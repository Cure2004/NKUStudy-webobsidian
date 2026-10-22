import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { setImmediate } from 'node:timers/promises';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'nkustudy-file-snapshot-'));
process.env.DATA_DIR=path.join(root,'data');process.env.VAULT_PATH=path.join(root,'vault-a');
await fs.mkdir(path.join(root,'vault-a/allowed'),{recursive:true});await fs.mkdir(path.join(root,'vault-b/allowed'),{recursive:true});
const {updateSettings}=await import('../src/services/settings.js');
await updateSettings(s=>{s.publicEditor.enabled=true;s.publicEditor.editableRoot='allowed';s.git.enabled=false;s.git.autoCommitOnSave=false;});
const {qmd}=await import('../src/services/search.js');
const {filesRouter}=await import('../src/routes/files.js');
const {errorHandler}=await import('../src/middleware/error.js');
const app=express();app.use(express.json());app.use('/api/files',filesRouter);app.use(errorHandler);
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
test('PATH-02 mutation authorization, disk write and indexes share a stable Vault/settings snapshot',async()=>{
 let entered!:()=>void;const indexed=new Promise<void>(r=>entered=r);let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 const original=qmd.upsert.bind(qmd);qmd.upsert=async rel=>{entered();await gate;return original(rel);};
 try{
  const request=fetch(base+'/api/files/content',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:'allowed/note.md',content:'snapshot sentinel'})});
  await indexed;let mutated=false;
  const change=updateSettings(s=>{mutated=true;s.vault.path=path.join(root,'vault-b');});
  await setImmediate();assert.equal(mutated,false);
  release();assert.equal((await request).status,200);await change;
  assert.equal(await fs.readFile(path.join(root,'vault-a/allowed/note.md'),'utf8'),'snapshot sentinel');
  await assert.rejects(fs.access(path.join(root,'vault-b/allowed/note.md')));
 }finally{release();qmd.upsert=original;await new Promise<void>(r=>server.close(()=>r()));await fs.rm(root,{recursive:true,force:true});}
});
