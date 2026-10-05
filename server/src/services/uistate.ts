import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { getSettings } from './settings.js';

/**
 * Persisted UI/workspace state (open tabs, active note, expanded folders, panel
 * layout, bookmarks, recents). Stored server-side as a plain JSON file so the
 * workspace is shared across browsers/devices — not tied to one browser's
 * localStorage. Single-user app → one shared state file.
 */

const FILE = path.join(config.dataDir, 'uistate.json');

/**
 * 清洗陈旧路径：工作区里的文件路径应为「相对内容根」（如 `about/x.md`）。
 * 早期版本误存过「相对仓库根」的路径（如 `docs/start/about/x.md`），若不清理，
 * 编辑器会把它当内容根相对路径，导致保存时在内容根里再套一层 `docs/start/`。
 * 这里丢弃以内容根前缀开头的陈旧路径。
 */
async function sanitize(state: Record<string, unknown>): Promise<Record<string, unknown>> {
  const s = await getSettings();
  const root = (s.vault.root ?? '').trim().replace(/^[/\\]+|[/\\]+$/g, '');
  if (!root || !state || typeof state !== 'object') return state;
  const stale = (p: unknown): boolean => {
    if (typeof p !== 'string') return false;
    const clean = p.replace(/^[/\\]+/, '');
    return clean === root || clean.startsWith(root + '/');
  };
  const out = { ...state };
  if (Array.isArray(out.tabs)) out.tabs = out.tabs.filter((t: any) => !stale(t?.path));
  if (Array.isArray(out.recent)) out.recent = out.recent.filter((p) => !stale(p));
  if (Array.isArray(out.expanded)) out.expanded = out.expanded.filter((p) => !stale(p));
  if (stale(out.activePath)) out.activePath = (out.tabs as any[])?.[0]?.path ?? null;
  if (stale(out.splitPath)) out.splitPath = null;
  return out;
}

export async function readUiState(): Promise<Record<string, unknown>> {
  try {
    return await sanitize(JSON.parse(await fs.readFile(FILE, 'utf8')));
  } catch {
    return {};
  }
}

export async function writeUiState(state: Record<string, unknown>): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true });
  const clean = await sanitize(state);
  const tmp = `${FILE}.tmp-${randomBytes(4).toString('hex')}`;
  await fs.writeFile(tmp, JSON.stringify(clean, null, 2));
  await fs.rename(tmp, FILE);
}
