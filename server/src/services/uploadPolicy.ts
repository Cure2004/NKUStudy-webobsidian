import multer from 'multer';
import type { RequestHandler } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { assertGuestWritable, getGuestWritableRoot } from './guestpath.js';
import { getSettings } from './settings.js';
import { resolveDirCaseInsensitive } from './vault.js';

export type UploadKind = 'attachment' | 'image';
let activeUploads = 0;

function boundedInteger(name: string, fallback: number, maximum: number, minimum = 1): number {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw Object.assign(new Error(`Invalid upload configuration: ${name}`), { status: 503 });
  }
  return value;
}

export function uploadPolicy(kind: UploadKind) {
  return {
    bytes: kind === 'image'
      ? boundedInteger('WEBOBSIDIAN_IMAGE_MAX_BYTES', 4 * 1024 * 1024, 16 * 1024 * 1024)
      : boundedInteger('WEBOBSIDIAN_ATTACHMENT_MAX_BYTES', 8 * 1024 * 1024, 64 * 1024 * 1024),
    concurrent: boundedInteger('WEBOBSIDIAN_UPLOAD_CONCURRENCY', 2, 4),
    timeoutMs: boundedInteger('WEBOBSIDIAN_UPLOAD_TIMEOUT_MS', 30_000, 120_000, 25),
  };
}

/**
 * Receive one bounded file on disk. Authentication precedes this middleware.
 * Keep the concurrency slot until the handler finishes, not just multipart parse.
 */
export function receiveUpload(kind: UploadKind): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      const policy = uploadPolicy(kind);
      if (req.sessionRole === 'guest') {
        await getGuestWritableRoot();
        if (kind === 'image') {
          const settings = await getSettings();
          // No approved external-image policy for anonymous visitors: the known
          // local attachment root is the authorization boundary even on fallback.
          const dir = await resolveDirCaseInsensitive(settings.vault.attachmentDir || 'attachments');
          await assertGuestWritable(dir);
          if (settings.upload.enabled) throw Object.assign(new Error('公开编辑暂不允许外部图床上传'), { status: 403 });
        } else if (typeof req.query.dir === 'string') {
          await assertGuestWritable(await resolveDirCaseInsensitive(req.query.dir));
        }
      }
      const envelopeLimit = policy.bytes + 16 * 1024;
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > envelopeLimit) {
        res.status(413).json({ error: 'Upload exceeds configured size limit' });
        return;
      }
      if (activeUploads >= policy.concurrent) {
        res.setHeader('Retry-After', '1');
        res.status(429).json({ error: 'Too many concurrent uploads' });
        return;
      }
      activeUploads++;
      const abort = new AbortController();
      res.locals.uploadAbortSignal = abort.signal;
      let directory: string | undefined;
      let released = false;
      let stopped = false;
      let timer: NodeJS.Timeout | undefined;
      let received = 0;
      const cleanup = () => {
        if (released) return;
        released = true;
        activeUploads--;
        abort.abort();
        if (timer) clearTimeout(timer);
        req.off('data', countBytes);
        if (directory) void fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      };
      const stop = (status: number, message: string) => {
        if (stopped) return;
        stopped = true;
        if (!res.headersSent) res.status(status).json({ error: message });
        // Close the upload stream after the error has been flushed.
        res.once('finish', () => req.destroy());
        if (res.writableFinished) req.destroy();
        cleanup();
      };
      function countBytes(chunk: Buffer) {
        received += chunk.length;
        if (received > envelopeLimit) stop(413, 'Upload exceeds configured size limit');
      }
      res.once('finish', cleanup);
      res.once('close', cleanup);
      req.once('aborted', () => { stopped = true; cleanup(); });
      try {
        const base = process.env.WEBOBSIDIAN_UPLOAD_TEMP_DIR || os.tmpdir();
        directory = await fs.mkdtemp(path.join(base, 'webobsidian-upload-'));
        await fs.chmod(directory, 0o700);
        if (released || req.destroyed) {
          await fs.rm(directory, { recursive: true, force: true });
          return;
        }
        req.on('data', countBytes);
        timer = setTimeout(() => stop(408, 'Upload timed out'), policy.timeoutMs);
        timer.unref();
        const receiver = multer({
          dest: directory,
          limits: { fileSize: policy.bytes, files: 1, fields: 1, parts: 3, fieldSize: 1024, fieldNameSize: 32, headerPairs: 32 },
        }).single('file');
        receiver(req, res, (error) => {
          if (stopped || req.aborted) { cleanup(); return; }
          if (error) {
            cleanup();
            const status = error instanceof multer.MulterError ? 413 : 400;
            next(Object.assign(new Error(error instanceof multer.MulterError ? 'Upload exceeds multipart limits' : 'Invalid multipart upload'), { status }));
            return;
          }
          // Deadline limits receiving multipart; the upstream image request has
          // its own timeout. Do not report a timeout midway through local commit.
          if (timer) clearTimeout(timer);
          req.off('data', countBytes);
          next();
        });
      } catch (error) {
        cleanup();
        next(error);
      }
    })().catch(next);
  };
}

/** Raster-only images: do not trust the client MIME or allow executable SVG. */
export async function assertRasterImage(file: Express.Multer.File): Promise<void> {
  const handle = await fs.open(file.path, 'r');
  const bytes = Buffer.alloc(16);
  let length: number;
  try { length = (await handle.read(bytes, 0, bytes.length, 0)).bytesRead; }
  finally { await handle.close(); }
  const ext = path.extname(file.originalname).toLowerCase();
  const allowed =
    (length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && ext === '.png' && file.mimetype === 'image/png') ||
    (length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && ['.jpg', '.jpeg'].includes(ext) && file.mimetype === 'image/jpeg') ||
    (length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString()) && ext === '.gif' && file.mimetype === 'image/gif') ||
    (length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' && ext === '.webp' && file.mimetype === 'image/webp');
  if (!allowed) throw Object.assign(new Error('Only PNG, JPEG, GIF or WebP images with matching content are supported'), { status: 415 });
}
