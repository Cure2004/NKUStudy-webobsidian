import path from 'node:path';
import { getSettings } from './settings.js';
import { getVaultRoot, getContentRoot, resolveInVault, normalizeRelativePath, isWithin } from './vault.js';

const denied = () => Object.assign(new Error('公开编辑仅允许修改指定目录'), { status: 403 });

/** editableRoot is repository-relative; API paths are content-relative. */
export async function getGuestWritableRoot(): Promise<string> {
  const s = await getSettings();
  const editable = normalizeRelativePath((s.publicEditor.editableRoot ?? '').trim());
  // An empty/unrelated configuration must never silently mean all content.
  if (!editable) throw denied();
  const configured = path.resolve(await getVaultRoot(), editable);
  const content = await getContentRoot();
  const repoContent = path.resolve(await getVaultRoot(), normalizeRelativePath(s.vault.root ?? ''));
  if (!isWithin(repoContent, configured)) throw denied();
  const root = await resolveInVault(path.relative(repoContent, configured).split(path.sep).join('/'));
  if (!isWithin(content, root)) throw denied();
  return root;
}

/** Authorize the canonical physical target, not the request's original prefix. */
export async function assertGuestWritable(rel: string, options: { protectRoot?: boolean } = {}): Promise<void> {
  const allowed = await getGuestWritableRoot();
  const target = await resolveInVault(rel);
  if (!isWithin(allowed, target) || (options.protectRoot && target === allowed)) throw denied();
}

export async function isGuestWritable(rel: string): Promise<boolean> {
  try {
    await assertGuestWritable(rel);
    return true;
  } catch {
    return false;
  }
}
