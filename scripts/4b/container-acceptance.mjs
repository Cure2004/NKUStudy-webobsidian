#!/usr/bin/env node
/** Local-only acceptance against the immutable running image. Never prints credentials. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map(x => { const i=x.indexOf('='); return [x.slice(0,i),x.slice(i+1)]; }));
const base = args.base || 'http://127.0.0.1:28787';
const url = new URL(base);
assert.equal(url.hostname,'127.0.0.1','Only IPv4 loopback is authorized');
const container = args.container;
assert.match(container || '',/^nkustudy-4b-[a-zA-Z0-9-]+$/,'Candidate-only container name required');
const phase = args.phase || 'initial';
const out = path.resolve(args.out || 'docs/nkustudy/4b-preflight/evidence/container');
const inputs = path.resolve(args.inputs || out);
const stateRoot=args.stateRoot?path.resolve(args.stateRoot):undefined;
const hostVault=stateRoot?path.join(stateRoot,'vault'):undefined;
const observerMode=args.observer||(stateRoot?'bind':'volume');
assert.ok(['volume','bind'].includes(observerMode),'observer must be volume or bind');
const volumeObserver=observerMode==='volume';
assert.ok(!volumeObserver||!stateRoot,'volume observer and host bind stateRoot must not be mixed');
assert.ok(volumeObserver||stateRoot,'bind observer requires its actual stateRoot');
const observerScript=fileURLToPath(new URL('./volume-observer.py',import.meta.url));
const secret = JSON.parse(await fs.readFile(args.credentials,'utf8'));
assert.ok(typeof secret.password === 'string' && secret.password.length >= 12);
await fs.mkdir(out,{recursive:true});
const startedAt = new Date().toISOString();
let cookie='';
const cases=[];
const selectedIds=args.only?new Set(args.only.split(',')):undefined;
const reusedIds=args.resume==='after-setup'?new Set(['C01','C02','C03','C04','C05','C06','C07','C08','C09','C11','C12','C13','C14','C15','C16','C19','P01']):new Set();
const latencies=[];
const exec = (...argv) => execFileSync('docker',['exec',container,...argv],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024}).trim();
const git = (...argv) => exec('git','-C','/vault',...argv);
const busybox=(...argv)=>exec('/bin/busybox',...argv);
const observedFile=(p)=>execFileSync('python3',[observerScript,'read','--container',container,'--path',p],{stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024});
const observedHash=(p)=>execFileSync('python3',[observerScript,'hash','--container',container,'--path',p],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const remoteExists=(p)=>busybox('sh','-c','if test -e "$1"; then printf true; else printf false; fi','fixture-exists',p)==='true';
const remoteWrite=(p,bytes,exclusive=false)=>execFileSync('docker',['exec','-i',container,'/bin/busybox','sh','-c',(exclusive?'set -C; ':'')+'cat > "$1"','fixture-write',p],{input:bytes,stdio:['pipe','pipe','pipe']});
function localFixturePath(p){if(!stateRoot)return undefined;if(p==='/vault'||p.startsWith('/vault/'))return path.join(stateRoot,'vault',p.slice(6));if(p==='/data'||p.startsWith('/data/'))return path.join(stateRoot,'data',p.slice(5));throw new Error('unsupported host fixture path');}
const fixtureRead=async(p)=>volumeObserver?observedFile(p):fs.readFile(localFixturePath(p));
const fixtureHash=async(p)=>volumeObserver?observedHash(p):hash(await fs.readFile(localFixturePath(p)));
const fixtureWrite=async(p,bytes,exclusive=false)=>volumeObserver?remoteWrite(p,bytes,exclusive):fs.writeFile(localFixturePath(p),bytes,{flag:exclusive?'wx':'w'});
const fixtureMkdir=async(p)=>volumeObserver?busybox('mkdir','-p',p):fs.mkdir(localFixturePath(p),{recursive:true});
const fixtureUnlink=async(p)=>volumeObserver?busybox('rm','-f',p):fs.unlink(localFixturePath(p)).catch(e=>{if(e.code!=='ENOENT')throw e;});
const fixtureSymlink=async(target,p)=>volumeObserver?busybox('ln','-s',target,p):fs.symlink(target,localFixturePath(p));
async function corpusDiskManifest(){if(volumeObserver)return JSON.parse(execFileSync('python3',[observerScript,'corpus-manifest','--container',container],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024}));const result=[];for(const n of(await fs.readdir(path.join(hostVault,'4b-corpus'))).sort()){const b=await fs.readFile(path.join(hostVault,'4b-corpus',n));result.push({path:'4b-corpus/'+n,bytes:b.length,sha256:hash(b)});}return result;}
const hash = x => createHash('sha256').update(x).digest('hex');
const pause = ms => new Promise(r=>setTimeout(r,ms));
async function test(id,label,fn){
  if(selectedIds&&!selectedIds.has(id))return;
  if(reusedIds.has(id)){console.log(`REUSE ${id} ${label} (initial-attempt1.log)`);return;}
  const t=Date.now();
  try { const detail=await fn(); cases.push({id,label,status:'PASS',durationMs:Date.now()-t,...(detail?{detail}: {})}); }
  catch(e){ cases.push({id,label,status:'FAIL',durationMs:Date.now()-t,error:String(e.message).replaceAll(secret.password,'[redacted]').replaceAll(secret.setupToken || 'NONE','[redacted]').slice(0,1200)}); }
  console.log(`${cases.at(-1).status} ${id} ${label}${cases.at(-1).error?' :: '+cases.at(-1).error:''}`);
  await fs.writeFile(path.join(out,`${phase}-progress.json`),JSON.stringify({startedAt,phase,cases},null,2)+'\n');
}
function notRun(id,label,reason){if(!selectedIds)cases.push({id,label,status:'NOT-RUN',reason});}
async function request(p,{method='GET',body,auth=true,headers={},raw=false}={}){
  const t=Date.now();
  const deadlineMs=p==='/api/reindex'?Number(args.reindexTimeoutMs||90000):30000;
  const response=await fetch(base+p,{method,headers:{...(auth&&cookie?{Cookie:cookie}:{}),...(body!==undefined&&!raw?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:raw?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(deadlineMs)});
  const text=await response.text(); let json; try{json=JSON.parse(text);}catch{}
  latencies.push({path:p.split('?')[0],method,status:response.status,durationMs:Date.now()-t,deadlineMs});
  return {status:response.status,json,text,headers:response.headers};
}
const ok = r => {assert.equal(r.status,200,`HTTP ${r.status}: ${r.text.slice(0,300)}`);return r.json;};
async function login(){ const r=await request('/auth/login',{method:'POST',body:{password:secret.password},auth:false});ok(r);cookie=r.headers.get('set-cookie')?.split(';')[0] || '';assert.ok(cookie);return r; }
const content = p => request('/api/files/content?path='+encodeURIComponent(p));
const write = (p,s) => request('/api/files/content',{method:'PUT',body:{path:p,content:s}});
const note='4b-fixture/note.md';
const renamed='4b-fixture/renamed.md';
const text='---\ntitle: 隔离夹具\ntags: [preflight, synthetic]\ncourse: 4B\n---\n# Isolated fixture\nunique4bneedle 初始正文\n[[target]]\n\n```mermaid\ngraph TD\n A[Start] --> B[End]\n```\n';
async function snapshot(){if(volumeObserver)return execFileSync('python3',[observerScript,'snapshot','--container',container],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024}).trim();const o={};async function w(p){const st=await fs.lstat(p);const rel='/vault'+(path.relative(hostVault,p)?'/'+path.relative(hostVault,p):'');if(st.isSymbolicLink())o[rel]='link:'+await fs.readlink(p);else if(st.isDirectory()){o[rel]='dir';for(const n of(await fs.readdir(p)).sort())if(n!=='.git')await w(path.join(p,n));}else o[rel]=hash(await fs.readFile(p));}await w(hostVault);return JSON.stringify(o);}
const tempDirs = () => exec('find','/tmp','-maxdepth','1','-type','d','-name','webobsidian-upload-*').split('\n').filter(Boolean);
async function waitFor(fn,ms=8000){const end=Date.now()+ms;while(!await fn()){assert.ok(Date.now()<end,'condition timed out');await pause(70);}}
async function cleanTemp(){await waitFor(()=>tempDirs().length===0);}
async function rejected(action,statuses=[400,403,409,413,415]){await cleanTemp();const before=await snapshot();const r=await action();assert.ok(statuses.includes(r.status),`rejection status ${r.status}`);await cleanTemp();assert.equal(await snapshot(),before,'rejection must not mutate Vault');return {httpStatus:r.status,beforeVaultSha256:hash(before),afterVaultSha256:hash(await snapshot())};}
async function upload(name,bytes,{dir='4b-fixture',mime='application/octet-stream',image=false,auth=true}={}){const form=new FormData();if(!image)form.set('dir',dir);form.set('file',new Blob([bytes],{type:mime}),name);return request('/api/files/'+(image?'upload-image':'upload'),{method:'POST',body:form,auth,raw:true});}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a52kAAAAASUVORK5CYII=','base64');
function partialUpload(name){
  const boundary='4b-isolated-partial';
  const prefix=`--${boundary}\r\nContent-Disposition: form-data; name="dir"\r\n\r\n4b-fixture\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  let resolve;
  const result=new Promise(r=>{resolve=r;});
  const req=http.request(base+'/api/files/upload',{method:'POST',headers:{Cookie:cookie,'Content-Type':`multipart/form-data; boundary=${boundary}`}},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));});
  req.once('error',()=>resolve(0));req.write(prefix);req.write('partial fixture bytes');
  return {req,result,end:()=>req.end(`\r\n--${boundary}--\r\n`)};
}

if(phase==='initial'){
  if(args.resume==='after-setup')await login();
  await test('C01','health endpoint body',async()=>assert.equal(ok(await request('/healthz',{auth:false})).ok,true));
  await test('C02','fresh installation and public editor disabled',async()=>{const s=ok(await request('/auth/status',{auth:false}));assert.equal(s.passwordSet,false);assert.equal(s.publicEditor,false);});
  await test('C03','retired default password rejected',async()=>assert.equal((await request('/auth/login',{method:'POST',body:{password:'123456'},auth:false})).status,401));
  await test('C04','setup missing capability rejected',async()=>assert.equal((await request('/auth/setup',{method:'POST',body:{password:secret.password},auth:false})).status,400));
  await test('C05','setup invalid capability rejected',async()=>assert.equal((await request('/auth/setup',{method:'POST',body:{password:secret.password,setupToken:'incorrect'},auth:false})).status,403));
  await test('C06','initialize with one-time capability',async()=>{const r=await request('/auth/setup',{method:'POST',body:{password:secret.password,setupToken:secret.setupToken},auth:false});ok(r);cookie=r.headers.get('set-cookie')?.split(';')[0]||'';assert.ok(cookie);assert.ok(r.headers.get('set-cookie').includes('HttpOnly'));assert.ok(r.headers.get('set-cookie').includes('SameSite=Lax'));});
  await test('C07','setup replay rejected',async()=>assert.equal((await request('/auth/setup',{method:'POST',body:{password:secret.password,setupToken:secret.setupToken},auth:false})).status,409));
  await test('C08','password login and owner session',async()=>{await login();assert.equal(ok(await request('/auth/me')).role,'owner');});
  await test('C09','anonymous read denied',async()=>assert.equal((await request('/api/files',{auth:false})).status,401));
  await test('C10','anonymous write denied without side effects',async()=>rejected(()=>request('/api/files/content',{method:'PUT',body:{path:'unauthorized.md',content:'must not exist'},auth:false}),[401]));
  await test('C11','create Markdown, save, read byte-equivalent',async()=>{ok(await write(note,text));assert.equal(ok(await content(note)).content,text);});
  await test('C12','edit save read',async()=>{ok(await write(note,text+'saved edit\n'));assert.equal(ok(await content(note)).content,text+'saved edit\n');});
  await test('C13','YAML tags and custom properties indexed',async()=>{assert.match(JSON.stringify(ok(await request('/api/tags'))),/preflight/);assert.match(JSON.stringify(ok(await request('/api/properties'))),/course/);});
  await test('C14','search finds unique body token',async()=>{const hits=ok(await request('/api/search?q=unique4bneedle')).hits;assert.ok(hits.some(x=>x.path===note));});
  await test('C15','linked note and graph edge indexed',async()=>{ok(await write('4b-fixture/target.md','# target\n'));ok(await request('/api/reindex',{method:'POST',body:{}}));const g=ok(await request('/api/graph'));assert.ok(g.nodes.some(x=>x.id===note));assert.ok(g.edges.some(x=>x.source===note&&x.target==='4b-fixture/target.md'));});
  await test('C16','rename preserves content and search',async()=>{ok(await request('/api/files/rename',{method:'PATCH',body:{from:note,to:renamed}}));assert.equal(ok(await content(renamed)).content,text+'saved edit\n');assert.ok(ok(await request('/api/search?q=unique4bneedle')).hits.some(x=>x.path===renamed));});
  await test('C19','executable frontmatter retained as data through save/cold index/search',async()=>{const hostile='---javascript\n(()=>{process.getBuiltinModule("node:fs").writeFileSync("/tmp/4b-parser-marker","executed");return {title:"executed"};})()\n---\nparser4bmarkertext [[target]]';ok(await write('4b-fixture/parser-marker.md',hostile));ok(await request('/api/reindex',{method:'POST',body:{}}));assert.equal(ok(await content('4b-fixture/parser-marker.md')).content,hostile);assert.ok(ok(await request('/api/search?q=parser4bmarkertext')).hits.some(x=>x.path==='4b-fixture/parser-marker.md'));assert.equal(remoteExists('/tmp/4b-parser-marker'),false);});
  await test('P09','read-only API key cannot write and is revoked',async()=>{const j=ok(await request('/api/keys',{method:'POST',body:{name:'4b disposable read-only',scopes:['read','search']}}));try{const before=await snapshot();const read=await request('/api/v1/notes/'+renamed,{auth:false,headers:{'x-api-key':j.key}});assert.equal(read.status,200);const denied=await request('/api/v1/notes/4b-fixture/api-forbidden.md',{method:'PUT',auth:false,headers:{'x-api-key':j.key},body:{content:'must not exist'}});assert.equal(denied.status,403);assert.equal(await snapshot(),before);}finally{ok(await request('/api/keys/'+j.record.id,{method:'DELETE'}));}assert.equal((await request('/api/v1/notes/'+renamed,{auth:false,headers:{'x-api-key':j.key}})).status,401);});
  for(const [i,p] of ['../outside.md','/tmp/escape.md','4b-fixture/../../outside.md','.git/config','4b-fixture\\escape.md'].entries()) await test(`P0${i+1}`,`illegal path rejected: ${p}`,()=>rejected(()=>write(p,'must not exist')));
  await test('P06','foreign Origin write rejected',()=>rejected(()=>request('/api/files/content',{method:'PUT',headers:{Origin:'https://untrusted.example.invalid'},body:{path:'origin-escape.md',content:'must not exist'}}),[403]));
  await test('P07','symlink write target rejected',async()=>{await fixtureMkdir('/data/outside');await fixtureWrite('/data/outside/sentinel.md','unchanged');await fixtureSymlink('/data/outside','/vault/4b-fixture/external-link');const r=await rejected(()=>write('4b-fixture/external-link/sentinel.md','changed'));assert.equal((await fixtureRead('/data/outside/sentinel.md')).toString('utf8'),'unchanged');return r;});
  await test('P08','symlink read target rejected',async()=>rejected(()=>content('4b-fixture/external-link/sentinel.md')));
  // Remove only this fixture symlink, never existing data; it would deliberately block later indexing.
  await fixtureUnlink('/vault/4b-fixture/external-link');
  await test('U01','legal attachment preserves bytes',async()=>{const b=Buffer.from('isolated attachment bytes');const j=ok(await upload('small.bin',b));assert.equal(j.path,'4b-fixture/small.bin');assert.equal(await fixtureHash('/vault/4b-fixture/small.bin'),hash(b));});
  await test('U02','collision rejected without overwriting',()=>rejected(()=>upload('small.bin',Buffer.from('must not overwrite')),[409]));
  await test('U03','legal PNG uses local fallback',async()=>{const j=ok(await upload('fixture.png',png,{image:true,mime:'image/png'}));assert.equal(j.remote,false);assert.equal(j.path,'attachments/fixture.png');});
  await test('U04','spoofed image signature rejected',()=>rejected(()=>upload('spoof.png',Buffer.from('not png'),{image:true,mime:'image/png'}),[415]));
  await test('U05','image MIME mismatch rejected',()=>rejected(()=>upload('mismatch.png',png,{image:true,mime:'text/plain'}),[415]));
  await test('U06','SVG image rejected',()=>rejected(()=>upload('script.svg',Buffer.from('<svg onload="alert(1)"/>'),{image:true,mime:'image/svg+xml'}),[415]));
  const max=Number(args.attachmentBytes || 8*1024*1024);
  for(const n of [max-1,max]) await test(`U07-${n}`,'attachment size boundary accepted',async()=>{const j=ok(await upload(`boundary-${n}.bin`,Buffer.alloc(n,0x4b)));assert.equal(j.size,n);return {bytes:n};});
  await test('U08','attachment N+1 rejected',()=>rejected(()=>upload('too-large.bin',Buffer.alloc(max+1)),[413]));
  await test('U09','image N+1 rejected',()=>rejected(()=>upload('too-large.png',Buffer.concat([png,Buffer.alloc(Number(args.imageBytes||4*1024*1024)+1-png.length)]),{image:true,mime:'image/png'}),[413]));
  await test('U10','multipart malformed rejected',()=>rejected(()=>request('/api/files/upload',{method:'POST',raw:true,headers:{'Content-Type':'multipart/form-data; boundary=bad'},body:'malformed'}),[400]));
  await test('U11','upload directory traversal rejected',()=>rejected(()=>upload('dir-traversal.bin',Buffer.from('no'),{dir:'../outside'})));
  await test('U12','anonymous upload rejected before reception',()=>rejected(()=>upload('anonymous.bin',Buffer.from('no'),{auth:false}),[401]));
  await test('U16','upload filename is reduced to basename within authorized directory',async()=>{const j=ok(await upload('../outside/basename-only.bin',Buffer.from('safe basename')));assert.equal(j.path,'4b-fixture/basename-only.bin');assert.equal((await fixtureRead('/vault/4b-fixture/basename-only.bin')).toString('utf8'),'safe basename');assert.equal(remoteExists('/vault/outside/basename-only.bin'),false);});
  await test('U13','concurrency budget rejects third upload with 429',async()=>{await cleanTemp();const a=partialUpload('held-one.bin');const b=partialUpload('held-two.bin');try{await pause(500);const r=await upload('busy.bin',Buffer.from('no'));assert.equal(r.status,429);return {httpStatus:r.status,barrier:'third request rejected while two partial streams remained open; no observer process during receive window'};}finally{a.req.destroy();b.req.destroy();await Promise.all([a.result,b.result]);await cleanTemp();}});
  await test('U14','receive timeout returns 408 and cleans temporary data',async()=>{const before=await snapshot();const p=partialUpload('timeout.bin');assert.equal(await p.result,408);await cleanTemp();assert.equal(await snapshot(),before);});
  await test('U15','client interruption clears temporary data and releases slots',async()=>{const before=await snapshot();const p=partialUpload('aborted.bin');await pause(500);assert.equal(p.req.writableLength,0,'partial body flushed from host client');p.req.destroy();await p.result;await cleanTemp();assert.equal(await snapshot(),before);ok(await upload('after-abort.bin',Buffer.from('slot released')));await cleanTemp();});
  await test('G01','Git target configured only to disposable local bare',async()=>{await fixtureMkdir('/data/fixture-remote.git');exec('git','init','--bare','/data/fixture-remote.git');ok(await request('/api/settings',{method:'PUT',body:{git:{enabled:true,remote:'/data/fixture-remote.git',authorName:'Synthetic Fixture',authorEmail:'fixture@example.invalid',autoSync:false,autoCommitOnSave:false,lfsPatterns:[]},github:{editBranch:'draft/4b',baseBranch:'review',autoPullRequest:false,autoFollowBase:false,appEnabled:false}}}));ok(await request('/api/git/init',{method:'POST',body:{}}));assert.equal(git('branch','--show-current'),'draft/4b');assert.equal(git('remote','get-url','origin'),'/data/fixture-remote.git');git('config','protocol.file.allow','always');git('add','.');git('commit','-m','测试: 隔离初始夹具');git('branch','review');git('push','origin','draft/4b','review');});
  await test('G02','local commit records only selected file',async()=>{ok(await write('4b-fixture/git-local.md','# local controlled commit\n'));ok(await write('4b-fixture/unselected.md','# not selected\n'));const before=git('rev-parse','HEAD');const j=ok(await request('/api/git/commit',{method:'POST',body:{message:'测试: 本地选择提交',paths:['4b-fixture/git-local.md']}}));assert.match(j.message,/Committed/);assert.notEqual(git('rev-parse','HEAD'),before);assert.equal(git('diff-tree','--no-commit-id','--name-only','-r','HEAD'),'4b-fixture/git-local.md');assert.match(git('status','--porcelain'),/unselected.md/);});
  await test('G03','owner bare synchronization pushes only local fixture refs',async()=>{const baseRef=exec('git','--git-dir=/data/fixture-remote.git','rev-parse','refs/heads/review');const j=ok(await request('/api/git/sync',{method:'POST',body:{message:'测试: 隔离模拟投稿'}}));assert.equal(j.ok,true);assert.equal(j.pushed,true);assert.equal(j.publication,'not_performed');assert.equal(exec('git','--git-dir=/data/fixture-remote.git','rev-parse','refs/heads/draft/4b'),git('rev-parse','HEAD'));assert.equal(exec('git','--git-dir=/data/fixture-remote.git','rev-parse','refs/heads/review'),baseRef);return {localHead:git('rev-parse','HEAD'),reviewRef:baseRef};});
  await test('G04','empty selection is no-op with stable HEAD',async()=>{const before=git('rev-parse','HEAD');const j=ok(await request('/api/git/sync',{method:'POST',body:{message:'测试: 空选择',paths:[]}}));assert.equal(j.noop,true);assert.equal(git('rev-parse','HEAD'),before);});
  await test('G05','Git external lock is preserved and commit is rejected',async()=>{await fixtureWrite('/vault/.git/index.lock','4b active fixture lock',true);try{ok(await write('4b-fixture/locked.md','# lock test\n'));const before=git('rev-parse','HEAD');const r=await request('/api/git/commit',{method:'POST',body:{message:'测试: 锁定拒绝',paths:['4b-fixture/locked.md']}});assert.ok(r.status>=400);assert.equal(git('rev-parse','HEAD'),before);assert.equal((await fixtureRead('/vault/.git/index.lock')).toString('utf8'),'4b active fixture lock');}finally{await fixtureUnlink('/vault/.git/index.lock');}});
  await test('G06','all Git background and external integrations disabled for steady state',async()=>{const s=ok(await request('/api/settings',{method:'PUT',body:{git:{enabled:false,autoSync:false,autoCommitOnSave:false},github:{appEnabled:false,autoPullRequest:false,autoFollowBase:false}}}));assert.equal(s.git.enabled,false);assert.equal(s.github.appEnabled,false);assert.equal(s.publicEditor.enabled,false);});
  await test('C17','SPA and JS assets served (HTTP scope only)',async()=>{const r=await request('/');assert.equal(r.status,200);assert.match(r.text,/<div id="root"><\/div>/);const m=r.text.match(/src="([^\"]+\.js)"/);assert.ok(m);const js=await request(m[1]);assert.equal(js.status,200);assert.ok(js.text.length>10000);return {htmlSha256:hash(r.text),entryAsset:m[1],entrySha256:hash(js.text)};});
  await test('C18','healthy after operations and no leaked upload files',async()=>{await cleanTemp();assert.equal(ok(await request('/healthz',{auth:false})).ok,true);const i=JSON.parse(execFileSync('docker',['inspect','--format','{{json .State}}',container],{encoding:'utf8'}));assert.equal(i.Running,true);assert.equal(i.OOMKilled,false);});
  notRun('BROWSER','complete editor/search/chart rendering and interactions','HTTP suite checks backend contracts and asset delivery only; browser owner must add actual browser evidence.');
  notRun('MOCK-PR','mock GitHub App and PR creation inside AMD64 container','Requires separate test preload after initial steady-state evidence; real GitHub integrations remain disabled.');
  await test('C20','save recovery sentinels and Git state for independent restart check',async()=>{await fs.writeFile(path.join(out,'expected-recovery.json'),JSON.stringify({path:renamed,content:text+'saved edit\n',contentSha256:hash(text+'saved edit\n'),head:git('rev-parse','HEAD'),vaultSha256:hash(await snapshot())},null,2)+'\n');});
} else if(phase==='recovery'){
  const expected=JSON.parse(await fs.readFile(path.join(inputs,'expected-recovery.json'),'utf8'));
  await test('R01','restart health ready',async()=>assert.equal(ok(await request('/healthz',{auth:false})).ok,true));
  await test('R02','persisted password login after restart',async()=>{await login();assert.equal(ok(await request('/auth/me')).role,'owner');});
  await test('R03','setup remains consumed after restart',async()=>assert.equal((await request('/auth/setup',{method:'POST',body:{password:secret.password,setupToken:secret.setupToken},auth:false})).status,409));
  await test('R04','note and Git HEAD recovered exactly',async()=>{assert.equal(ok(await content(expected.path)).content,expected.content);assert.equal(git('rev-parse','HEAD'),expected.head);});
  await test('R05','search and graph recovered',async()=>{assert.ok(ok(await request('/api/search?q=unique4bneedle')).hits.some(x=>x.path===expected.path));assert.ok(ok(await request('/api/graph')).nodes.some(x=>x.id===expected.path));});
  await test('R06','restored data remains writable',async()=>{const p='4b-fixture/recovery-write.md';ok(await write(p,'# recovered writable fixture\n'));assert.equal(ok(await content(p)).content,'# recovered writable fixture\n');});
  await test('R07','default credential still rejected and public mode disabled',async()=>{assert.equal((await request('/auth/login',{method:'POST',body:{password:'123456'},auth:false})).status,401);assert.equal(ok(await request('/auth/status',{auth:false})).publicEditor,false);});
  await test('R08','upload temp clean after restart',cleanTemp);
} else if(phase==='prepare-recovery-matrix'){
  await login();
  const seed=JSON.parse(await fs.readFile(path.join(inputs,'recovery-matrix-seed.json'),'utf8'));
  const serial=Date.now();
  const expected={preparedAt:new Date().toISOString(),create:{path:'4b-fixture/recovery-matrix/create.md',token:'newvioletsignal'+serial,content:'# Recovery matrix create\nnewvioletsignal'+serial+'\n'},edit:{...seed.edit,oldToken:seed.edit.token,token:'newcobaltvector'+serial,content:'# Recovery matrix edited\nnewcobaltvector'+serial+'\n'},rename:{from:seed.rename.path,path:'4b-fixture/recovery-matrix/renamed-after.md',token:seed.rename.token,content:seed.rename.content},delete:{...seed.delete}};
  for(const name of ['create','edit','rename'])expected[name].contentSha256=hash(expected[name].content);
  let baselineReady=false;
  await test('RM01','matrix baseline files and search are present in existing startup cache',async()=>{const cache=(await fixtureRead('/data/qmd-index.json')).toString('utf8');for(const item of Object.values(seed)){assert.equal(ok(await content(item.path)).content,item.content);assert.ok(ok(await request('/api/search?q='+item.token)).hits.some(x=>x.path===item.path));assert.ok(cache.includes(item.path),'baseline path absent from pre-mutation persisted cache');}expected.beforeCacheSha256=hash(cache);expected.beforeCacheBytes=Buffer.byteLength(cache);baselineReady=true;return {cacheSha256:expected.beforeCacheSha256,baselinePaths:Object.values(seed).map(x=>x.path)};});
  if(baselineReady){
    await test('RM02','create a new document after cached baseline',async()=>{ok(await write(expected.create.path,expected.create.content));assert.equal(ok(await content(expected.create.path)).content,expected.create.content);});
    await test('RM03','edit cached body from old token to a distinct new token',async()=>{ok(await write(expected.edit.path,expected.edit.content));assert.equal(ok(await content(expected.edit.path)).content,expected.edit.content);assert.ok(!ok(await request('/api/search?q='+expected.edit.oldToken)).hits.some(x=>x.path===expected.edit.path));});
    await test('RM04','rename a cached document and retain its exact bytes',async()=>{ok(await request('/api/files/rename',{method:'PATCH',body:{from:expected.rename.from,to:expected.rename.path}}));assert.equal(ok(await content(expected.rename.path)).content,expected.rename.content);assert.equal(remoteExists('/vault/'+expected.rename.from),false);});
    await test('RM05','delete a cached document using normal API semantics',async()=>{const j=ok(await request('/api/files?path='+encodeURIComponent(expected.delete.path),{method:'DELETE'}));expected.delete.deleteReceipt=j;assert.equal(remoteExists('/vault/'+expected.delete.path),false);assert.ok(!ok(await request('/api/search?q='+expected.delete.token)).hits.some(x=>x.path===expected.delete.path));});
    await test('RM06','persist exact matrix inputs and cache hash without reindexing',async()=>{for(const name of ['create','edit','rename'])assert.ok(ok(await request('/api/search?q='+expected[name].token)).hits.some(x=>x.path===expected[name].path));const cache=(await fixtureRead('/data/qmd-index.json')).toString('utf8');expected.afterMutationCacheSha256=hash(cache);expected.afterMutationCacheIncludesCreatedPath=cache.includes(expected.create.path);await fs.writeFile(path.join(out,'expected-recovery-matrix.json'),JSON.stringify(expected,null,2)+'\n');return {beforeCacheSha256:expected.beforeCacheSha256,afterMutationCacheSha256:expected.afterMutationCacheSha256,cacheIncludesCreatedPath:expected.afterMutationCacheIncludesCreatedPath};});
  }else for(const id of ['RM02','RM03','RM04','RM05','RM06'])notRun(id,'matrix mutation not started','cached baseline not verified; no mutation attempted');
} else if(phase==='recovery-matrix'){
  await login();
  const expected=JSON.parse(await fs.readFile(path.join(inputs,'expected-recovery-matrix.json'),'utf8'));
  for(const [id,name] of [['RM11','create'],['RM12','edit'],['RM13','rename']])await test(id,name+' exact bytes persist after ordinary restart',async()=>{const item=expected[name];const j=ok(await content(item.path));assert.equal(j.content,item.content);assert.equal(hash(j.content),item.contentSha256);assert.equal(await fixtureHash('/vault/'+item.path),item.contentSha256);});
  await test('RM14','old renamed and deleted paths remain absent',async()=>{const results=[];for(const p of [expected.rename.from,expected.delete.path]){assert.equal(remoteExists('/vault/'+p),false);const r=await content(p);assert.ok(r.status>=400,'missing path must not return content');assert.match(r.json?.error||'',/ENOENT|not found|not exist/i,'reject for actual absence, not an unrelated server failure');results.push({path:p,httpStatus:r.status,error:r.json?.error});}return {negativeReads:results,note:'existing files/content endpoint may represent ENOENT as HTTP 500; no 404 claim is made'};});
  await test('RM15','search preserves create/edit/rename and removes stale edit/rename/delete',async()=>{for(const name of ['create','edit','rename']){const item=expected[name];const hits=ok(await request('/api/search?q='+item.token)).hits;assert.ok(hits.some(x=>x.path===item.path),name+' body token missing');if(name==='rename')assert.ok(!hits.some(x=>x.path===item.from),'old rename path remains indexed');}assert.ok(!ok(await request('/api/search?q='+expected.edit.oldToken)).hits.some(x=>x.path===expected.edit.path),'stale pre-edit body token remains indexed');assert.ok(!ok(await request('/api/search?q='+expected.delete.token)).hits.some(x=>x.path===expected.delete.path),'deleted document remains indexed');});
  await test('RM16','graph includes current documents and excludes old/deleted paths',async()=>{const ids=new Set(ok(await request('/api/graph')).nodes.map(x=>x.id));for(const name of ['create','edit','rename'])assert.ok(ids.has(expected[name].path));assert.ok(!ids.has(expected.rename.from));assert.ok(!ids.has(expected.delete.path));});
  await test('RM17','new derived cache describes the post-mutation file tree',async()=>{const cache=(await fixtureRead('/data/qmd-index.json')).toString('utf8');for(const name of ['create','edit','rename'])assert.ok(cache.includes(expected[name].path));assert.ok(!cache.includes(expected.rename.from));assert.ok(!cache.includes(expected.delete.path));assert.ok(!cache.includes(expected.edit.oldToken));return {beforeCacheSha256:expected.beforeCacheSha256,afterMutationCacheSha256:expected.afterMutationCacheSha256,afterRestartCacheSha256:hash(cache),noManualReindex:true};});
} else if(phase==='prepare-incremental-recovery'){
  await login();
  const token='incremental4bbody'+Date.now();
  const file='4b-fixture/new-after-cache.md';
  const source='# New content after existing cache\n'+token+'\n';
  await test('IR01','save new body token after existing startup cache',async()=>{ok(await write(file,source));assert.equal(ok(await content(file)).content,source);});
  await test('IR02','new body token is indexed before restart',async()=>assert.ok(ok(await request('/api/search?q='+token)).hits.some(x=>x.path===file)));
  await test('IR03','preserve exact new token and cache state before restart',async()=>{const cache=remoteExists('/data/qmd-index.json')?(await fixtureRead('/data/qmd-index.json')).toString('utf8'):null;const expected={path:file,token,content:source,contentSha256:hash(source),preparedAt:new Date().toISOString(),existingCachePresent:cache!==null,existingCacheSha256:cache!==null?hash(cache):null,existingCacheIncludesExactToken:cache!==null?cache.includes(token):false};await fs.writeFile(path.join(out,'expected-incremental-recovery.json'),JSON.stringify(expected,null,2)+'\n');return {path:file,token,cachePresent:cache!==null,cacheIncludesExactToken:expected.existingCacheIncludesExactToken};});
} else if(phase==='recovery-incremental'){
  await login();
  const expected=JSON.parse(await fs.readFile(path.join(inputs,'expected-incremental-recovery.json'),'utf8'));
  await test('IR04','new body bytes persist after ordinary stop/start',async()=>{const j=ok(await content(expected.path));assert.equal(j.content,expected.content);assert.equal(hash(j.content),expected.contentSha256);});
  await test('IR05','post-cache new body token remains searchable after ordinary stop/start',async()=>{const hits=ok(await request('/api/search?q='+expected.token)).hits;assert.ok(hits.some(x=>x.path===expected.path),'new body token missing from restored search index');return {hits:hits.filter(x=>x.path===expected.path).length};});
  await test('IR06','new note remains in recovered graph',async()=>assert.ok(ok(await request('/api/graph')).nodes.some(x=>x.id===expected.path)));
} else if(phase==='corpus'){
  assert.ok(!volumeObserver,'volume corpus must be generated offline and preloaded while stopped; use corpus-verify after startup');
  await login();
  let corpus;
  await test('V01','generate 1000 deterministic 4KiB Markdown files and manifest',async()=>{
    if(hostVault){await fs.mkdir(path.join(hostVault,'4b-corpus'),{recursive:true});const manifest=[];for(let i=0;i<1000;i++){const id=String(i).padStart(4,'0'),next=String((i+1)%1000).padStart(4,'0');const head='---\ntitle: Synthetic corpus '+id+'\ntags: [preflight, corpus4b]\nfixture: isolated\n---\n# Synthetic corpus '+id+'\nallcorpus4b corpus4bneedle'+id+'\n[[4b-corpus/'+next+']]\n';const source=(head+'Synthetic neutral paragraph for isolated resource validation only. '.repeat(100)).slice(0,4096);const rel='4b-corpus/'+id+'.md';await fs.writeFile(path.join(hostVault,rel),source);manifest.push({path:rel,bytes:Buffer.byteLength(source),sha256:hash(source)});}corpus={files:manifest.length,totalTextBytes:manifest.reduce((n,x)=>n+x.bytes,0),manifest};}

    assert.equal(corpus.files,1000);assert.equal(corpus.totalTextBytes,4096000);assert.ok(corpus.manifest.every(x=>x.bytes===4096));
    return {files:corpus.files,totalTextBytes:corpus.totalTextBytes};
  });
  await test('V02','1MiB legal Markdown saved and read exactly through HTTP',async()=>{
    const head='---\ntitle: Synthetic 1MiB document\ntags: [preflight, corpus4b]\n---\n# Synthetic large document\nlarge4bneedle\n[[4b-corpus/0000]]\n';
    const large=(head+'Synthetic neutral paragraph for bounded large document validation. '.repeat(20000)).slice(0,1024*1024);
    const p='4b-corpus/large-document.md';ok(await write(p,large));assert.equal(ok(await content(p)).content,large);
    assert.equal(Buffer.byteLength(large),1048576);
    const item={path:p,bytes:Buffer.byteLength(large),sha256:hash(large)};
    corpus.manifest.push(item);corpus.files++;corpus.totalTextBytes+=item.bytes;
    return item;
  });
  await test('V03','cold rebuild indexes every corpus Markdown file',async()=>{
    ok(await request('/api/reindex',{method:'POST',body:{}}));
    const all=ok(await request('/api/v1/health'));assert.equal(all.ok,true);
    const g=ok(await request('/api/graph'));
    const nodes=g.nodes.filter(x=>x.kind==='note'&&x.id.startsWith('4b-corpus/'));
    const edges=g.edges.filter(x=>x.source.startsWith('4b-corpus/')&&x.target.startsWith('4b-corpus/'));
    assert.equal(nodes.length,1001);assert.equal(edges.length,1001);
    assert.equal(ok(await request('/api/search?q=allcorpus4b')).hits.filter(x=>x.path.startsWith('4b-corpus/')).length,1000);
    assert.ok(ok(await request('/api/search?q=large4bneedle')).hits.some(x=>x.path==='4b-corpus/large-document.md'));
    return {corpusNoteNodes:nodes.length,corpusEdges:edges.length,commonTokenSearchHits:1000};
  });
  await test('V04','fixed corpus sentinels and on-disk bytes match manifest',async()=>{
    const actual=await corpusDiskManifest();
    assert.deepEqual(actual,corpus.manifest.sort((a,b)=>a.path.localeCompare(b.path)));
    for(const id of ['0000','0499','0999']) assert.ok(ok(await request('/api/search?q=corpus4bneedle'+id)).hits.some(x=>x.path==='4b-corpus/'+id+'.md'));
    return {manifestSha256:hash(JSON.stringify(actual)+'\n'),files:actual.length,totalTextBytes:actual.reduce((n,x)=>n+x.bytes,0),sentinels:['0000','0499','0999','large-document']};
  });
  if(corpus){const manifestText=JSON.stringify(corpus.manifest.sort((a,b)=>a.path.localeCompare(b.path)))+'\n';await fs.writeFile(path.join(out,'corpus-manifest.json'),manifestText);await fs.writeFile(path.join(out,'corpus-summary.json'),JSON.stringify({files:corpus.files,totalTextBytes:corpus.totalTextBytes,manifestSha256:hash(manifestText),fixtureOnly:true,realWikiCapacityClaim:false},null,2)+'\n');}
} else if(phase==='corpus-verify'){
  await login();
  const manifest=JSON.parse(await fs.readFile(path.join(inputs,'corpus-actual-manifest.json'),'utf8'));
  const large=manifest.find(x=>x.path==='4b-corpus/large-document.md');
  await test('CV01','health and fixed corpus manifest inputs',async()=>{assert.equal(ok(await request('/healthz',{auth:false})).ok,true);assert.equal(manifest.length,1001);assert.equal(manifest.reduce((n,x)=>n+x.bytes,0),5144576);assert.equal(large.bytes,1048576);});
  await test('CV02','1MiB existing Markdown read through HTTP matches saved bytes',async()=>{const j=ok(await content(large.path));assert.equal(Buffer.byteLength(j.content),large.bytes);assert.equal(hash(j.content),large.sha256);});
  await test('CV03','1MiB legal Markdown can save and read in settled state',async()=>{const source=(await fixtureRead('/vault/'+large.path)).toString('utf8');ok(await write(large.path,source));assert.equal(hash(ok(await content(large.path)).content),large.sha256);});
  await test('CV04','every corpus document indexed and fixed search sentinels found',async()=>{assert.equal(ok(await request('/api/search?q=allcorpus4b')).hits.filter(x=>x.path.startsWith('4b-corpus/')).length,1000);for(const id of ['0000','0499','0999'])assert.ok(ok(await request('/api/search?q=corpus4bneedle'+id)).hits.some(x=>x.path==='4b-corpus/'+id+'.md'));assert.ok(ok(await request('/api/search?q=large4bneedle')).hits.some(x=>x.path===large.path));});
  await test('CV05','graph contains exact corpus nodes and ring edges',async()=>{const g=ok(await request('/api/graph'));assert.equal(g.nodes.filter(x=>x.kind==='note'&&x.id.startsWith('4b-corpus/')).length,1001);assert.equal(g.edges.filter(x=>x.source.startsWith('4b-corpus/')&&x.target.startsWith('4b-corpus/')).length,1001);});
  await test('CV06','small normal edit remains writable with loaded corpus',async()=>{const p='4b-fixture/corpus-normal-save.md';const source='# settled corpus write\nnormal4bcapacityneedle\n';ok(await write(p,source));assert.equal(ok(await content(p)).content,source);assert.ok(ok(await request('/api/search?q=normal4bcapacityneedle')).hits.some(x=>x.path===p));});
  await test('CV07','on-disk corpus remains byte-identical to preserved actual manifest',async()=>{const actual=await corpusDiskManifest();assert.deepEqual(actual,manifest);return {files:actual.length,totalTextBytes:actual.reduce((n,x)=>n+x.bytes,0),manifestSha256:hash(JSON.stringify(actual)+'\n')};});
} else if(phase==='soak'){
  await login();
  const seconds=Number(args.seconds||1800);
  const end=Date.now()+seconds*1000;let loops=0;
  await test('S01','bounded concurrent write/read/search/graph soak',async()=>{while(Date.now()<end){const round=++loops;const p='4b-fixture/soak.md';const source=`---\ntags: [preflight]\n---\n# Synthetic soak\nunique4bsoak ${round}\n[[target]]\n`;ok(await write(p,source));const results=await Promise.all([content(p),request('/api/search?q=unique4bsoak'),request('/api/graph'),request('/healthz',{auth:false})]);results.forEach(ok);assert.equal(results[0].json.content,source,'soak exact bytes must match current iteration');const hit=results[1].json.hits.find(x=>x.path===p);assert.ok(hit,'soak document must be searchable each iteration');assert.ok(hit.snippet.includes('unique4bsoak '+round+' [[target]]'),'search snippet must reflect current iteration');assert.ok(results[2].json.nodes.some(x=>x.id===p),'soak document graph node must be present');assert.equal(results[3].json.ok,true,'health body must remain ready');if(round%10===0)console.log(`SOAK iterations=${round} remainingSeconds=${Math.max(0,Math.round((end-Date.now())/1000))}`);await pause(1000);}return {iterations:loops,requestedSeconds:seconds};});
  await test('S02','corpus sentinels and indexed graph survive sustained writes',async()=>{const corpus=JSON.parse(await fs.readFile(path.join(inputs,'corpus-actual-summary.json'),'utf8'));assert.equal(corpus.files,1001);assert.equal(ok(await request('/api/search?q=allcorpus4b')).hits.filter(x=>x.path.startsWith('4b-corpus/')).length,1000);const g=ok(await request('/api/graph'));assert.equal(g.nodes.filter(x=>x.kind==='note'&&x.id.startsWith('4b-corpus/')).length,1001);assert.ok(ok(await request('/api/search?q=large4bneedle')).hits.some(x=>x.path==='4b-corpus/large-document.md'));return {corpusFiles:1001,commonTokenHits:1000};});
} else throw new Error('Unknown phase');

const durations=latencies.map(x=>x.durationMs).sort((a,b)=>a-b);
const report={startedAt,endedAt:new Date().toISOString(),phase,base,container,host:{platform:process.platform,arch:process.arch,node:process.version},observation:volumeObserver?'host Python streaming docker cp tar observer; .git excluded; container find for temporary uploads':'host bind fixture fs snapshot; container find for temporary upload directory',reusedPasses:[...reusedIds],reusedEvidence:reusedIds.size?'initial-attempt1.log':undefined,credentials:'private input file; values omitted',summary:{pass:cases.filter(x=>x.status==='PASS').length,fail:cases.filter(x=>x.status==='FAIL').length,notRun:cases.filter(x=>x.status==='NOT-RUN').length},requestMetrics:{count:latencies.length,p50Ms:durations[Math.floor(durations.length*.5)]||0,p95Ms:durations[Math.floor(durations.length*.95)]||0,maxMs:durations.at(-1)||0},cases,requests:latencies};
await fs.writeFile(path.join(out,`${phase}-results.json`),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.summary));
process.exitCode=report.summary.fail?1:0;
