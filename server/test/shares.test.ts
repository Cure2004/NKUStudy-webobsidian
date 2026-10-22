import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import cookieParser from 'cookie-parser';

const fixture = await mkdtemp(path.join(os.tmpdir(), 'nkustudy-shares-'));
process.env.DATA_DIR = path.join(fixture, 'data');
process.env.VAULT_PATH = path.join(fixture, 'vault');
delete process.env.WEBOBSIDIAN_PASSWORD;
await mkdir(process.env.VAULT_PATH, { recursive: true });
await writeFile(path.join(process.env.VAULT_PATH, 'shared.md'), '# Fixture shared note\n');
await writeFile(path.join(process.env.VAULT_PATH, 'second.md'), '# Fixture second note\n');
const { sharesRouter, publicSharesRouter } = await import('../src/routes/shares.js');
const { sharePageRouter } = await import('../src/routes/sharepage.js');
const { issueToken } = await import('../src/services/auth.js');
const { errorHandler } = await import('../src/middleware/error.js');
const app = express();
app.set('trust proxy', 'loopback');
app.use(express.json()); app.use(cookieParser());
app.use('/api/shares', sharesRouter); app.use('/public/shares', publicSharesRouter); app.use('/share', sharePageRouter);
app.use(errorHandler);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(fixture, { recursive: true, force: true }); });
const owner = `webobsidian_token=${await issueToken()}`;
const password = 'fixture-share-password';
let first = ''; let second = ''; let unlock = '';
async function request(route: string, method = 'GET', body?: unknown, cookies?: string, tls = false) {
  return fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(cookies ? { Cookie: cookies } : {}), ...(tls ? { 'X-Forwarded-Proto': 'https' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
}

test('SHARE-01 owner creates password shares, guest cannot manage them', async () => {
  assert.equal((await request('/api/shares', 'POST', { path: 'shared.md' })).status, 401);
  for (const name of ['shared.md', 'second.md']) {
    const r = await request('/api/shares', 'POST', { path: name }, owner);
    assert.equal(r.status, 200);
    const id = (await r.json()).share.id;
    if (!first) first = id; else second = id;
    assert.equal((await request('/api/shares/' + id, 'PATCH', { password }, owner)).status, 200);
    assert.equal((await request('/public/shares/' + id)).status, 401);
  }
});

test('SHARE-01 correct password unlocks only its share and uses Secure cookie behind trusted TLS proxy', async () => {
  const r = await request(`/public/shares/${first}/unlock`, 'POST', { password }, undefined, true);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie')!, /; Secure/);
  assert.match(r.headers.get('set-cookie')!, /; HttpOnly/);
  unlock = r.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await request('/public/shares/' + first, 'GET', undefined, unlock)).status, 200);
  assert.equal((await request('/public/shares/' + second, 'GET', undefined, unlock)).status, 401);
  const ssr = await request('/share/' + first, 'GET', undefined, unlock);
  assert.equal(ssr.status, 200);
  assert.match(await ssr.text(), /Fixture shared note/);
});

test('SHARE-01 changing a share password invalidates earlier unlock cookies and disabling rejects reads', async () => {
  assert.equal((await request('/api/shares/' + first, 'PATCH', { password: 'fixture-share-password-new' }, owner)).status, 200);
  assert.equal((await request('/public/shares/' + first, 'GET', undefined, unlock)).status, 401);
  const protectedSsr = await request('/share/' + first, 'GET', undefined, unlock);
  assert.equal((await protectedSsr.text()).includes('Fixture shared note'), false);
  assert.equal((await request('/api/shares/' + first, 'PATCH', { enabled: false }, owner)).status, 200);
  assert.equal((await request('/public/shares/' + first, 'GET', undefined, unlock)).status, 404);
});

test('SHARE-01 repeated wrong passwords are throttled without modifying content or share records', async () => {
  const shareFile = path.join(process.env.DATA_DIR!, 'shares.json');
  const before = await readFile(shareFile, 'utf8');
  const content = await readFile(path.join(process.env.VAULT_PATH!, 'second.md'), 'utf8');
  for (let i = 0; i < 10; i++) assert.equal((await request(`/public/shares/${second}/unlock`, 'POST', { password: 'fixture-wrong' })).status, 401);
  const limited = await request(`/public/shares/${second}/unlock`, 'POST', { password: 'fixture-wrong' });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal(await readFile(shareFile, 'utf8'), before);
  assert.equal(await readFile(path.join(process.env.VAULT_PATH!, 'second.md'), 'utf8'), content);
});
