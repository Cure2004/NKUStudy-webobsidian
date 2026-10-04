import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { api, type NoteMatches } from '../lib/api';
import { outline } from '../lib/markdown';
import { t } from '../lib/i18n';
import TagsPanel from './TagsPanel';
import Icon from './Icon';

const MD_RE = /\.(md|markdown)$/i;
const name = (p: string) => p.split('/').pop()?.replace(MD_RE, '') ?? p;

const TABS = [
  { id: 'backlinks', icon: 'link', title: 'Backlinks' },
  { id: 'outgoing', icon: 'arrow-up-right', title: 'Outgoing links' },
  { id: 'tags', icon: 'hash', title: 'Tags' },
  { id: 'outline', icon: 'list', title: 'Outline' },
] as const;

function Section({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="section-head" onClick={onToggle}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
        <span>{title}</span>
        <span className="count">{count}</span>
      </div>
      {open && children}
    </>
  );
}

/** Linked mentions (backlinks index) + Unlinked mentions (plain-text title hits). */
function BacklinksPanel() {
  const activePath = useStore((s) => s.activePath);
  const content = useStore((s) => s.content);
  const openFile = useStore((s) => s.openFile);
  const [linked, setLinked] = useState<string[]>([]);
  const [unlinked, setUnlinked] = useState<NoteMatches[]>([]);
  const [openLinked, setOpenLinked] = useState(true);
  const [openUnlinked, setOpenUnlinked] = useState(true);

  useEffect(() => {
    if (!activePath || !MD_RE.test(activePath)) {
      setLinked([]);
      return;
    }
    api.backlinks(activePath).then((r) => setLinked(r.backlinks)).catch(() => setLinked([]));
  }, [activePath, content]);

  useEffect(() => {
    if (!activePath || !MD_RE.test(activePath)) {
      setUnlinked([]);
      return;
    }
    let stale = false;
    const title = name(activePath);
    (async () => {
      try {
        const { hits } = await api.search(title, 100);
        const linkedSet = new Set(linked);
        const candidates = hits
          .filter((h) => h.path !== activePath && !linkedSet.has(h.path) && MD_RE.test(h.path))
          .slice(0, 30)
          .map((h) => h.path);
        if (!candidates.length) {
          if (!stale) setUnlinked([]);
          return;
        }
        const { matches } = await api.searchMatches(title, candidates, false, true);
        if (!stale) setUnlinked(matches.filter((m) => m.count > 0));
      } catch {
        if (!stale) setUnlinked([]);
      }
    })();
    return () => {
      stale = true;
    };
  }, [activePath, linked]);

  return (
    <>
      <div className="nav-header">
        <span className="nav-title">
          {activePath && MD_RE.test(activePath) ? t('Backlinks for {name}', { name: name(activePath) }) : t('Backlinks')}
        </span>
      </div>
      <div className="sidebar-body">
        <Section title={t('Linked mentions')} count={linked.length} open={openLinked} onToggle={() => setOpenLinked(!openLinked)}>
          {linked.length === 0 && <div className="panel-item">{t('No backlinks found.')}</div>}
          {linked.map((b) => (
            <div key={b} className="mention-box">
              <div className="mention-src" onClick={() => openFile(b)}>
                {name(b)}
              </div>
              <div style={{ color: 'var(--text-faint)' }}>{t('links to {name}', { name: name(activePath ?? '') })}</div>
            </div>
          ))}
        </Section>
        <Section
          title={t('Unlinked mentions')}
          count={unlinked.length}
          open={openUnlinked}
          onToggle={() => setOpenUnlinked(!openUnlinked)}
        >
          {unlinked.length === 0 && <div className="panel-item">{t('No unlinked mentions found.')}</div>}
          {unlinked.map((m) => (
            <div key={m.path} className="mention-box">
              <div className="mention-src" onClick={() => openFile(m.path)}>
                {name(m.path)}
              </div>
              {m.contexts[0] && (
                <div style={{ color: 'var(--text-muted)' }}>
                  {m.contexts[0].pre && '…'}
                  {m.contexts[0].text}
                  {m.contexts[0].post && '…'}
                </div>
              )}
            </div>
          ))}
        </Section>
      </div>
    </>
  );
}

/** Every wikilink in the active note, resolved (exists) or not (click creates). */
function OutgoingPanel() {
  const activePath = useStore((s) => s.activePath);
  const content = useStore((s) => s.content);
  const openWikilink = useStore((s) => s.openWikilink);
  const [resolved, setResolved] = useState<Record<string, string | null>>({});

  const targets = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const m of content.matchAll(/!?\[\[([^\]]+?)\]\]/g)) {
      const t = m[1].split('|')[0].split('#')[0].trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
    return out.slice(0, 200);
  }, [content]);

  useEffect(() => {
    let stale = false;
    Promise.all(
      targets.map((t) =>
        api
          .resolve(t)
          .then((r) => [t, r.path] as const)
          .catch(() => [t, null] as const),
      ),
    ).then((pairs) => {
      if (!stale) setResolved(Object.fromEntries(pairs));
    });
    return () => {
      stale = true;
    };
  }, [targets]);

  const links = targets.filter((t) => resolved[t] !== undefined && resolved[t] !== null);
  // /api/resolve only knows notes — an unresolved attachment embed (image/pdf/…)
  // is NOT a "create this note" candidate, so keep those out of the list.
  const unresolved = targets.filter(
    (t) => resolved[t] === null && !/\.(png|jpe?g|gif|svg|webp|bmp|ico|pdf|mp3|mp4|mov|zip)$/i.test(t),
  );

  return (
    <>
      <div className="nav-header">
        <span className="nav-title">
          {activePath && MD_RE.test(activePath) ? t('Outgoing links from {name}', { name: name(activePath) }) : t('Outgoing links')}
        </span>
      </div>
      <div className="sidebar-body">
        <div className="section-head" style={{ cursor: 'default' }}>
          <span>{t('Links')}</span>
          <span className="count">{links.length}</span>
        </div>
        {links.length === 0 && <div className="panel-item">{t('No outgoing links.')}</div>}
        {links.map((t2) => (
          <div key={t2} className="outgoing-item" onClick={() => openWikilink(t2)} title={resolved[t2] ?? t2}>
            <Icon name="file-text" size={14} />
            <span>{t2}</span>
          </div>
        ))}
        {unresolved.length > 0 && (
          <div className="section-head" style={{ cursor: 'default' }}>
            <span>{t('Unresolved')}</span>
            <span className="count">{unresolved.length}</span>
          </div>
        )}
        {unresolved.map((t2) => (
          <div key={t2} className="outgoing-item unresolved" onClick={() => openWikilink(t2)} title={t('Not created yet — click to create')}>
            <Icon name="file-plus" size={14} />
            <span>{t2}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function OutlinePanel() {
  const content = useStore((s) => s.content);
  const heads = outline(content);
  return (
    <>
      <div className="nav-header">
        <span className="nav-title">{t('Outline')}</span>
      </div>
      <div className="sidebar-body">
        {heads.length === 0 && <div className="panel-item">{t('No headings')}</div>}
        {heads.map((h, i) => (
          <div key={i} className="outline-item" style={{ paddingLeft: 10 + (h.level - 1) * 12 }}>
            {h.text}
          </div>
        ))}
      </div>
    </>
  );
}

export default function RightSidebar() {
  const rightPanel = useStore((s) => s.rightPanel);
  const setRightPanel = useStore((s) => s.setRightPanel);

  return (
    <div className="right-sidebar">
      <div className="right-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`right-tab ${rightPanel === tab.id ? 'active' : ''}`}
            title={t(tab.title)}
            onClick={() => setRightPanel(tab.id)}
          >
            <Icon name={tab.icon} size={16} />
          </button>
        ))}
      </div>
      {rightPanel === 'backlinks' && <BacklinksPanel />}
      {rightPanel === 'outgoing' && <OutgoingPanel />}
      {rightPanel === 'tags' && (
        <>
          <div className="nav-header">
            <span className="nav-title">{t('Tags')}</span>
          </div>
          <div className="sidebar-body">
            <TagsPanel />
          </div>
        </>
      )}
      {rightPanel === 'outline' && <OutlinePanel />}
    </div>
  );
}
