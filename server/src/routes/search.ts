import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, denyGuest } from '../middleware/auth.js';
import { qmd } from '../services/search.js';
import { backlinksFor, graphData, resolveLink, buildLinkGraph } from '../services/links.js';
import { resolveFile } from '../services/fileindex.js';
import { readPropertyTypes, setPropertyType } from '../services/propertytypes.js';
import { isGuestReadable } from '../services/guestpath.js';

export const searchRouter = Router();
searchRouter.use(requireAuth);

searchRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '');
    // limit omitted / 0 → return every match; the client renders them incrementally.
    const limit = Math.max(0, Number(req.query.limit ?? 0) || 0);
    let hits = await qmd.search(q, limit);
    // 访客的全文搜索只命中可读范围（editableRoot + 附件目录）：
    // 私有笔记既不能打开，也不该能被搜出来
    if (req.sessionRole === 'guest') {
      const verdicts = await Promise.all(hits.map((hit) => isGuestReadable(hit.path)));
      hits = hits.filter((_, i) => verdicts[i]);
    }
    res.json({ query: q, hits });
  }),
);

// Per-note match contexts for the rendered batch of results (Obsidian-style
// grouped search). Reads bodies lazily so broad queries stay cheap.
searchRouter.post(
  '/search/matches',
  asyncHandler(async (req, res) => {
    const { query, paths, matchCase, phrase } = req.body ?? {};
    // phrase=true → match the whole query as one needle (e.g. unlinked mentions
    // look for the exact note title, not each word of it).
    const terms = phrase
      ? [String(query ?? '').trim()].filter((t) => t.length >= 2)
      : qmd.queryTerms(String(query ?? ''));
    let list = (Array.isArray(paths) ? paths : []).slice(0, 80).map((p) => String(p));
    if (req.sessionRole === 'guest') {
      // 先按可读范围过滤这批路径，再取正文片段——不返回任何越界笔记的上下文
      const verdicts = await Promise.all(list.map((p) => isGuestReadable(p)));
      list = list.filter((_, i) => verdicts[i]);
    }
    const matches = await Promise.all(
      list.map((p) => qmd.matchesFor(p, terms, { caseSensitive: !!matchCase })),
    );
    res.json({ matches });
  }),
);

searchRouter.get(
  '/tags',
  asyncHandler(async (_req, res) => {
    res.json({ tags: qmd.allTags() });
  }),
);

searchRouter.get(
  '/properties',
  asyncHandler(async (_req, res) => {
    res.json({ properties: qmd.allProperties() });
  }),
);

searchRouter.get(
  '/property-types',
  asyncHandler(async (_req, res) => {
    res.json({ types: await readPropertyTypes() });
  }),
);

searchRouter.post(
  '/property-types',
  denyGuest,
  asyncHandler(async (req, res) => {
    const { key, type } = req.body ?? {};
    if (typeof key !== 'string' || typeof type !== 'string') {
      res.status(400).json({ error: 'key and type required' });
      return;
    }
    res.json({ types: await setPropertyType(key, type) });
  }),
);

searchRouter.get(
  '/backlinks',
  asyncHandler(async (req, res) => {
    const rel = String(req.query.path ?? '');
    let sources = backlinksFor(rel);
    // 访客只看到可读笔记的反链：反链列表本身也是内容枚举面
    if (req.sessionRole === 'guest') {
      const verdicts = await Promise.all(sources.map((p) => isGuestReadable(p)));
      sources = sources.filter((_, i) => verdicts[i]);
    }
    res.json({ path: rel, backlinks: sources });
  }),
);

searchRouter.get(
  '/resolve',
  asyncHandler(async (req, res) => {
    const target = String(req.query.target ?? '');
    // The link graph only indexes markdown notes, so a wikilink that points at a
    // non-markdown file with an explicit extension (e.g. `[[Foo.canvas]]`) misses.
    // Fall back to the vault-wide file index for those — but only when an explicit
    // non-markdown extension is present, so a bare `[[Foo]]` still resolves to a
    // note (or stays unresolved so the client can offer to create one).
    let resolved = resolveLink(target);
    if (!resolved && /\.[^./]+$/.test(target) && !/\.(md|markdown)$/i.test(target)) {
      resolved = resolveFile(target);
    }
    // 访客的解析结果只落可读范围：不确认私有文件的存在性
    if (resolved && req.sessionRole === 'guest' && !(await isGuestReadable(resolved))) {
      resolved = undefined;
    }
    res.json({ target, path: resolved ?? null });
  }),
);

searchRouter.get(
  '/graph',
  asyncHandler(async (req, res) => {
    const data = graphData();
    // 访客的关系图只含可读节点：整库的知识结构（标题、链接关系）不该匿名可见
    if (req.sessionRole === 'guest') {
      const nodes = data.nodes ?? [];
      const verdicts = await Promise.all(nodes.map((n) => isGuestReadable(String(n.id))));
      const allowed = new Set(nodes.filter((_, i) => verdicts[i]).map((n) => String(n.id)));
      data.nodes = nodes.filter((n) => allowed.has(String(n.id)));
      data.edges = (data.edges ?? []).filter((e) => allowed.has(String(e.source)) && allowed.has(String(e.target)));
    }
    res.json(data);
  }),
);

searchRouter.post(
  '/reindex',
  denyGuest,
  asyncHandler(async (_req, res) => {
    await qmd.build();
    await buildLinkGraph();
    res.json({ ok: true });
  }),
);
