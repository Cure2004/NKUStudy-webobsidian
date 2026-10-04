import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { api, type GitChange } from '../lib/api';
import { t } from '../lib/i18n';
import Icon from './Icon';

/** 变更类型 → 显示字母与颜色（对齐 git / VS Code 的约定）。 */
const KIND_META: Record<GitChange['kind'], { letter: string; color: string; label: string }> = {
  added: { letter: 'A', color: '#3fb950', label: '新增' },
  modified: { letter: 'M', color: '#d29922', label: '修改' },
  deleted: { letter: 'D', color: '#e5534b', label: '删除' },
  renamed: { letter: 'R', color: '#58a6ff', label: '改名' },
  copied: { letter: 'C', color: '#58a6ff', label: '复制' },
  conflicted: { letter: 'U', color: '#e5534b', label: '冲突' },
};

/**
 * 提交模板对话框：按 Wiki 仓库规范生成提交信息。
 * 结构为「可选中文前缀 + 英文冒号 + 自定义描述」，例如「新增: 添加市北校区建筑与设施信息」。
 * 支持 git 风格的文件变更列表，可勾选要提交的文件（部分提交）。
 */
export default function CommitDialog() {
  const open = useStore((s) => s.commitDialogOpen);
  const setOpen = useStore((s) => s.setCommitDialog);
  const notify = useStore((s) => s.notify);
  const loadTree = useStore((s) => s.loadTree);
  const save = useStore((s) => s.save);
  const role = useStore((s) => s.role);
  const isGuest = role === 'guest';

  const [prefixes, setPrefixes] = useState<string[]>(['新增', '修订', '优化', '修复', '更新']);
  const [prefix, setPrefix] = useState('新增');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingChanges, setLoadingChanges] = useState(false);

  const refreshChanges = async () => {
    setLoadingChanges(true);
    try {
      const { changes: list } = await api.gitChanges();
      setChanges(list);
      // 默认全选（对齐「提交全部改动」的直觉；可手动取消）。
      setSelected(new Set(list.map((c) => c.path)));
    } catch {
      setChanges([]);
      setSelected(new Set());
    } finally {
      setLoadingChanges(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    api
      .commitPrefixes()
      .then((r) => {
        if (r.prefixes?.length) {
          setPrefixes(r.prefixes);
          setPrefix((p) => (r.prefixes.includes(p) ? p : r.prefixes[0]));
        }
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (open) {
      void refreshChanges();
    } else {
      setDescription('');
      setErr('');
      setLog([]);
      setChanges([]);
      setSelected(new Set());
    }
  }, [open]);

  if (!open) return null;

  const message = `${prefix}: ${description.trim()}`;
  const valid = description.trim().length >= 2;
  const allSelected = changes.length > 0 && selected.size === changes.length;
  const noneSelected = selected.size === 0;

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(changes.map((c) => c.path)));
  };

  const run = async (withPush: boolean) => {
    setErr('');
    if (!valid) {
      setErr(t('提交描述至少需要 2 个字符'));
      return;
    }
    if (noneSelected) {
      setErr(t('请至少勾选一个要提交的文件'));
      return;
    }
    setBusy(true);
    try {
      await save(); // 先把当前编辑内容写入磁盘
      const paths = changes.filter((c) => selected.has(c.path)).map((c) => c.path);
      if (withPush) {
        const r = await api.gitSyncTemplate(prefix, description.trim(), paths);
        setLog(r.log);
        notify(r.ok ? t('已提交并推送') : t('同步未完全成功，请查看日志'));
      } else {
        const r = await api.gitCommitTemplate(prefix, description.trim(), paths);
        setLog([r.message]);
        notify(t('已提交'));
      }
      await loadTree();
      await refreshChanges();
    } catch (e: any) {
      setErr(e?.message ?? t('提交失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" onClick={() => setOpen(false)}>
      <div className="modal commit-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="vh-head">
          <Icon name="git-commit" size={16} />
          <div className="vh-title">{t('提交更改')}</div>
          <button className="tool-btn" title={t('Close')} onClick={() => setOpen(false)}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="commit-body">
          {/* git 风格变更列表：可勾选要提交的文件 */}
          <div className="commit-changes-head">
            <span className="commit-changes-title">
              {t('更改')}
              {changes.length > 0 && <span className="commit-changes-count">{selected.size}/{changes.length}</span>}
            </span>
            {changes.length > 0 && (
              <button className="tool-btn" title={t('全选/取消全选')} onClick={toggleAll}>
                <Icon name={allSelected ? 'check-square' : 'square'} size={15} />
              </button>
            )}
            <span style={{ flex: 1 }} />
            <button className="tool-btn" title={t('Refresh')} onClick={() => refreshChanges()} disabled={loadingChanges}>
              <Icon name="refresh-cw" size={15} style={loadingChanges ? { animation: 'spin 1s linear infinite' } : undefined} />
            </button>
          </div>
          <div className="commit-changes">
            {changes.length === 0 && (
              <div className="commit-changes-empty">
                {loadingChanges ? t('加载中…') : t('没有检测到任何改动')}
              </div>
            )}
            {changes.map((c) => {
              const meta = KIND_META[c.kind];
              const checked = selected.has(c.path);
              return (
                <label key={c.path} className={`commit-change ${checked ? 'checked' : ''}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(c.path)} />
                  <span className="commit-change-badge" style={{ color: meta.color }} title={t(meta.label)}>
                    {meta.letter}
                  </span>
                  <span className="commit-change-path" title={c.path}>
                    {c.path}
                  </span>
                </label>
              );
            })}
          </div>

          <p className="commit-hint">
            {t('提交信息格式为「中文前缀: 详细说明」，与 Wiki 仓库的 CI 校验一致。')}
          </p>

          <div className="setting-row">
            <div className="info">
              <div className="name">{t('前缀')}</div>
              <div className="desc">{t('选择本次改动的类型')}</div>
            </div>
            <select
              className="text-input"
              style={{ width: 160 }}
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
            >
              {prefixes.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="setting-row">
            <div className="info">
              <div className="name">{t('描述')}</div>
              <div className="desc">{t('用中文简要说明本次改动，至少 2 个字符')}</div>
            </div>
            <input
              className="text-input"
              style={{ width: 320 }}
              placeholder={t('例如：添加市北校区建筑与设施信息')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && valid && !busy) void run(true);
              }}
            />
          </div>

          <div className="commit-preview">
            <div className="commit-preview-label">{t('预览')}</div>
            <code className="commit-preview-value">{message}</code>
          </div>

          {err && <div style={{ color: '#e5534b', margin: '6px 0' }}>{err}</div>}
          {log.length > 0 && (
            <pre className="commit-log">{log.join('\n')}</pre>
          )}
        </div>

        <div className="vh-foot">
          <button className="btn secondary" onClick={() => setOpen(false)} disabled={busy}>
            {t('Close')}
          </button>
          {/* 访客只能走投稿流程（提交并推送 + 开 PR）；「仅提交」是 owner 功能。 */}
          {!isGuest && (
            <button className="btn secondary" onClick={() => run(false)} disabled={busy || !valid || noneSelected}>
              {busy ? t('处理中…') : t('仅提交')}
            </button>
          )}
          <button className="btn" onClick={() => run(true)} disabled={busy || !valid || noneSelected}>
            {busy ? t('处理中…') : t('提交并推送（创建 PR）')}
          </button>
        </div>
      </div>
    </div>
  );
}
