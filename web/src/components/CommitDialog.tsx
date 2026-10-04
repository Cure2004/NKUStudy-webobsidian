import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import Icon from './Icon';

/**
 * 提交模板对话框：按 Wiki 仓库规范生成提交信息。
 * 结构为「可选中文前缀 + 英文冒号 + 自定义描述」，例如「新增: 添加市北校区建筑与设施信息」。
 * 提交后调用 /api/git/commit（或 /api/git/sync 一并推送并开 PR）。
 */
export default function CommitDialog() {
  const open = useStore((s) => s.commitDialogOpen);
  const setOpen = useStore((s) => s.setCommitDialog);
  const notify = useStore((s) => s.notify);
  const loadTree = useStore((s) => s.loadTree);
  const save = useStore((s) => s.save);

  const [prefixes, setPrefixes] = useState<string[]>(['新增', '修订', '优化', '修复', '更新']);
  const [prefix, setPrefix] = useState('新增');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [log, setLog] = useState<string[]>([]);

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
    if (!open) {
      setDescription('');
      setErr('');
      setLog([]);
    }
  }, [open]);

  if (!open) return null;

  const message = `${prefix}: ${description.trim()}`;
  const valid = description.trim().length >= 2;

  const run = async (withPush: boolean) => {
    setErr('');
    if (!valid) {
      setErr(t('提交描述至少需要 2 个字符'));
      return;
    }
    setBusy(true);
    try {
      await save(); // 先把当前编辑内容写入磁盘
      if (withPush) {
        const r = await api.gitSyncTemplate(prefix, description.trim());
        setLog(r.log);
        notify(r.ok ? t('已提交并推送') : t('同步未完全成功，请查看日志'));
      } else {
        const r = await api.gitCommitTemplate(prefix, description.trim());
        setLog([r.message]);
        notify(t('已提交'));
      }
      await loadTree();
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
          <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
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
            <span style={{ color: 'var(--text-muted)' }}>{t('预览')}：</span>
            <code>{message}</code>
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
          <button className="btn secondary" onClick={() => run(false)} disabled={busy || !valid}>
            {busy ? t('处理中…') : t('仅提交')}
          </button>
          <button className="btn" onClick={() => run(true)} disabled={busy || !valid}>
            {busy ? t('处理中…') : t('提交并推送（创建 PR）')}
          </button>
        </div>
      </div>
    </div>
  );
}
