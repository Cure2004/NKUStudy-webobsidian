#!/usr/bin/env python3
import subprocess,json,pathlib,time,datetime,urllib.request,sys,re
phase=sys.argv[1];assert re.fullmatch('[a-z0-9-]+',phase)
out=pathlib.Path('docs/nkustudy/4b-preflight/evidence/container');app='nkustudy-4b-1bd3f6c';relay=app+'-relay';rows=[]
for n in [relay,app]:
 x=json.loads(subprocess.check_output(['docker','inspect',n]))[0];assert x['Config']['Labels']['org.nkustudy.4b.instance']==app
 (out/(phase+'-'+n+'-prestop.json')).write_text(json.dumps({k:x[k] for k in ['Id','Name','Image','State','HostConfig','Mounts','NetworkSettings']},indent=2))
for argv in [['docker','stop','--time','30',relay],['docker','stop','--time','30',app],['docker','start',app,relay]]:
 p=subprocess.run(argv,text=True,capture_output=True);rows.append({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'argv':argv,'exitCode':p.returncode,'stdout':p.stdout,'stderr':p.stderr});assert p.returncode==0
start=time.monotonic();ready=False
while time.monotonic()-start<180:
 try:
  with urllib.request.urlopen('http://127.0.0.1:28787/healthz',timeout=3) as res:ready=json.load(res).get('ok')is True
  if ready:break
 except Exception:pass
 time.sleep(.5)
r={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'budgetSeconds':180,'startupSeconds':time.monotonic()-start,'httpReady':ready,'memoryBudgetBytes':640*1024*1024,'resourcesChanged':False,'commands':rows};(out/(phase+'-restart.json')).write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2));sys.exit(0 if ready else 1)
