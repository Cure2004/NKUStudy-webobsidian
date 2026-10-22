import { promises as fs, constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { getSettings } from './settings.js';

export interface TreeNode {
  name: string;
  path: string; // vault-relative, posix style
  type: 'file' | 'folder';
  ext?: string;
  size?: number;
  mtime?: number; // last-modified (ms) — for sort-by-modified-time
  ctime?: number; // created/birth (ms) — for sort-by-created-time
  children?: TreeNode[];
  /** 显示名：文件夹用中文映射，md 用文档标题；缺省时前端回退到 name。 */
  label?: string;
  /** 文件夹自定义排序序号（来自 vault.folderOrder）；越小越靠前，缺省排在最后。 */
  order?: number;
}

/**
 * In-memory mtime/ctime cache so sort-by-time costs ONE stat per file total,
 * not 27k stats on every tree fetch (the tree is refetched on each fs event).
 * Filled lazily during listTree(); the file watcher invalidates changed paths
 * (see invalidateStat), so steady-state tree fetches do zero extra syscalls.
 */
const statCache = new Map<string, { m: number; c: number }>();

export function invalidateStat(rel: string): void {
  statCache.delete(rel);
}

async function fileStat(abs: string, rel: string): Promise<{ m: number; c: number }> {
  const hit = statCache.get(rel);
  if (hit) return hit;
  let v = { m: 0, c: 0 };
  try {
    const st = await fs.stat(abs);
    // birthtime can be 0 on some Linux filesystems → fall back to mtime.
    v = { m: st.mtimeMs, c: st.birthtimeMs || st.mtimeMs };
  } catch { /* file vanished mid-walk — leave zeros */ }
  statCache.set(rel, v);
  return v;
}

const TEXT_EXTS = new Set([
  '.md', '.markdown', '.txt', '.json', '.csv', '.canvas', '.css', '.js', '.yml', '.yaml',
]);

const IGNORED = new Set(['.git', 'node_modules']);

/** 仓库根（git 操作基准，也用于解析内容根）。 */
export async function getVaultRoot(): Promise<string> {
  const s = await getSettings();
  return path.resolve(s.vault.path);
}

/** True only for the root itself or a descendant (not a sibling prefix). */
export function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

const pathError = (message: string) => Object.assign(new Error(message), { status: 400 });

/** Public paths use portable relative slash syntax. Never decode a second time. */
export function normalizeRelativePath(rel: string): string {
  if (typeof rel !== 'string' || rel.includes('\0') || rel.includes('\\') || path.posix.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) {
    throw pathError('Expected a relative path');
  }
  // Check before normalization too: .git/../note must not enter a protected object.
  if (rel.split('/').some((part) => part.toLowerCase() === '.git')) throw pathError('Path not allowed');
  const normalized = path.posix.normalize(rel || '.');
  if (normalized === '..' || normalized.startsWith('../')) throw pathError('Path escapes vault');
  return normalized === '.' ? '' : normalized;
}

/**
 * Resolve existing ancestors without following content symlinks. Missing tails
 * are allowed for creation; permission, ENOTDIR and other IO errors fail closed.
 * The vault is application-owned: concurrent external filesystem writers must
 * not share its writable mount (Node does not expose an openat directory handle).
 */
async function resolvePhysical(root: string, rel: string): Promise<string> {
  let current = await fs.realpath(root);
  const anchor = current;
  const parts = rel ? rel.split('/') : [];
  for (let i = 0; i < parts.length; i++) {
    const candidate = path.join(current, parts[i]);
    try {
      const stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink()) throw pathError('Symbolic links are not supported for content paths');
      current = await fs.realpath(candidate);
      if (!isWithin(anchor, current)) throw pathError('Path escapes vault');
      if (path.relative(anchor, current).split(path.sep).some((part) => part.toLowerCase() === '.git')) throw pathError('Path not allowed');
      if (i < parts.length - 1 && !stat.isDirectory()) throw pathError('Path ancestor is not a directory');
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      return path.join(current, ...parts.slice(i));
    }
  }
  return current;
}

/** Content root must be a real descendant of the configured repository root. */
export async function getContentRoot(): Promise<string> {
  const s = await getSettings();
  const repo = await getVaultRoot();
  const sub = normalizeRelativePath((s.vault.root ?? '').trim());
  const root = path.resolve(repo, sub);
  if (!isWithin(repo, root)) throw pathError('Invalid content root');
  // Startup may create an entirely new vault, but an existing ancestor's IO
  // failure is not interpreted as a new empty installation.
  try {
    await fs.lstat(repo);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    return root;
  }
  return resolvePhysical(repo, sub);
}

/** Canonical physical object used by reads, writes and guest/Git authorization. */
export async function resolveInVault(relPath: string): Promise<string> {
  const root = await getContentRoot();
  const rel = normalizeRelativePath(relPath);
  return resolvePhysical(root, rel);
}

export async function canonicalRelativePath(rel: string): Promise<string> {
  return toRel(await getContentRoot(), await resolveInVault(rel));
}

/** Preflight an entire existing tree before a recursive operation has effects. */
export async function assertTreeSafe(rel: string): Promise<void> {
  const root = await getContentRoot();
  const abs = await resolveInVault(rel);
  async function visit(current: string): Promise<void> {
    const st = await fs.lstat(current);
    if (st.isSymbolicLink()) throw pathError('Symbolic links are not supported for content paths');
    await resolveInVault(toRel(root, current));
    if (st.isDirectory()) {
      for (const entry of await fs.readdir(current)) await visit(path.join(current, entry));
    }
  }
  await visit(abs);
}

async function mutationPath(rel: string): Promise<string> {
  const abs = await resolveInVault(rel);
  if (abs === await getContentRoot()) throw pathError('Cannot modify the content root');
  return abs;
}

export function toRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/');
}

export async function ensureVault(): Promise<void> {
  const root = await getContentRoot();
  await fs.mkdir(root, { recursive: true });
}

/** 读取 Markdown 的显示标题：优先 frontmatter title，其次首个 `# 标题`。 */
function extractDocTitle(raw: string): string | null {
  const fm = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const m = fm[1].match(/^title:\s*(.+)$/m);
    if (m) return m[1].trim().replace(/^["'](.+)["']$/, '$1');
  }
  const lines = raw.split(/\r?\n/);
  let fence: string | null = null;
  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence === null) {
      const h = line.match(/^#(?!#)\s+(.+?)\s*$/);
      if (h) return h[1].replace(/\s+#+\s*$/, '').trim();
    }
  }
  return null;
}

/**
 * 构建文件树（仅内容根目录），跳过忽略目录。
 * 为每个节点附加 `label`：文件夹取 vault.folderLabels 的中文映射，
 * Markdown 文件取文档标题（可关闭）。`path` 始终是真实相对路径。
 */
export async function listTree(): Promise<TreeNode> {
  const root = await getContentRoot();
  await fs.mkdir(root, { recursive: true });
  const s = await getSettings();
  const folderLabels = s.vault.folderLabels ?? {};
  const folderOrder = s.vault.folderOrder ?? [];
  const useDocTitles = s.vault.useDocTitles !== false;

  async function walk(absDir: string): Promise<TreeNode[]> {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    // Stat files concurrently per directory (cached) so the one-time fill is fast;
    // steady state reads from statCache → no syscalls. mtime/ctime power sort-by-time.
    const nodes = await Promise.all(
      entries
        .filter((e) => !(IGNORED.has(e.name) || e.name.startsWith('.'))) // hide dotfiles like Obsidian
        .map(async (e): Promise<TreeNode | null> => {
          const abs = path.join(absDir, e.name);
          const rel = toRel(root, abs);
          if (e.isDirectory()) {
            const label = folderLabels[rel];
            const orderIdx = folderOrder.indexOf(rel);
            return {
              name: e.name,
              path: rel,
              type: 'folder',
              label,
              order: orderIdx >= 0 ? orderIdx : undefined,
              children: await walk(abs),
            };
          }
          if (e.isFile()) {
            const { m, c } = await fileStat(abs, rel);
            const node: TreeNode = { name: e.name, path: rel, type: 'file', ext: path.extname(e.name).toLowerCase(), mtime: m, ctime: c };
            // Markdown 用文档标题作为显示名（对齐 VitePress 侧边栏）。
            if (useDocTitles && /\.(md|markdown)$/i.test(e.name)) {
              try {
                const raw = await fs.readFile(abs, 'utf8');
                const title = extractDocTitle(raw);
                if (title) node.label = title;
              } catch {
                /* 读取失败则回退到文件名 */
              }
            }
            return node;
          }
          return null;
        }),
    );
    const out = nodes.filter((n): n is TreeNode => n !== null);
    // folders first, then alphabetical (client re-sorts by the chosen order)
    out.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return out;
  }

  return { name: path.basename(root), path: '', type: 'folder', children: await walk(root) };
}

export function isTextFile(rel: string): boolean {
  return TEXT_EXTS.has(path.extname(rel).toLowerCase());
}

export async function readFileText(rel: string): Promise<string> {
  const abs = await resolveInVault(rel);
  return fs.readFile(abs, 'utf8');
}

export async function readFileBuffer(rel: string): Promise<Buffer> {
  const abs = await resolveInVault(rel);
  return fs.readFile(abs);
}

async function atomicWrite(rel: string, write: (tmp: string) => Promise<void>, exclusive = false): Promise<void> {
  const abs = await mutationPath(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  // Recheck after directory creation; temp is same-filesystem and unpredictable.
  if (await mutationPath(rel) !== abs) throw pathError('Path changed during write');
  const tmp = path.join(path.dirname(abs), `.upload-${randomBytes(16).toString('hex')}`);
  try {
    await write(tmp);
    if (await mutationPath(rel) !== abs) throw pathError('Path changed during write');
    if (exclusive) {
      try { await fs.link(tmp, abs); }
      catch (error: any) {
        if (error?.code === 'EEXIST') throw Object.assign(new Error('File already exists'), { status: 409 });
        throw error;
      }
    } else await fs.rename(tmp, abs);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

export async function writeFileText(rel: string, content: string): Promise<void> {
  await atomicWrite(rel, (tmp) => fs.writeFile(tmp, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 }));
}

export async function writeFileBuffer(rel: string, buf: Buffer): Promise<void> {
  await atomicWrite(rel, (tmp) => fs.writeFile(tmp, buf, { flag: 'wx', mode: 0o600 }));
}

/** Commit a bounded temporary upload atomically, without clobbering a file. */
export async function importUpload(rel: string, temporaryFile: string): Promise<void> {
  await atomicWrite(rel, (tmp) => fs.copyFile(temporaryFile, tmp, constants.COPYFILE_EXCL), true);
}

export async function createFolder(rel: string): Promise<void> {
  const abs = await mutationPath(rel);
  await fs.mkdir(abs, { recursive: true });
}

/**
 * Resolve a directory path against the folders that already exist, matching each
 * segment case-insensitively. Prevents creating a case-duplicate folder (e.g. a
 * new `attachments` next to an existing `Attachments`) on case-sensitive
 * filesystems. Segments with no existing match are kept verbatim.
 */
export async function resolveDirCaseInsensitive(rel: string): Promise<string> {
  const root = await getContentRoot();
  const segs = normalizeRelativePath(rel).split('/').filter(Boolean);
  const out: string[] = [];
  let curAbs = root;
  for (const seg of segs) {
    let actual = seg;
    try {
      const entries = await fs.readdir(curAbs, { withFileTypes: true });
      const exact = entries.find((e) => e.isDirectory() && e.name === seg);
      const ci = exact ?? entries.find((e) => e.isDirectory() && e.name.toLowerCase() === seg.toLowerCase());
      if (ci) actual = ci.name;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
    out.push(actual);
    curAbs = path.join(curAbs, actual);
  }
  return canonicalRelativePath(out.join('/'));
}

export async function exists(rel: string): Promise<boolean> {
  try {
    await fs.access(await resolveInVault(rel));
    return true;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function rename(from: string, to: string): Promise<void> {
  const absFrom = await mutationPath(from);
  const absTo = await mutationPath(to);
  await assertTreeSafe(from);
  if (isWithin(absFrom, absTo)) throw pathError('Destination is inside source');
  if (await pathExists(absTo)) throw Object.assign(new Error('Destination already exists'), { status: 409 });
  await fs.mkdir(path.dirname(absTo), { recursive: true });
  await fs.rename(await mutationPath(from), await mutationPath(to));
}

/** Recursively copy only a preflighted tree; never preserve hidden symlink aliases. */
export async function copy(from: string, to: string): Promise<string[]> {
  const absFrom = await mutationPath(from);
  const absTo = await mutationPath(to);
  await assertTreeSafe(from);
  if (isWithin(absFrom, absTo)) throw pathError('Destination is inside source');
  if (await pathExists(absTo)) throw Object.assign(new Error('Destination already exists'), { status: 409 });
  await fs.mkdir(path.dirname(absTo), { recursive: true });
  await fs.cp(absFrom, absTo, { recursive: true, errorOnExist: true, force: false, dereference: false });
  const root = await getContentRoot();
  const out: string[] = [];
  async function walk(abs: string): Promise<void> {
    const st = await fs.lstat(abs);
    if (st.isDirectory()) for (const name of await fs.readdir(abs)) await walk(path.join(abs, name));
    else if (st.isFile()) out.push(toRel(root, abs));
  }
  await walk(absTo);
  return out;
}

/** Permanently delete a preflighted file or directory, never the content root. */
export async function remove(rel: string): Promise<void> {
  const abs = await mutationPath(rel);
  await assertTreeSafe(rel);
  await fs.rm(abs, { recursive: true, force: true });
}

/** Trash is an internal destination; it is still constrained to the content root. */
export async function trash(rel: string): Promise<string> {
  const root = await getContentRoot();
  const absFrom = await mutationPath(rel);
  await assertTreeSafe(rel);
  const trashRoot = await getTrashRoot();
  if (isWithin(trashRoot, absFrom)) throw pathError('Item is already in trash');
  const canonical = toRel(root, absFrom);
  let dest = await mutationPath(toRel(root, path.join(trashRoot, canonical)));
  if (await pathExists(dest)) {
    const ext = path.extname(dest);
    dest = `${dest.slice(0, dest.length - ext.length)}.${randomBytes(8).toString('hex')}${ext}`;
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(absFrom, await mutationPath(toRel(root, dest)));
  return toRel(root, dest);
}

async function pathExists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return true;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

/** ---- Trash (FR-1) -------------------------------------------------------- */

export interface TrashItem {
  name: string; // basename
  path: string; // vault-relative, including the trash prefix, e.g. ".trash/folder/note.md"
  original: string; // where it restores to, e.g. "folder/note.md"
  ext: string;
  size: number;
  mtime: number; // deletion time (file mtime when it landed in trash)
}

async function getTrashRoot(): Promise<string> {
  const s = await getSettings();
  const root = await getContentRoot();
  const rel = normalizeRelativePath(s.vault.trash);
  if (!rel) throw pathError('Invalid trash root');
  return resolveInVault(rel);
}

/** Confirm `abs` lives inside the trash folder; return its trash-relative path. */
function assertInTrash(abs: string, trashRoot: string): string {
  const rel = path.relative(trashRoot, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw Object.assign(new Error('Not a trash item'), { status: 400 });
  }
  return rel;
}

/** Remove now-empty directories upward from `dir`, stopping at (and keeping) `stopAt`. */
async function pruneEmptyDirs(dir: string, stopAt: string): Promise<void> {
  let cur = path.resolve(dir);
  const root = path.resolve(stopAt);
  while (cur !== root && cur.startsWith(root + path.sep)) {
    try {
      const remaining = await fs.readdir(cur);
      if (remaining.length > 0) break;
      await fs.rmdir(cur);
    } catch {
      break;
    }
    cur = path.dirname(cur);
  }
}

/** List every file currently in the trash, newest deletion first. */
export async function listTrash(): Promise<TrashItem[]> {
  const root = await getContentRoot();
  const trashRoot = await getTrashRoot();
  const out: TrashItem[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // trash folder doesn't exist yet
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs);
      } else if (e.isFile()) {
        const st = await fs.stat(abs).catch(() => null);
        out.push({
          name: e.name,
          path: toRel(root, abs),
          original: path.relative(trashRoot, abs).split(path.sep).join('/'),
          ext: path.extname(e.name).toLowerCase(),
          size: st?.size ?? 0,
          mtime: st ? st.mtimeMs : 0,
        });
      }
    }
  }
  await walk(trashRoot);
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/** Move a trashed item back to its original location. Returns the restored rel path. */
export async function restoreFromTrash(trashRel: string): Promise<string> {
  const trashRoot = await getTrashRoot();
  const absFrom = await resolveInVault(trashRel);
  const relInTrash = assertInTrash(absFrom, trashRoot);
  await assertTreeSafe(trashRel);
  let destRel = relInTrash.split(path.sep).join('/');
  let absTo = await resolveInVault(destRel);
  // Don't clobber a file that was recreated at the same path after deletion.
  if (await pathExists(absTo)) {
    const ext = path.extname(destRel);
    destRel = `${destRel.slice(0, destRel.length - ext.length)}.restored-${Date.now()}${ext}`;
    absTo = await resolveInVault(destRel);
  }
  await fs.mkdir(path.dirname(absTo), { recursive: true });
  await fs.rename(absFrom, absTo);
  await pruneEmptyDirs(path.dirname(absFrom), trashRoot);
  return destRel;
}

/** Permanently delete a single trashed item. */
export async function deleteFromTrash(trashRel: string): Promise<void> {
  const trashRoot = await getTrashRoot();
  const abs = await resolveInVault(trashRel);
  assertInTrash(abs, trashRoot);
  await assertTreeSafe(trashRel);
  await fs.rm(abs, { recursive: true, force: true });
  await pruneEmptyDirs(path.dirname(abs), trashRoot);
}

/** Permanently delete everything in the trash. */
export async function emptyTrash(): Promise<void> {
  const trashRoot = await getTrashRoot();
  let entries;
  try {
    entries = await fs.readdir(trashRoot);
  } catch {
    return; // nothing to empty
  }
  await assertTreeSafe(toRel(await getContentRoot(), trashRoot));
  for (const name of entries) {
    await fs.rm(path.join(trashRoot, name), { recursive: true, force: true });
  }
}

/** List all markdown files (vault-relative) for indexing. */
export async function listMarkdownFiles(): Promise<string[]> {
  const root = await getContentRoot();
  const out: string[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // Skip dotfiles/dot-dirs (`.trash`, `.obsidian`, …) like the tree view and
      // file index do — a note moved to `.trash` must not stay a live link target
      // (and would otherwise shadow a real file with the same basename).
      if (IGNORED.has(e.name) || e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else if (e.isFile() && /\.(md|markdown)$/i.test(e.name)) out.push(toRel(root, abs));
    }
  }
  await walk(root);
  return out;
}
