import type { EditorView } from '@codemirror/view';
import { undo, redo, indentMore, indentLess } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { toggleInline, toggleChecklist, insertLink } from './editorCommands';
import { api } from './api';
import { useStore } from './store';
import { t } from './i18n';

/**
 * Module-level handle to the currently-mounted CodeMirror editor, so UI outside
 * the editor (e.g. the mobile formatting toolbar) can dispatch commands without
 * threading a ref through React. The Editor registers/clears it on mount/unmount.
 */
let active: EditorView | null = null;

export function setActiveEditor(v: EditorView | null) {
  active = v;
}
export function getActiveEditor(): EditorView | null {
  return active;
}

/** Wrap the selection (or word at caret) in a pair of marks; unwrap if already wrapped. */
export function fmtInline(mark: string) {
  if (active) toggleInline(active, mark);
}

/** Toggle a task checkbox / continue checklist on the selected lines. */
export function fmtChecklist() {
  if (active) toggleChecklist(active);
}

/** Prefix each selected line with `prefix` (heading, bullet, quote…). */
export function fmtPrefixLines(prefix: string) {
  const v = active;
  if (!v) return;
  const { from, to } = v.state.selection.main;
  const a = v.state.doc.lineAt(from).number;
  const b = v.state.doc.lineAt(to).number;
  const changes = [];
  for (let n = a; n <= b; n++) changes.push({ from: v.state.doc.line(n).from, insert: prefix });
  v.dispatch({ changes, userEvent: 'input' });
  v.focus();
}

/** Insert text at the caret; place caret `caretOffset` chars in (default end). */
export function fmtInsert(text: string, caretOffset = text.length) {
  const v = active;
  if (!v) return;
  const { from, to } = v.state.selection.main;
  v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + caretOffset }, userEvent: 'input' });
  v.focus();
}

export function fmtLink() {
  if (active) insertLink(active);
}
export function fmtIndent() {
  if (active) { indentMore(active); active.focus(); }
}
export function fmtOutdent() {
  if (active) { indentLess(active); active.focus(); }
}
export function fmtUndo() {
  if (active) { undo(active); active.focus(); }
}
export function fmtRedo() {
  if (active) { redo(active); active.focus(); }
}

/** Open the in-document Find/Replace panel (CM6 search panel includes both). */
export function editorFind(): boolean {
  if (!active) return false;
  openSearchPanel(active);
  return true;
}

/**
 * 计算从当前笔记所在目录到目标资源的相对路径（posix）。
 * 例：笔记 `newstudent/foo.md`，资源 `attachments/x.png` → `../attachments/x.png`。
 * 这样 VitePress 才能正确解析（它按笔记所在目录解析相对图片）。
 */
/**
 * 计算从当前笔记所在目录到目标资源的相对路径（posix）。
 * 例：笔记 `newstudent/foo.md`，资源 `attachments/x.png` → `../attachments/x.png`。
 * 这样 VitePress 才能正确解析（它按笔记所在目录解析相对图片）。
 */
export function relativeToNote(notePath: string | null, target: string): string {
  if (!notePath) return target;
  const fromDir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : '';
  const fromSegs = fromDir ? fromDir.split('/') : [];
  const toSegs = target.split('/');
  let i = 0;
  while (i < fromSegs.length && i < toSegs.length && fromSegs[i] === toSegs[i]) i++;
  const up = fromSegs.length - i;
  const rest = toSegs.slice(i);
  const rel = [...Array(up).fill('..'), ...rest].join('/');
  return rel || target;
}

/**
 * 上传一张图片并在光标处插入引用。
 * 统一使用标准 Markdown 图片语法 `![alt](url)`（VitePress 兼容）：
 * 图床启用时用远程 URL，否则用相对当前笔记的本地 attachments 路径。
 */
export async function fmtUploadImage(file: File): Promise<void> {
  const notify = useStore.getState().notify;
  try {
    const r = await api.uploadImage(file);
    const alt = file.name.replace(/\.[^.]+$/, '');
    if (r.remote) {
      fmtInsert(`![${alt}](${r.url})`);
      notify(t('已上传图片：{url}', { url: r.url }));
    } else {
      const rel = relativeToNote(useStore.getState().activePath, r.path);
      fmtInsert(`![${alt}](${rel})`);
      notify(t('Inserted {path}', { path: r.path }));
    }
  } catch (e: any) {
    notify(e?.message ?? t('上传失败'));
  }
}
