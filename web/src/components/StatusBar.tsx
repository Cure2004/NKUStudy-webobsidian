import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import Icon from './Icon';

export default function StatusBar() {
  const content = useStore((s) => s.content);
  const activePath = useStore((s) => s.activePath);
  const dirty = useStore((s) => s.dirty);
  const loadTree = useStore((s) => s.loadTree);
  const notify = useStore((s) => s.notify);
  const role = useStore((s) => s.role);
  const isGuest = role === 'guest';
  const [git, setGit] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);

  // 访客无权访问 git 状态（owner 专属接口），直接跳过轮询。
  const refresh = () => api.gitStatus().then(setGit).catch(() => setGit(null));
  useEffect(() => {
    if (isGuest) return;
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [isGuest]);

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    notify(t('Syncing…'));
    try {
      const r = await api.gitSync();
      notify(r.ok ? t('Synced ✓') : t('Sync: {msg}', { msg: r.log.at(-1) ?? '' }));
      await loadTree();
      await refresh();
    } catch (e: any) {
      notify(t('Sync failed: {msg}', { msg: e.message }));
    } finally {
      setSyncing(false);
    }
  };

  const isText = activePath && /\.(md|markdown|txt)$/i.test(activePath);
  const words = isText ? content.trim().split(/\s+/).filter(Boolean).length : 0;

  const gitLabel = !git?.isRepo
    ? t('No vault sync')
    : git.clean
      ? `git ${git.branch}${git.ahead ? ` ↑${git.ahead}` : ''}${git.behind ? ` ↓${git.behind}` : ''}`
      : t('{n} unsaved changes', { n: git.modified + git.notAdded });

  return (
    <div className="status-bar">
      {dirty && <span>{t('Saving…')}</span>}
      {isText && <span>{t('{n} words', { n: words })}</span>}
      {isText && <span>{t('{n} characters', { n: content.length })}</span>}
      {/* 访客只能通过「提交更改」对话框投稿（带提交模板），不显示一键同步入口。 */}
      {!isGuest && (
        <span className="clickable" title={t('Git sync')} onClick={sync}>
          <Icon name="refresh-cw" size={13} style={syncing ? { animation: 'spin 1s linear infinite' } : undefined} />
          {gitLabel}
        </span>
      )}
    </div>
  );
}
