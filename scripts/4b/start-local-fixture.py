#!/usr/bin/env python3
import subprocess,json,pathlib,time,urllib.request
r=pathlib.Path('/Users/carlos/Documents/ChatGPT/New project 3/4b-artifacts-20261022');out=pathlib.Path('docs/nkustudy/4b-preflight/evidence/build');name='nkustudy-4b-1bd3f6c';network=name+'-internal'
def run(a):
 p=subprocess.run(a,text=True,capture_output=True)
 if p.returncode:raise RuntimeError(json.dumps({'argv':a,'exit':p.returncode,'stderr':p.stderr}))
 return p.stdout.strip()
x=json.loads(run(['docker','image','inspect','nkustudy/webobsidian:4b-1bd3f6c']))[0]
assert x['Architecture']=='amd64' and x['Os']=='linux'
assert x['Config']['Labels']['org.nkustudy.source-manifest-sha256']=='86a1d4e926ff61b79d47909260968bbc47c56934cd09d55061bd502a3e64c73f'
assert x['Config']['Labels']['org.opencontainers.image.revision']=='cb3a96e8546844416258c1af64549724685eeb04'
image=x['Id'];filtered={k:x[k] for k in ['Id','Architecture','Os','Size','Created','RepoTags','Descriptor']};filtered.update({'Config':x['Config'],'RootFS':x['RootFS']});(out/'final-image.json').write_text(json.dumps(filtered,indent=2))
assert subprocess.run(['docker','inspect',name],capture_output=True).returncode!=0
assert subprocess.run(['docker','network','inspect',network],capture_output=True).returncode!=0
run(['docker','run','--rm','--pull','never','--platform','linux/amd64','--network','none','--user','0:0','--read-only','--cap-drop','ALL','--cap-add','CHOWN','--cap-add','FOWNER','--cap-add','DAC_OVERRIDE','--memory','128m','--memory-swap','128m','--cpus','0.50','--pids-limit','32','--mount',f'type=bind,source={r}/state-main/vault,target=/vault','--mount',f'type=bind,source={r}/state-main/data,target=/data','--entrypoint','node',image,'-e','const fs=require("fs");for(const p of ["/vault","/data"]){fs.chownSync(p,1000,1000)}'])
run(['docker','network','create','--internal','--label',f'org.nkustudy.4b.instance={name}',network])
a=['docker','run','--detach','--pull','never','--platform','linux/amd64','--name',name,'--label',f'org.nkustudy.4b.instance={name}','--init','--restart','no','--user','1000:1000','--network',network,'--publish','127.0.0.1:28787:8787','--read-only','--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','512m','--memory-reservation','256m','--memory-swap','512m','--cpus','0.50','--pids-limit','96','--stop-timeout','30','--log-driver','json-file','--log-opt','max-size=10m','--log-opt','max-file=3','--env-file',str(r/'private/main.env'),'--env','TRUST_PROXY=false','--env','WEBOBSIDIAN_WATCH=auto','--env','WEBOBSIDIAN_UPLOAD_TIMEOUT_MS=3000','--mount',f'type=bind,source={r}/state-main/vault,target=/vault','--mount',f'type=bind,source={r}/state-main/data,target=/data',image]
begin=time.monotonic();cid=run(a);ready=False
while time.monotonic()-begin<120:
 try:
  with urllib.request.urlopen('http://127.0.0.1:28787/healthz',timeout=2) as response:ready=json.load(response).get('ok') is True
  if ready:break
 except Exception:pass
 time.sleep(.25)
receipt={'argv':a,'container':name,'containerID':cid,'imageID':image,'httpReady':ready,'startupSeconds':time.monotonic()-begin,'note':'Main fixture only, short receiving deadline 3000ms; no secrets recorded'};(out/'local-start.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt,indent=2))
if not ready:raise SystemExit(1)
x=json.loads(run(['docker','inspect',name]))[0];safe={k:x[k] for k in ['Id','Name','Image','State','HostConfig','Mounts','NetworkSettings']};safe['Config']={k:x['Config'][k] for k in ['User','Labels','WorkingDir','Entrypoint','Cmd','Healthcheck']};(out/'container-config.json').write_text(json.dumps(safe,indent=2))
