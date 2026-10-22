import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';

test('Integrated server: isolated startup, protected setup, owner edit/read and same-origin guard',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'nkustudy-startup-'));
 const setupToken='fixture-startup-setup-capability-0123456789';
 const child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:path.join(root,'data'),VAULT_PATH:path.join(root,'vault{literal}'),WEBOBSIDIAN_SETUP_TOKEN:setupToken,WEBOBSIDIAN_PASSWORD:'',NODE_ENV:'production',TRUST_PROXY:'false'},stdio:['ignore','pipe','pipe']});
 let output='';child.stderr.on('data',b=>{output+=String(b);});
 try {
  const base=await new Promise<string>((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(new Error('Server startup timed out')),30000);
   child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Server exited '+code+': '+output));});
   child.stdout.on('data',b=>{output+=String(b);const match=output.match(/server → (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
  });
  assert.equal((await fetch(base+'/healthz')).status,200);
  assert.equal((await fetch(base+'/api/files')).status,401);
  assert.equal((await fetch(base+'/auth/status').then(r=>r.json())).passwordSet,false);
  const password='fixture-startup-password';
  const setup=await fetch(base+'/auth/setup',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({password,setupToken})});
  assert.equal(setup.status,200);const cookie=setup.headers.get('set-cookie')!.split(';')[0];
  const body=JSON.stringify({path:'normal.md',content:'---\ntitle: 正常笔记\n---\n# Body'});
  const rejected=await fetch(base+'/api/files/content',{method:'PUT',headers:{cookie,origin:'https://foreign.invalid','content-type':'application/json'},body});
  assert.equal(rejected.status,403);await assert.rejects(fs.access(path.join(root,'vault{literal}/normal.md')));
  const saved=await fetch(base+'/api/files/content',{method:'PUT',headers:{cookie,origin:base,'content-type':'application/json'},body});
  assert.equal(saved.status,200);
  const read=await fetch(base+'/api/files/content?path=normal.md',{headers:{cookie}});assert.equal(read.status,200);assert.match((await read.json()).content,/正常笔记/);
  const ws=new WebSocket(base.replace('http:','ws:')+'/ws',{headers:{cookie,origin:base}});
  await once(ws,'open');
  const observed=new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>{ws.terminate();reject(new Error('Literal-root watcher event missing'));},5000);
   ws.on('message',raw=>{const event=JSON.parse(raw.toString());if(event.type==='fs'&&event.path==='watched.md'){clearTimeout(timer);resolve();}});
  });
  await fs.writeFile(path.join(root,'vault{literal}/watched.md'),'watcher fixture');
  await observed;ws.terminate();
  assert.ok(!output.includes(password));assert.ok(!output.includes(setupToken));
 }finally{
  const exit=once(child,'exit');child.kill('SIGTERM');await exit;await fs.rm(root,{recursive:true,force:true});
 }
});
