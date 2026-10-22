import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import express from 'express';
import cookieParser from 'cookie-parser';

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'nkustudy-uploads-'));
process.env.DATA_DIR = path.join(fixture, 'data');
process.env.VAULT_PATH = path.join(fixture, 'vault');
process.env.WEBOBSIDIAN_UPLOAD_TEMP_DIR = path.join(fixture, 'tmp');
process.env.WEBOBSIDIAN_ATTACHMENT_MAX_BYTES = '128';
process.env.WEBOBSIDIAN_IMAGE_MAX_BYTES = '128';
process.env.WEBOBSIDIAN_UPLOAD_CONCURRENCY = '1';
process.env.WEBOBSIDIAN_UPLOAD_TIMEOUT_MS = '1000';
delete process.env.WEBOBSIDIAN_PASSWORD;
const root = path.join(process.env.VAULT_PATH, 'content');
await fs.mkdir(path.join(root, 'allowed/images'), { recursive: true });
await fs.mkdir(path.join(root, 'private'), { recursive: true });
await fs.mkdir(process.env.WEBOBSIDIAN_UPLOAD_TEMP_DIR);
await fs.writeFile(path.join(root, 'allowed/sentinel.md'), 'sentinel allowed');
await fs.writeFile(path.join(root, 'private/sentinel.md'), 'sentinel private');
const { updateSettings } = await import('../src/services/settings.js');
const { hashPassword, issueToken } = await import('../src/services/auth.js');
const { filesRouter } = await import('../src/routes/files.js');
const { errorHandler } = await import('../src/middleware/error.js');
const { qmd } = await import('../src/services/search.js');
const { buildLinkGraph, graphData } = await import('../src/services/links.js');
await updateSettings(async s => {
  s.vault.path = process.env.VAULT_PATH!; s.vault.root = 'content'; s.vault.attachmentDir = 'attachments';
  s.publicEditor.enabled = true; s.publicEditor.editableRoot = 'content/allowed'; s.upload.enabled = false;
  s.git.enabled = false; s.git.autoCommitOnSave = false; s.auth.userPasswordHash = await hashPassword('fixture-owner-password');
});
const owner = await issueToken();
const git = (...args: string[]) => execFileSync('git', args, { cwd: process.env.VAULT_PATH, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
git('init', '-q', '-b', 'fixture'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('add', '.'); git('commit', '-qm', 'fixture');
const app = express(); app.use(express.json()); app.use(cookieParser()); app.use('/api/files', filesRouter); app.use(errorHandler);
const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/files`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a52kAAAAASUVORK5CYII=', 'base64');
async function upload(url: string, dir: string | undefined, name: string, bytes: Buffer, mime = 'application/octet-stream', asOwner = false) {
  const form = new FormData(); if (dir !== undefined) form.set('dir', dir);
  form.set('file', new Blob([bytes], { type: mime }), name);
  return fetch(base + url, { method: 'POST', body: form, headers: asOwner ? { Authorization: `Bearer ${owner}` } : {} });
}
async function snapshot() {
  const files: Record<string, string> = {};
  async function walk(abs: string) {
    const st = await fs.lstat(abs); const rel = path.relative(process.env.VAULT_PATH!, abs);
    if (st.isSymbolicLink()) files[rel] = `link:${await fs.readlink(abs)}`;
    else if (st.isDirectory()) { files[rel] = 'directory'; for (const n of (await fs.readdir(abs)).sort()) await walk(path.join(abs, n)); }
    else files[rel] = createHash('sha256').update(await fs.readFile(abs)).digest('hex');
  }
  await walk(process.env.VAULT_PATH!);
  return { files, search: await qmd.search('sentinel'), graph: graphData(), index: git('ls-files', '--stage'), status: git('status', '--porcelain'), head: git('rev-parse', 'HEAD') };
}
async function waitFor(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 2000;
  while (!(await predicate())) {
    assert.ok(Date.now() < deadline, 'condition reached before deadline');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
async function cleanTemp() { await waitFor(async () => (await fs.readdir(process.env.WEBOBSIDIAN_UPLOAD_TEMP_DIR!)).length === 0); }
async function denied(action: () => Promise<Response>, statuses = [400, 403, 409, 413, 415]) {
  await cleanTemp(); await qmd.build(); await buildLinkGraph(); const before = await snapshot();
  const response = await action(); const text = await response.text();
  assert.ok(statuses.includes(response.status), `${response.status}: ${text}`);
  assert.deepEqual(await snapshot(), before, 'rejection leaves content, indexes and Git unchanged');
  await cleanTemp();
  return text;
}
function partialUpload(filename: string) {
  const boundary = 'fixture-upload-boundary';
  const prefix = `--${boundary}\r\nContent-Disposition: form-data; name="dir"\r\n\r\nallowed\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  let resolve!: (status: number) => void;
  const result = new Promise<number>(r => { resolve = r; });
  const request = http.request(base + '/upload', { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode!)); });
  request.on('error', () => resolve(0)); request.write(prefix); request.write('small');
  return { request, result, end: () => request.end(`\r\n--${boundary}--\r\n`) };
}

test('UPL-01–06 bounded, authorized uploads and cleanup', async t => {
  try {
    await t.test('UPL-01 missing/empty dir cannot write content root for guest', async () => {
      await denied(() => upload('/upload', undefined, 'empty.bin', Buffer.from('small')));
      await denied(() => upload('/upload', '', 'empty.bin', Buffer.from('small')));
    });
    await t.test('UPL-02 final canonical directory: allowed succeeds, private/dotdot/symlink denied', async () => {
      const good = await upload('/upload', 'allowed', 'good.bin', Buffer.from('small')); assert.equal(good.status, 200);
      assert.equal(await fs.readFile(path.join(root, 'allowed/good.bin'), 'utf8'), 'small'); await cleanTemp();
      await fs.symlink('../private', path.join(root, 'allowed/upload-link'));
      for (const dir of ['private', 'allowed/../private', 'allowed/upload-link', 'allowed/../../outside']) await denied(() => upload('/upload', dir, 'denied.bin', Buffer.from('small')));
      // Directory case resolution must happen before final authorization.
      await fs.mkdir(path.join(root, 'PrivateCase'));
      await denied(() => upload('/upload', 'privatecase', 'case.bin', Buffer.from('small')));
      const nested = await upload('/upload', 'allowed/IMAGES', 'case-good.bin', Buffer.from('small')); assert.equal(nested.status, 200);
      assert.equal(await fs.readFile(path.join(root, 'allowed/images/case-good.bin'), 'utf8'), 'small');
    });
    await t.test('UPL-03/04 image fallback preauthorization does not expand attachment scope', async () => {
      for (const dir of ['', 'attachments', 'private', 'allowed/upload-link']) {
        await updateSettings(s => { s.vault.attachmentDir = dir; });
        await denied(() => upload('/upload-image', undefined, 'denied.png', png, 'image/png'));
      }
      await updateSettings(s => { s.vault.attachmentDir = 'allowed/images'; });
      const good = await upload('/upload-image', undefined, 'good.png', png, 'image/png'); assert.equal(good.status, 200);
      assert.deepEqual(await fs.readFile(path.join(root, 'allowed/images/good.png')), png);
      await updateSettings(s => { s.upload.enabled = true; s.upload.server = 'http://127.0.0.1:1'; });
      await denied(() => upload('/upload-image', undefined, 'external.png', png, 'image/png'));
      await updateSettings(s => { s.upload.enabled = false; });
    });
    await t.test('UPL-05 filename traversal/collision, MIME spoof and SVG are controlled', async () => {
      const ok = await upload('/upload', 'allowed', '../private/traverse.bin', Buffer.from('safe')); assert.equal(ok.status, 200);
      assert.equal(await fs.readFile(path.join(root, 'allowed/traverse.bin'), 'utf8'), 'safe');
      await denied(() => upload('/upload', 'allowed', 'traverse.bin', Buffer.from('overwrite')), [409]);
      await denied(() => upload('/upload', 'allowed', 'x'.repeat(250) + '.bin', Buffer.from('small')), [400]);
      await denied(() => upload('/upload-image', undefined, 'fake.png', Buffer.from('not an image'), 'image/png'), [415]);
      await denied(() => upload('/upload-image', undefined, 'fake.png', png, 'text/plain'), [415]);
      await denied(() => upload('/upload-image', undefined, 'script.svg', Buffer.from('<svg onload="alert(1)"/>'), 'image/svg+xml'), [415]);
    });
    await t.test('UPL-06 N-1/N accepted, N+1 rejected; malformed multipart cleaned', async () => {
      for (const n of [127, 128]) assert.equal((await upload('/upload', 'allowed', `size-${n}.bin`, Buffer.alloc(n))).status, 200);
      await denied(() => upload('/upload', 'allowed', 'size-129.bin', Buffer.alloc(129)), [413]);
      await denied(() => fetch(base + '/upload', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=bad' }, body: 'malformed' }), [400]);
    });
    await t.test('UPL-06 concurrency and deadline reject without creating final files', async () => {
      await cleanTemp();
      const slow = partialUpload('held.bin');
      await waitFor(async () => (await fs.readdir(process.env.WEBOBSIDIAN_UPLOAD_TEMP_DIR!)).length === 1);
      const busy = await upload('/upload', 'allowed', 'second.bin', Buffer.from('small')); assert.equal(busy.status, 429);
      slow.end(); assert.equal(await slow.result, 200); await cleanTemp();
      process.env.WEBOBSIDIAN_UPLOAD_TIMEOUT_MS = '80';
      const before = await snapshot(); const timed = partialUpload('timeout.bin');
      assert.equal(await timed.result, 408); await cleanTemp(); assert.deepEqual(await snapshot(), before);
      process.env.WEBOBSIDIAN_UPLOAD_TIMEOUT_MS = '1000';
    });
    await t.test('UPL-06 interrupted client removes temporary data and releases slot', async () => {
      const before = await snapshot(); const aborted = partialUpload('aborted.bin');
      await waitFor(async () => (await fs.readdir(process.env.WEBOBSIDIAN_UPLOAD_TEMP_DIR!)).length === 1);
      aborted.request.destroy(); await aborted.result; await cleanTemp(); assert.deepEqual(await snapshot(), before);
      assert.equal((await upload('/upload', 'allowed', 'after-abort.bin', Buffer.from('small'))).status, 200); await cleanTemp();
    });
    await t.test('UPL-04 owner mock success/errors/timeout redact body/key; guest never forwards', async () => {
      let status = 500; let slow = false; let calls = 0; let cancelledSlow = 0;
      const mock = http.createServer((req, res) => { calls++; req.resume(); req.on('end', () => {
        if (slow) { res.once('close', () => { cancelledSlow++; }); return; }
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(status === 200 ? JSON.stringify({ success: true, result: ['https://images.example.invalid/fixture.png'] }) : 'FAKE-SECRET-SENTINEL');
      }); });
      await new Promise<void>(resolve => mock.listen(0, '127.0.0.1', resolve));
      try {
        await updateSettings(s => { s.upload.enabled = true; s.upload.server = `http://127.0.0.1:${(mock.address() as { port: number }).port}`; s.upload.key = 'FAKE-KEY-SENTINEL'; });
        for (status of [400, 403, 429, 500]) {
          const text = await denied(() => upload('/upload-image', undefined, 'mock.png', png, 'image/png', true), [502]);
          assert.ok(!text.includes('FAKE-SECRET-SENTINEL') && !text.includes('FAKE-KEY-SENTINEL'));
        }
        const beforeCalls = calls;
        await denied(() => upload('/upload-image', undefined, 'guest.png', png, 'image/png'), [403]);
        assert.equal(calls, beforeCalls);
        status = 200;
        const success = await upload('/upload-image', undefined, 'remote.png', png, 'image/png', true);
        assert.equal(success.status, 200); assert.equal((await success.json()).url, 'https://images.example.invalid/fixture.png'); await cleanTemp();
        slow = true; process.env.WEBOBSIDIAN_IMAGE_UPSTREAM_TIMEOUT_MS = '50';
        await denied(() => upload('/upload-image', undefined, 'timeout.png', png, 'image/png', true), [502]);
        process.env.WEBOBSIDIAN_IMAGE_UPSTREAM_TIMEOUT_MS = '10000';
        const cancelledBefore = cancelledSlow;
        const controller = new AbortController(); const beforeAbort = await snapshot();
        const form = new FormData(); form.set('file', new Blob([png], { type: 'image/png' }), 'aborted-remote.png');
        const beforeAbortCalls = calls;
        const pending = fetch(base + '/upload-image', { method: 'POST', body: form, headers: { Authorization: `Bearer ${owner}` }, signal: controller.signal }).catch(() => null);
        await waitFor(async () => calls > beforeAbortCalls); controller.abort(); await pending;
        await cleanTemp(); await waitFor(async () => cancelledSlow > cancelledBefore); assert.deepEqual(await snapshot(), beforeAbort);

      } finally {
        mock.closeAllConnections(); await new Promise<void>(resolve => mock.close(() => resolve()));
        delete process.env.WEBOBSIDIAN_IMAGE_UPSTREAM_TIMEOUT_MS;
        await updateSettings(s => { s.upload.enabled = false; s.upload.key = ''; });
      }
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await cleanTemp(); await fs.rm(fixture, { recursive: true, force: true });
  }
});
