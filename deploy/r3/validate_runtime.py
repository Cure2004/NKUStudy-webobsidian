#!/usr/bin/env python3
"""Check exact r2 app + fixed relay process, resource and owned-volume contracts."""
import json
import re
import sys


# One non-privileged shell, builtins only: no Node heap, helper container or mutation.
# Container-private unified cgroup v2 paths only; v1/host-path fallback is deliberately unsupported.
CGROUP_PROBE = '''[ -f /sys/fs/cgroup/cgroup.controllers ] || { printf 'cgroup v2 required\\n' >&2; exit 1; }
for key in memory.max memory.swap.max pids.max cpu.max; do
    file=/sys/fs/cgroup/$key
    [ -f "$file" ] && [ -r "$file" ] || { printf 'cgroup limit unreadable\\n' >&2; exit 1; }
    value=
    IFS= read -r value < "$file" || { printf 'cgroup limit read failed\\n' >&2; exit 1; }
    printf '%s=%s\\n' "$key" "$value"
done'''


def validate_cgroup(output, role):
    """Validate actual finite kernel enforcement, independently of Docker HostConfig."""
    if role not in ('app', 'relay'):
        raise ValueError('unknown cgroup role')
    lines = output.splitlines()
    keys = ('memory.max', 'memory.swap.max', 'pids.max', 'cpu.max')
    if len(lines) != len(keys):
        raise ValueError(role + ' cgroup v2 limit output incomplete')
    values = {}
    for key, line in zip(keys, lines):
        if not line.startswith(key + '='):
            raise ValueError(role + ' cgroup v2 limit field mismatch')
        values[key] = line[len(key) + 1:]
    for key, expected in (('memory.max', 536870912 if role == 'app' else 134217728),
                          ('memory.swap.max', 0), ('pids.max', 96 if role == 'app' else 32)):
        value = values[key]
        if not re.fullmatch(r'[0-9]+', value) or int(value) != expected:
            raise ValueError(role + ' actual cgroup ' + key + ' drift/unlimited')
    cpu = re.fullmatch(r'([0-9]+) ([0-9]+)', values['cpu.max'])
    divisor = 2 if role == 'app' else 10
    if not cpu or int(cpu[1]) <= 0 or int(cpu[2]) <= 0 or int(cpu[1]) * divisor != int(cpu[2]):
        raise ValueError(role + ' actual cgroup cpu.max drift/unlimited')
    return values


def validate(runtime,state,name,port,role='app',package='',volumes=None):
    app=role=='app'
    expected={'memory':536870912 if app else 134217728,'swap':536870912 if app else 134217728,
              'cpu':500000000 if app else 100000000,'pids':96 if app else 32,'readonly':True,
              'privileged':False,'user':'1000:1000','network':name+('-internal' if app else '-ingress'),
              'init':True,'restart':'no'}
    for field,value in expected.items():
        if runtime.get(field)!=value: raise ValueError(role+' runtime '+field+' drift')
    if set(runtime.get('caps') or [])!={'ALL'} or runtime.get('capadd'): raise ValueError('runtime capability drift')
    if not any(value in ('no-new-privileges:true','no-new-privileges') for value in runtime.get('security') or []): raise ValueError('no-new-privileges missing')
    if (runtime.get('ports') or {})!=({} if app else {'8787/tcp':[{'HostIp':'127.0.0.1','HostPort':port}]}): raise ValueError('published port drift')
    if set(runtime.get('networks') or {})!=({name+'-internal'} if app else {name+'-internal',name+'-ingress'}): raise ValueError('attached network drift')
    mounts=runtime.get('mounts',[])
    if app:
        if not volumes or set(volumes)!={'vault','data'}: raise ValueError('verified volume bindings required')
        expected_mounts={'/'+r:(volumes[r]['Name'],volumes[r]['Mountpoint'],True) for r in ('vault','data')}
        actual={m['Destination']:(m.get('Name'),m.get('Source'),m.get('RW')) for m in mounts if m['Type']=='volume'}
        if actual!=expected_mounts or any(m['Type']=='bind' for m in mounts): raise ValueError('app must use only owned Linux volumes')
        if runtime.get('entrypoint')!=['/usr/local/bin/nkustudy-entrypoint'] or runtime.get('cmd') not in (None,[]) or runtime.get('path')!='/usr/local/bin/nkustudy-entrypoint' or runtime.get('args') not in (None,[]): raise ValueError('app fixed startup guard bypassed')
    else:
        actual={m['Destination']:(m.get('Source'),m.get('RW')) for m in mounts if m['Type']=='bind'}
        if actual!={'/relay.mjs':(package+'/relay.mjs',False)} or any(m['Type']=='volume' for m in mounts): raise ValueError('relay cannot mount data or credentials')
        args=['--max-old-space-size=16','/relay.mjs',name]
        if runtime.get('entrypoint')!=['node'] or runtime.get('cmd')!=args or runtime.get('path')!='node' or runtime.get('args')!=args: raise ValueError('relay fixed process drift')
    if any(m['Type'] not in ('volume' if app else 'bind','tmpfs') or (m['Type']=='tmpfs' and m['Destination']!='/tmp') for m in mounts): raise ValueError('unexpected mount')
    temp=runtime.get('tmpfs',{})
    if set(temp)!={'/tmp'} or set(temp['/tmp'].split(','))!={'rw','nosuid','nodev','noexec','size='+('64m' if app else '16m'),'mode=1777'}: raise ValueError('tmpfs drift')


if __name__=='__main__':
    try:
        data=json.load(sys.stdin);validate(data['runtime'],data['state'],data['name'],data['port'],data['role'],data['package'],data['volumes'])
    except (ValueError,KeyError,TypeError,OSError) as error:
        print('ERROR: '+str(error),file=sys.stderr);sys.exit(1)


def validate_proxy_environment(output):
    """Deployment r3: exact proxy trust and automatic HTTPS cookies, no secret input."""
    values = {}
    for line in output.splitlines():
        key, separator, value = line.partition('=')
        if not separator or key not in ('NODE_ENV', 'TRUST_PROXY', 'COOKIE_SECURE') or key in values:
            raise ValueError('proxy environment projection invalid/duplicate')
        values[key] = value
    if values.get('NODE_ENV') != 'production' or values.get('TRUST_PROXY') != '1':
        raise ValueError('production/proxy trust drift; r3 requires TRUST_PROXY=1')
    if values.get('COOKIE_SECURE', 'auto') != 'auto':
        raise ValueError('cookie policy drift; r3 requires automatic HTTPS Secure cookies')
    return values
