import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import Icon from './Icon';

export default function Ribbon({ onTheme }: { onTheme: () => void }) {
  const setLeftPanel = useStore((s) => s.setLeftPanel);
  const leftPanel = useStore((s) => s.leftPanel);
  const setGraph = useStore((s) => s.setGraph);
  const setSettings = useStore((s) => s.setSettings);
  const setLoginOpen = useStore((s) => s.setLoginOpen);
  const role = useStore((s) => s.role);
  const isGuest = role === 'guest';
  const setPalette = useStore((s) => s.setPalette);
  const openDailyNote = useStore((s) => s.openDailyNote);
  const notify = useStore((s) => s.notify);
  const loadTree = useStore((s) => s.loadTree);
  const setCommitDialog = useStore((s) => s.setCommitDialog);

  // Show the Sync-now button only when git sync is enabled in settings.
  const [gitEnabled, setGitEnabled] = useState(false);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    const refresh = () => api.gitStatus().then((g) => setGitEnabled(!!g?.enabled)).catch(() => setGitEnabled(false));
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, []);

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    notify(t('Syncing…'));
    try {
      const r = await api.gitSync();
      notify(r.ok ? t('Synced ✓') : t('Sync: {msg}', { msg: r.log.at(-1) ?? '' }));
      await loadTree();
    } catch (e: any) {
      notify(t('Sync failed: {msg}', { msg: e.message }));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="ribbon">
      <button className={leftPanel === 'files' ? 'active' : ''} title={t('Files')} onClick={() => setLeftPanel('files')}>
        <Icon name="file-text" size={18} />
      </button>
      <button className={leftPanel === 'search' ? 'active' : ''} title={t('Search (⌘⇧F)')} onClick={() => setLeftPanel('search')}>
        <Icon name="search" size={18} />
      </button>
      <button title={t('Graph view')} onClick={() => setGraph(true)}>
        <Icon name="graph" size={18} />
      </button>
      <button className={leftPanel === 'bookmarks' ? 'active' : ''} title={t('Bookmarks & recent')} onClick={() => setLeftPanel('bookmarks')}>
        <Icon name="bookmark" size={18} />
      </button>
      <button title={t('Daily note')} onClick={() => openDailyNote()}>
        <Icon name="calendar" size={18} />
      </button>
      <button className={leftPanel === 'tags' ? 'active' : ''} title={t('Tags')} onClick={() => setLeftPanel('tags')}>
        <Icon name="hash" size={18} />
      </button>
      <button title={t('Command palette (⌘P)')} onClick={() => setPalette(true, 'commands')}>
        <Icon name="command" size={18} />
      </button>
      <div className="spacer" />
      {/* 访客：只保留「提交」入口（走投稿 PR 流程），不显示同步/设置。 */}
      {isGuest && (
        <button title={t('提交更改')} onClick={() => setCommitDialog(true)}>
          <Icon name="git-commit" size={18} />
        </button>
      )}
      {!isGuest && gitEnabled && (
        <button title={t('提交更改')} onClick={() => setCommitDialog(true)}>
          <Icon name="git-commit" size={18} />
        </button>
      )}
      {!isGuest && gitEnabled && (
        <button title={syncing ? t('Syncing…') : t('Sync now')} onClick={sync} disabled={syncing}>
          <Icon name="refresh-cw" size={18} style={syncing ? { animation: 'spin 1s linear infinite' } : undefined} />
        </button>
      )}
      <button title={t('Toggle theme')} onClick={onTheme}>
        <Icon name="moon" size={18} />
      </button>
      {isGuest ? (
        <button title={t('管理员登录')} onClick={() => setLoginOpen(true)}>
          <Icon name="log-in" size={18} />
        </button>
      ) : (
        <button title={t('Settings')} onClick={() => setSettings(true)}>
          <Icon name="settings" size={18} />
        </button>
      )}
    </div>
  );
}
