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
 * 上传一张图片并在光标处插入引用。
 * 图床启用时插入 `![alt](远程URL)`，否则回退本地 `![[路径]]`。
 */
export async function fmtUploadImage(file: File): Promise<void> {
  const notify = useStore.getState().notify;
  try {
    const r = await api.uploadImage(file);
    if (r.remote) {
      const alt = file.name.replace(/\.[^.]+$/, '');
      fmtInsert(`![${alt}](${r.url})`);
      notify(t('已上传图片：{url}', { url: r.url }));
    } else {
      fmtInsert(`![[${r.path}]]`);
      notify(t('Inserted {path}', { path: r.path }));
    }
  } catch (e: any) {
    notify(e?.message ?? t('上传失败'));
  }
}
