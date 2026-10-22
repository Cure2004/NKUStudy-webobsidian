import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, access, symlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixturePassword = 'fixture-recovery-password';
function child(dir: string, code: string, extra: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
    cwd: root, encoding: 'utf8', env: { ...process.env, DATA_DIR: path.join(dir, 'data'), VAULT_PATH: path.join(dir, 'vault'), WEBOBSIDIAN_PASSWORD: '', WEBOBSIDIAN_SETUP_TOKEN: '', ...extra },
  });
}
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nkustudy-settings-'));
  await mkdir(path.join(dir, 'vault'));
  const result = child(dir, "await import('./server/src/services/settings.ts').then(m=>m.loadSettings())");
  assert.equal(result.status, 0, result.stderr);
  return dir;
}
const load = "await import('./server/src/services/settings.ts').then(m=>m.loadSettings())";

test('AUTH-06 invalid JSON/schema/structure preserve both settings and immutable backup', async () => {
  for (const content of ['{"privateSentinel":', JSON.stringify({ auth: { jwtSecret: 'fixture-secret', userPasswordHash: 4 }, vault: { path: '/invalid' } }), '{}']) {
    const dir = await fixture();
    try {
      const file = path.join(dir, 'data/settings.json');
      const bak = file + '.bak';
      await writeFile(file, content);
      await writeFile(bak, 'fixture-existing-backup');
      const r = child(dir, load);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /SETTINGS_UNAVAILABLE/);
      assert.equal(r.stderr.includes('privateSentinel'), false);
      assert.equal(await readFile(file, 'utf8'), content);
      assert.equal(await readFile(bak, 'utf8'), 'fixture-existing-backup');
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});

test('AUTH-06 missing primary with backup is recovery, never new installation', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'data/settings.json');
    const original = await readFile(file, 'utf8');
    await writeFile(file + '.bak', original);
    await rm(file);
    const r = child(dir, load);
    assert.notEqual(r.status, 0);
    await assert.rejects(access(file));
    assert.equal(await readFile(file + '.bak', 'utf8'), original);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('AUTH-06 unreadable existing settings fails closed without replacement', async () => {
  const dir = await fixture();
  const file = path.join(dir, 'data/settings.json');
  const original = await readFile(file, 'utf8');
  try {
    await chmod(file, 0);
    const r = child(dir, load);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /read_failed/);
    await chmod(file, 0o600);
    assert.equal(await readFile(file, 'utf8'), original);
  } finally { await chmod(file, 0o600); await rm(dir, { recursive: true, force: true }); }
});

test('AUTH-06 failed persistence does not update live cache or replace settings/backup', async () => {
  const dir = await fixture();
  try {
    const r = child(dir, `
      import assert from 'node:assert/strict'; import fs from 'node:fs/promises';
      const m=await import('./server/src/services/settings.ts');const a=await m.getSettings();
      const old=JSON.stringify(a);const before=await fs.readFile(process.env.DATA_DIR+'/settings.json','utf8');
      await fs.mkdir(process.env.DATA_DIR+'/settings.json.bak');
      await assert.rejects(m.updateSettings(s=>{s.auth.sessionVersion+=100}));
      assert.equal(JSON.stringify(await m.getSettings()),old);
      assert.equal(await fs.readFile(process.env.DATA_DIR+'/settings.json','utf8'),before);
    `);
    assert.equal(r.status, 0, r.stderr);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('AUTH-02 legacy strong password migrates intact and explicit recovery never enables retired default', async () => {
  const dir = await fixture();
  try {
    const r = child(dir, `
      import assert from 'node:assert/strict';import fs from 'node:fs/promises';
      const file=process.env.DATA_DIR+'/settings.json';
      const auth=await import('./server/src/services/auth.ts');
      const raw=JSON.parse(await fs.readFile(file,'utf8'));
      raw.auth.passwordHash=await auth.hashPassword('fixture-legacy-password');raw.auth.userPasswordHash='';
      await fs.writeFile(file,JSON.stringify(raw));
      const settings=await import('./server/src/services/settings.ts');const loaded=await settings.loadSettings();
      assert.equal(loaded.auth.userPasswordHash,raw.auth.passwordHash);assert.equal(loaded.auth.passwordHash,'');
      assert.equal(await auth.checkPassword('fixture-legacy-password'),true);
      assert.equal(await auth.checkPassword('fixture-recovery-password'),true);
      assert.equal(await auth.checkPassword('123456'),false);
    `, { WEBOBSIDIAN_PASSWORD: fixturePassword });
    assert.equal(r.status, 0, r.stderr);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('AUTH-02 short/default recovery credential cannot initialize or authenticate', async () => {
  const dir = await fixture();
  try {
    for (const secret of ['123456', 'short']) {
      const r = child(dir, `import assert from 'node:assert/strict';const a=await import('./server/src/services/auth.ts');assert.equal(await a.checkPassword(process.env.WEBOBSIDIAN_PASSWORD),false);assert.equal(await a.isPasswordSet(),false)`, { WEBOBSIDIAN_PASSWORD: secret });
      assert.equal(r.status, 0, r.stderr);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('AUTH-02 setup capability remains consumed after process restart', async () => {
  const dir = await fixture();
  const extra = { WEBOBSIDIAN_SETUP_TOKEN: 'fixture-setup-capability-across-restart-0123456789' };
  try {
    const first = child(dir, "const a=await import('./server/src/services/auth.ts');await a.initializeUserPassword(process.env.WEBOBSIDIAN_SETUP_TOKEN,'fixture-first-password')", extra);
    assert.equal(first.status, 0, first.stderr);
    const file = path.join(dir, 'data/settings.json');
    const original = await readFile(file, 'utf8');
    const next = child(dir, "import assert from 'node:assert/strict';const a=await import('./server/src/services/auth.ts');await assert.rejects(a.initializeUserPassword(process.env.WEBOBSIDIAN_SETUP_TOKEN,'fixture-second-password'),{status:409});assert.equal(await a.checkPassword('fixture-first-password'),true)", extra);
    assert.equal(next.status, 0, next.stderr);
    assert.equal(await readFile(file, 'utf8'), original);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('AUTH-06 real server entrypoint exits before readiness on corrupted settings', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'data/settings.json');
    const invalid = '{"fixturePrivateMarker":';
    await writeFile(file, invalid);
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
      cwd: root, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, DATA_DIR: path.join(dir, 'data'), VAULT_PATH: path.join(dir, 'vault'), WEBOBSIDIAN_PASSWORD: '', WEBOBSIDIAN_SETUP_TOKEN: '', HOST: '127.0.0.1', PORT: '0' },
    });
    assert.equal(result.error, undefined, 'Child process must finish, not hit the test startup deadline');
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /invalid_json/);
    assert.equal(result.stderr.includes('fixturePrivateMarker'), false);
    assert.equal(await readFile(file, 'utf8'), invalid);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('AUTH-06 truncated persisted auth cannot default credentials away or reopen setup', async () => {
  const extra = { WEBOBSIDIAN_SETUP_TOKEN: 'fixture-consumed-setup-capability-012345678901' };
  const changes = [
    (s: any) => { delete s.auth.userPasswordHash; },
    (s: any) => { delete s.auth.passwordHash; },
    (s: any) => { delete s.auth.userPasswordHash; delete s.auth.passwordHash; },
    (s: any) => { s.auth = { jwtSecret: s.auth.jwtSecret }; },
    (s: any) => { delete s.auth.sessionVersion; },
    (s: any) => { delete s.vault.path; },
    (s: any) => { delete s.version; delete s.auth.sessionVersion; },
  ];
  for (const change of changes) {
    const dir = await fixture();
    try {
      const setup = child(dir, "const a=await import('./server/src/services/auth.ts');await a.initializeUserPassword(process.env.WEBOBSIDIAN_SETUP_TOKEN,'fixture-original-owner-password')", extra);
      assert.equal(setup.status, 0, setup.stderr);
      const file = path.join(dir, 'data/settings.json');
      const backup = await readFile(file + '.bak', 'utf8');
      const broken = JSON.parse(await readFile(file, 'utf8'));
      change(broken);
      const raw = JSON.stringify(broken);
      await writeFile(file, raw);
      const attempt = child(dir, "import assert from 'node:assert/strict';const a=await import('./server/src/services/auth.ts');await assert.rejects(a.initializeUserPassword(process.env.WEBOBSIDIAN_SETUP_TOKEN,'fixture-replacement-password'),{code:'SETTINGS_UNAVAILABLE'});", extra);
      assert.equal(attempt.status, 0, attempt.stderr);
      assert.equal(await readFile(file, 'utf8'), raw);
      assert.equal(await readFile(file + '.bak', 'utf8'), backup);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});

test('AUTH-06 true legacy single-hash format migrates with exact old bytes retained', async () => {
  const dir = await fixture();
  try {
    const result = child(dir, `
      import assert from 'node:assert/strict';import fs from 'node:fs/promises';
      const file=process.env.DATA_DIR+'/settings.json';
      const a=await import('./server/src/services/auth.ts');
      const old=JSON.parse(await fs.readFile(file,'utf8'));
      old.version=1;old.auth.passwordHash=await a.hashPassword('fixture-old-format-password');
      delete old.auth.userPasswordHash;delete old.auth.sessionVersion;
      const bytes=JSON.stringify(old);await fs.writeFile(file,bytes);
      const m=await import('./server/src/services/settings.ts');const s=await m.loadSettings();
      assert.equal(s.version,2);assert.equal(s.auth.userPasswordHash,old.auth.passwordHash);
      assert.equal(s.auth.passwordHash,'');assert.equal(s.auth.sessionVersion,0);
      assert.equal(await a.checkPassword('fixture-old-format-password'),true);
      assert.equal(await fs.readFile(file+'.bak','utf8'),bytes);
    `);
    assert.equal(result.status, 0, result.stderr);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('AUTH-06 symlink and non-regular primary files are refused without touching targets or backup', async () => {
  for (const kind of ['symlink', 'dangling', 'directory']) {
    const dir = await fixture();
    try {
      const file = path.join(dir, 'data/settings.json');
      const original = await readFile(file, 'utf8');
      const target = path.join(dir, 'data/fixture-target.json');
      await writeFile(file + '.bak', original);
      await rm(file);
      if (kind === 'directory') await mkdir(file);
      else {
        if (kind === 'symlink') await writeFile(target, original);
        await symlink(target, file);
      }
      const result = child(dir, load);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /SETTINGS_UNAVAILABLE/);
      assert.equal(await readFile(file + '.bak', 'utf8'), original);
      if (kind === 'directory') assert.equal((await lstat(file)).isDirectory(), true);
      else {
        assert.equal((await lstat(file)).isSymbolicLink(), true);
        if (kind === 'symlink') assert.equal(await readFile(target, 'utf8'), original);
        else await assert.rejects(access(target));
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});
