import { getSettings, type Settings } from './settings.js';

/**
 * 公开编辑模式下访客的路径限制。
 *
 * 有两套路径口径，务必区分：
 *   - 文件接口（/api/files/*）用「相对内容根」的路径（内容根 = vault.root，如 docs/start）；
 *   - git 变更/暂存用「相对仓库根」的路径（如 docs/start/about/x.md）。
 * 因此这里提供两个校验函数，分别对应两种口径。
 */

/** 规范化：去掉首尾斜杠/反斜杠。 */
const trimSlashes = (p: string): string => (p ?? '').trim().replace(/^[/\\]+|[/\\]+$/g, '');

/** publicEditor.editableRoot（相对仓库根）。 */
function editableRoot(s: Settings): string {
  return trimSlashes(s.publicEditor.editableRoot ?? '');
}

/** 判断 clean 是否等于 prefix 或位于 prefix 之下。prefix 为空视为不限制。 */
function under(clean: string, prefix: string): boolean {
  if (!prefix) return true;
  return clean === prefix || clean.startsWith(prefix + '/');
}

/**
 * 校验「相对内容根」的路径（文件接口用）。editableRoot 相对仓库根，需换算成
 * 相对内容根的前缀再比较。
 */
export async function assertGuestWritableContent(rel: string): Promise<void> {
  const s = await getSettings();
  const repoRoot = trimSlashes(s.vault.root ?? '');
  const editable = editableRoot(s);
  let allowPrefix = editable;
  if (repoRoot) {
    if (editable === repoRoot) allowPrefix = '';
    else if (editable.startsWith(repoRoot + '/')) allowPrefix = editable.slice(repoRoot.length + 1);
    else allowPrefix = editable; // 不相交：按原样比较（通常不会发生）
  }
  const clean = (rel ?? '').replace(/^[/\\]+/, '');
  if (!under(clean, allowPrefix)) {
    throw Object.assign(new Error('公开编辑仅允许修改指定目录'), { status: 403 });
  }
}

/** 校验「相对仓库根」的路径（git 变更/暂存用），直接与 editableRoot 比较。 */
export async function assertGuestWritableRepo(rel: string): Promise<void> {
  const s = await getSettings();
  const editable = editableRoot(s);
  const clean = (rel ?? '').replace(/^[/\\]+/, '');
  if (!under(clean, editable)) {
    throw Object.assign(new Error('公开编辑仅允许修改指定目录'), { status: 403 });
  }
}

/** 访客是否可提交该「相对仓库根」路径（用于过滤变更列表，不抛异常）。 */
export async function isGuestWritableRepo(rel: string): Promise<boolean> {
  const s = await getSettings();
  const editable = editableRoot(s);
  return under((rel ?? '').replace(/^[/\\]+/, ''), editable);
}
