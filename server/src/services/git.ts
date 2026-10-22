import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git';
import { getSettings, withSettingsSnapshotLock } from './settings.js';
import { getVaultRoot, canonicalRelativePath, getContentRoot } from './vault.js';
import { assertGuestWritable, isGuestWritable } from './guestpath.js';
import { redactUrlCreds } from '../lib/redact.js';
import {
  authedRemoteWithApp,
  createOrGetPullRequest,
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

/** Do not pass inherited editor/pager/command variables into Git. */
function gitEnvironment(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '',
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    LANG: 'C.UTF-8', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', ...extra,
  };
}

async function git(): Promise<SimpleGit> {
  const root = await getVaultRoot();
  await fs.mkdir(root, { recursive: true });
  // `timeout.block`: abort a command that produces no output for this long, so a
  // dead network push/pull can't hang forever and wedge the serial queue below.
  const env = gitEnvironment();
  return simpleGit({ baseDir: root, trimmed: true, timeout: { block: 120_000 }, allowEnvironment: Object.keys(env) }).env(env);
}

// Serialize this process and coordinate cooperating local instances. Existing Git
// locks are never removed based on their age; recovery requires operator review.
let gitQueue: Promise<unknown> = Promise.resolve();
function withGitLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = gitQueue.then(() => withSettingsSnapshotLock(async () => {
    const gitDir = path.join(await getVaultRoot(), '.git');
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    const ownLock = path.join(gitDir, 'webobsidian-operation.lock');
    try {
      if ((await fs.stat(gitDir).catch(() => null))?.isDirectory()) {
        try { handle = await fs.open(ownLock, 'wx', 0o600); }
        catch (e: any) { if (e?.code === 'EEXIST') throw new Error('Repository operation already running; inspect the operation lock before recovery'); throw e; }
      }
      return await fn();
    } finally {
      if (handle) { await handle.close(); await fs.unlink(ownLock); }
    }
  }));
  gitQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function assertRepositoryIdle(g: SimpleGit): Promise<void> {
  const root = await getVaultRoot();
  for (const name of ['index.lock', 'HEAD.lock', 'config.lock', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    if (await fs.lstat(path.join(root, '.git', name)).then(() => true, (e: any) => { if (e?.code === 'ENOENT') return false; throw e; })) {
      throw new Error('Repository has an active lock or unfinished operation; preserve it and resolve before retrying');
    }
  }
  if ((await g.status()).conflicted.length) throw new Error('Resolve repository conflicts before writing');
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
export const sync = (message?: string, branch?: string, paths?: string[], role: 'owner' | 'guest' = 'owner'): Promise<SyncResult> =>
  withGitLock(() => syncImpl(message, branch, paths, role));
export const changes = (): Promise<GitChange[]> => withGitLock(changesImpl);
export const discard = (paths: string[]): Promise<number> => withGitLock(() => discardImpl(paths));

/** Compose an authenticated remote URL from settings (PAT embedded). */
async function authedRemote(): Promise<string> {
  const s = await getSettings();
  const url = s.git.remote.trim();
  if (!url) return '';
  // GitHub App 优先：用 installation token 拼鉴权地址（自动轮换、权限更细）。
  if (await isGithubAppConfigured()) {
    const viaApp = await authedRemoteWithApp(url);
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

function validBranch(value: string): boolean {
  return Boolean(value) && value !== '@' && !/[\x00-\x20\x7f~^:?*\[\\]/.test(value)
    && !value.includes('..') && !value.includes('@{') && !value.startsWith('-')
    && !value.endsWith('.') && value.split('/').every(p => p && !p.startsWith('.') && !p.endsWith('.lock'));
}

/** Only the explicit edit branch controls writes. git.branch is legacy display data. */
async function editBranch(): Promise<string> {
  const s = await getSettings();
  const branch = s.github.editBranch.trim();
  if (!validBranch(branch)) throw new Error('Configure a valid explicit editing branch');
  return branch;
}

interface WriteTarget { remote: string; edit: string; base: string; owner: string; repo: string; local: boolean }
async function writeTarget(requirePr = false): Promise<WriteTarget> {
  const s = await getSettings();
  if (!s.git.enabled) throw new Error('Git writes are disabled');
  const remote = s.git.remote.trim();
  const edit = await editBranch();
  const base = s.github.baseBranch.trim();
  if (!validBranch(base) || base === edit) throw new Error('Configure distinct valid editing and review base branches');
  if (!remote) throw new Error('Configure the content repository remote explicitly');
  const local = path.isAbsolute(remote);
  const parsed = parseGithubRemote(remote);
  if (!local && !parsed) throw new Error('Remote must be a GitHub HTTPS/SSH URL or an absolute local repository path');
  const owner = s.github.owner.trim(), repo = s.github.repo.trim();
  if (!local) {
    if (!s.github.targetConfirmed) throw new Error('Confirm the content repository and branch configuration before Git writes');
    if (!owner || !repo || owner.toLowerCase() !== parsed!.owner.toLowerCase() || repo.toLowerCase() !== parsed!.repo.toLowerCase()) {
      throw new Error('Configured GitHub owner/repo does not match the content remote');
    }
  }
  if (requirePr && (local || !s.github.autoPullRequest || !(await isGithubAppConfigured()))) {
    throw new Error('Guest submissions require a configured matching GitHub App and pull request review');
  }
  if (!local && s.github.autoPullRequest && !(await isGithubAppConfigured())) throw new Error('Automatic pull requests require a configured GitHub App');
  return { remote, edit, base, owner, repo, local };
}

function remoteIdentity(remote: string): string {
  const parsed = parseGithubRemote(remote);
  return parsed ? `github:${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}` : path.resolve(remote);
}
async function assertTargetRepository(g: SimpleGit, target: WriteTarget): Promise<void> {
  if (!(await isRepo(g))) throw new Error('Initialize the content repository before submitting');
  await assertRepositoryIdle(g);
  const current = (await g.raw(['symbolic-ref', '--short', 'HEAD'])).trim();
  if (current !== target.edit) throw new Error('Current content branch is not the configured editing branch; no write was performed');
  const origin = (await g.raw(['remote', 'get-url', 'origin'])).trim();
  if (remoteIdentity(origin) !== remoteIdentity(target.remote)) throw new Error('Existing origin does not match the confirmed content remote');
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
  await writeTarget();
  const g = await git();
  const s = await getSettings();
  const branch = await editBranch();
  if (!(await isRepo(g))) {
    await g.init();
    await g.checkoutLocalBranch(branch).catch(() => {});
  }
  await configureIdentity(g);
  const remote = s.git.remote.trim();
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
  const target = await writeTarget();
  const s = await getSettings();
  const remote = await authedRemote();
  if (!remote) throw new Error('No remote configured');
  const root = await getVaultRoot();
  const branch = target.edit;
  const entries = await fs.readdir(root).catch(() => []);
  if (entries.filter((e) => e !== '.git').length > 0) {
    throw new Error('Vault directory not empty; cannot clone into it');
  }
  const env = gitEnvironment();
  const g = simpleGit({ allowEnvironment: Object.keys(env) }).env(env);
  try { await g.clone(remote, root, ['--branch', branch]); }
  finally {
    const local = await git();
    if (await isRepo(local)) await local.remote(['set-url', 'origin', target.remote]);
  }
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
  const repoPath = contentToRepo(await canonicalRelativePath(filePath), await contentRootPrefix());
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
  const repoPath = contentToRepo(await canonicalRelativePath(filePath), await contentRootPrefix());
  if (!/^[0-9a-f]{7,64}$/i.test(hash)) throw new Error('A concrete commit hash is required');
  // simple-git's show() takes the pathspec as one element; `<hash>:<path>`.
  return g.show([`${hash}:${repoPath}`]);
}

async function pullImpl(): Promise<string> {
  const target = await writeTarget();
  const g = await git();
  await assertTargetRepository(g, target);
  if (!(await g.status()).isClean()) throw new Error('Pull requires a clean working tree and index');
  await assertNoPendingReceipt();
  const remote = await authedRemote();
  await g.raw(['fetch', '--no-tags', remote, `refs/heads/${target.edit}`]);
  await g.raw(['merge', '--ff-only', 'FETCH_HEAD']);
  return `Fast-forwarded ${target.edit}`;
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
  return path.relative(await fs.realpath(await getVaultRoot()), await getContentRoot()).split(path.sep).join('/');
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
  const st = await g.status(['--untracked-files=all']);
  const root = await contentRootPrefix();
  const out: GitChange[] = [];
  for (const f of st.files) {
    const rel = repoToContent(f.path, root);
    if (rel === null || !rel || !hasNoDotSegments(rel)) continue;
    const previous = f.from ? repoToContent(f.from, root) : null;
    if (previous && previous !== rel && hasNoDotSegments(previous)) out.push({ path: previous, kind: 'deleted', staged: true });
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
  const clean = await selectedPaths(paths);
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
    await g.raw(['--literal-pathspecs', 'checkout', 'HEAD', '--', ...tracked]);
  }
  if (newFiles.length) {
    await g.raw(['--literal-pathspecs', 'clean', '-f', '--', ...newFiles]);
  }
  return clean.length;
}

/** Resolve every selected file before touching any index. Directories must be
 * expanded by the change list, never passed as broad Git pathspecs. */
async function selectedPaths(paths: string[] | undefined, role: 'owner' | 'guest' = 'owner'): Promise<string[]> {
  if (paths !== undefined && (!Array.isArray(paths) || paths.some(p => typeof p !== 'string' || !p.trim()))) {
    throw Object.assign(new Error('paths must contain non-empty file paths'), { status: 400 });
  }
  let source = paths;
  if (source === undefined) {
    source = [];
    for (const change of await changesImpl()) if (role === 'owner' || await isGuestWritable(change.path)) source.push(change.path);
  }
  const result: string[] = [];
  for (const requested of source) {
    const canonical = await canonicalRelativePath(requested);
    if (!canonical || !hasNoDotSegments(canonical)) throw Object.assign(new Error('Select a visible content file'), { status: 400 });
    if (role === 'guest') await assertGuestWritable(canonical);
    const st = await fs.lstat(path.join(await getContentRoot(), canonical)).catch((e: any) => { if (e?.code === 'ENOENT') return null; throw e; });
    if (st?.isDirectory()) throw Object.assign(new Error('Select individual files, not directories'), { status: 400 });
    result.push(canonical);
  }
  return [...new Set(result)];
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

async function commitAllImpl(message?: string, paths?: string[], role: 'owner' | 'guest' = 'owner'): Promise<string> {
  const selected = await selectedPaths(paths, role);
  if (!selected.length) return 'Nothing to commit';
  const supplied = message?.trim();
  if (supplied && !isValidCommitMessage(supplied)) throw Object.assign(new Error('Invalid commit message template'), { status: 400 });
  const g = await git();
  if (!(await isRepo(g))) throw new Error('Initialize the repository before committing');
  await assertRepositoryIdle(g);
  const branch = await editBranch();
  if ((await g.raw(['symbolic-ref', '--short', 'HEAD'])).trim() !== branch) throw new Error('Current branch is not the configured editing branch');
  const root = await getVaultRoot();
  const prefix = await contentRootPrefix();
  const repoPaths = selected.map(p => contentToRepo(p, prefix));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'webobsidian-index-'));
  const s = await getSettings();
  const isolatedEnv = gitEnvironment({
    GIT_INDEX_FILE: path.join(temporary, 'index'), GIT_LITERAL_PATHSPECS: '1',
    GIT_AUTHOR_NAME: s.git.authorName || 'WebObsidian', GIT_AUTHOR_EMAIL: s.git.authorEmail || 'webobsidian@localhost',
    GIT_COMMITTER_NAME: s.git.authorName || 'WebObsidian', GIT_COMMITTER_EMAIL: s.git.authorEmail || 'webobsidian@localhost',
  });
  const isolated = simpleGit({ baseDir: root, trimmed: true, allowEnvironment: Object.keys(isolatedEnv) }).env(isolatedEnv);
  try {
    const previous = await g.revparse(['--verify', 'HEAD']).catch(() => '');
    if (previous) await isolated.raw(['read-tree', previous]);
    else await isolated.raw(['read-tree', '--empty']);
    // --literal-pathspecs prevents a filename containing '*' or ':' from widening selection.
    await isolated.raw(['--literal-pathspecs', 'add', '-A', '--', ...repoPaths]);
    const tree = (await isolated.raw(['write-tree'])).trim();
    const oldTree = previous ? (await g.revparse([`${previous}^{tree}`])).trim() : '';
    if (tree === oldTree) return 'Nothing to commit';
    const changed = (await isolated.raw(['diff', '--cached', '--name-only', '--no-renames', '-z', ...(previous ? [previous] : [])])).split('\0').filter(Boolean);
    if (changed.some(p => !repoPaths.includes(p))) throw new Error('Commit tree contains a path outside the authorized selection');
    const st = await isolated.status();
    const described = describeChanges(st);
    const subject = supplied || described.subject;
    const full = described.body ? `${subject}\n\n${described.body}` : subject;
    const commit = (await isolated.raw(['commit-tree', tree, ...(previous ? ['-p', previous] : []), '-m', full])).trim();
    // Compare-and-swap refuses concurrent branch movement. No hooks, reset or merge recovery.
    await g.raw(['update-ref', `refs/heads/${branch}`, commit, previous || '0'.repeat(40)]);
    // Only selected index entries follow the new HEAD; unrelated staged blobs stay intact.
    await g.raw(['--literal-pathspecs', 'reset', '-q', commit, '--', ...repoPaths]);
    return `Committed ${commit} (${changed.length} files): ${subject}`;
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

async function pushImpl(branchOverride?: string): Promise<string> {
  const target = await writeTarget();
  if (branchOverride !== undefined && branchOverride !== target.edit) throw new Error('Branch override conflicts with configured editing branch');
  const g = await git();
  await assertTargetRepository(g, target);
  await assertNoPendingReceipt();
  const commit = (await g.revparse(['HEAD'])).trim();
  const receipt = newReceipt(target, commit, false);
  await saveReceipt(receipt);
  try {
    await g.push(await authedRemote(), `HEAD:refs/heads/${target.edit}`);
    receipt.phase = 'complete'; receipt.pushed = true;
    await saveReceipt(receipt);
    return `Pushed ${commit} to ${target.edit}; no merge or publication performed`;
  } catch { receipt.phase = 'push_unknown'; await saveReceipt(receipt); throw new Error('Push outcome unknown; inspect sync status before any retry'); }
}

/**
 * 为在线编辑分支创建（或复用）Pull Request：editBranch → baseBranch。
 * 需要 GitHub App 已配置且能解析出 owner/repo。
 */
async function openPullRequestImpl(opts?: {
  title?: string;
  body?: string;
}): Promise<{ number: number; html_url: string; created: boolean }> {
  const s = await getSettings();
  if (!(await isGithubAppConfigured())) {
    throw new Error('GitHub App 尚未配置，无法创建 PR');
  }
  const target = await writeTarget(true);
  const { owner, repo, edit: head, base } = target;
  const title = opts?.title?.trim() || `在线编辑: 更新 ${head} 分支`;
  const body =
    opts?.body?.trim() ||
    `本 PR 由在线编辑器自动创建，来源分支：\`${head}\`，目标分支：\`${base}\`。\n\n请审核内容后合并。`;
  return createOrGetPullRequest({ owner, repo, title, body, head, base });
}

/** A standalone PR request uses the same durable no-replay boundary as sync. */
export const openPullRequest = (opts?: { title?: string; body?: string }): Promise<{ number: number; html_url: string; created: boolean }> => withGitLock(async () => {
  const target = await writeTarget(true);
  const g = await git();
  await assertTargetRepository(g, target);
  await assertNoPendingReceipt();
  const refs = await g.raw(['ls-remote', await authedRemote(), `refs/heads/${target.edit}`]);
  const commit = refs.split(/\s+/)[0];
  if (!/^[0-9a-f]{40,64}$/i.test(commit)) throw new Error('The remote editing branch is missing');
  const receipt = newReceipt(target, commit, true);
  receipt.pushed = true; receipt.phase = 'pr_pending'; await saveReceipt(receipt);
  try {
    const pr = await openPullRequestImpl(opts);
    receipt.pr = { number: pr.number, html_url: pr.html_url }; receipt.phase = 'complete'; await saveReceipt(receipt);
    return pr;
  } catch {
    receipt.phase = 'pr_unknown'; await saveReceipt(receipt);
    throw new Error('Pull request outcome unresolved; query sync status before retrying');
  }
});

/** Follow base is explicit, clean and fast-forward-only; no automatic workflow
 * dispatch, force push, hidden stashes or conflict-resolution commits. */
async function followBaseImpl(): Promise<{ ok: boolean; merged: boolean; log: string[] }> {
  const target = await writeTarget();
  const g = await git();
  await assertTargetRepository(g, target);
  await assertNoPendingReceipt();
  if (!(await g.status()).isClean()) return { ok: false, merged: false, log: ['Follow-base requires a clean worktree and index'] };
  if (!target.local) {
    if (!(await isGithubAppConfigured())) return { ok: false, merged: false, log: ['Cannot verify pending pull requests without GitHub App'] };
    const pr = await findOpenPullRequest({ owner: target.owner, repo: target.repo, head: target.edit });
    if (pr) return { ok: true, merged: false, log: ['An open pull request is awaiting review; base following paused'] };
  }
  const old = (await g.revparse(['HEAD'])).trim();
  await g.raw(['fetch', '--no-tags', await authedRemote(), `refs/heads/${target.base}`]);
  try { await g.raw(['merge', '--ff-only', 'FETCH_HEAD']); }
  catch { return { ok: false, merged: false, log: ['Base cannot fast-forward; resolve in a reviewed local operation'] }; }
  const current = (await g.revparse(['HEAD'])).trim();
  if (old === current) return { ok: true, merged: false, log: ['Editing branch already includes base'] };
  await pushImpl();
  return { ok: true, merged: true, log: [`Fast-forwarded ${target.edit} to base; no pull request merge or publication performed`] };
}

export const followBase = (): Promise<{ ok: boolean; merged: boolean; log: string[] }> => withGitLock(followBaseImpl);

export const syncAutomatic = (): Promise<SyncResult> => withGitLock(async () => {
  const s = await getSettings();
  if (s.publicEditor.enabled || !s.git.enabled || !s.git.autoSync || !s.git.remote) return { ok: true, noop: true, log: ['Automatic sync is disabled for this snapshot'], publication: 'not_performed' };
  return syncImpl();
});
export const followBaseAutomatic = (): Promise<{ ok: boolean; merged: boolean; log: string[] }> => withGitLock(async () => {
  const s = await getSettings();
  if (s.publicEditor.enabled || !s.git.enabled || !s.github.autoFollowBase || !s.git.remote) return { ok: true, merged: false, log: ['Automatic base following is disabled for this snapshot'] };
  return followBaseImpl();
});

// Debounced auto-commit (+push) after saves, when enabled in settings.
let autoCommitTimer: NodeJS.Timeout | null = null;
export function scheduleAutoCommitOnSave(): void {
  if (autoCommitTimer) clearTimeout(autoCommitTimer);
  autoCommitTimer = setTimeout(async () => {
    try {
      await withGitLock(async () => {
        const s = await getSettings();
        if (!s.git.enabled || !s.git.autoCommitOnSave || s.publicEditor.enabled) return;
        if (s.git.remote) await syncImpl();
        else await commitAllImpl();
      });
    } catch (e: any) {
      console.warn('[git] auto-commit failed:', redactUrlCreds(e.message));
    }
  }, 5000);
}

export interface SyncReceipt {
  id: string; remote: string; edit: string; base: string; owner: string; repo: string;
  commit: string; phase: 'push_pending' | 'push_unknown' | 'pr_pending' | 'pr_unknown' | 'complete';
  pushed: boolean | null; prRequired: boolean; pr?: { number: number; html_url: string }; updatedAt: string;
}
export interface SyncResult { ok: boolean; log: string[]; noop?: boolean; committed?: string; pushed?: boolean | null; pullRequest?: SyncReceipt['pr']; publication: 'not_performed'; receipt?: SyncReceipt }
const RECEIPT_FILE = path.join(config.dataDir, 'git-sync-receipt.json');
function newReceipt(target: WriteTarget, commit: string, prRequired: boolean): SyncReceipt {
  return { id: randomUUID(), remote: remoteIdentity(target.remote), edit: target.edit, base: target.base, owner: target.owner, repo: target.repo,
    commit, phase: 'push_pending', pushed: null, prRequired, updatedAt: new Date().toISOString() };
}
async function saveReceipt(receipt: SyncReceipt): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true });
  const temporary = `${RECEIPT_FILE}.${randomUUID()}.tmp`;
  receipt.updatedAt = new Date().toISOString();
  try { await fs.writeFile(temporary, JSON.stringify(receipt), { mode: 0o600 }); await fs.rename(temporary, RECEIPT_FILE); }
  finally { await fs.rm(temporary, { force: true }); }
}
async function readReceipt(): Promise<SyncReceipt | null> {
  try {
    const value = JSON.parse(await fs.readFile(RECEIPT_FILE, 'utf8'));
    if (!value || typeof value.id !== 'string' || typeof value.commit !== 'string' || !['push_pending','push_unknown','pr_pending','pr_unknown','complete'].includes(value.phase)) throw new Error('Invalid sync receipt');
    return value as SyncReceipt;
  } catch (e: any) { if (e?.code === 'ENOENT') return null; throw new Error('Sync receipt cannot be read safely; preserve it for recovery'); }
}
async function assertNoPendingReceipt(): Promise<void> {
  const receipt = await readReceipt();
  if (receipt && receipt.phase !== 'complete') throw new Error(`Previous Git write outcome requires read-only reconciliation (${receipt.id})`);
}

/** Query-only reconciliation: never retries push/PR, creates a commit or changes a branch. */
export const syncStatus = (): Promise<SyncReceipt | null> => withGitLock(async () => {
  const receipt = await readReceipt();
  if (!receipt || receipt.phase === 'complete') return receipt;
  const target = await writeTarget(receipt.prRequired);
  if (receipt.remote !== remoteIdentity(target.remote) || receipt.edit !== target.edit || receipt.base !== target.base) throw new Error('Receipt belongs to another target; restore its configuration for read-only reconciliation');
  const g = await git();
  if (!receipt.pushed) {
    const refs = await g.raw(['ls-remote', await authedRemote(), `refs/heads/${target.edit}`]);
    if (refs.split(/\s+/)[0] !== receipt.commit) return receipt;
    receipt.pushed = true;
  }
  if (receipt.prRequired) {
    const pr = await findOpenPullRequest({ owner: target.owner, repo: target.repo, head: target.edit });
    if (!pr || pr.base !== target.base) { await saveReceipt(receipt); return receipt; }
    receipt.pr = { number: pr.number, html_url: pr.html_url };
  }
  receipt.phase = 'complete'; await saveReceipt(receipt); return receipt;
});

async function syncImpl(message?: string, branchOverride?: string, paths?: string[], role: 'owner' | 'guest' = 'owner'): Promise<SyncResult> {
  // A clean worktree is common after a failed push/PR: never hide an unresolved
  // receipt behind a successful no-op, even for an explicit empty selection.
  await assertNoPendingReceipt();
  const selected = await selectedPaths(paths, role);
  const ownerFullSync = role === 'owner' && paths === undefined;
  if (!selected.length && !ownerFullSync) return { ok: true, noop: true, log: ['No authorized file changes selected'], publication: 'not_performed' };
  const target = await writeTarget(role === 'guest');
  if (branchOverride !== undefined && branchOverride !== target.edit) throw new Error('Branch override conflicts with configured editing branch');
  const g = await git();
  await assertTargetRepository(g, target);
  await assertNoPendingReceipt();
  // Remote review queries happen before the local commit. Failures stop without mutation.
  const s = await getSettings();
  if (!target.local && await isGithubAppConfigured()) {
    const existing = await findOpenPullRequest({ owner: target.owner, repo: target.repo, head: target.edit });
    if (existing) return { ok: false, log: ['An existing pull request is awaiting review; no new commit or push was performed'], publication: 'not_performed', pullRequest: { number: existing.number, html_url: existing.html_url } };
  }
  // Verify the remote edit/base ancestry without hidden merges or automatic actions.
  const remote = await authedRemote();
  const refs = await g.raw(['ls-remote', remote, `refs/heads/${target.edit}`, `refs/heads/${target.base}`]);
  const remoteRefs = new Map(refs.split('\n').filter(Boolean).map(line => line.trim().split(/\s+/) as [string, string]).map(([hash, ref]) => [ref, hash]));
  const remoteEdit = remoteRefs.get(`refs/heads/${target.edit}`);
  const remoteBase = remoteRefs.get(`refs/heads/${target.base}`);
  if (!remoteEdit || !remoteBase) throw new Error('Configured remote edit/base branch is missing');
  for (const branch of [target.edit, target.base]) await g.raw(['fetch', '--no-tags', remote, `refs/heads/${branch}`]);
  let currentHead = (await g.revparse(['HEAD'])).trim();
  if (!ownerFullSync && remoteEdit !== currentHead) throw new Error('Editing HEAD differs from the remote editing branch; reconcile or explicitly sync reviewed local history as owner before submitting selected files');
  const distance = async (from: string, to: string) => {
    const count = Number((await g.raw(['rev-list', '--count', `${from}..${to}`])).trim());
    if (!Number.isFinite(count)) throw new Error('Cannot determine branch ancestry');
    return count;
  };
  const behindEdit = await distance(currentHead, remoteEdit);
  if (behindEdit) {
    const aheadEdit = await distance(remoteEdit, currentHead);
    if (!ownerFullSync || aheadEdit || !(await g.status()).isClean()) throw new Error('Editing branch is behind or divergent; preserve drafts and perform a reviewed merge');
    await g.raw(['merge', '--ff-only', remoteEdit]);
    currentHead = (await g.revparse(['HEAD'])).trim();
  }
  const behindBase = await distance(currentHead, remoteBase);
  if (behindBase) {
    if (!ownerFullSync || !(await g.status()).isClean() || await distance(remoteBase, currentHead)) throw new Error('Editing branch is behind the review base; perform reviewed follow-base before submitting');
    await g.raw(['merge', '--ff-only', remoteBase]);
  }
  const output = await commitAllImpl(message, selected, role);
  const afterCommit = (await g.revparse(['HEAD'])).trim();
  if (output === 'Nothing to commit' && afterCommit === remoteEdit) return { ok: true, noop: true, log: ['Owner synchronization complete; remote and local editing branches agree'], publication: 'not_performed' };
  const commit = (await g.revparse(['HEAD'])).trim();
  const receipt = newReceipt(target, commit, role === 'guest' || (!target.local && s.github.autoPullRequest));
  await saveReceipt(receipt);
  const log = [output];
  try { await g.push(remote, `HEAD:refs/heads/${target.edit}`); receipt.pushed = true; }
  catch { receipt.phase = 'push_unknown'; await saveReceipt(receipt); return { ok: false, committed: commit, pushed: null, receipt, publication: 'not_performed', log: [...log, 'Push outcome unknown; query sync status before retrying'] }; }
  if (receipt.prRequired) {
    receipt.phase = 'pr_pending'; await saveReceipt(receipt);
    try { const pr = await openPullRequestImpl(); receipt.pr = { number: pr.number, html_url: pr.html_url }; log.push(`Pull request #${pr.number} available for review`); }
    catch { receipt.phase = 'pr_unknown'; await saveReceipt(receipt); return { ok: false, committed: commit, pushed: true, receipt, publication: 'not_performed', log: [...log, 'Content pushed, pull request outcome unresolved; query sync status, do not resubmit'] }; }
  }
  receipt.phase = 'complete'; await saveReceipt(receipt);
  return { ok: true, committed: commit, pushed: true, pullRequest: receipt.pr, receipt, publication: 'not_performed', log: [...log, 'Push complete; review/merge/publication remain separate'] };
}
