import { useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { t } from '../lib/i18n';
import Icon from './Icon';

const MIN_LEN = 12;

/**
 * Blocking screen shown after a recovery login without a user password
 * (`mustChangePassword`). The vault can't be
 * used until a custom password is set — there is no dismiss.
 */
export default function ForceChangePassword() {
  const setMustChangePassword = useStore((s) => s.setMustChangePassword);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (next.length < MIN_LEN) {
      setErr(t('Password must be at least {n} characters', { n: MIN_LEN }));
      return;
    }
    if (next !== confirm) {
      setErr(t('Passwords do not match'));
      return;
    }
    setBusy(true);
    try {
      // Recovery credentials are never embedded in the UI.
      await api.changePassword(current, next);
      setMustChangePassword(false);
    } catch (e: any) {
      setErr(e.message ?? t('Failed to change password'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="logo">
          <Icon name="gem" size={40} />
        </div>
        <h1>{t('Set a new password')}</h1>
        <p>
          Enter the credential you used to sign in, then choose a new password.
        </p>
        <div className="err">{err}</div>
        <input className="text-input" type="password" autoComplete="current-password"
          aria-label="Current password" placeholder="Current password"
          value={current} onChange={(e) => setCurrent(e.target.value)} />
        <input
          className="text-input"
          type="password"
          placeholder={t('New password')}
          autoFocus
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <input
          className="text-input"
          type="password"
          placeholder={t('Confirm new password')}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <button className="btn" type="submit" disabled={busy}>
          {busy ? t('Saving…') : t('Set password & continue')}
        </button>
      </form>
    </div>
  );
}
