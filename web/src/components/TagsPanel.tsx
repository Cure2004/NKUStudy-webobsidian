import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { t } from '../lib/i18n';

export default function TagsPanel() {
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const searchFor = useStore((s) => s.searchFor);

  useEffect(() => {
    api.tags().then((r) => setTags(r.tags)).catch(() => {});
  }, []);

  return (
    <div style={{ padding: 8 }}>
      {tags.length === 0 && <div style={{ color: 'var(--text-faint)', padding: 8 }}>{t('No tags found')}</div>}
      {tags.map((tag) => (
        <span
          key={tag.tag}
          className="tag-pill"
          title={t('Search #{tag}', { tag: tag.tag })}
          onClick={() => searchFor(`tag:${tag.tag}`)}
        >
          #{tag.tag} <span className="count">{tag.count}</span>
        </span>
      ))}
    </div>
  );
}
