import { useEffect } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import Icon from './Icon';

/**
 * Per-note share settings popup (FR-10) — opened from the file-tree context
 * menu ("Share…"). Create/copy the public URL, toggle it on/off, manage the
 * password, or delete the link. The centralized list lives in Settings → Sharing.
 */
export default function ShareDialog() {
  const path = useStore((s) => s.shareDialogPath);
  const setShareDialog = useStore((s) => s.setShareDialog);
  const shares = useStore((s) => s.shares);
  const loadShares = useStore((s) => s.loadShares);
  const notify = useStore((s) => s.notify);

  useEffect(() => {
    if (path) loadShares();
  }, [path, loadShares]);

  if (!path) return null;
  const close = () => setShareDialog(null);
  const share = shares.find((s) => s.path === path) ?? null;
  const url = share ? `${location.origin}/share/${share.id}` : '';

  const create = async () => {
    await api.createShare(path);
    await loadShares();
    notify(t('Public link created'));
  };
  const toggle = async () => {
    if (!share) return;
    await api.setShareEnabled(share.id, !share.enabled);
    await loadShares();
  };
  const copy = () => {
    navigator.clipboard?.writeText(url).catch(() => {});
    notify(t('Public link copied'));
  };
  const password = async () => {
    if (!share) return;
    const pw = prompt(
      share.hasPassword
        ? t('New password for this link (leave empty to REMOVE the password):')
        : t('Password for this link:'),
    );
    if (pw === null) return;
    await api.setSharePassword(share.id, pw || null);
    await loadShares();
    notify(pw ? t('Password set') : t('Password removed'));
  };
  const remove = async () => {
    if (!share) return;
    if (!confirm(t('Delete this public link? The URL stops working permanently.'))) return;
    await api.deleteShare(share.id);
    await loadShares();
    notify(t('Public link deleted'));
  };

  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal share-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="share-dialog-head">
          <Icon name="globe" size={18} />
          <div>
            <div className="share-dialog-title">{/\.canvas$/i.test(path) ? t('Share canvas') : t('Share note')}</div>
            <div className="share-dialog-path">{path}</div>
          </div>
        </div>

        {!share && (
          <>
            <p className="share-dialog-hint">
              {t('Create a public link so anyone with the URL can read this note without login.')}
            </p>
            <button className="btn" onClick={create}>
              <Icon name="globe" size={14} /> {t('Create public link')}
            </button>
          </>
        )}

        {share && (
          <>
            <div className="setting-row">
              <div className="info">
                <div className="name">{t('Public link')}</div>
                <div className="desc">{share.enabled ? t('Anyone with the URL can view this note') : t('Sharing is paused — the URL returns 404')}</div>
              </div>
              <button className={`graph-switch ${share.enabled ? 'on' : ''}`} onClick={toggle} aria-label={t('Toggle public link')}>
                <span className="graph-knob" />
              </button>
            </div>

            {share.enabled && (
              <div className="share-url">
                <input className="text-input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
                <button className="btn" onClick={copy}><Icon name="link" size={14} /> {t('Copy')}</button>
              </div>
            )}

            <div className="setting-row">
              <div className="info">
                <div className="name">{t('Password protection')}</div>
                <div className="desc">{share.hasPassword ? t('Visitors must enter a password') : t('Anyone with the link can open it')}</div>
              </div>
              <button className="btn secondary" onClick={password}>
                {share.hasPassword ? t('Change…') : t('Set password…')}
              </button>
            </div>

            <div className="setting-row">
              <div className="info">
                <div className="name">{t('Delete link')}</div>
                <div className="desc">{t('Revokes the URL permanently')}</div>
              </div>
              <button className="btn danger" onClick={remove}>{t('Delete')}</button>
            </div>
          </>
        )}

        <div className="share-dialog-foot">
          <button className="btn secondary" onClick={close}>{t('Done')}</button>
        </div>
      </div>
    </div>
  );
}
