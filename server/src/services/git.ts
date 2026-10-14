import { promises as fs } from 'node:fs';
import path from 'node:path';
import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git';
import { getSettings } from './settings.js';
import { getVaultRoot } from './vault.js';
import { redactUrlCreds } from '../lib/redact.js';
import {
  authedRemoteWithApp,
  createOrGetPullRequest,
  dispatchWorkflow,
  findOpenPullRequest,
  isGithubAppConfigured,
  parseGithubRemote,
} from './githubApp.js';
import { buildCommitMessage, isValidCommitMessage } from './commitTemplate.js';

/** GitHub-native sync with Git LFS support (PRD FR-4). */

export interface GitStatus {
  enabled: boolean;
  isRepo: boolean;
  branch: string;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  notAdded: number;
  conflicted: string[];
  lfsAvailable: boolean;
  remote: string;
  clean: boolean;
}

async function git(): Promise<SimpleGit> {
  const root = await getVaultRoot();
  await fs.mkdir(root, { recursive: true });
  // `timeout.block`: abort a command that produces no output for this long, so a
  // dead network push/pull can't hang forever and wedge the serial queue below.
  return simpleGit({ baseDir: root, trimmed: true, timeout: { block: 120_000 } });
}

// ---------------------------------------------------------------------------
// Serialized git access + stale-lock self-healing
//
// Auto-sync (every 30s), the debounced commit-on-save, and the manual /git/*
// routes all drive git on the SAME repo. Run two at once and their `git add`/
// `commit` collide on `.git/index.lock` ("Another git process seems to be
// running") — and a command killed mid-write leaves that lock behind, which then
// wedges EVERY later op (the "completely dead" state). Funnelling all mutating
// ops through one async queue removes the race; clearing a stale lock at the head
// of each op heals a leftover from a crash or an external Obsidian-git process.
// ---------------------------------------------------------------------------
let gitQueue: Promise<unknown> = Promise.resolve();

/** A lock a live git process holds is gone within a second for a notes vault; one
 *  older than this is orphaned. Generous enough that even an external LFS commit
 *  in flight is never yanked, small enough that a crash leftover self-heals fast. */
const STALE_LOCK_MS = 15_000;

async function clearStaleLocks(): Promise<void> {
  const gitDir = path.join(await getVaultRoot(), '.git');
  for (const name of ['index.lock', 'HEAD.lock', 'config.lock']) {
    const lock = path.join(gitDir, name);
    try {
      const { mtimeMs } = await fs.stat(lock);
      const age = Date.now() - mtimeMs;
      if (age >= STALE_LOCK_MS) {
        await fs.rm(lock, { force: true });
        console.warn(`[git] cleared stale ${name} (age ${Math.round(age / 1000)}s)`);
      }
    } catch {
      /* lock absent — nothing to clear */
    }
  }
}

/** Run `fn` with exclusive access to the vault repo, after self-healing any stale
 *  lock. Ops queue (never overlap); a rejecting op doesn't poison the queue. */
function withGitLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = gitQueue.then(async () => {
    await clearStaleLocks();
    return fn();
  });
  gitQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

// Public, serialized git operations. Each delegates to its private *Impl below;
// callers that already hold the lock (e.g. syncImpl) call the *Impl directly to
// avoid re-entering the queue and dead-locking.
export const status = (): Promise<GitStatus> => withGitLock(statusImpl);
export const pull = (): Promise<string> => withGitLock(pullImpl);
export const push = (branch?: string): Promise<string> => withGitLock(() => pushImpl(branch));
export const commitAll = (message?: string, paths?: string[]): Promise<string> =>
  withGitLock(() => commitAllImpl(message, paths));
export const init = (): Promise<void> => withGitLock(initImpl);
export const clone = (): Promise<void> => withGitLock(cloneImpl);
export const sync = (message?: string, branch?: string, paths?: string[]): Promise<{ ok: boolean; log: string[] }> =>
  withGitLock(() => syncImpl(message, branch, paths));
export const changes = (): Promise<GitChange[]> => withGitLock(changesImpl);
export const discard = (paths: string[]): Promise<number> => withGitLock(() => discardImpl(paths));

/** Compose an authenticated remote URL from settings (PAT embedded). */
async function authedRemote(): Promise<string> {
  const s = await getSettings();
  const url = s.git.remote.trim();
  if (!url) return '';
  // GitHub App 优先：用 installation token 拼鉴权地址（自动轮换、权限更细）。
  if (await isGithubAppConfigured()) {
    const viaApp = await authedRemoteWithApp(url).catch(() => null);
    if (viaApp) return viaApp;
  }
  if (s.git.token && url.startsWith('https://')) {
    // https://<token>@github.com/owner/repo.git
    const without = url.replace(/^https:\/\//, '');
    if (without.includes('@')) return url; // already has creds
    return `https://${s.git.token}@${without}`;
  }
  return url;
}

/** 在线编辑要推送的目标分支：优先 GitHub 配置的 editBranch，否则回退 git.branch。 */
async function editBranch(): Promise<string> {
  const s = await getSettings();
  return (s.github.editBranch || s.git.branch || 'web-edit').trim();
}

async function isRepo(g: SimpleGit): Promise<boolean> {
  try {
    return await g.checkIsRepo();
  } catch {
    return false;
  }
}

export async function lfsAvailable(): Promise<boolean> {
  try {
    const g = await git();
    await g.raw(['lfs', 'version']);
    return true;
  } catch {
    return false;
  }
}

async function configureIdentity(g: SimpleGit): Promise<void> {
  const s = await getSettings();
  await g.addConfig('user.name', s.git.authorName || 'WebObsidian');
  await g.addConfig('user.email', s.git.authorEmail || 'webobsidian@localhost');
}

/** Write/refresh .gitattributes so LFS patterns are tracked. */
export async function ensureLfsAttributes(): Promise<void> {
  const s = await getSettings();
  if (!s.git.lfsPatterns.length) return;
  const root = await getVaultRoot();
  const file = path.join(root, '.gitattributes');
  let existing = '';
  try {
    existing = await fs.readFile(file, 'utf8');
  } catch {
    /* none */
  }
  const lines = new Set(
    existing
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      // Drop any leftover git merge-conflict markers so resolving a .gitattributes
      // conflict by regenerating never bakes `<<<<<<<`/`=======`/`>>>>>>>` into the file.
      .filter((l) => !/^(<{7}|={7}|>{7})/.test(l)),
  );
  for (const p of s.git.lfsPatterns) {
    lines.add(`${p} filter=lfs diff=lfs merge=lfs -text`);
  }
  // Write a CANONICAL (sorted) .gitattributes so every device/instance produces a
  // byte-identical file. Otherwise each side rewrites it in a different order and
  // every sync conflicts on .gitattributes — which silently wedges the repo in an
  // unfinished merge and stops sync entirely. Only write when content changes.
  const content = [...lines].sort().join('\n') + '\n';
  if (content !== existing) await fs.writeFile(file, content);

  // Install the LFS filters locally, but DON'T `git lfs track`: that rewrites
  // .gitattributes itself (non-deterministically), reintroducing the conflict above.
  if (await lfsAvailable()) {
    const g = await git();
    await g.raw(['lfs', 'install', '--local']).catch(() => {});
  }
}

async function initImpl(): Promise<void> {
  const g = await git();
  const s = await getSettings();
  const branch = await editBranch();
  if (!(await isRepo(g))) {
    await g.init();
    await g.checkoutLocalBranch(branch).catch(() => {});
  }
  await configureIdentity(g);
  const remote = await authedRemote();
  if (remote) {
    const remotes = await g.getRemotes(true);
    if (remotes.find((r) => r.name === 'origin')) {
      await g.remote(['set-url', 'origin', remote]);
    } else {
      await g.addRemote('origin', remote);
    }
  }
  await ensureLfsAttributes();
}

/** Clone the configured remote into the (empty) vault dir. */
async function cloneImpl(): Promise<void> {
  const s = await getSettings();
  const remote = await authedRemote();
  if (!remote) throw new Error('No remote configured');
  const root = await getVaultRoot();
  const branch = s.github.editBranch || s.git.branch || 'main';
  const entries = await fs.readdir(root).catch(() => []);
  if (entries.filter((e) => e !== '.git').length > 0) {
    throw new Error('Vault directory not empty; cannot clone into it');
  }
  const g = simpleGit();
  await g.clone(remote, root, ['--branch', branch]);
  const gv = await git();
  await configureIdentity(gv);
  if (await lfsAvailable()) await gv.raw(['lfs', 'pull']).catch(() => {});
}

async function statusImpl(): Promise<GitStatus> {
  const s = await getSettings();
  const g = await git();
  const repo = await isRepo(g);
  if (!repo) {
    return {
      enabled: s.git.enabled,
      isRepo: false,
      branch: s.git.branch,
      ahead: 0,
      behind: 0,
      staged: 0,
      modified: 0,
      notAdded: 0,
      conflicted: [],
      lfsAvailable: await lfsAvailable(),
      remote: s.git.remote,
      clean: true,
    };
  }
  const st = await g.status();
  return {
    enabled: s.git.enabled,
    isRepo: true,
    branch: st.current ?? s.git.branch,
    ahead: st.ahead,
    behind: st.behind,
    staged: st.staged.length,
    modified: st.modified.length,
    notAdded: st.not_added.length,
    conflicted: st.conflicted,
    lfsAvailable: await lfsAvailable(),
    remote: s.git.remote,
    clean: st.isClean(),
  };
}

export interface GitCommit {
  hash: string;
  date: string;
  message: string;
  author: string;
}

/**
 * Recent commits touching `filePath` (vault-relative), newest first. Returns []
 * when the vault isn't a git repo or the file has no history yet — the version
 * history UI treats that as "no versions".
 */
export async function log(filePath: string, limit = 50): Promise<GitCommit[]> {
  const g = await git();
  if (!(await isRepo(g))) return [];
  // 入参为「相对内容根」路径，git 需要「相对仓库根」路径。
  const repoPath = contentToRepo(filePath, await contentRootPrefix());
  try {
    const res = await g.log({ file: repoPath, maxCount: limit });
    return res.all.map((c) => ({
      hash: c.hash,
      date: c.date,
      message: c.message,
      author: c.author_name,
    }));
  } catch {
    return [];
  }
}

/** File contents at a specific commit (`git show <hash>:<path>`). 入参为相对内容根路径。 */
export async function showFile(hash: string, filePath: string): Promise<string> {
  const g = await git();
  const repoPath = contentToRepo(filePath, await contentRootPrefix());
  // simple-git's show() takes the pathspec as one element; `<hash>:<path>`.
  return g.show([`${hash}:${repoPath}`]);
}

async function pullImpl(): Promise<string> {
  const g = await git();
  await ensureLfsAttributes();
  const s = await getSettings();
  // Pull must use the authenticated remote too. push() set-urls before pushing but
  // pull() didn't, so a fresh clone's tokenless origin made pull fail auth → "Pull
  // skipped" → the subsequent push hit a diverged remote → "fetch first" forever.
  const remote = await authedRemote();
  if (remote) await g.remote(['set-url', 'origin', remote]);
  const branch = await editBranch();
  // `--allow-unrelated-histories`: a vault that was `git init`'d locally and a
  // remote that already has commits have no common ancestor; without this, the
  // first pull aborts with "refusing to merge unrelated histories" and sync can
  // never converge. Harmless (no-op) once the histories share a base.
  const res = await g.pull('origin', branch, {
    '--no-rebase': null,
    '--allow-unrelated-histories': null,
    // 部分提交后，未勾选的文件仍是「未提交改动」，会阻止 pull 的 merge。
    // --autostash 会临时 stash 这些改动、pull 完再恢复，保证投稿流程不中断。
    '--autostash': null,
  });
  if (await lfsAvailable()) await g.raw(['lfs', 'pull']).catch(() => {});
  return `Pulled: ${res.summary.changes} changes, +${res.summary.insertions}/-${res.summary.deletions}`;
}

/**
 * 单个工作区变更（供前端展示 git 风格的文件列表）。
 * path 使用「相对内容根」的路径（与文件树一致，如 `about/contribute.md`）。
 */
export interface GitChange {
  path: string; // 相对内容根（vault.root）
  /** 变更类型：新增/修改/删除/改名/复制/冲突。 */
  kind: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'conflicted';
  /** 该文件是否已在暂存区。 */
  staged: boolean;
}

/** 把 simple-git 的状态字母映射为变更类型。 */
function changeKind(f: { index?: string; working_dir?: string }): GitChange['kind'] {
  const x = (f.index?.trim() || f.working_dir?.trim() || '').toUpperCase();
  if (x === 'A' || x === '?') return 'added';
  if (x === 'D') return 'deleted';
  if (x === 'R') return 'renamed';
  if (x === 'C') return 'copied';
  if (x === 'U') return 'conflicted';
  return 'modified';
}

/** 内容根相对仓库根的前缀（如 'docs/start'），空串表示仓库根。 */
async function contentRootPrefix(): Promise<string> {
  const s = await getSettings();
  return (s.vault.root ?? '').trim().replace(/^[/\\]+|[/\\]+$/g, '');
}

/** 仓库相对路径 → 内容根相对路径；不在内容根内返回 null。 */
function repoToContent(p: string, root: string): string | null {
  const clean = p.replace(/^[/\\]+/, '');
  if (!root) return clean;
  if (clean === root) return '';
  if (clean.startsWith(root + '/')) return clean.slice(root.length + 1);
  return null;
}

/** 内容根相对路径 → 仓库相对路径。 */
function contentToRepo(p: string, root: string): string {
  const clean = p.replace(/^[/\\]+/, '');
  return root ? `${root}/${clean}` : clean;
}

/** 路径各段均非空且不以点开头（排除 `.trash`、`.obsidian`、`.git` 等）。 */
function hasNoDotSegments(rel: string): boolean {
  return rel.split('/').every((seg) => seg && !seg.startsWith('.'));
}

/**
 * 列出工作区变更（含未跟踪文件），供提交对话框展示与勾选。
 * 只保留「内容根目录」下的文件（与文件树一致），并排除回收站 `.trash` 与
 * 点文件/点目录——这些不是编辑器管理的笔记，不应出现在待提交列表里。
 * 返回的 path 为「相对内容根」，与文件树口径一致。
 */
async function changesImpl(): Promise<GitChange[]> {
  const g = await git();
  if (!(await isRepo(g))) return [];
  const st = await g.status();
  const root = await contentRootPrefix();
  const out: GitChange[] = [];
  for (const f of st.files) {
    const rel = repoToContent(f.path, root);
    if (rel === null || !rel || !hasNoDotSegments(rel)) continue;
    out.push({
      path: rel,
      kind: changeKind(f),
      // index 非空/非 '?' 表示已暂存（' ' 或 '?' 表示未暂存）。
      staged: Boolean(f.index && f.index.trim() && f.index !== '?'),
    });
  }
  return out;
}

/**
 * 舍弃指定路径的未提交改动，恢复到 HEAD（VS Code 的「Discard Changes」）。
 * 入参为「相对内容根」路径。已跟踪文件用 `checkout HEAD --` 还原；未跟踪的
 * 新文件用 `clean -f` 删除。返回实际处理的路径数。
 */
async function discardImpl(paths: string[]): Promise<number> {
  const g = await git();
  if (!(await isRepo(g))) return 0;
  const root = await contentRootPrefix();
  const clean = paths
    .map((p) => String(p))
    .filter((p) => p && !p.startsWith('/') && !p.includes('\0'));
  if (!clean.length) return 0;
  const repoPaths = clean.map((p) => contentToRepo(p, root));

  // 先看哪些是未跟踪的新文件（index 为 '?'），这些要 clean 而不是 checkout。
  const st = await g.status();
  const untracked = new Set(
    st.files.filter((f) => (f.index ?? '').trim() === '?').map((f) => f.path),
  );
  const tracked = repoPaths.filter((p) => !untracked.has(p));
  const newFiles = repoPaths.filter((p) => untracked.has(p));

  if (tracked.length) {
    // 还原工作区 + 暂存区到 HEAD（既撤销修改也取消暂存）。
    await g.raw(['checkout', 'HEAD', '--', ...tracked]);
  }
  if (newFiles.length) {
    await g.raw(['clean', '-f', '--', ...newFiles]);
  }
  return clean.length;
}

/**
 * 只暂存指定路径（VS Code 式部分提交）。入参为「相对内容根」路径。先清空
 * 暂存区，再按路径 `git add -A`（同时覆盖新增/修改/删除）。paths 为空时
 * 回退为「内容根目录下的全部改动」（排除 `.trash` 等点目录）。
 */
async function stagePaths(g: SimpleGit, paths: string[]): Promise<void> {
  const root = await contentRootPrefix();
  if (!paths.length) {
    // 未指定路径：只暂存内容根，排除回收站，避免把垃圾/越界文件带上。
    const spec = root || '.';
    await g.raw(['add', '-A', '--', spec, `:(exclude)${spec}/.trash`]).catch(async () => {
      await g.add(spec);
    });
    return;
  }
  // 清空暂存区，保证「只提交勾选的文件」语义可预测（本应用不依赖既有暂存状态）。
  await g.raw(['reset']).catch(() => {});
  const repoPaths = paths
    .map((p) => String(p))
    .filter((p) => p && !p.startsWith('/') && !p.includes('\0'))
    .map((p) => contentToRepo(p, root));
  await g.raw(['add', '-A', '--', ...repoPaths]);
}

/**
 * Build a commit message from what was staged, so the vault history (and the
 * Version History UI) shows exactly which notes synced instead of a generic
 * "WebObsidian auto-sync". Returns a one-line subject that names the notes plus
 * a body listing every changed path grouped by kind.
 *
 * 主题行必须符合 Wiki 仓库 CI 的「中文前缀: 详细说明」规范（无消息提交时也
 * 不能产生英文兜底信息，否则 PR 检查会失败）。
 */
export function describeChanges(st: StatusResult): { subject: string; body: string } {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const renamed: string[] = [];
  for (const f of st.files) {
    // 只看「已暂存」的文件：部分提交时未勾选的文件仍在工作区，不应写进提交信息。
    // index 为 ' ' 或 '?' 表示未暂存（'?' = 未跟踪的新文件）。
    const idx = (f.index ?? '').trim();
    if (!idx || idx === '?') continue;
    const x = idx.toUpperCase();
    if (x === 'A' || x === 'C') added.push(f.path);
    else if (x === 'D') deleted.push(f.path);
    else if (x === 'R') renamed.push(f.path);
    else modified.push(f.path);
  }
  const all = [...added, ...modified, ...deleted, ...renamed];
  const total = all.length;
  // Display name: basename without the .md extension (notes read best that way).
  const name = (p: string) => (p.split('/').pop() || p).replace(/\.md$/i, '');

  // 根据改动类型选一个合规的中文前缀（见 commitTemplate.ts 的 COMMIT_PREFIXES）。
  const pickPrefix = (): string => {
    if (total === 0) return '修订';
    if (added.length === total) return '新增';
    if (deleted.length === total) return '移除';
    if (renamed.length === total) return '调整';
    return '修订';
  };

  let subject: string;
  if (total === 0) {
    subject = '修订: 同步知识库';
  } else if (total === 1) {
    // CI 要求冒号后描述至少 2 个字符；文件名过短时补足。
    const n = name(all[0]);
    subject = `${pickPrefix()}: ${n.length >= 2 ? n : `笔记 ${n}`}`;
  } else {
    const names = all.slice(0, 3).map(name).join('、');
    const more = total > 3 ? ` 等 ${total} 篇` : '';
    subject = `${pickPrefix()}: 同步 ${total} 篇笔记（${names}${more}）`;
  }
  // Keep the subject a sane git title length.
  if (subject.length > 72) subject = subject.slice(0, 71) + '…';

  const section = (label: string, arr: string[]): string => {
    if (!arr.length) return '';
    const CAP = 100;
    const lines = arr.slice(0, CAP).map((p) => `  ${p}`);
    if (arr.length > CAP) lines.push(`  …以及另外 ${arr.length - CAP} 个`);
    return `${label}（${arr.length}）：\n${lines.join('\n')}`;
  };
  const body = [
    section('新增', added),
    section('修改', modified),
    section('删除', deleted),
    section('重命名', renamed),
  ].filter(Boolean).join('\n\n');

  return { subject, body };
}

async function commitAllImpl(message?: string, paths?: string[]): Promise<string> {
  const g = await git();
  await configureIdentity(g);
  await ensureLfsAttributes();
  // 指定 paths 时只暂存这些文件（部分提交）；否则暂存全部。
  await stagePaths(g, paths ?? []);
  const st = await g.status();
  // 没有暂存内容 → 无需提交（勾选的文件可能没有实际改动）。
  if (st.staged.length === 0) return 'Nothing to commit';
  const { subject, body } = describeChanges(st);
  // A caller-supplied message (e.g. a manual commit with a typed message) wins
  // as the subject; otherwise auto-derive one naming the notes. The file list
  // always goes in the body so `git log` shows precisely what was synced.
  const supplied = message?.trim();
  // 在线编辑必须经过提交模板：调用方传入的信息需符合「中文前缀: 描述」规范，
  // 否则拒绝提交（避免产生不符合 Wiki 仓库 CI 校验的提交）。
  if (supplied && !isValidCommitMessage(supplied)) {
    throw new Error(
      '提交信息不符合规范，请使用「中文前缀: 详细说明」格式（例如「新增: 添加市北校区建筑与设施信息」）',
    );
  }
  const finalSubject = supplied || subject;
  const full = body ? `${finalSubject}\n\n${body}` : finalSubject;
  const res = await g.commit(full);
  return `Committed ${res.commit || ''} (${res.summary.changes} files): ${finalSubject}`;
}

async function pushImpl(branchOverride?: string): Promise<string> {
  const g = await git();
  // 访客投稿强制推送到 web-edit（branchOverride），不信任任何客户端输入。
  const branch = branchOverride || (await editBranch());
  const remote = await authedRemote();
  if (remote) await g.remote(['set-url', 'origin', remote]);
  // 在线编辑统一推送到 origin/<editBranch>（默认 web-edit）。
  // 用显式 refspec 推送当前 HEAD，避免本地分支名与目标分支名不一致的问题。
  await g.push('origin', `HEAD:refs/heads/${branch}`);
  return `已推送到 origin/${branch}`;
}

/**
 * 为在线编辑分支创建（或复用）Pull Request：editBranch → baseBranch。
 * 需要 GitHub App 已配置且能解析出 owner/repo。
 */
export async function openPullRequest(opts?: {
  title?: string;
  body?: string;
}): Promise<{ number: number; html_url: string; created: boolean }> {
  const s = await getSettings();
  if (!(await isGithubAppConfigured())) {
    throw new Error('GitHub App 尚未配置，无法创建 PR');
  }
  const remote = s.git.remote.trim();
  const parsed = parseGithubRemote(remote);
  const owner = s.github.owner || parsed?.owner || '';
  const repo = s.github.repo || parsed?.repo || '';
  if (!owner || !repo) throw new Error('无法确定目标仓库（owner/repo）');
  const head = s.github.editBranch || 'web-edit';
  const base = s.github.baseBranch || s.git.branch || 'contribute';
  const title = opts?.title?.trim() || `在线编辑: 更新 ${head} 分支`;
  const body =
    opts?.body?.trim() ||
    `本 PR 由 QUT WiKi 在线编辑器自动创建，来源分支：\`${head}\`，目标分支：\`${base}\`。\n\n请审核内容后合并。`;
  return createOrGetPullRequest({ owner, repo, title, body, head, base });
}

/** 解析远程仓库的 owner/repo（settings.github 优先，回退解析 remote URL）。 */
async function resolveRepoRef(): Promise<{ owner: string; repo: string }> {
  const s = await getSettings();
  const parsed = parseGithubRemote(s.git.remote.trim());
  return { owner: s.github.owner || parsed?.owner || '', repo: s.github.repo || parsed?.repo || '' };
}

/** 查询编辑分支是否存在未合并的 PR；无法判断（App 未配置）时返回 null。 */
async function openPrForEdit(): Promise<{ number: number; html_url: string; base: string } | null> {
  const { owner, repo } = await resolveRepoRef();
  if (!owner || !repo || !(await isGithubAppConfigured())) return null;
  return findOpenPullRequest({ owner, repo, head: await editBranch() });
}

/**
 * 编辑分支是否已包含主分支（即不落后）。
 * 注意：不能用 `git merge-base --is-ancestor`——simple-git 的 raw() 在该命令以
 * 退出码 1（非祖先）结束时仍会 resolve，导致误判。改用 `rev-list --count`：
 * `<editRef>..<baseRef>` 为主分支有、编辑分支没有的提交数，为 0 即已包含。
 */
async function editContainsBase(g: SimpleGit, baseRef: string, editRef: string): Promise<boolean> {
  const out = await g.raw(['rev-list', '--count', `${editRef}..${baseRef}`]).catch(() => '1');
  return Number(out.trim()) === 0;
}

/**
 * 把主分支合并进本地编辑分支并推送（假定已确认需要合并）。
 * --autostash：访客可能正在编辑（工作区有未提交改动），先临时 stash 再合并，合并后自动恢复。
 */
async function mergeBaseIntoEdit(
  g: SimpleGit,
  baseRef: string,
  edit: string,
): Promise<{ ok: boolean; log: string[] }> {
  // 确保本地在编辑分支上，且与远端一致（无本地独有提交时快进）。
  const st = await g.status();
  if (st.current !== edit) await g.checkout(edit).catch(() => {});
  await g.raw(['merge', '--ff-only', `origin/${edit}`]).catch(() => {});

  try {
    await g.merge([baseRef, '--no-edit', '--autostash']);
  } catch {
    // 合并冲突：能自动解决的生成文件冲突就解决，否则中止并报告。
    if (await resolveNoiseConflicts(g)) {
      await g.raw(['commit', '--no-edit']).catch(() => {});
    } else {
      const cst = await g.status();
      await g.raw(['merge', '--abort']).catch(() => {});
      return { ok: false, log: [`合并主分支产生冲突，已中止：${cst.conflicted.join(', ')}`] };
    }
  }

  try {
    await g.push('origin', `HEAD:refs/heads/${edit}`);
  } catch (e: any) {
    return { ok: false, log: [`推送失败：${redactUrlCreds(e.message)}`] };
  }
  return { ok: true, log: [`已合并主分支 ${baseRef.replace(/^origin\//, '')} → ${edit}`] };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 投稿前的分支状态检查：确保编辑分支基于最新的主分支。
 *
 * - 编辑分支有未合并 PR：上一批编辑仍在审核，提示等待维护者合并，本次中止；
 * - 编辑分支落后主分支（Actions 空窗期）：优先触发 GitHub Actions 同步工作流并
 *   轮询等待追平；无法触发（App 无 Actions 权限）或超时则本地合并主分支兜底。
 *
 * 返回 { blocked: true } 表示应中止本次投稿。
 */
async function preSyncCheck(g: SimpleGit, s: Awaited<ReturnType<typeof getSettings>>): Promise<{ blocked: boolean; log: string[] }> {
  const log: string[] = [];
  const edit = await editBranch();
  const base = (s.github.baseBranch || s.git.branch || 'contribute').trim();
  if (!base || base === edit) return { blocked: false, log };

  const { owner, repo } = await resolveRepoRef();
  const appReady = owner && repo && (await isGithubAppConfigured());

  // 1) 有未合并 PR → 等待维护者合并。
  if (appReady) {
    try {
      const pr = await findOpenPullRequest({ owner, repo, head: edit });
      if (pr) {
        return {
          blocked: true,
          log: [`编辑分支已有未合并的 PR #${pr.number}（${pr.html_url}），请等待维护者合并后再提交`],
        };
      }
    } catch (e: any) {
      log.push(`检查 PR 状态失败（继续）：${redactUrlCreds(e.message)}`);
    }
  }

  // 2) 编辑分支是否落后主分支。
  await g.raw(['fetch', 'origin', base, edit]).catch(() => {});
  const baseRef = `origin/${base}`;
  if (await editContainsBase(g, baseRef, `origin/${edit}`)) return { blocked: false, log }; // 已最新

  // 空窗期：优先触发 Actions 同步工作流（若 App 有 Actions 权限）。
  if (appReady) {
    try {
      await dispatchWorkflow({ owner, repo, workflow: 'sync-web-edit.yml', ref: base });
      log.push('已触发 GitHub Actions 同步工作流，等待编辑分支跟进主分支…');
      for (let i = 0; i < 6; i++) {
        await sleep(5000);
        await g.raw(['fetch', 'origin', edit]).catch(() => {});
        if (await editContainsBase(g, baseRef, `origin/${edit}`)) {
          log.push('编辑分支已跟进主分支');
          return { blocked: false, log };
        }
      }
      log.push('工作流未在预期时间内完成，改为本地同步');
    } catch (e: any) {
      log.push(`触发同步工作流失败，改为本地同步：${redactUrlCreds(e.message)}`);
    }
  }

  // 兜底：本地合并主分支（此时 Actions 若已结束则不会与其竞争）。
  const res = await mergeBaseIntoEdit(g, baseRef, edit);
  log.push(...res.log);
  return { blocked: false, log };
}

/**
 * 让编辑分支自动跟进主分支（定时任务调用）：把 baseBranch（如 contribute）合并进
 * editBranch（如 web-edit），使在线编辑器始终基于最新的主分支内容。
 *
 * 规则：
 * - 编辑分支存在**未合并的 PR** 时暂停跟进，避免把待审核的编辑内容与主分支改动混在一起；
 * - 主分支已是编辑分支的祖先时（无新提交）直接跳过；
 * - 合并通常是快进（fast-forward），不会产生多余的合并提交。
 */
async function followBaseImpl(): Promise<{ ok: boolean; merged: boolean; log: string[] }> {
  const log: string[] = [];
  const s = await getSettings();
  const g = await git();
  if (!(await isRepo(g))) return { ok: true, merged: false, log: ['非 git 仓库，跳过'] };

  const edit = await editBranch();
  const base = (s.github.baseBranch || s.git.branch || 'contribute').trim();
  if (!base || base === edit) return { ok: true, merged: false, log: ['主分支与编辑分支相同，跳过'] };

  const remote = await authedRemote();
  if (remote) await g.remote(['set-url', 'origin', remote]);

  // 有未合并 PR → 暂停跟进。
  try {
    const pr = await openPrForEdit();
    if (pr) {
      return { ok: true, merged: false, log: [`编辑分支存在未合并 PR #${pr.number}，暂停跟进主分支`] };
    }
  } catch (e: any) {
    // 查询失败（网络/权限）时保守跳过，避免误合并。
    return { ok: false, merged: false, log: [`检查 PR 失败，跳过跟进：${redactUrlCreds(e.message)}`] };
  }

  // 拉取主分支与编辑分支的最新引用。
  await g.raw(['fetch', 'origin', base, edit]).catch(() => {});
  const baseRef = `origin/${base}`;

  // 主分支已是编辑分支祖先 → 无新提交。
  if (await editContainsBase(g, baseRef, `origin/${edit}`)) {
    return { ok: true, merged: false, log: ['编辑分支已包含主分支最新提交，无需跟进'] };
  }

  const res = await mergeBaseIntoEdit(g, baseRef, edit);
  return { ok: res.ok, merged: res.ok, log: res.log };
}

/** 公开的、串行化的「跟进主分支」操作（与其它 git 操作共用队列）。 */
export const followBase = (): Promise<{ ok: boolean; merged: boolean; log: string[] }> =>
  withGitLock(followBaseImpl);

// Debounced auto-commit (+push) after saves, when enabled in settings.
let autoCommitTimer: NodeJS.Timeout | null = null;
export function scheduleAutoCommitOnSave(): void {
  if (autoCommitTimer) clearTimeout(autoCommitTimer);
  autoCommitTimer = setTimeout(async () => {
    try {
      const s = await getSettings();
      if (!s.git.enabled || !s.git.autoCommitOnSave) return;
      // Full sync (pull→merge→push), not a bare push: pushing without first
      // integrating the remote is exactly what left the repo permanently rejected
      // ("fetch first") once another device had pushed in the meantime.
      if (s.git.remote) await sync().catch((e) => console.warn('[git] auto-sync failed:', redactUrlCreds(e?.message)));
      else await commitAll();
    } catch (e: any) {
      console.warn('[git] auto-commit failed:', redactUrlCreds(e.message));
    }
  }, 5000);
}

/** Auto-resolve conflicts in machine-generated files so multi-device sync converges
 *  without manual intervention: regenerate .gitattributes, keep our copy of Obsidian
 *  UI state (.obsidian/**). Returns true only if ALL conflicts were resolved. */
async function resolveNoiseConflicts(g: SimpleGit): Promise<boolean> {
  const st = await g.status();
  if (!st.conflicted.length) return true;
  let remaining = 0;
  for (const f of st.conflicted) {
    if (f === '.gitattributes') {
      await ensureLfsAttributes();
      await g.add(['.gitattributes']);
    } else if (f.startsWith('.obsidian/')) {
      await g.raw(['checkout', '--ours', '--', f]).catch(() => {});
      await g.add([f]);
    } else {
      remaining++;
    }
  }
  return remaining === 0;
}

/** If a previous sync left an unfinished/conflicted merge, get back to a clean state
 *  so the next sync isn't permanently stuck on "you have unmerged files". */
async function recoverMerge(g: SimpleGit): Promise<void> {
  const root = await getVaultRoot();
  try {
    await fs.access(path.join(root, '.git', 'MERGE_HEAD'));
  } catch {
    return; // not mid-merge
  }
  if (await resolveNoiseConflicts(g)) {
    await g.raw(['commit', '--no-edit']).catch(() => {});
  } else {
    await g.raw(['merge', '--abort']).catch(async () => {
      await g.raw(['reset', '--merge']).catch(() => {});
    });
  }
}

/** Convenience: stage+commit+pull+push in one go. Reports conflicts. Runs entirely
 *  inside the git queue (via the exported `sync` wrapper), so it calls the unlocked
 *  *Impl helpers directly — re-entering withGitLock here would dead-lock. */
async function syncImpl(
  message?: string,
  branchOverride?: string,
  paths?: string[],
): Promise<{ ok: boolean; log: string[] }> {
  const log: string[] = [];
  const g = await git();
  if (!(await isRepo(g))) {
    await initImpl();
    log.push('Initialized repository');
  }
  await recoverMerge(g); // unwedge a prior stuck merge before doing anything
  log.push(await commitAllImpl(message || '', paths));

  // 投稿前检查：编辑分支必须基于最新主分支。若已有未合并 PR 则中止本次投稿；
  // 若处于 Actions 空窗期则触发同步工作流（或本地合并）先行跟进。
  const s = await getSettings();
  const pre = await preSyncCheck(g, s);
  if (pre.log.length) log.push(...pre.log);
  if (pre.blocked) return { ok: false, log };

  try {
    log.push(await pullImpl());
  } catch (e: any) {
    // Pull hit a merge conflict. Auto-resolve generated-file noise and finish the
    // merge; only bail (cleanly, not wedged) if real note conflicts remain.
    if (await resolveNoiseConflicts(g)) {
      await g.raw(['commit', '--no-edit']).catch(() => {});
      if (await lfsAvailable()) await g.raw(['lfs', 'pull']).catch(() => {});
      log.push('Pulled (auto-resolved generated-file conflicts)');
    } else {
      const st = await g.status();
      await g.raw(['merge', '--abort']).catch(() => {});
      return { ok: false, log: [...log, `Conflicts need manual resolution: ${st.conflicted.join(', ')}`] };
    }
  }
  try {
    log.push(await pushImpl(branchOverride));
  } catch (e: any) {
    // Redact: a push failure echoes the authenticated remote URL (PAT embedded).
    log.push(`Push failed: ${redactUrlCreds(e.message)}`);
    return { ok: false, log };
  }
  // 推送成功后，如启用 GitHub App 且开启自动 PR，则为 web-edit → base 创建/复用 PR。
  try {
    if (s.github.autoPullRequest && (await isGithubAppConfigured())) {
      const pr = await openPullRequest();
      log.push(pr.created ? `已创建 PR #${pr.number}：${pr.html_url}` : `已复用现有 PR #${pr.number}：${pr.html_url}`);
    }
  } catch (e: any) {
    log.push(`PR 创建失败（内容已推送）：${redactUrlCreds(e.message)}`);
  }
  return { ok: true, log };
}
