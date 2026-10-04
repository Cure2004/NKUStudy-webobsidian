import { getSettings, type Settings } from './settings.js';

/**
 * 公开编辑模式下访客的路径限制。
 *
 * 统一使用「相对内容根」的路径口径（内容根 = vault.root，如 docs/start）——
 * 文件接口与 git 变更/暂存接口都用这一口径，与文件树一致。
 * publicEditor.editableRoot 是「相对仓库根」的路径，需换算成相对内容根的前缀。
 */

/** 规范化：去掉首尾斜杠/反斜杠。 */
const trimSlashes = (p: string): string => (p ?? '').trim().replace(/^[/\\]+|[/\\]+$/g, '');

/** publicEditor.editableRoot（相对仓库根）。 */
function editableRoot(s: Settings): string {
  return trimSlashes(s.publicEditor.editableRoot ?? '');
}

/**
 * 计算访客可编辑前缀（相对内容根）。editableRoot 与内容根（vault.root）同为
 * 仓库根口径，取相对部分：
 *   vault.root=docs/start、editableRoot=docs/start → ''（整个内容根可编辑）
 *   vault.root=''、editableRoot=docs/start        → 'docs/start'
 */
function allowPrefix(s: Settings): string {
  const repoRoot = trimSlashes(s.vault.root ?? '');
  const editable = editableRoot(s);
  if (!repoRoot) return editable;
  if (editable === repoRoot) return '';
  if (editable.startsWith(repoRoot + '/')) return editable.slice(repoRoot.length + 1);
  return editable; // 不相交：按原样比较（通常不会发生）
}

/** clean 是否等于 prefix 或位于 prefix 之下；prefix 为空视为不限制。 */
function under(clean: string, prefix: string): boolean {
  if (!prefix) return true;
  return clean === prefix || clean.startsWith(prefix + '/');
}

/** 访客是否可写该「相对内容根」路径（不抛异常）。 */
export async function isGuestWritable(rel: string): Promise<boolean> {
  const s = await getSettings();
  return under((rel ?? '').replace(/^[/\\]+/, ''), allowPrefix(s));
}

/** 校验访客可写该「相对内容根」路径，否则抛 403。 */
export async function assertGuestWritable(rel: string): Promise<void> {
  const s = await getSettings();
  const clean = (rel ?? '').replace(/^[/\\]+/, '');
  if (!under(clean, allowPrefix(s))) {
    throw Object.assign(new Error('公开编辑仅允许修改指定目录'), { status: 403 });
  }
}
