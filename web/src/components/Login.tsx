import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { t } from '../lib/i18n';
import Icon from './Icon';

export default function Login({ onAuthed, overlay = false }: { onAuthed: () => void; overlay?: boolean }) {
  const setMustChangePassword = useStore((s) => s.setMustChangePassword);
  const [needSetup, setNeedSetup] = useState(false);
  const [password, setPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.authStatus().then((s) => setNeedSetup(!s.passwordSet)).catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (needSetup && password !== confirm) {
      setErr(t('Passwords do not match'));
      return;
    }
    setBusy(true);
    try {
      if (needSetup) {
        await api.setup(password, setupToken);
        setMustChangePassword(false); // a freshly-set password is already custom
      } else {
        const r = await api.login(password);
        setMustChangePassword(Boolean(r.mustChangePassword));
      }
      onAuthed();
    } catch (e: any) {
      setErr(e.message ?? t('Failed'));
    } finally {
      setBusy(false);
    }
  };

  // overlay=true 时作为公开模式下的「管理员登录」浮层，去掉全屏背景。
  return (
    <div className={overlay ? 'login-overlay' : 'login-screen'}>
      <form className="login-card" onSubmit={submit}>
        <div className="logo">
          <Icon name="gem" size={40} />
        </div>
        <h1>{t('WebObsidian')}</h1>
        <p>{needSetup ? t('Set a master password to secure your vault') : t('Enter your password to unlock')}</p>
        <div className="err">{err}</div>
        <input
          className="text-input"
          type="password"
          placeholder={t('Password')}
          minLength={needSetup ? 12 : undefined}
          maxLength={1024}
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {needSetup && (
          <input className="text-input" type="password" autoComplete="off"
            aria-label="One-time setup credential" placeholder="One-time setup credential"
            value={setupToken} onChange={(e) => setSetupToken(e.target.value)} />
        )}
        {needSetup && (
          <input
            className="text-input"
            type="password"
            placeholder={t('Confirm password')}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        )}
        <button className="btn" type="submit" disabled={busy}>
          {needSetup ? t('Create & Unlock') : t('Unlock')}
        </button>
      </form>
    </div>
  );
}
