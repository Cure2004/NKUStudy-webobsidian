import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import path from 'node:path';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, denyGuest } from '../middleware/auth.js';
import * as vault from '../services/vault.js';
import { getSettings } from '../services/settings.js';
import { qmd } from '../services/search.js';
import { updateLinkGraphForFile } from '../services/links.js';
import { scheduleAutoCommitOnSave } from '../services/git.js';
import { resolveFile } from '../services/fileindex.js';
import { onFileRenamed } from '../services/shares.js';
import { mimeFor } from '../services/mime.js';
import { sendFileWithRange } from '../services/httpfile.js';
import { uploadImage, UploadError } from '../services/upload.js';
import { assertGuestWritableContent } from '../services/guestpath.js';

export const filesRouter = Router();
filesRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024 * 1024 } });

const isMd = (p: string) => /\.(md|markdown)$/i.test(p);

/** 取上传文件名的纯文件名，去掉任何目录/穿越片段（防止 originalname 携带 ../）。 */
const safeUploadName = (name: string): string =>
  path.posix.basename(String(name ?? '').replace(/\\/g, '/')).replace(/^\.+/, '') || 'file';

/** 访客（公开编辑）只能改动 publicEditor.editableRoot 下的路径。 */
const assertGuestWritable = assertGuestWritableContent;

/** 访客写操作守卫：仅 guest 受限，owner 不受限。 */
function guestWriteGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.sessionRole !== 'guest') {
    next();
    return;
  }
  // 收集请求里涉及的路径（query.path / body.path / body.from / body.to / body.dir）。
  const paths: string[] = [];
  for (const v of [req.query.path, req.body?.path, req.body?.from, req.body?.to, req.body?.dir]) {
    if (typeof v === 'string' && v) paths.push(v);
  }
  Promise.all(paths.map((p) => assertGuestWritable(p)))
    .then(() => next())
    .catch((e) => {
      res.status(e?.status ?? 403).json({ error: e?.message ?? 'Forbidden' });
    });
}

// Refresh derived indexes after a mutation (best-effort, non-blocking).
// Incremental: only the touched file(s) are reparsed, not the whole vault.
function reindex(opts: { upsert?: string; added?: string; removed?: string } = {}) {
  if (opts.upsert) void qmd.upsert(opts.upsert).catch(() => {});
  if (opts.added && isMd(opts.added)) void updateLinkGraphForFile(opts.added).catch(() => {});
  if (opts.removed && isMd(opts.removed)) void updateLinkGraphForFile(opts.removed, true).catch(() => {});
  scheduleAutoCommitOnSave();
}

filesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await vault.listTree());
  }),
);

filesRouter.get(
  '/content',
  asyncHandler(async (req, res) => {
    let rel = String(req.query.path ?? '');
    if (!rel) {
      res.status(400).json({ error: 'path required' });
      return;
    }
    // Obsidian-style resolution: if the exact path doesn't exist (e.g. an embed
    // `![[image.jpg]]` that lives in Attachments/), resolve it by basename.
    if (!(await vault.exists(rel))) {
      const resolved = resolveFile(rel);
      if (resolved) rel = resolved;
    }
    if (vault.isTextFile(rel)) {
      res.json({ path: rel, content: await vault.readFileText(rel), encoding: 'utf8' });
    } else {
      // Stream with Range support so embedded <video>/<audio> can seek.
      const abs = await vault.resolveInVault(rel);
      await sendFileWithRange(req, res, abs, mimeFor(rel));
    }
  }),
);

filesRouter.put(
  '/content',
  guestWriteGuard,
  asyncHandler(async (req, res) => {
    const { path: rel, content } = req.body ?? {};
    if (typeof rel !== 'string' || typeof content !== 'string') {
      res.status(400).json({ error: 'path and content required' });
      return;
    }
    await vault.writeFileText(rel, content);
    reindex({ upsert: rel, added: rel });
    res.json({ ok: true, path: rel });
  }),
);

filesRouter.post(
  '/folder',
  guestWriteGuard,
  asyncHandler(async (req, res) => {
    const { path: rel } = req.body ?? {};
    if (typeof rel !== 'string') {
      res.status(400).json({ error: 'path required' });
      return;
    }
    await vault.createFolder(rel);
    res.json({ ok: true, path: rel });
  }),
);

filesRouter.post(
  '/upload',
  upload.single('file'),
  guestWriteGuard,
  asyncHandler(async (req, res) => {
    const dir = String(req.body?.dir ?? '');
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'file required' });
      return;
    }
    // Reuse an existing folder that differs only in case (e.g. an Obsidian vault's
    // "Attachments") instead of creating a duplicate "attachments". See vault.ts.
    const resolvedDir = dir ? await vault.resolveDirCaseInsensitive(dir) : '';
    const rel = path.posix.join(resolvedDir, safeUploadName(file.originalname));
    await vault.writeFileBuffer(rel, file.buffer);
    res.json({ ok: true, path: rel, size: file.size });
  }),
);

/**
 * 图片上传到外部图床（PicList-Core）。成功返回远程 URL；未启用/失败时
 * 回退到本地 attachments，返回 vault 相对路径（前端据此决定插入形式）。
 */
filesRouter.post(
  '/upload-image',
  upload.single('file'),
  guestWriteGuard,
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'file required' });
      return;
    }
    if (!file.mimetype.startsWith('image/')) {
      res.status(400).json({ error: '仅支持图片文件' });
      return;
    }
    try {
      const { url } = await uploadImage(file.buffer, file.originalname, file.mimetype);
      res.json({ ok: true, remote: true, url });
    } catch (e) {
      if (e instanceof UploadError && e.status === 400) {
        // 未启用图床：回退到本地 attachments。
        const s = await getSettings();
        const resolvedDir = await vault.resolveDirCaseInsensitive(s.vault.attachmentDir || 'attachments');
        const rel = path.posix.join(resolvedDir, safeUploadName(file.originalname));
        await vault.writeFileBuffer(rel, file.buffer);
        res.json({ ok: true, remote: false, path: rel, size: file.size });
        return;
      }
      throw e;
    }
  }),
);

filesRouter.patch(
  '/rename',
  guestWriteGuard,
  asyncHandler(async (req, res) => {
    const { from, to } = req.body ?? {};
    if (typeof from !== 'string' || typeof to !== 'string') {
      res.status(400).json({ error: 'from and to required' });
      return;
    }
    await vault.rename(from, to);
    await qmd.rename(from, to);
    await onFileRenamed(from, to).catch(() => {}); // keep public share links pointing at the note
    reindex({ added: to, removed: from });
    res.json({ ok: true, from, to });
  }),
);

filesRouter.post(
  '/copy',
  guestWriteGuard,
  asyncHandler(async (req, res) => {
    const { from, to } = req.body ?? {};
    if (typeof from !== 'string' || typeof to !== 'string') {
      res.status(400).json({ error: 'from and to required' });
      return;
    }
    const copied = await vault.copy(from, to);
    for (const f of copied) {
      if (isMd(f)) {
        void qmd.upsert(f).catch(() => {});
        void updateLinkGraphForFile(f).catch(() => {});
      }
    }
    scheduleAutoCommitOnSave();
    res.json({ ok: true, from, to });
  }),
);

// --- Trash (FR-1) -----------------------------------------------------------
// Listed/mutated via dedicated /trash* routes; the plain DELETE / below either
// trashes or permanently removes depending on settings.vault.deleteMode.

filesRouter.get(
  '/trash',
  denyGuest,
  asyncHandler(async (_req, res) => {
    res.json({ items: await vault.listTrash() });
  }),
);

filesRouter.post(
  '/trash/restore',
  denyGuest,
  asyncHandler(async (req, res) => {
    const rel = String(req.body?.path ?? '');
    if (!rel) {
      res.status(400).json({ error: 'path required' });
      return;
    }
    const restored = await vault.restoreFromTrash(rel);
    reindex({ upsert: restored, added: restored });
    res.json({ ok: true, restored });
  }),
);

// Permanently delete one trashed item.
filesRouter.delete(
  '/trash/item',
  denyGuest,
  asyncHandler(async (req, res) => {
    const rel = String(req.query.path ?? '');
    if (!rel) {
      res.status(400).json({ error: 'path required' });
      return;
    }
    await vault.deleteFromTrash(rel);
    res.json({ ok: true });
  }),
);

// Empty the whole trash.
filesRouter.delete(
  '/trash',
  denyGuest,
  asyncHandler(async (_req, res) => {
    await vault.emptyTrash();
    res.json({ ok: true });
  }),
);

filesRouter.delete(
  '/',
  guestWriteGuard,
  asyncHandler(async (req, res) => {
    const rel = String(req.query.path ?? '');
    if (!rel) {
      res.status(400).json({ error: 'path required' });
      return;
    }
    const s = await getSettings();
    qmd.remove(rel);
    if (s.vault.deleteMode === 'permanent') {
      await vault.remove(rel);
      reindex({ removed: rel });
      res.json({ ok: true, deleted: rel });
      return;
    }
    const dest = await vault.trash(rel);
    reindex({ removed: rel });
    res.json({ ok: true, trashed: dest });
  }),
);
