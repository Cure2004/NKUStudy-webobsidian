#!/usr/bin/env python3
import pathlib,subprocess,json,hashlib,shutil,sys
root=pathlib.Path.cwd(); dest=pathlib.Path(sys.argv[1]).resolve()
suffix=sys.argv[2] if len(sys.argv)>2 else ''
if suffix and suffix!='-r2': raise SystemExit('Unknown manifest suffix')
if dest.exists(): raise SystemExit('Refuse existing context')
base='cb3a96e8546844416258c1af64549724685eeb04'
files=subprocess.check_output(['git','ls-tree','-r','--name-only',base],text=True).splitlines()
def included(f):
 return f in ['package.json','package-lock.json','server/package.json','server/tsconfig.json','web/package.json','web/index.html','web/tsconfig.json','web/vite.config.ts','desktop/package.json'] or f.startswith(('server/src/','web/src/','web/public/'))
records=[]
for f in sorted(filter(included,files)):
 p=root/f; raw=p.read_bytes(); old=subprocess.check_output(['git','show',base+':'+f])
 if p.is_symlink() or raw!=old: raise SystemExit('Source mismatch: '+f)
 if any(x in f.lower() for x in ['.env','.pem','.key','.zip','.bak']): raise SystemExit('Denied path: '+f)
 records.append({'path':f,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)})
for f in ['Dockerfile','.dockerignore','scripts/4b/container-entrypoint.sh']:
 raw=(root/f).read_bytes();records.append({'path':f,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)})
payload=json.dumps({'source_commit':base,'code_commit':'1bd3f6c088466c8b46b447c9516cec623bc194f6','files':records},indent=2)+'\n'
out=root/'docs/nkustudy/4b-preflight/evidence/build'; manifest=out/('source-manifest'+suffix+'.json'); checksum=out/('source-manifest'+suffix+'.sha256')
if manifest.exists() or checksum.exists(): raise SystemExit('Refuse existing source manifest')
manifest.write_text(payload)
sha=hashlib.sha256(payload.encode()).hexdigest();checksum.write_text(sha+'\n')
dest.mkdir(parents=True)
for x in records:
 target=dest/x['path'];target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(root/x['path'],target)
print(json.dumps({'context':str(dest),'files':len(records),'source_manifest_sha256':sha,'source_verified':True,'untracked_copied':False}))
