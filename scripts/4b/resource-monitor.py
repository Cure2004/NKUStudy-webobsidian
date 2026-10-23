#!/usr/bin/env python3
import subprocess,time,json,sys,pathlib,datetime
name,out,seconds=sys.argv[1:]; dest=pathlib.Path(out);dest.parent.mkdir(parents=True,exist_ok=True)
start=time.monotonic(); samples=[]
def run(argv):
 p=subprocess.run(argv,text=True,capture_output=True,timeout=20);return p.returncode,p.stdout,p.stderr
with dest.open('x') as f:
 while time.monotonic()-start<float(seconds):
  row={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'elapsedSeconds':round(time.monotonic()-start,2)}
  for key,args in [('stats',['docker','stats','--no-stream','--format','{{json .}}',name]),('cgroup',['docker','exec',name,'sh','-c','for f in memory.current memory.peak memory.events memory.max memory.swap.max pids.current pids.max cpu.stat; do echo "$f"; cat "/sys/fs/cgroup/$f"; done']),('state',['docker','inspect','--format','{{json .State}}',name])]:
   try:
    code,stdout,stderr=run(args);row[key]={'exitCode':code,'stdout':stdout,'stderr':stderr}
   except Exception as e:row[key]={'error':str(e)}
  f.write(json.dumps(row)+'\n');f.flush();samples.append(row)
  if row['state'].get('exitCode')==0:
   state=json.loads(row['state']['stdout'])
   if not state.get('Running') or state.get('OOMKilled'):break
  time.sleep(5)
summary={'container':name,'samples':len(samples),'actualSeconds':time.monotonic()-start,'durationRequested':float(seconds),'ended':datetime.datetime.now(datetime.timezone.utc).isoformat()}
dest.with_suffix('.summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary))
