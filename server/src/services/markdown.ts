import { load, JSON_SCHEMA } from 'js-yaml';
import path from 'node:path';

export interface ParsedNote {
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  tags: string[];
  /** Wikilink targets (without alias / heading). */
  links: string[];
  headings: string[];
}

const WIKILINK_RE = /!?\[\[([^\]]+?)\]\]/g;
const TAG_RE = /(?:^|\s)#([A-Za-z0-9_\-/]+)/g;
const HEADING_RE = /^#{1,6}\s+(.+?)\s*$/gm;

// Frontmatter is data, never a selectable language engine. Unknown headers,
// malformed documents and oversized metadata remain ordinary Markdown.
const MAX_FRONTMATTER_BYTES = 64 * 1024;
function boundedData(value: unknown, active = new Set<object>(), budget = { left: 10_000 }, depth = 0): boolean {
  if (--budget.left < 0 || depth > 32) return false;
  if (value === null || typeof value !== 'object') return true;
  if (active.has(value)) return false;
  active.add(value);
  const valid = Object.values(value).every(child => boundedData(child, active, budget, depth + 1));
  active.delete(value);
  return valid;
}

function dataFrontmatter(raw: string): { data: Record<string, unknown>; body: string } | null {
  const opening = /^(?:\uFEFF)?---(?:ya?ml)?[ \t]*\r?\n/.exec(raw);
  if (!opening) return null;
  const rest = raw.slice(opening[0].length);
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (!closing || Buffer.byteLength(rest.slice(0, closing.index), 'utf8') > MAX_FRONTMATTER_BYTES) return null;
  const options = { schema: JSON_SCHEMA, maxDepth: 32, maxTotalMergeKeys: 1000 };
  const data: unknown = load(rest.slice(0, closing.index), options);
  if (data != null && (typeof data !== 'object' || Array.isArray(data))) return null;
  if (!boundedData(data)) return null;
  return { data: (data ?? {}) as Record<string, unknown>, body: rest.slice(closing.index + closing[0].length) };
}

/** Parse a markdown document into structured fields used for search & links. */
export function parseNote(rel: string, raw: string): ParsedNote {
  let frontmatter: Record<string, unknown> = {};
  let body = raw;
  try {
    const fm = dataFrontmatter(raw);
    if (fm) {
      frontmatter = fm.data;
      body = fm.body;
    }
  } catch {
    /* malformed frontmatter — index raw */
  }

  const links = new Set<string>();
  for (const m of body.matchAll(WIKILINK_RE)) {
    const target = m[1].split('|')[0].split('#')[0].trim();
    if (target) links.add(target);
  }

  const tags = new Set<string>();
  for (const m of body.matchAll(TAG_RE)) tags.add(m[1]);
  const fmTags = frontmatter.tags;
  if (Array.isArray(fmTags)) for (const t of fmTags) {
    if (typeof t === 'string' || typeof t === 'number') tags.add(String(t));
  }
  else if (typeof fmTags === 'string') for (const t of fmTags.split(/[,\s]+/)) if (t) tags.add(t);

  const headings: string[] = [];
  for (const m of body.matchAll(HEADING_RE)) headings.push(m[1]);

  const fmTitle = typeof frontmatter.title === 'string' ? frontmatter.title : undefined;
  const title = fmTitle || path.basename(rel).replace(/\.(md|markdown)$/i, '');

  return { title, frontmatter, body, tags: [...tags], links: [...links], headings };
}

/** Normalize a wikilink target to a comparable key (basename, no ext, lower). */
export function linkKey(target: string): string {
  const base = target.includes('/') ? target : target;
  return base.replace(/\.(md|markdown)$/i, '').toLowerCase();
}
