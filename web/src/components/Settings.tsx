import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import Icon from './Icon';

type Section = 'vault' | 'git' | 'api' | 'sharing' | 'plugins' | 'appearance' | 'account' | 'about';

export default function Settings() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettings);
  const [section, setSection] = useState<Section>('vault');
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    if (open) api.getSettings().then(setSettings).catch(() => {});
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-bg" onClick={() => setOpen(false)}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-layout">
          <div className="settings-nav">
            {(['vault', 'git', 'api', 'sharing', 'plugins', 'appearance', 'account', 'about'] as Section[]).map((s) => (
              <button key={s} className={section === s ? 'active' : ''} onClick={() => setSection(s)}>
                {labels[s]}
              </button>
            ))}
          </div>
          <div className="settings-content">
            {settings && section === 'vault' && <VaultSettings s={settings} reload={() => api.getSettings().then(setSettings)} />}
            {settings && section === 'git' && <GitSettings s={settings} reload={() => api.getSettings().then(setSettings)} />}
            {section === 'api' && <ApiKeys />}
            {section === 'sharing' && <Shares />}
            {section === 'plugins' && <Plugins />}
            {settings && section === 'appearance' && <Appearance s={settings} />}
            {section === 'account' && <AccountSettings s={settings} reload={() => api.getSettings().then(setSettings)} />}
            {section === 'about' && <About />}
          </div>
        </div>
      </div>
    </div>
  );
}

const labels: Record<Section, string> = {
  vault: t('Vault & Files'),
  git: t('GitHub Sync'),
  api: t('API Keys'),
  sharing: t('Sharing'),
  plugins: t('Community Plugins'),
  appearance: t('Appearance'),
  account: t('Account'),
  about: t('About'),
};

function Row({ name, desc, children }: { name: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div className="info">
        <div className="name">{name}</div>
        {desc && <div className="desc">{desc}</div>}
      </div>
      <div className="control">{children}</div>
    </div>
  );
}

function VaultSettings({ s, reload }: { s: any; reload: () => void }) {
  const [path, setPath] = useState(s.vault.path);
  const [deleteMode, setDeleteMode] = useState(s.vault.deleteMode ?? 'trash');
  const [contentRoot, setContentRoot] = useState(s.vault.root ?? '');
  const [useDocTitles, setUseDocTitles] = useState(s.vault.useDocTitles !== false);
  const [labelsText, setLabelsText] = useState(
    Object.entries(s.vault.folderLabels ?? {})
      .map(([k, v]) => `${k} = ${v}`)
      .join('\n'),
  );
  const [browser, setBrowser] = useState<any>(null);
  const save = async () => {
    await api.putSettings({ vault: { path } });
    await reload();
    alert(t('Vault path saved. Reindex from the command palette if needed.'));
  };
  const saveDeleteMode = async (mode: string) => {
    setDeleteMode(mode);
    await api.putSettings({ vault: { deleteMode: mode } });
    await reload();
  };
  const saveDisplay = async () => {
    // 每行 `相对路径 = 中文名`，空行/无等号的行忽略。
    const folderLabels: Record<string, string> = {};
    for (const line of labelsText.split('\n')) {
      const i = line.indexOf('=');
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (k && v) folderLabels[k] = v;
    }
    await api.putSettings({ vault: { root: contentRoot.trim(), useDocTitles, folderLabels } });
    await reload();
    alert(t('显示设置已保存，重新加载文件树后生效。'));
  };
  const browse = async (dir?: string) => setBrowser(await api.browse(dir).catch((e) => ({ error: e.message })));
  return (
    <div>
      <h2>{t('Vault & Files')}</h2>
      <Row name={t('Vault path')} desc={t('Absolute path on the server to your notes folder')}>
        <input className="text-input" style={{ width: 260 }} value={path} onChange={(e) => setPath(e.target.value)} />
      </Row>
      <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
        <button className="btn secondary" onClick={() => browse()}>{t('Browse…')}</button>
        <button className="btn" onClick={save}>{t('Save vault path')}</button>
      </div>
      {browser && !browser.error && (
        <div style={{ border: '1px solid var(--bg-modifier-border)', borderRadius: 6, padding: 8, marginTop: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{browser.dir}</div>
          <div className="result" onClick={() => browse(browser.parent)} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="folder" size={15} /> ..
          </div>
          {browser.folders.map((f: any) => (
            <div className="result" key={f.path} onClick={() => browse(f.path)} onDoubleClick={() => setPath(f.path)} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="folder" size={15} /> {f.name}
              <button className="btn secondary" style={{ float: 'right', padding: '2px 8px' }} onClick={(e) => { e.stopPropagation(); setPath(f.path); }}>
                {t('Select')}
              </button>
            </div>
          ))}
        </div>
      )}
      {browser?.error && <div style={{ color: '#e5534b' }}>{browser.error}</div>}

      <h3 style={{ marginTop: 20 }}>{t('显示')}</h3>
      <Row
        name={t('内容根目录')}
        desc={t('相对仓库根的子目录，文件树只显示该目录（如 docs/start）。留空表示整个仓库。')}
      >
        <input className="text-input" style={{ width: 260 }} value={contentRoot} onChange={(e) => setContentRoot(e.target.value)} placeholder="docs/start" />
      </Row>
      <Row
        name={t('用文档标题显示 Markdown')}
        desc={t('开启后，文件树/标签页用文档标题替代英文文件名显示')}
      >
        <input type="checkbox" checked={useDocTitles} onChange={(e) => setUseDocTitles(e.target.checked)} />
      </Row>
      <Row
        name={t('文件夹中文名映射')}
        desc={t('每行一条「相对路径 = 中文名」，与 VitePress config.ts 的 directoryLabels 对应')}
      >
        <textarea
          className="text-input"
          style={{ width: 320, height: 160, fontFamily: 'var(--font-monospace, monospace)', fontSize: 12 }}
          value={labelsText}
          onChange={(e) => setLabelsText(e.target.value)}
          placeholder={'preface = 序言\nnewstudent = 新生入学\ncampus-life = 校园生活'}
        />
      </Row>
      <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
        <button className="btn" onClick={saveDisplay}>{t('保存显示设置')}</button>
      </div>

      <Row
        name={t('When deleting a file')}
        desc={t('Move to .trash keeps a recoverable copy (Open trash to restore). Permanently delete removes it immediately.')}
      >
        <select
          className="text-input"
          style={{ width: 220 }}
          value={deleteMode}
          onChange={(e) => saveDeleteMode(e.target.value)}
        >
          <option value="trash">{t('Move to .trash (recoverable)')}</option>
          <option value="permanent">{t('Permanently delete')}</option>
        </select>
      </Row>
    </div>
  );
}

function GitSettings({ s, reload }: { s: any; reload: () => void }) {
  const [g, setG] = useState({ ...s.git });
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<HTMLTextAreaElement>(null);
  const set = (k: string, v: any) => setG((p: any) => ({ ...p, [k]: v }));
  // Append timestamped lines to the running log instead of replacing it, so the
  // textarea keeps a history of every git action across clicks.
  const append = (lines: string[]) => {
    const ts = new Date().toLocaleTimeString();
    setLog((prev) => [...prev, ...lines.map((l, i) => (i === 0 ? `[${ts}] ${l}` : `         ${l}`))]);
  };
  // Auto-scroll to the newest line whenever the log grows.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);
  const save = async () => { await api.putSettings({ git: g }); await reload(); append([t('Saved git settings')]); };
  const run = async (fn: () => Promise<any>, label: string) => {
    append([`${label}…`]);
    try {
      const r = await fn();
      // sync returns { ok, log: string[] }; others return { message }. Split any
      // embedded newlines so multi-line git output renders one line per row.
      const lines: string[] = Array.isArray(r?.log)
        ? [`${label} ${r.ok ? t('ok') : t('NOT ok')}`, ...r.log]
        : [String(r?.message ?? JSON.stringify(r))];
      append(lines.flatMap((l) => String(l).split('\n')));
    } catch (e: any) { append([t('Error: {msg}', { msg: e.message })]); }
  };
  return (
    <div>
      <h2>{t('GitHub Sync')}</h2>
      <Row name={t('Enable git sync')}><input type="checkbox" checked={g.enabled} onChange={(e) => set('enabled', e.target.checked)} /></Row>
      <Row name={t('Remote URL')} desc="https://github.com/owner/repo.git">
        <input className="text-input" style={{ width: 260 }} value={g.remote} onChange={(e) => set('remote', e.target.value)} />
      </Row>
      <Row name={t('Branch')}><input className="text-input" style={{ width: 120 }} value={g.branch} onChange={(e) => set('branch', e.target.value)} /></Row>
      <Row name={t('Access token (PAT)')} desc={t('Stored server-side; leave masked to keep current')}>
        <input className="text-input" type="password" style={{ width: 260 }} value={g.token} onChange={(e) => set('token', e.target.value)} />
      </Row>
      <Row name={t('Author name')}><input className="text-input" value={g.authorName} onChange={(e) => set('authorName', e.target.value)} /></Row>
      <Row name={t('Author email')}><input className="text-input" value={g.authorEmail} onChange={(e) => set('authorEmail', e.target.value)} /></Row>
      <Row name={t('Auto-sync')} desc={t('Periodic pull+commit+push on the interval below')}><input type="checkbox" checked={g.autoSync} onChange={(e) => set('autoSync', e.target.checked)} /></Row>
      <Row name={t('Auto-commit on save')} desc={t('Commit (+push) ~5s after each edit')}><input type="checkbox" checked={g.autoCommitOnSave} onChange={(e) => set('autoCommitOnSave', e.target.checked)} /></Row>
      <Row name={t('Interval (sec)')}><input className="text-input" type="number" style={{ width: 90 }} value={g.intervalSec} onChange={(e) => set('intervalSec', Number(e.target.value))} /></Row>
      <Row name={t('Git LFS patterns')} desc={t('Space-separated globs tracked via LFS')}>
        <input className="text-input" style={{ width: 260 }} value={(g.lfsPatterns || []).join(' ')} onChange={(e) => set('lfsPatterns', e.target.value.split(/\s+/).filter(Boolean))} />
      </Row>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <button className="btn" onClick={save}>{t('Save')}</button>
        <button className="btn secondary" onClick={() => run(api.gitInit, t('Init'))}>{t('Init repo')}</button>
        <button className="btn secondary" onClick={() => run(api.gitClone, t('Clone'))}>{t('Clone')}</button>
        <button className="btn secondary" onClick={() => run(api.gitPull, t('Pull'))}>{t('Pull')}</button>
        <button className="btn secondary" onClick={() => run(() => api.gitCommit(), t('Commit'))}>{t('Commit')}</button>
        <button className="btn secondary" onClick={() => run(api.gitPush, t('Push'))}>{t('Push')}</button>
        <button className="btn" onClick={() => run(() => api.gitSync(), t('Sync'))}>{t('Sync now')}</button>
      </div>
      <div style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('Sync log')}</span>
          {log.length > 0 && (
            <button className="btn secondary" style={{ padding: '2px 8px' }} onClick={() => setLog([])}>{t('Clear')}</button>
          )}
        </div>
        <textarea
          ref={logRef}
          readOnly
          value={log.length ? log.join('\n') : t('No git activity yet. Click an action above (Sync now, Pull, Push…) to see logs here.')}
          style={{
            width: '100%', height: 200, boxSizing: 'border-box', resize: 'vertical',
            background: 'var(--bg-primary)', color: 'var(--text-normal)',
            border: '1px solid var(--bg-modifier-border, #444)', borderRadius: 6, padding: 10,
            fontFamily: 'var(--font-monospace, monospace)', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre',
          }}
        />
      </div>
      <GitHubAppSettings s={s} reload={reload} append={append} />
    </div>
  );
}

/**
 * GitHub App 鉴权 + 在线投稿（PR）配置。
 * 说明见 docs/GITHUB_APP.md。
 */
function GitHubAppSettings({
  s,
  reload,
  append,
}: {
  s: any;
  reload: () => void;
  append: (lines: string[]) => void;
}) {
  const [gh, setGh] = useState({ ...(s.github ?? {}) });
  const [appStatus, setAppStatus] = useState<boolean | null>(null);
  const set = (k: string, v: any) => setGh((p: any) => ({ ...p, [k]: v }));

  useEffect(() => {
    api.githubAppStatus().then((r) => setAppStatus(r.configured)).catch(() => setAppStatus(null));
  }, [s.github]);

  const save = async () => {
    await api.putSettings({ github: gh });
    await reload();
    append([t('GitHub App 设置已保存')]);
    api.githubAppStatus().then((r) => setAppStatus(r.configured)).catch(() => {});
  };

  const testPr = async () => {
    append([t('正在创建测试 PR…')]);
    try {
      const r = await api.openPullRequest();
      append([r.created ? t('已创建 PR #{n}：{url}', { n: r.number, url: r.html_url }) : t('已复用现有 PR #{n}：{url}', { n: r.number, url: r.html_url })]);
    } catch (e: any) {
      append([t('Error: {msg}', { msg: e.message })]);
    }
  };

  return (
    <div style={{ marginTop: 24, borderTop: '1px solid var(--bg-modifier-border)', paddingTop: 12 }}>
      <h2>{t('GitHub App（在线编辑）')}</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
        {t('使用 GitHub App 鉴权后，在线编辑将推送到指定分支并自动创建 Pull Request。创建步骤见 docs/GITHUB_APP.md。')}
      </p>
      <Row name={t('启用 GitHub App')} desc={appStatus === null ? undefined : appStatus ? t('已配置') : t('未配置')}>
        <input type="checkbox" checked={!!gh.appEnabled} onChange={(e) => set('appEnabled', e.target.checked)} />
      </Row>
      <Row name={t('App ID')} desc={t('GitHub App 页面显示的 App ID')}>
        <input className="text-input" style={{ width: 160 }} value={gh.appId ?? ''} onChange={(e) => set('appId', e.target.value)} />
      </Row>
      <Row name={t('Installation ID')} desc={t('安装到目标仓库后获得的 Installation ID')}>
        <input className="text-input" style={{ width: 160 }} value={gh.installationId ?? ''} onChange={(e) => set('installationId', e.target.value)} />
      </Row>
      <Row name={t('私钥（.pem）')} desc={t('粘贴 .pem 文件全文；已保存时显示为掩码，保持不变即不修改')}>
        <textarea
          className="text-input"
          style={{ width: 320, height: 90, fontFamily: 'var(--font-monospace, monospace)', fontSize: 12 }}
          value={gh.privateKey ?? ''}
          onChange={(e) => set('privateKey', e.target.value)}
          placeholder="-----BEGIN RSA PRIVATE KEY-----"
        />
      </Row>
      <Row name={t('仓库 owner')}><input className="text-input" style={{ width: 200 }} value={gh.owner ?? ''} onChange={(e) => set('owner', e.target.value)} /></Row>
      <Row name={t('仓库名 repo')}><input className="text-input" style={{ width: 200 }} value={gh.repo ?? ''} onChange={(e) => set('repo', e.target.value)} /></Row>
      <Row name={t('编辑分支')} desc={t('在线编辑推送到��分支（默认 web-edit）')}>
        <input className="text-input" style={{ width: 160 }} value={gh.editBranch ?? ''} onChange={(e) => set('editBranch', e.target.value)} />
      </Row>
      <Row name={t('PR 目标分支')} desc={t('创建 Pull Request 时的目标分支')}>
        <input className="text-input" style={{ width: 160 }} value={gh.baseBranch ?? ''} onChange={(e) => set('baseBranch', e.target.value)} />
      </Row>
      <Row name={t('自动创建 PR')} desc={t('推送成功后自动为编辑分支创建/复用 Pull Request')}>
        <input type="checkbox" checked={!!gh.autoPullRequest} onChange={(e) => set('autoPullRequest', e.target.checked)} />
      </Row>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn" onClick={save}>{t('Save')}</button>
        <button className="btn secondary" onClick={testPr}>{t('测试：创建 PR')}</button>
      </div>
    </div>
  );
}

function ApiKeys() {
  const [keys, setKeys] = useState<any[]>([]);
  const [name, setName] = useState('my-agent');
  const [scopes, setScopes] = useState<string[]>(['read', 'search']);
  const [created, setCreated] = useState('');
  const load = () => api.listKeys().then((r) => setKeys(r.keys)).catch(() => {});
  useEffect(() => { load(); }, []);
  const toggle = (sc: string) => setScopes((p) => (p.includes(sc) ? p.filter((x) => x !== sc) : [...p, sc]));
  const create = async () => {
    const r = await api.createKey(name, scopes);
    setCreated(r.key);
    await load();
  };
  return (
    <div>
      <h2>{t('API Keys')}</h2>
      <p style={{ color: 'var(--text-muted)' }}>{t('Keys let AI agents call /api/v1. The raw key is shown once.')}</p>
      <Row name={t('Name')}><input className="text-input" value={name} onChange={(e) => setName(e.target.value)} /></Row>
      <Row name={t('Scopes')}>
        <span>
          {['read', 'write', 'search'].map((sc) => (
            <label key={sc} style={{ marginRight: 10 }}>
              <input type="checkbox" checked={scopes.includes(sc)} onChange={() => toggle(sc)} /> {sc}
            </label>
          ))}
        </span>
      </Row>
      <button className="btn" onClick={create}>{t('Create key')}</button>
      {created && (
        <pre style={{ background: 'var(--bg-primary)', padding: 10, borderRadius: 6, marginTop: 10, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
          {created}
          {'\n'}{t('⚠ Copy now — it will not be shown again.')}
        </pre>
      )}
      <div style={{ marginTop: 16 }}>
        {keys.map((k) => (
          <div className="setting-row" key={k.id}>
            <div className="info">
              <div className="name">{k.name} <span style={{ color: 'var(--text-faint)' }}>{k.prefix}…</span></div>
              <div className="desc">{t('scopes: {scopes} · used: {used}', { scopes: k.scopes.join(', '), used: k.lastUsed ?? t('never') })}</div>
            </div>
            <button className="btn danger" onClick={async () => { await api.revokeKey(k.id); load(); }}>{t('Revoke')}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Shares() {
  const notify = useStore((s) => s.notify);
  const openFile = useStore((s) => s.openFile);
  const setOpen = useStore((s) => s.setSettings);
  // Shared with the store so the file tree's globe badges refresh on changes.
  const shares = useStore((s) => s.shares);
  const load = useStore((s) => s.loadShares);
  const [query, setQuery] = useState('');
  useEffect(() => { load(); }, [load]);

  const url = (id: string) => `${location.origin}/share/${id}`;
  const copy = (id: string) => {
    navigator.clipboard?.writeText(url(id)).catch(() => {});
    notify(t('Public link copied'));
  };
  const toggle = async (s: any) => {
    await api.setShareEnabled(s.id, !s.enabled);
    load();
  };
  const remove = async (s: any) => {
    if (!confirm(t('Delete the public link for "{path}"? The URL stops working permanently.', { path: s.path }))) return;
    await api.deleteShare(s.id);
    load();
  };
  const setPassword = async (s: any) => {
    const pw = prompt(
      s.hasPassword
        ? t('New password for this link (leave empty to REMOVE the password):')
        : t('Password for this link:'),
    );
    if (pw === null) return;
    await api.setSharePassword(s.id, pw || null);
    notify(pw ? t('Password set') : t('Password removed'));
    load();
  };

  const q = query.trim().toLowerCase();
  const filtered = q ? shares.filter((s) => s.path.toLowerCase().includes(q)) : shares;

  return (
    <div>
      <h2>{t('Sharing')}</h2>
      <p style={{ color: 'var(--text-muted)' }}>
        {t('Notes shared via a public link are readable by anyone with the URL, without login. Create a link from a note\'s context menu ("Share…"). Disable keeps the URL for re-enabling later; delete revokes it permanently.')}
      </p>
      <input
        className="text-input"
        style={{ width: '100%', margin: '6px 0 12px' }}
        placeholder={t('Search shared notes…')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {filtered.length === 0 && (
        <div style={{ color: 'var(--text-faint)' }}>
          {shares.length === 0 ? t('No notes are shared publicly.') : t('No shared note matches the search.')}
        </div>
      )}
      {filtered.map((s) => (
        <div className="setting-row" key={s.id}>
          <div className="info" style={{ minWidth: 0 }}>
            <div
              className="name"
              style={{ cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: s.enabled ? 1 : 0.55 }}
              title={t('Open {path}', { path: s.path })}
              onClick={() => { openFile(s.path); setOpen(false); }}
            >
              {s.path}
            </div>
            <div className="desc">
              {s.enabled ? t('active') : t('disabled')}
              {s.hasPassword ? ' · ' + t('password-protected') : ''} · {t('created {date}', { date: new Date(s.createdAt).toLocaleDateString() })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            <button className="btn secondary" disabled={!s.enabled} onClick={() => copy(s.id)} title={url(s.id)}>
              <Icon name="link" size={14} /> {t('Copy link')}
            </button>
            <button className="btn secondary" onClick={() => setPassword(s)} title={s.hasPassword ? t('Change or remove password') : t('Require a password to open the link')}>
              {s.hasPassword ? t('Password ✓') : t('Password…')}
            </button>
            <button className={`btn ${s.enabled ? 'secondary' : ''}`} onClick={() => toggle(s)}>
              {s.enabled ? t('Disable') : t('Enable')}
            </button>
            <button className="btn danger" onClick={() => remove(s)}>{t('Delete')}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Plugins() {
  const [plugins, setPlugins] = useState<any[]>([]);
  const [repo, setRepo] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => api.listPlugins().then((r) => setPlugins(r.plugins)).catch(() => {});
  useEffect(() => { load(); }, []);
  const install = async () => {
    setMsg(t('Installing…'));
    try { await api.installPlugin(repo); setMsg(t('Installed ✓')); setRepo(''); await load(); }
    catch (e: any) { setMsg(t('Error: {msg}', { msg: e.message })); }
  };
  return (
    <div>
      <h2>{t('Community Plugins')}</h2>
      <Row name={t('Install from GitHub')} desc={t('owner/repo — pulls manifest.json + main.js from latest release')}>
        <span style={{ display: 'flex', gap: 8 }}>
          <input className="text-input" placeholder="blacksmithgu/obsidian-dataview" value={repo} onChange={(e) => setRepo(e.target.value)} />
          <button className="btn" onClick={install}>{t('Install')}</button>
        </span>
      </Row>
      {msg && <div style={{ color: 'var(--text-muted)', margin: '6px 0' }}>{msg}</div>}
      <div style={{ marginTop: 12 }}>
        {plugins.length === 0 && <div style={{ color: 'var(--text-faint)' }}>{t('No plugins installed in .obsidian/plugins')}</div>}
        {plugins.map((p) => (
          <div className="setting-row" key={p.id}>
            <div className="info">
              <div className="name">{p.name} <span style={{ color: 'var(--text-faint)' }}>v{p.version}</span></div>
              <div className="desc">{p.description}</div>
            </div>
            <label>
              <input type="checkbox" checked={p.enabled} onChange={async (e) => { await api.setPluginEnabled(p.id, e.target.checked); load(); }} /> {t('enabled')}
            </label>
          </div>
        ))}
      </div>
      <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 14 }}>
        {t('Note: WebObsidian supports a subset of the Obsidian plugin API. Most metadata/markdown plugins work; plugins relying on Electron/Node internals may not.')}
      </p>
    </div>
  );
}

function Appearance({ s }: { s: any }) {
  const [theme, setTheme] = useState(s.ui.theme);
  const save = async (t: string) => { setTheme(t); await api.putSettings({ ui: { theme: t } }); location.reload(); };
  return (
    <div>
      <h2>{t('Appearance')}</h2>
      <Row name={t('Theme')}>
        <select className="text-input" value={theme} onChange={(e) => save(e.target.value)}>
          <option value="obsidian-dark">{t('Obsidian Dark')}</option>
          <option value="obsidian-light">{t('Obsidian Light')}</option>
        </select>
      </Row>
    </div>
  );
}

function AccountSettings({ s, reload }: { s: any; reload: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const usingDefault = !s?.auth?.hasCustomPassword;

  const save = async () => {
    setErr('');
    setMsg('');
    if (next.length < 6) {
      setErr(t('Mật khẩu mới phải có ít nhất 6 ký tự'));
      return;
    }
    if (next !== confirm) {
      setErr(t('Mật khẩu xác nhận không khớp'));
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setMsg(t('Đã đổi mật khẩu ✓'));
      setCurrent('');
      setNext('');
      setConfirm('');
      await reload();
    } catch (e: any) {
      setErr(e?.message ?? t('Đổi mật khẩu thất bại'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2>{t('Account')}</h2>
      <p style={{ color: 'var(--text-muted)' }}>
        {t('Mật khẩu đăng nhập vào WebObsidian.')}
        {usingDefault && (
          <>
            {' '}{t('Bạn đang dùng mật khẩu mặc định 123456 — hãy đổi mật khẩu để bảo mật vault.')}
          </>
        )}
      </p>
      <Row name={t('Mật khẩu hiện tại')} desc={usingDefault ? t('Mặc định là 123456') : undefined}>
        <input className="text-input" type="password" style={{ width: 240 }} value={current}
          onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </Row>
      <Row name={t('Mật khẩu mới')} desc={t('Tối thiểu 6 ký tự')}>
        <input className="text-input" type="password" style={{ width: 240 }} value={next}
          onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      </Row>
      <Row name={t('Xác nhận mật khẩu mới')}>
        <input className="text-input" type="password" style={{ width: 240 }} value={confirm}
          onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </Row>
      {err && <div style={{ color: '#e5534b', margin: '6px 0' }}>{err}</div>}
      {msg && <div style={{ color: 'var(--text-accent, #4caf50)', margin: '6px 0' }}>{msg}</div>}
      <button className="btn" onClick={save} disabled={busy || !current || !next}>
        {busy ? t('Đang lưu…') : t('Đổi mật khẩu')}
      </button>
      <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 16 }}>
        {t('Quên mật khẩu? Đặt auth.passwordHash trong data/settings.json hoặc biến môi trường WEBOBSIDIAN_PASSWORD làm mật khẩu khôi phục (override) rồi đăng nhập lại để đổi mật khẩu mới.')}
      </p>
    </div>
  );
}

function About() {
  const logout = async () => { await api.logout(); location.reload(); };
  return (
    <div>
      <h2>{t('About WebObsidian')}</h2>
      <p style={{ color: 'var(--text-muted)' }}>
        {t('A self-hosted, Obsidian-compatible web app. Vault, QMD search, GitHub sync (with LFS), agent API and community plugins.')}
      </p>
      <button className="btn danger" onClick={logout}>{t('Log out')}</button>
    </div>
  );
}
