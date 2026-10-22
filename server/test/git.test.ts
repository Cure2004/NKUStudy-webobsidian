import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nkustudy-git-'));
process.env.HOME = path.join(root, 'home');
await fs.mkdir(process.env.HOME,{recursive:true});
process.env.DATA_DIR = path.join(root, 'data');
process.env.VAULT_PATH = path.join(root, 'initial');
process.env.GIT_CONFIG_NOSYSTEM = '1'; process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_TERMINAL_PROMPT = '0'; process.env.GIT_ALLOW_PROTOCOL = 'file';
delete process.env.WEBOBSIDIAN_PASSWORD;
await fs.mkdir(process.env.VAULT_PATH,{recursive:true});
const { updateSettings } = await import('../src/services/settings.js');
const { hashPassword, issueToken } = await import('../src/services/auth.js');
const git = await import('../src/services/git.js');
const { gitRouter } = await import('../src/routes/git.js');
const { errorHandler } = await import('../src/middleware/error.js');
const appApi = await import('../src/services/githubApp.js');
const app = express(); app.use(express.json()); app.use(cookieParser()); app.use('/api/git',gitRouter); app.use(errorHandler);
const server = app.listen(0,'127.0.0.1'); await new Promise<void>(r=>server.once('listening',r));
const base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
const realFetch = globalThis.fetch;
let serial=0;
const run = (cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',env:{...process.env},stdio:['ignore','pipe','pipe']}).trim();
const contentFile=(repo:string,rel:string)=>path.join(repo,'content',rel);
async function write(repo:string,rel:string,content:string) { const p=contentFile(repo,rel); await fs.mkdir(path.dirname(p),{recursive:true}); await fs.writeFile(p,content); }
async function fixture() {
  globalThis.fetch=realFetch; appApi.clearInstallationTokenCache();
  await fs.rm(path.join(root,'data/git-sync-receipt.json'),{force:true});
  const repo=path.join(root,`repo-${++serial}`),remote=path.join(root,`bare-${serial}`);
  await fs.mkdir(repo,{recursive:true}); await fs.mkdir(remote,{recursive:true});
  run(repo,'init','-b','draft/custom'); run(repo,'config','protocol.allow','never'); run(repo,'config','protocol.file.allow','always'); run(repo,'config','user.name','Fixture'); run(repo,'config','user.email','fixture@example.invalid');
  await write(repo,'allowed/note.md','original'); await write(repo,'private/secret.md','private'); await fs.writeFile(path.join(repo,'outside.md'),'outside');
  run(repo,'add','.'); run(repo,'commit','-m','fixture initial'); run(repo,'branch','review'); run(remote,'init','--bare');
  run(repo,'remote','add','origin',remote); run(repo,'push','origin','draft/custom','review');
  const password=await hashPassword('fixture-owner-long-password');
  await updateSettings(s=>{s.vault.path=repo;s.vault.root='content';s.auth.userPasswordHash=password;s.publicEditor.enabled=true;s.publicEditor.editableRoot='content/allowed';
    s.git.enabled=true;s.git.remote=remote;s.git.token='';s.git.branch='legacy-main-ignored';s.git.lfsPatterns=[];s.git.autoCommitOnSave=false;s.git.autoSync=false;
    s.github.editBranch='draft/custom';s.github.baseBranch='review';s.github.owner='fixture';s.github.repo='wiki';s.github.targetConfirmed=false;s.github.appEnabled=false;
    s.github.appId='';s.github.installationId='';s.github.privateKey='';s.github.autoPullRequest=false;s.github.autoFollowBase=false;});
  return {repo,remote};
}
function state(repo:string) { return {head:run(repo,'rev-parse','HEAD'),index:run(repo,'ls-files','--stage'),status:run(repo,'status','--porcelain=v1','--untracked-files=all')}; }
function changed(repo:string) {return run(repo,'diff-tree','--no-commit-id','--name-only','--no-renames','-r','HEAD').split('\n').filter(Boolean);}
const request=async(body:unknown,owner=false)=>realFetch(base+'/api/git/sync',{method:'POST',headers:{'Content-Type':'application/json',...(owner?{Authorization:'Bearer '+await issueToken()}: {})},body:JSON.stringify(body)});
after(async()=>{globalThis.fetch=realFetch; await new Promise<void>((r,e)=>server.close(err=>err?e(err):r())); await fs.rm(root,{recursive:true,force:true});});

test('GIT-01 explicit empty selection leaves commit/index/worktree unchanged', async()=>{
  const {repo,remote}=await fixture(); await write(repo,'private/secret.md','changed private'); await fs.writeFile(path.join(repo,'outside.md'),'staged outside'); run(repo,'add','outside.md');
  const before=state(repo),bare=run(remote,'rev-parse','refs/heads/draft/custom');
  assert.equal(await git.commitAll('修复: 空选择',[]),'Nothing to commit');
  assert.deepEqual(state(repo),before); assert.equal(run(remote,'rev-parse','refs/heads/draft/custom'),bare);
  assert.equal((await git.sync('修复: 空选择',undefined,[])).noop,true);
  assert.deepEqual(state(repo),before); assert.equal(await fs.stat(path.join(root,'data/git-sync-receipt.json')).then(()=>true,()=>false),false);
});

test('GIT-02 isolated index commits only selected literal files and preserves unrelated staged blobs', async()=>{
  const {repo}=await fixture(); await write(repo,'allowed/note.md','new allowed'); await write(repo,'private/secret.md','staged private'); run(repo,'add','content/private/secret.md');
  await fs.writeFile(path.join(repo,'outside.md'),'staged outside');run(repo,'add','outside.md');
  const before=run(repo,'ls-files','--stage','content/private/secret.md','outside.md');
  const result=await git.commitAll('修复: 合法选择',['allowed/note.md']); assert.match(result,/^Committed/);
  assert.deepEqual(changed(repo),['content/allowed/note.md']);assert.equal(run(repo,'ls-files','--stage','content/private/secret.md','outside.md'),before);
  assert.equal(run(repo,'show','HEAD:content/private/secret.md'),'private');
  await write(repo,'allowed/*.md','literal star'); await write(repo,'allowed/extra.md','unselected');
  await git.commitAll('修复: 字面文件',['allowed/*.md']); assert.deepEqual(changed(repo),['content/allowed/*.md']);
});

test('GIT-02 guest dotdot, symlink and mixed selection rejected without effects', async()=>{
  const {repo}=await fixture(); await write(repo,'allowed/note.md','new');await write(repo,'private/secret.md','new private');await fs.symlink('../private',contentFile(repo,'allowed/link'));
  for(const paths of [['allowed/../private/secret.md'],['allowed/link/secret.md'],['allowed/note.md','private/secret.md'],['../outside.md'],['.git/config']]){
    const before=state(repo);const response=await request({message:'修复: 访客拒绝',paths});assert.ok(response.status>=400); assert.deepEqual(state(repo),before);
  }
});

test('GIT-03 absent/empty/invalid guest paths never become full-repo writes', async()=>{
  const {repo,remote}=await fixture();await write(repo,'private/secret.md','private pending'); const before=state(repo),bare=run(remote,'rev-parse','refs/heads/draft/custom');
  for(const paths of [undefined,[]]) {const response=await request({message:'修复: 无可选文件',...(paths?{paths}:{})});assert.equal(response.status,200);assert.equal((await response.json()).noop,true);}
  for(const paths of ['',null,{},[''],[7],['allowed/note.md','']]){const response=await request({message:'修复: 非法选择',paths});assert.equal(response.status,400);}
  assert.deepEqual(state(repo),before);assert.equal(run(remote,'rev-parse','refs/heads/draft/custom'),bare);
});

test('GIT-04 owner sync uses configured custom branch and preserves review ref', async()=>{
  const {repo,remote}=await fixture();await write(repo,'allowed/note.md','submission');await write(repo,'private/secret.md','staged private');run(repo,'add','content/private/secret.md');
  const review=run(repo,'rev-parse','review'),staged=run(repo,'ls-files','--stage','content/private/secret.md');
  const response=await request({message:'修复: 本地同步',paths:['allowed/note.md']},true);assert.equal(response.status,200); const result=await response.json(); assert.equal(result.ok,true);assert.equal(result.pushed,true);assert.equal(result.publication,'not_performed');
  assert.deepEqual(changed(repo),['content/allowed/note.md']);assert.equal(run(remote,'rev-parse','refs/heads/draft/custom'),run(repo,'rev-parse','HEAD'));assert.equal(run(remote,'rev-parse','refs/heads/review'),review);assert.equal(run(repo,'ls-files','--stage','content/private/secret.md'),staged);
});

test('GIT-04 wrong current branch fails before commit; no automatic checkout/base write', async()=>{
  const {repo}=await fixture();run(repo,'checkout','review');await write(repo,'allowed/note.md','pending');const before=state(repo);
  await assert.rejects(git.sync('修复: 错分支',undefined,['allowed/note.md']),/Current content branch/);assert.deepEqual(state(repo),before);assert.equal(run(repo,'branch','--show-current'),'review');
});

test('GIT-05 disabled/missing/unconfirmed/mismatched target fails closed',async()=>{
  const {repo}=await fixture();await write(repo,'allowed/note.md','pending');const before=state(repo);
  await updateSettings(s=>{s.git.enabled=false;});await assert.rejects(git.sync('修复: 配置拒绝',undefined,['allowed/note.md']),/disabled/);
  await updateSettings(s=>{s.git.enabled=true;s.git.remote='';});await assert.rejects(git.sync('修复: 配置拒绝',undefined,['allowed/note.md']),/remote explicitly/);
  await updateSettings(s=>{s.git.remote='https://github.com/fixture/wiki.git';s.github.targetConfirmed=false;});await assert.rejects(git.sync('修复: 配置拒绝',undefined,['allowed/note.md']),/Confirm/);
  await updateSettings(s=>{s.github.targetConfirmed=true;s.github.owner='QUT-Lib';s.github.repo='QUT-WiKi';});await assert.rejects(git.sync('修复: 配置拒绝',undefined,['allowed/note.md']),/does not match/);
  await updateSettings(s=>{s.github.owner='fixture';s.github.repo='wiki';s.github.baseBranch=s.github.editBranch;});await assert.rejects(git.sync('修复: 配置拒绝',undefined,['allowed/note.md']),/distinct/);
  assert.deepEqual(state(repo),before);
  for(const remote of ['https://evilgithub.com/fixture/wiki','https://github.com.evil/fixture/wiki','https://evil/x/github.com/fixture/wiki','https://github.com/fixture/wiki?x=1'])assert.equal(appApi.parseGithubRemote(remote),null);
});

async function githubFixture() {
  const f=await fixture(); const fake='https://github.com/fixture/wiki.git';run(f.repo,'remote','set-url','origin',fake);
  // Git's real HTTPS transport is mapped to the disposable local bare repo, never network.
  run(f.repo,'config',`url.${f.remote}.insteadOf`,fake);
  const keys=generateKeyPairSync('rsa',{modulusLength:2048});
  const privateKey=keys.privateKey.export({type:'pkcs8',format:'pem'}).toString();
  await updateSettings(s=>{s.git.remote=fake;s.github.targetConfirmed=true;s.github.appEnabled=true;s.github.appId='1';s.github.installationId='1';s.github.privateKey=privateKey;s.github.autoPullRequest=true;});
  // Avoid embedding a token in the local Git transport URL: the App mock token is
  // intentionally empty, and URL rewriting covers that exact authenticated URL too.
  run(f.repo,'config',`url.${f.remote}.insteadOf`,'https://x-access-token:fixture-token@github.com/fixture/wiki.git');
  let prCreated=false; let postCount=0; let failPost=false; let failLookup=false;
  globalThis.fetch=async(input: string|URL|Request,init?:RequestInit)=>{
    const url=String(input);assert.ok(url.startsWith('https://api.github.com/'),'Unexpected external request');
    if(url.includes('/access_tokens'))return Response.json({token:'fixture-token',expires_at:new Date(Date.now()+3600000).toISOString()});
    if(init?.method==='POST') {postCount++;if(failPost)throw new Error('fixture network interruption');prCreated=true;return Response.json({number:7,html_url:'https://github.com/fixture/wiki/pull/7'});}
    if(failLookup)return new Response('',{status:503});
    return Response.json(prCreated?[{number:7,html_url:'https://github.com/fixture/wiki/pull/7',base:{ref:'review'}}]:[]);
  };
  return {...f,posts:()=>postCount,setFailPost:()=>{failPost=true;},setFailLookup:()=>{failLookup=true;},setExisting:()=>{prCreated=true;}};
}

test('GIT-06 guest local bare/mock PR succeeds on custom edit/base without fixed QUT values',async()=>{
  const f=await githubFixture();await write(f.repo,'allowed/note.md','guest submission');const response=await request({message:'修复: 访客投稿',paths:['allowed/note.md']});assert.equal(response.status,200);const result=await response.json();assert.equal(result.ok,true);assert.equal(result.pullRequest.number,7);assert.equal(result.publication,'not_performed');assert.equal(f.posts(),1);assert.equal(run(f.remote,'rev-parse','refs/heads/draft/custom'),run(f.repo,'rev-parse','HEAD'));
});

test('GIT-06 PR lookup failure does not commit; PR POST unknown blocks replay and supports query-only recovery',async()=>{
  let f=await githubFixture();await write(f.repo,'allowed/note.md','first');f.setFailLookup();const before=state(f.repo);await assert.rejects(git.sync('修复: 查询拒绝',undefined,['allowed/note.md'],'guest'),/lookup failed/);assert.deepEqual(state(f.repo),before);assert.equal(f.posts(),0);
  f=await githubFixture();await write(f.repo,'allowed/note.md','second');f.setFailPost();const result=await git.sync('修复: 回执未知',undefined,['allowed/note.md'],'guest');assert.equal(result.ok,false);assert.equal(result.pushed,true);assert.equal(result.receipt?.phase,'pr_unknown');const committed=state(f.repo);await write(f.repo,'allowed/note.md','third');const pending=state(f.repo);await assert.rejects(git.sync('修复: 禁止重放',undefined,['allowed/note.md'],'guest'),/read-only reconciliation/);assert.equal(state(f.repo).head,committed.head);assert.deepEqual(state(f.repo),pending);assert.equal(f.posts(),1);
  f.setExisting();const receipt=await git.syncStatus();assert.equal(receipt?.phase,'complete');assert.equal(f.posts(),1);
});

test('GIT-07 behind base and conflicts stop before commit and preserve local draft',async()=>{
  const {repo,remote}=await fixture(); const other=path.join(root,'other-'+serial);run(root,'clone',remote,other);run(other,'config','user.name','Fixture');run(other,'config','user.email','fixture@example.invalid');run(other,'checkout','review');await fs.writeFile(path.join(other,'base-new.md'),'base');run(other,'add','.');run(other,'commit','-m','base next');run(other,'push','origin','review');
  await write(repo,'allowed/note.md','local pending');const before=state(repo);await assert.rejects(git.sync('修复: 落后停止',undefined,['allowed/note.md']),/behind/);assert.deepEqual(state(repo),before);
});

test('GIT-08 old external lock is retained and concurrent app operations serialize',async()=>{
  const {repo}=await fixture();await write(repo,'allowed/note.md','pending');const lock=path.join(repo,'.git/index.lock');await fs.writeFile(lock,'fixture active');await fs.utimes(lock,0,0);const before=state(repo);await assert.rejects(git.commitAll('修复: 活跃锁',['allowed/note.md']),/active lock/);assert.equal(await fs.readFile(lock,'utf8'),'fixture active');assert.deepEqual(state(repo),before);await fs.unlink(lock);
  const results=await Promise.all([git.commitAll('修复: 并发一',['allowed/note.md']),git.commitAll('修复: 并发二',['allowed/note.md'])]);assert.equal(results.filter(x=>x.startsWith('Committed')).length,1);assert.equal(results.filter(x=>x==='Nothing to commit').length,1);
});

test('GIT-09 explicit rename/delete and small binary preserve selected tree only',async()=>{
  const {repo}=await fixture();await fs.rename(contentFile(repo,'allowed/note.md'),contentFile(repo,'allowed/renamed.md'));await write(repo,'allowed/small.bin','\x00\x01fixture');await git.commitAll('修复: 重命名附件',['allowed/note.md','allowed/renamed.md','allowed/small.bin']);assert.deepEqual(changed(repo).sort(),['content/allowed/note.md','content/allowed/renamed.md','content/allowed/small.bin'].sort());assert.equal(run(repo,'show','HEAD:content/allowed/renamed.md'),'original');
});

test('GIT-06 guest requires App and PR policy before mutation, and lookup failures never create',async()=>{
  const f=await githubFixture();await write(f.repo,'allowed/note.md','pending');const before=state(f.repo);
  await updateSettings(s=>{s.github.autoPullRequest=false;});await assert.rejects(git.sync('修复: 必须审核',undefined,['allowed/note.md'],'guest'),/require/);assert.deepEqual(state(f.repo),before);
  await updateSettings(s=>{s.github.autoPullRequest=true;s.github.appEnabled=false;});await assert.rejects(git.sync('修复: 必须鉴权',undefined,['allowed/note.md'],'guest'),/require/);assert.deepEqual(state(f.repo),before);
  await updateSettings(s=>{s.github.appEnabled=true;});f.setFailLookup();
  await assert.rejects(appApi.createOrGetPullRequest({owner:'fixture',repo:'wiki',head:'draft/custom',base:'review',title:'fixture',body:'fixture'}),/lookup failed/);assert.equal(f.posts(),0);
});

test('GIT-07 existing PR pauses sync and follow-base, reuse avoids duplicate PR writes',async()=>{
  const f=await githubFixture();f.setExisting();await write(f.repo,'allowed/note.md','pending');const before=state(f.repo);
  const result=await git.sync('修复: 待审暂停',undefined,['allowed/note.md'],'guest');assert.equal(result.ok,false);assert.match(result.log[0],/awaiting review/);assert.deepEqual(state(f.repo),before);assert.equal(f.posts(),0);
  // Reusing the known PR is a read, not another POST.
  const pr=await appApi.createOrGetPullRequest({owner:'fixture',repo:'wiki',head:'draft/custom',base:'review',title:'fixture',body:'fixture'});assert.equal(pr.created,false);assert.equal(pr.number,7);assert.equal(f.posts(),0);
  await write(f.repo,'allowed/note.md','original');const follow=await git.followBase();assert.equal(follow.merged,false);assert.match(follow.log[0],/open pull request/);assert.equal(f.posts(),0);
});

test('GIT-06 standalone PR unknown outcome also prevents repeated writes',async()=>{
  const f=await githubFixture();f.setFailPost();await assert.rejects(git.openPullRequest(),/unresolved/);assert.equal(f.posts(),1);
  await assert.rejects(git.openPullRequest(),/read-only reconciliation/);assert.equal(f.posts(),1);f.setExisting();assert.equal((await git.syncStatus())?.phase,'complete');assert.equal(f.posts(),1);
});

test('GIT-06 push refusal is conservatively unknown and cannot be replayed',async()=>{
  const {repo,remote}=await fixture();await fs.writeFile(path.join(remote,'hooks/pre-receive'),'#!/bin/sh\nexit 1\n',{mode:0o700});await write(repo,'allowed/note.md','pending');
  const remoteBefore=run(remote,'rev-parse','refs/heads/draft/custom');const result=await git.sync('修复: 推送拒绝',undefined,['allowed/note.md']);assert.equal(result.ok,false);assert.equal(result.pushed,null);assert.equal(result.receipt?.phase,'push_unknown');assert.equal(run(remote,'rev-parse','refs/heads/draft/custom'),remoteBefore);
  await write(repo,'allowed/note.md','later');const before=state(repo);await assert.rejects(git.sync('修复: 禁止再写',undefined,['allowed/note.md']),/read-only reconciliation/);assert.deepEqual(state(repo),before);assert.equal((await git.syncStatus())?.phase,'push_unknown');
});

test('GIT-06 expired mock App tokens refresh; token exchange failure prevents commit',async()=>{
  const f=await githubFixture();await write(f.repo,'allowed/note.md','pending');const before=state(f.repo);let calls=0;
  globalThis.fetch=async(input:string|URL|Request)=>{assert.ok(String(input).includes('/access_tokens'));calls++;return Response.json({token:'fixture-only',expires_at:new Date(Date.now()-1000).toISOString()});};
  appApi.clearInstallationTokenCache();await appApi.getInstallationToken();await appApi.getInstallationToken();assert.equal(calls,2);
  globalThis.fetch=async()=>new Response('',{status:503});appApi.clearInstallationTokenCache();await assert.rejects(git.sync('修复: 令牌失败',undefined,['allowed/note.md'],'guest'),/token exchange failed/);assert.deepEqual(state(f.repo),before);
});


test('GIT-04 selected sync cannot carry unrelated local-only commit history',async()=>{
  const {repo,remote}=await fixture();await write(repo,'private/secret.md','local-only private');run(repo,'add','content/private/secret.md');run(repo,'commit','-m','local-only fixture');await write(repo,'allowed/note.md','selected pending');
  const before=state(repo),remoteHead=run(remote,'rev-parse','refs/heads/draft/custom');await assert.rejects(git.sync('修复: 隔离历史',undefined,['allowed/note.md']),/HEAD differs/);assert.deepEqual(state(repo),before);assert.equal(run(remote,'rev-parse','refs/heads/draft/custom'),remoteHead);
});


test('GIT-07 unfinished merge is retained without hidden abort/reset/commit',async()=>{
  const {repo}=await fixture();await write(repo,'allowed/note.md','draft');const merge=path.join(repo,'.git/MERGE_HEAD');const head=run(repo,'rev-parse','HEAD');await fs.writeFile(merge,head+'\n');const before=state(repo);
  await assert.rejects(git.commitAll('修复: 冲突保留',['allowed/note.md']),/unfinished operation/);assert.deepEqual(state(repo),before);assert.equal((await fs.readFile(merge,'utf8')).trim(),head);
});


test('GIT-06 unresolved receipt blocks clean omitted/empty retry instead of returning Synced',async()=>{
  const f=await githubFixture();await write(f.repo,'allowed/note.md','submission');f.setFailPost();const first=await git.sync('修复: 回执清洁重试',undefined,['allowed/note.md'],'guest');assert.equal(first.receipt?.phase,'pr_unknown');assert.equal(run(f.repo,'status','--porcelain'),'');const before=state(f.repo);
  for(const role of ['guest','owner'] as const) for(const paths of [undefined,[]]) await assert.rejects(git.sync('修复: 不得误报成功',undefined,paths,role),/read-only reconciliation/);
  assert.deepEqual(state(f.repo),before);assert.equal(f.posts(),1);
});

test('GIT-04 owner Commit then omitted-path Sync pushes existing reviewed history; explicit [] does not',async()=>{
  const {repo,remote}=await fixture();await write(repo,'allowed/note.md','local commit');await git.commitAll('修复: 先本地提交',['allowed/note.md']);const committed=run(repo,'rev-parse','HEAD'),remoteBefore=run(remote,'rev-parse','refs/heads/draft/custom');
  assert.equal((await git.sync(undefined,undefined,[])).noop,true);assert.equal(run(remote,'rev-parse','refs/heads/draft/custom'),remoteBefore);
  const result=await git.sync();assert.equal(result.ok,true);assert.equal(result.pushed,true);assert.equal(run(repo,'rev-parse','HEAD'),committed);assert.equal(run(remote,'rev-parse','refs/heads/draft/custom'),committed);
});

test('GIT-04 clean owner omitted-path Sync fast-forwards remote edits without guest publication',async()=>{
  const {repo,remote}=await fixture();const other=path.join(root,'pull-other-'+serial);run(root,'clone',remote,other);run(other,'config','user.name','Fixture');run(other,'config','user.email','fixture@example.invalid');run(other,'checkout','draft/custom');await write(other,'allowed/note.md','remote update');run(other,'add','.');run(other,'commit','-m','remote update');run(other,'push','origin','draft/custom');const remoteHead=run(remote,'rev-parse','refs/heads/draft/custom');
  const before=state(repo);const guest=await git.sync(undefined,undefined,undefined,'guest');assert.equal(guest.noop,true);assert.deepEqual(state(repo),before);
  const result=await git.sync();assert.equal(result.ok,true);assert.equal(run(repo,'rev-parse','HEAD'),remoteHead);assert.equal(await fs.readFile(contentFile(repo,'allowed/note.md'),'utf8'),'remote update');assert.equal(run(repo,'status','--porcelain'),'');
});


test('GIT-05 concurrent settings update waits for entire Git operation snapshot',async()=>{
  const f=await githubFixture();await write(f.repo,'allowed/note.md','old target submission');
  const other=path.join(root,'target-b-'+serial),otherBare=path.join(root,'target-b-bare-'+serial);run(root,'clone',f.remote,other);run(other,'checkout','draft/custom');run(root,'clone','--bare',f.remote,otherBare);run(other,'remote','set-url','origin',otherBare);const otherBefore=state(other),otherRemote=run(otherBare,'rev-parse','refs/heads/draft/custom');
  const originalMock=globalThis.fetch;let entered!:()=>void,release!:()=>void;const entry=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});let first=true;
  globalThis.fetch=async(input:string|URL|Request,init?:RequestInit)=>{if(first && String(input).includes('/pulls') && init?.method!=='POST'){first=false;entered();await gate;}return originalMock(input,init);};
  const operation=git.sync('修复: 冻结目标',undefined,['allowed/note.md'],'guest');await entry;
  let mutationEntered=false;const settingChange=updateSettings(s=>{mutationEntered=true;s.vault.path=other;s.git.remote=otherBare;s.github.appEnabled=false;s.github.autoPullRequest=false;s.github.targetConfirmed=false;s.github.owner='second';s.github.repo='repository';});
  await new Promise<void>(r=>setImmediate(r));assert.equal(mutationEntered,false);release();const result=await operation;assert.equal(result.ok,true);await settingChange;assert.equal(mutationEntered,true);
  assert.equal(result.receipt?.remote,'github:fixture/wiki');assert.equal(result.receipt?.commit,run(f.remote,'rev-parse','refs/heads/draft/custom'));assert.deepEqual(state(other),otherBefore);assert.equal(run(otherBare,'rev-parse','refs/heads/draft/custom'),otherRemote);
});

test('GIT-08 public-edit snapshot disables all background Git writes',async()=>{
  const {repo,remote}=await fixture();await write(repo,'allowed/note.md','anonymous pending');await write(repo,'private/secret.md','owner pending');await updateSettings(s=>{s.git.autoSync=true;s.github.autoFollowBase=true;});const before=state(repo),remoteHead=run(remote,'rev-parse','refs/heads/draft/custom');
  assert.equal((await git.syncAutomatic()).noop,true);assert.equal((await git.followBaseAutomatic()).merged,false);assert.deepEqual(state(repo),before);assert.equal(run(remote,'rev-parse','refs/heads/draft/custom'),remoteHead);
});
