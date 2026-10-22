import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nkustudy-parser-'));
process.env.DATA_DIR = path.join(root, 'data');
process.env.VAULT_PATH = path.join(root, 'vault');
delete process.env.WEBOBSIDIAN_PASSWORD;
await fs.mkdir(process.env.VAULT_PATH, { recursive: true });
const { updateSettings } = await import('../src/services/settings.js');
const { hashPassword } = await import('../src/services/auth.js');
const hash = await hashPassword('fixture-owner-long-password');
await updateSettings(s => {
  s.auth.userPasswordHash = hash;
  s.vault.path = process.env.VAULT_PATH!;
  s.publicEditor.enabled = true;
  s.publicEditor.editableRoot = 'allowed';
  s.git.enabled = false;
  s.git.autoCommitOnSave = false;
  s.github.autoFollowBase = false;
});
const { parseNote } = await import('../src/services/markdown.js');
const { qmd } = await import('../src/services/search.js');
const links = await import('../src/services/links.js');
const { filesRouter } = await import('../src/routes/files.js');
const { agentRouter } = await import('../src/routes/agent.js');
const { sharePageRouter } = await import('../src/routes/sharepage.js');
const { publicSharesRouter } = await import('../src/routes/shares.js');
const { searchRouter } = await import('../src/routes/search.js');
const { createKey } = await import('../src/services/apikeys.js');
const { createShare } = await import('../src/services/shares.js');
const { errorHandler } = await import('../src/middleware/error.js');
const app = express();
app.use(express.json()); app.use(cookieParser());
app.use('/api/files', filesRouter); app.use('/api/v1', agentRouter);
app.use('/api', searchRouter); app.use('/share', sharePageRouter);
app.use('/public/shares', publicSharesRouter); app.use(errorHandler);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(r => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const marker = '__NKUSTUDY_PARSER_MARKER';
const hostile = '---javascript\n(()=>{globalThis.__NKUSTUDY_PARSER_MARKER="executed";return {title:"executed"};})()\n---\nmarkertext [[Target]]';
const normal = '\uFEFF---yaml\r\ntitle: 合法标题\r\ntags: [学习, test]\r\ndate: 2026-10-22\r\n---\r\n# 正文\r\nordinarytext [[Target]]';
const markerUnchanged = () => assert.equal((globalThis as Record<string, unknown>)[marker], undefined);
const put = (name: string, content: string) => fetch(base + '/api/files/content', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: name, content }),
});
after(async () => { await new Promise<void>((r,e) => server.close(err => err ? e(err) : r())); await fs.rm(root,{recursive:true,force:true}); });

test('PAR-01 normal YAML/title/tags/BOM/CRLF remain data', () => {
  const note = parseNote('allowed/good.md', normal);
  assert.equal(note.title, '合法标题'); assert.deepEqual(note.tags, ['学习','test']);
  assert.equal(note.frontmatter.date, '2026-10-22'); assert.ok(note.body.startsWith('# 正文'));
  assert.deepEqual(note.links, ['Target']);
  assert.deepEqual(parseNote('empty.md', '---\n---\nbody').frontmatter, {});
});

test('PAR-01 executable/unknown engines, aliases and malformed metadata never execute', () => {
  for (const source of [hostile, hostile.replace('javascript','js'), hostile.replace('javascript','JavaScript'), hostile.replace('javascript','json'),
    '---\nx: !!js/function >\n  function(){globalThis.__NKUSTUDY_PARSER_MARKER="executed"}\n---\nbody',
    '---\nx: &x {self: *x}\n---\nbody', '---\nx: '+ '['.repeat(80)+'0'+']'.repeat(80)+'\n---\nbody', '---\ntitle: [bad\n---\nbody','---\n- array\n---\nbody','---\ntitle: unclosed',
    '---\nx: '+ 'a'.repeat(65537)+'\n---\nbody']) {
    const note = parseNote('fallback.md',source); markerUnchanged(); assert.equal(note.title,'fallback'); assert.equal(note.body,source);
  }
  const aliases = parseNote('a.md', '---\nx: &x [a,b]\ntags: *x\n---\nbody');
  assert.deepEqual(aliases.tags,['a','b']); markerUnchanged();
});

test('PAR-01 real guest save and derived incremental index do not execute', async () => {
  assert.equal((await put('allowed/hostile.md',hostile)).status,200);
  assert.equal(await fs.readFile(path.join(root,'vault/allowed/hostile.md'),'utf8'),hostile);
  // Explicit completion, not a sleep or HTTP 200 standing in for indexing.
  await qmd.upsert('allowed/hostile.md'); await links.updateLinkGraphForFile('allowed/hostile.md');
  markerUnchanged();
  assert.equal((await put('allowed/good.md',normal)).status,200);
  await qmd.upsert('allowed/good.md');
  assert.equal((await qmd.search('合法标题'))[0]?.title,'合法标题'); markerUnchanged();
});

test('PAR-02 cold search/link indexes and lazy match contexts share safe parser', async () => {
  await qmd.build(); await links.buildLinkGraph();
  assert.ok((await qmd.search('markertext')).some(x=>x.path==='allowed/hostile.md'));
  assert.ok((await qmd.matchesFor('allowed/hostile.md',['markertext'])).count>0);
  assert.ok(links.graphData().nodes.some(x=>x.id==='allowed/good.md'));
  const response = await fetch(base+'/api/search/matches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'markertext',paths:['allowed/hostile.md']})});
  assert.equal(response.status,200); markerUnchanged();
});

test('PAR-02 API key read/write uses same safe parser; legitimate scopes remain', async () => {
  const key = await createKey('parser-fixture',['read','write','search']);
  const headers = {'x-api-key': key.raw,'Content-Type':'application/json'};
  const write = await fetch(base+'/api/v1/notes/allowed/api.md',{method:'PUT',headers,body:JSON.stringify({content:hostile})});
  assert.equal(write.status,200);
  const read = await fetch(base+'/api/v1/notes/allowed/api.md',{headers});
  assert.equal(read.status,200); assert.equal((await read.json()).title,'api');
  const good = await fetch(base+'/api/v1/notes/allowed/good.md',{headers});
  assert.equal((await good.json()).title,'合法标题');
  await qmd.upsert('allowed/api.md'); await links.buildLinkGraph(); markerUnchanged();
});

test('PAR-02 real SSR/public-share rendering treats hostile frontmatter as text', async () => {
  const share = await createShare('allowed/hostile.md');
  const response = await fetch(base+'/share/'+share.id);
  assert.equal(response.status,200); assert.ok((await response.text()).includes('markertext'));
  const publicRead = await fetch(base+'/public/shares/'+share.id);
  assert.equal(publicRead.status,200); markerUnchanged();
});
