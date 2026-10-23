#!/usr/bin/env python3
import json,sys,re,pathlib,statistics
p=pathlib.Path(sys.argv[1]);rows=[json.loads(x) for x in p.read_text().splitlines() if x.strip()]; currents=[];peaks=[];cpu=[];pids=[];events=[];oomkilled=[];health=[];errors=[];limits=[];stopped=[]
for r in rows:
 try:
  st=json.loads(r['state']['stdout']);oomkilled.append(st['OOMKilled'])
  if not st.get('Running'):
   stopped.append({'at':r['at'],'exitCode':st.get('ExitCode'),'health':st.get('Health',{}).get('Status'),'oomKilled':st['OOMKilled'],'cgroupExitCode':r.get('cgroup',{}).get('exitCode')});continue
  s=json.loads(r['stats']['stdout']);cpu.append(float(s['CPUPerc'].strip('%')));pids.append(int(s['PIDs']))
  health.append(st.get('Health',{}).get('Status'))
  raw=r['cgroup']['stdout'];v={};key=None
  for line in raw.splitlines():
   if line in ['memory.current','memory.peak','memory.events','memory.max','memory.swap.max','pids.current','pids.max','cpu.stat']:key=line;v[key]=[]
   elif key:v[key].append(line)
  currents.append(int(v['memory.current'][0]));peaks.append(int(v['memory.peak'][0]));events.append(dict(x.split() for x in v['memory.events']));limits.append({'memory':v['memory.max'][0],'swap':v['memory.swap.max'][0],'pids':v['pids.max'][0]})
 except Exception as e:errors.append({'elapsed':r['elapsedSeconds'],'error':str(e)})
def percentile(x,f):return sorted(x)[min(len(x)-1,int(len(x)*f))] if x else None
result={'samples':len(rows),'elapsedSeconds':rows[-1]['elapsedSeconds']-rows[0]['elapsedSeconds'] if rows else 0,'maxMemoryCurrentBytes':max(currents,default=0),'cgroupMemoryPeakBytes':max(peaks,default=0),'cpuPercent':{'mean':statistics.mean(cpu) if cpu else None,'p95':percentile(cpu,.95),'max':max(cpu,default=0)},'maxPids':max(pids,default=0),'anyOOMKilled':any(oomkilled),'memoryEventsLast':events[-1] if events else {},'runningHealthStates':sorted(set(str(x) for x in health)),'stoppedTransitionSamples':stopped,'limits':limits[-1] if limits else {},'parseErrors':errors}
out=p.with_suffix('.analysis.json');out.write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
