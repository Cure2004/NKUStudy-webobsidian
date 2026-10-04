import { promises as fs } from 'node:fs';
import path from 'node:path';
import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git';
import { getSettings } from './settings.js';
import { getVaultRoot } from './vault.js';
import { redactUrlCreds } from '../lib/redact.js';
import {
  authedRemoteWithApp,
  createOrGetPullRequest,
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
export const push = (): Promise<string> => withGitLock(pushImpl);
export const commitAll = (message?: string): Promise<string> => withGitLock(() => commitAllImpl(message));
export const init = (): Promise<void> => withGitLock(initImpl);
export const clone = (): Promise<void> => withGitLock(cloneImpl);
export const sync = (message?: string): Promise<{ ok: boolean; log: string[] }> =>
  withGitLock(() => syncImpl(message));

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
  try {
    const res = await g.log({ file: filePath, maxCount: limit });
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

/** File contents at a specific commit (`git show <hash>:<path>`). */
export async function showFile(hash: string, filePath: string): Promise<string> {
  const g = await git();
  // simple-git's show() takes the pathspec as one element; `<hash>:<path>`.
  return g.show([`${hash}:${filePath}`]);
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
  });
  if (await lfsAvailable()) await g.raw(['lfs', 'pull']).catch(() => {});
  return `Pulled: ${res.summary.changes} changes, +${res.summary.insertions}/-${res.summary.deletions}`;
}

/**
 * Build a human-readable commit message from what `git add .` staged, so the
 * vault history (and the Version History UI) shows exactly which notes synced
 * instead of a generic "WebObsidian auto-sync". Returns a one-line subject that
 * names the notes plus a body listing every changed path grouped by kind.
 */
export function describeChanges(st: StatusResult): { subject: string; body: string } {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const renamed: string[] = [];
  for (const f of st.files) {
    // `index` is the staged status; fall back to working-tree status. '?' = new
    // untracked file (becomes 'A' after add, but be defensive), 'C' = copied.
    const x = (f.index?.trim() || f.working_dir?.trim() || '').toUpperCase();
    if (x === 'A' || x === '?' || x === 'C') added.push(f.path);
    else if (x === 'D') deleted.push(f.path);
    else if (x === 'R') renamed.push(f.path);
    else modified.push(f.path);
  }
  const all = [...added, ...modified, ...deleted, ...renamed];
  const total = all.length;
  // Display name: basename without the .md extension (notes read best that way).
  const name = (p: string) => (p.split('/').pop() || p).replace(/\.md$/i, '');

  let subject: string;
  if (total === 0) {
    subject = 'Vault sync';
  } else if (total === 1) {
    const verb = added.length ? 'Add' : deleted.length ? 'Delete' : renamed.length ? 'Rename' : 'Update';
    subject = `${verb} ${name(all[0])}`;
  } else {
    const counts = [
      added.length && `${added.length} new`,
      modified.length && `${modified.length} edited`,
      deleted.length && `${deleted.length} deleted`,
      renamed.length && `${renamed.length} renamed`,
    ].filter(Boolean).join(', ');
    const names = all.slice(0, 3).map(name).join(', ');
    const more = total > 3 ? ` +${total - 3} more` : '';
    subject = `Sync ${total} notes (${counts}): ${names}${more}`;
  }
  // Keep the subject a sane git title length.
  if (subject.length > 72) subject = subject.slice(0, 71) + '…';

  const section = (label: string, arr: string[]): string => {
    if (!arr.length) return '';
    const CAP = 100;
    const lines = arr.slice(0, CAP).map((p) => `  ${p}`);
    if (arr.length > CAP) lines.push(`  …and ${arr.length - CAP} more`);
    return `${label} (${arr.length}):\n${lines.join('\n')}`;
  };
  const body = [
    section('Added', added),
    section('Modified', modified),
    section('Deleted', deleted),
    section('Renamed', renamed),
  ].filter(Boolean).join('\n\n');

  return { subject, body };
}

async function commitAllImpl(message?: string): Promise<string> {
  const g = await git();
  await configureIdentity(g);
  await ensureLfsAttributes();
  await g.add('.');
  const st = await g.status();
  if (st.staged.length === 0 && st.isClean()) return 'Nothing to commit';
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

async function pushImpl(): Promise<string> {
  const g = await git();
  const branch = await editBranch();
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
async function syncImpl(message?: string): Promise<{ ok: boolean; log: string[] }> {
  const log: string[] = [];
  const g = await git();
  if (!(await isRepo(g))) {
    await initImpl();
    log.push('Initialized repository');
  }
  await recoverMerge(g); // unwedge a prior stuck merge before doing anything
  log.push(await commitAllImpl(message || ''));
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
    log.push(await pushImpl());
  } catch (e: any) {
    // Redact: a push failure echoes the authenticated remote URL (PAT embedded).
    log.push(`Push failed: ${redactUrlCreds(e.message)}`);
    return { ok: false, log };
  }
  // 推送成功后，如启用 GitHub App 且开启自动 PR，则为 web-edit → base 创建/复用 PR。
  try {
    const s = await getSettings();
    if (s.github.autoPullRequest && (await isGithubAppConfigured())) {
      const pr = await openPullRequest();
      log.push(pr.created ? `已创建 PR #${pr.number}：${pr.html_url}` : `已复用现有 PR #${pr.number}：${pr.html_url}`);
    }
  } catch (e: any) {
    log.push(`PR 创建失败（内容已推送）：${redactUrlCreds(e.message)}`);
  }
  return { ok: true, log };
}
