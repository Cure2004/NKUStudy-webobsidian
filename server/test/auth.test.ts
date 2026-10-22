import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

const fixture = await mkdtemp(path.join(os.tmpdir(), 'nkustudy-auth-'));
process.env.DATA_DIR = path.join(fixture, 'data');
process.env.VAULT_PATH = path.join(fixture, 'vault');
process.env.WEBOBSIDIAN_SETUP_TOKEN = 'fixture-setup-capability-012345678901234567890';
delete process.env.WEBOBSIDIAN_PASSWORD;
await mkdir(process.env.VAULT_PATH, { recursive: true });
const settings = await import('../src/services/settings.js');
const auth = await import('../src/services/auth.js');
const { authRouter } = await import('../src/routes/auth.js');
const { requireOwner } = await import('../src/middleware/auth.js');
const { createAttemptLimiter } = await import('../src/middleware/ratelimit.js');
const { errorHandler } = await import('../src/middleware/error.js');
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/auth', authRouter);
app.get('/owner', requireOwner, (_req, res) => res.json({ ok: true }));
app.use(errorHandler);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(fixture, { recursive: true, force: true }); });
const password = 'fixture-owner-password-first';
let owner = '';
function cookie(res: Response): string { return res.headers.get('set-cookie')!.split(';')[0]; }
async function request(route: string, body?: unknown, token?: string) {
  return fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function disk() { return readFile(path.join(process.env.DATA_DIR!, 'settings.json'), 'utf8'); }

test('AUTH-02 new installation rejects default and unauthorized setup without changing settings', async () => {
  const status = await (await request('/auth/status')).json();
  assert.equal(status.passwordSet, false);
  const before = await disk();
  assert.equal((await request('/auth/login', { password: '123456' })).status, 401);
  assert.equal((await request('/auth/setup', { password })).status, 400);
  assert.equal((await request('/auth/setup', { password, setupToken: 'wrong' })).status, 403);
  assert.equal(await disk(), before);
});

test('AUTH-02 concurrent protected setup succeeds once and cannot be replayed', async () => {
  const body = { password, setupToken: process.env.WEBOBSIDIAN_SETUP_TOKEN };
  const results = await Promise.all([request('/auth/setup', body), request('/auth/setup', body)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  owner = cookie(results.find((r) => r.status === 200)!);
  const before = await disk();
  assert.equal((await request('/auth/setup', body)).status, 409);
  assert.equal(await disk(), before);
  assert.equal((await request('/owner', undefined, owner)).status, 200);
  assert.equal((await request('/auth/login', { password })).status, 200);
});

test('AUTH-01 closed mode denies anonymous and guest; public mode grants only guest', async () => {
  const guest = `webobsidian_token=${await auth.issueGuestToken()}`;
  assert.equal((await request('/auth/me')).status, 401);
  assert.equal((await request('/auth/me', undefined, guest)).status, 401);
  assert.equal((await request('/auth/me', undefined, owner)).status, 200);
  await settings.updateSettings((s) => { s.publicEditor.enabled = true; });
  assert.equal((await (await request('/auth/me')).json()).role, 'guest');
  assert.equal((await request('/owner')).status, 401);
  await settings.updateSettings((s) => { s.publicEditor.enabled = false; });
  assert.equal((await request('/auth/me', undefined, guest)).status, 401);
});

test('AUTH-03 guest never enters password verification or mutates authentication', async () => {
  await settings.updateSettings((s) => { s.publicEditor.enabled = true; });
  const before = await disk();
  for (let i = 0; i < 12; i++) {
    assert.equal((await request('/auth/change-password', { currentPassword: password, newPassword: 'fixture-guest-unauthorized' })).status, 401);
  }
  assert.equal(await disk(), before);
  assert.equal(await auth.checkPassword(password), true);
  await settings.updateSettings((s) => { s.publicEditor.enabled = false; });
});

test('AUTH-05 password change refreshes current cookie and revokes old sessions', async () => {
  const prior = owner;
  const res = await request('/auth/change-password', { currentPassword: password, newPassword: 'fixture-owner-password-second' }, owner);
  assert.equal(res.status, 200);
  owner = cookie(res);
  assert.equal((await request('/owner', undefined, prior)).status, 401);
  assert.equal((await request('/owner', undefined, owner)).status, 200);
  assert.equal(await auth.checkPassword(password), false);
  assert.equal(await auth.checkPassword('fixture-owner-password-second'), true);
});

test('AUTH-05 logout revokes owner sessions; anonymous logout cannot revoke owner', async () => {
  await request('/auth/logout', {});
  assert.equal((await request('/owner', undefined, owner)).status, 200);
  assert.equal((await request('/auth/logout', {}, owner)).status, 200);
  assert.equal((await request('/owner', undefined, owner)).status, 401);
  owner = cookie(await request('/auth/login', { password: 'fixture-owner-password-second' }));
});

test('AUTH-05 expired, tampered, wrong algorithm and legacy unversioned tokens are rejected', async () => {
  const s = await settings.getSettings();
  const payload = { sub: 'owner', ver: s.auth.sessionVersion };
  const invalid = [
    jwt.sign(payload, s.auth.jwtSecret, { algorithm: 'HS256', expiresIn: -1 }),
    jwt.sign(payload, s.auth.jwtSecret, { algorithm: 'HS384' }),
    jwt.sign({ sub: 'owner' }, s.auth.jwtSecret, { algorithm: 'HS256' }),
    (await auth.issueToken()).slice(0, -5) + 'wrong',
  ];
  for (const token of invalid) assert.equal((await request('/owner', undefined, `webobsidian_token=${token}`)).status, 401);
});

test('AUTH-05 racing old-password login cannot receive a new credential generation', async () => {
  const pending = auth.authenticatePassword('fixture-owner-password-second');
  const replacement = await auth.changePassword('fixture-owner-password-second', 'fixture-owner-password-third');
  const raced = await pending;
  assert.ok(raced);
  assert.equal(await auth.verifyTokenRole(raced), null);
  assert.equal(await auth.verifyTokenRole(replacement), 'owner');
  owner = `webobsidian_token=${replacement}`;
});

test('AUTH-03 owner wrong-password validation is rate limited without disk mutation', async () => {
  const before = await disk();
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push((await request('/auth/change-password', { currentPassword: 'fixture-wrong', newPassword: 'fixture-safe-replacement' }, owner)).status);
  assert.ok(statuses.includes(401));
  assert.equal(statuses.at(-1), 429);
  assert.equal(await disk(), before);
});

test('AUTH-04 real login endpoint limits repeated failures and returns Retry-After', async () => {
  let last: Response | undefined;
  for (let i = 0; i < 11; i++) last = await request('/auth/login', { password: 'fixture-wrong' });
  assert.equal(last!.status, 429);
  assert.ok(Number(last!.headers.get('retry-after')) > 0);
});

test('AUTH-04 limiter ignores spoofed XFF with trust=true and separates explicitly trusted proxy clients', async () => {
  const limiterApp = express();
  limiterApp.set('trust proxy', true);
  limiterApp.get('/direct', createAttemptLimiter({ limit: 2 }), (_req, res) => res.sendStatus(200));
  const trusted = express();
  trusted.set('trust proxy', 'loopback');
  trusted.get('/', createAttemptLimiter({ limit: 1 }), (_req, res) => res.sendStatus(200));
  limiterApp.use('/trusted', trusted);
  const srv = limiterApp.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => srv.once('listening', resolve));
  const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  try {
    for (let i = 0; i < 3; i++) {
      const r = await fetch(url + '/direct', { headers: { 'X-Forwarded-For': `192.0.2.${i + 1}` } });
      assert.equal(r.status, i < 2 ? 200 : 429);
    }
    assert.equal((await fetch(url + '/trusted', { headers: { 'X-Forwarded-For': '192.0.2.10' } })).status, 200);
    assert.equal((await fetch(url + '/trusted', { headers: { 'X-Forwarded-For': '192.0.2.11' } })).status, 200);
    assert.equal((await fetch(url + '/trusted', { headers: { 'X-Forwarded-For': '192.0.2.10' } })).status, 429);
  } finally { srv.closeAllConnections(); await new Promise<void>((resolve) => srv.close(() => resolve())); }
});
