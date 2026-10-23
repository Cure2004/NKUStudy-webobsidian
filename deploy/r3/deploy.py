#!/usr/bin/env python3
"""Offline-only, fixture-only app + fixed TCP relay lifecycle."""
import json
import os
import pathlib
import re
import secrets
import socket
import subprocess
import sys
import time
import urllib.request
from manifest import read_manifest, verify, accepted_ids, require
from storage import VolumeStore

LABEL = 'org.nkustudy.4b.instance'
ROLE = 'org.nkustudy.4b.role'
FILTER = ('{"memory":{{.HostConfig.Memory}},"swap":{{.HostConfig.MemorySwap}},'
          '"cpu":{{.HostConfig.NanoCpus}},"pids":{{.HostConfig.PidsLimit}},'
          '"readonly":{{.HostConfig.ReadonlyRootfs}},"privileged":{{.HostConfig.Privileged}},'
          '"user":{{json .Config.User}},"caps":{{json .HostConfig.CapDrop}},'
          '"capadd":{{json .HostConfig.CapAdd}},"security":{{json .HostConfig.SecurityOpt}},'
          '"network":{{json .HostConfig.NetworkMode}},"init":{{json .HostConfig.Init}},'
          '"restart":{{json .HostConfig.RestartPolicy.Name}},"ports":{{json .HostConfig.PortBindings}},'
          '"mounts":{{json .Mounts}},"tmpfs":{{json .HostConfig.Tmpfs}},'
          '"networks":{{json .NetworkSettings.Networks}},"entrypoint":{{json .Config.Entrypoint}},"cmd":{{json .Config.Cmd}},"path":{{json .Path}},"args":{{json .Args}}}')


def docker(*args, optional=False):
    p = subprocess.run(['docker', *args], text=True, capture_output=True, timeout=180)
    if optional and p.returncode:
        # Only a proven missing object is optional; engine/permission/CLI failures are not absence.
        object_name = re.escape(args[-1]) if args else ''
        missing = [r'error: no such (?:object|container|network|image|volume): ' + object_name,
                   r'error response from daemon: no such (?:object|container|network|image|volume): ' + object_name,
                   r'error response from daemon: network ' + object_name + r' not found',
                   r'error response from daemon: get ' + object_name + r': no such volume']
        if args[:2] == ('image', 'inspect') and ':' not in args[-1]:
            missing.append(r'error response from daemon: no such image: ' + object_name + r':latest')
        if p.returncode == 1 and any(re.fullmatch(pattern, p.stderr.strip(), re.IGNORECASE) for pattern in missing):
            return None
        raise ValueError('Docker object absence not proven: ' + ' '.join(args[:2]) +
                         '; exit=' + str(p.returncode) + '; preserve candidate state')
    require(p.returncode == 0, 'Docker command failed: ' + ' '.join(args[:2]) + '; preserve candidate state')
    return p.stdout.strip()


class Instance:
    def __init__(self, package, release, state, name):
        require(re.fullmatch(r'nkustudy-4b-[a-z0-9][a-z0-9-]{0,40}', name), 'invalid instance name')
        self.package, self.release, self.name = package, release, name
        self.relay = name + '-relay'
        self.internal, self.ingress = name + '-internal', name + '-ingress'
        self.port = os.environ.get('NKU_4B_PORT', '28787')
        require(self.port in ('28787', '28788'), 'only reviewed loopback ports 28787/28788 accepted')
        self.state = pathlib.Path(state)
        require(self.state.is_absolute() and str(self.state) != '/' and ',' not in str(self.state) and '\n' not in str(self.state), 'unsafe state path')
        require(not self.state.is_symlink() and self.state.parent.resolve(strict=True) == self.state.parent, 'state path must be canonical without symlinks')
        require(',' not in str(package) and '\n' not in str(package), 'unsafe package path')
        marker = self.state / '.nkustudy-4b-instance'
        if marker.is_file() and not marker.is_symlink():
            fields = marker.read_text().strip().split(' ')
            require(len(fields) == 3 and fields[0] == name and fields[2] == self.port, 'instance state marker mismatch')
            self.image_id = fields[1]
        else:
            self.image_id = docker('image', 'inspect', '--format', '{{.Id}}', release['image_tag'])
        require(self.image_id in accepted_ids(release), 'local image identity is not in verified archive')
        self.store=VolumeStore(self.state,self.name,self.image_id,docker)

    def inspect(self, name, template, optional=False):
        return docker('inspect', '--format', template, name, optional=optional)

    def check_image(self):
        value = docker('image', 'inspect', '--format', '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}} {{index .Config.Labels "org.nkustudy.lock-sha256"}} {{index .Config.Labels "org.nkustudy.source-manifest-sha256"}}', self.image_id)
        require(value == ' '.join([self.image_id, 'linux/amd64', self.release['source_commit'], self.release['lock_sha256'], self.release['source_manifest_sha256']]), 'immutable image/source/lock/build mismatch')

    def check_state(self):
        marker=self.state/'.nkustudy-4b-instance'
        require(marker.is_file() and not marker.is_symlink(),'state marker missing/symlinked')
        require(marker.read_text().strip()==self.name+' '+self.image_id+' '+self.port,'state marker mismatch')
        self.store.check()

    def identity(self,name,role):
        value=self.inspect(name,'{{index .Config.Labels "'+LABEL+'"}} {{index .Config.Labels "'+ROLE+'"}} {{.Image}}')
        require(value==self.name+' '+role+' '+self.image_id,'container identity mismatch')
        mounts=json.loads(self.inspect(name,'{{json .Mounts}}'))
        if role=='app':
            values=self.store.check()
            expected={'/'+r:(values[r]['Name'],values[r]['Mountpoint']) for r in ('vault','data')}
            actual={m['Destination']:(m.get('Name'),m.get('Source')) for m in mounts if m['Type']=='volume'}
            require(actual==expected and not any(m['Type']=='bind' for m in mounts),'app named-volume binding mismatch')
        else:
            actual={m['Destination']:m['Source'] for m in mounts if m['Type']=='bind'}
            require(actual=={'/relay.mjs':str(self.package/'relay.mjs')} and not any(m['Type']=='volume' for m in mounts),'relay mount isolation mismatch')

    def check_runtime(self):
        from validate_runtime import CGROUP_PROBE, validate, validate_cgroup, validate_proxy_environment
        self.check_image(); self.check_state()
        # Project only non-secret policy variables; never capture the full Env.
        projection = '{{range .Config.Env}}{{if or (eq (index (split . "=") 0) "TRUST_PROXY") (eq (index (split . "=") 0) "COOKIE_SECURE") (eq (index (split . "=") 0) "NODE_ENV")}}{{println .}}{{end}}{{end}}'
        validate_proxy_environment(self.inspect(self.name, projection))
        enforcement = {}
        for name, role in ((self.name, 'app'), (self.relay, 'relay')):
            self.identity(name, role)
            validate(json.loads(self.inspect(name, FILTER)), str(self.state), self.name, self.port, role, str(self.package), self.store.check())
            running = self.inspect(name, '{{.State.Running}}')
            require(running in ('true', 'false'), 'container running state unavailable')
            if running == 'true':
                limits = validate_cgroup(docker('exec', name, 'sh', '-eu', '-c', CGROUP_PROBE), role)
                enforcement[role] = {'status': 'VERIFIED', 'cgroup_version': 2, 'limits': limits}
            else:
                # Stopped cgroups may not exist. This is metadata-only, never enforcement PASS.
                enforcement[role] = {'status': 'NOT-AVAILABLE', 'reason': 'container stopped; metadata checked only'}
        for network, internal in ((self.internal, 'true'), (self.ingress, 'false')):
            result = docker('network', 'inspect', '--format', '{{.Internal}} {{index .Labels "' + LABEL + '"}}', network)
            require(result == internal + ' ' + self.name, 'network ownership/isolation mismatch')
        return enforcement

    def require_enforcement(self):
        enforcement = self.check_runtime()
        require(all(enforcement[role]['status'] == 'VERIFIED' for role in ('app', 'relay')),
                'both running containers require actual cgroup v2 enforcement')
        return enforcement

    def ensure_absent(self):
        for name in (self.name, self.relay):
            require(docker('inspect', name, optional=True) is None, 'candidate container already exists')
        for network in (self.internal, self.ingress):
            require(docker('network', 'inspect', network, optional=True) is None, 'candidate network already exists')

    def init(self):
        require(not self.state.exists(),'state generation already exists; preserve it')
        self.check_image();self.ensure_absent();self.store.ensure_absent()
        self.state.mkdir(mode=0o700)
        (self.state/'.nkustudy-4b-instance').write_text(self.name+' '+self.image_id+' '+self.port+'\n')
        (self.state/'setup.env').write_text('WEBOBSIDIAN_SETUP_TOKEN='+secrets.token_hex(32)+'\n')
        (self.state/'setup.env').chmod(0o600)
        self.store.create();self.store.initialize()
        print('PASS: new labelled Linux volumes and restricted local credentials created; volumes retained on cleanup')

    def auth_arguments(self):
        setup = self.state / 'setup.env'
        require(not setup.is_symlink(), 'setup.env symlink forbidden')
        if setup.exists():
            require(setup.is_file() and setup.stat().st_mode & 0o777 == 0o600, 'setup.env must be regular mode 0600')
            require(re.fullmatch(r'WEBOBSIDIAN_SETUP_TOKEN=[0-9a-f]{64}\n', setup.read_text()), 'invalid setup env')
            return ['--env-file', str(setup)]
        meta = self.state / '.nkustudy-4b-restore.json'
        settings = None
        require(meta.is_file() and not meta.is_symlink(), 'restore metadata and persisted settings required')
        m = json.loads(meta.read_text())
        require(m.get('format') == 2 and m.get('image_id') == self.image_id and m.get('instance') == self.name and m.get('port') == self.port, 'restore binding mismatch')
        self.store.password_ready()
        return []

    def common(self, name, role):
        return ['run', '--detach', '--pull', 'never', '--platform', 'linux/amd64', '--name', name,
                '--label', LABEL + '=' + self.name, '--label', ROLE + '=' + role,
                '--init', '--restart', 'no', '--user', '1000:1000', '--read-only', '--cap-drop', 'ALL',
                '--security-opt', 'no-new-privileges:true', '--stop-timeout', ('30' if role == 'app' else '10'),
                '--log-driver', 'json-file', '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3']

    def stop_owned(self):
        # Stop must remain available if runtime resources drift: identity + exact mounts are sufficient.
        for name, role in ((self.relay, 'relay'), (self.name, 'app')):
            if docker('inspect', name, optional=True) is not None:
                self.identity(name, role)
                docker('stop', '--time', '10' if role == 'relay' else '30', name)

    def wait_health(self):
        self.require_enforcement()
        deadline=time.monotonic()+240
        while time.monotonic()<deadline:
            states = [self.inspect(name, '{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')
                      for name in (self.name, self.relay)]
            require(all(value.startswith('true ') for value in states), 'candidate app/relay exited')
            if all(value == 'true healthy' for value in states):
                p = subprocess.run(['curl', '--fail', '--silent', '--max-time', '2',
                                    'http://127.0.0.1:' + self.port + '/healthz'], capture_output=True, timeout=5)
                if p.returncode == 0:
                    self.require_enforcement()
                    print('PASS: named app/relay healthy; loopback HTTP ready; functional acceptance still required')
                    return
            time.sleep(1)
        raise ValueError('candidate readiness timed out')

    def start(self):
        self.check_image(); self.check_state(); self.ensure_absent()
        auth = self.auth_arguments()
        with socket.socket() as probe: probe.bind(('127.0.0.1', int(self.port)))
        docker('network', 'create', '--internal', '--label', LABEL + '=' + self.name, self.internal)
        docker('network', 'create', '--label', LABEL + '=' + self.name, self.ingress)
        try:
            docker(*(self.common(self.name, 'app') + ['--network', self.internal,
                     '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777',
                     '--memory', '512m', '--memory-reservation', '256m', '--memory-swap', '512m', '--cpus', '0.50', '--pids-limit', '96'] + auth +
                     ['--env', 'NODE_ENV=production', '--env', 'PORT=8787', '--env', 'HOST=0.0.0.0',
                      '--env', 'DATA_DIR=/data', '--env', 'VAULT_PATH=/vault', '--env', 'ALLOWED_ROOTS=/vault',
                      '--env', 'TRUST_PROXY=1', '--env', 'HOME=/tmp', '--env', 'NODE_OPTIONS=--max-old-space-size=256',
                      '--env', 'WEBOBSIDIAN_WATCH=auto'] + self.store.mounts() + [self.image_id]))
            relay_args = self.common(self.relay, 'relay'); relay_args[0] = 'create'; relay_args.remove('--detach')
            docker(*(relay_args + ['--network', self.ingress, '--publish', '127.0.0.1:' + self.port + ':8787',
                     '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777',
                     '--memory', '128m', '--memory-swap', '128m', '--cpus', '0.10', '--pids-limit', '32',
                     '--mount', 'type=bind,source=' + str(self.package / 'relay.mjs') + ',target=/relay.mjs,readonly',
                     '--entrypoint', 'node', self.image_id, '--max-old-space-size=16', '/relay.mjs', self.name]))
            docker('network', 'connect', self.internal, self.relay)
            docker('start', self.relay)
            self.wait_health()
        except Exception:
            self.stop_owned()
            raise

    def resume(self):
        self.check_runtime()
        require(all(self.inspect(name, '{{.State.Running}}') == 'false' for name in (self.name, self.relay)), 'both candidate containers must be stopped')
        try:
            docker('start', self.name); docker('start', self.relay); self.wait_health()
        except Exception:
            self.stop_owned(); raise

    def status(self):
        enforcement = self.check_runtime()
        for name, role in ((self.name, 'app'), (self.relay, 'relay')):
            print(name + ': ' + self.inspect(name, 'image={{.Image}} running={{.State.Running}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}'))
            print('actual-cgroup-enforcement=' + json.dumps(enforcement[role], sort_keys=True))
            print(docker('stats', '--no-stream', '--format', 'memory={{.MemUsage}} cpu={{.CPUPerc}} pids={{.PIDs}}', name))

    def cleanup(self):
        self.check_state()
        for name, role in ((self.relay, 'relay'), (self.name, 'app')):
            if docker('inspect', name, optional=True) is not None:
                self.identity(name, role)
                require(self.inspect(name, '{{.State.Running}}') == 'false', 'stop candidate before cleanup')
        for network in (self.ingress, self.internal):
            if docker('network', 'inspect', network, optional=True) is not None:
                require(docker('network', 'inspect', '--format', '{{index .Labels "' + LABEL + '"}}', network) == self.name, 'foreign network')
        for name in (self.relay, self.name):
            if docker('inspect', name, optional=True) is not None: docker('rm', name)
        for network in (self.ingress, self.internal):
            if docker('network', 'inspect', network, optional=True) is not None: docker('network', 'rm', network)
        print('PASS: own stopped app/relay and two networks removed; labelled volumes, state and credentials retained')


def main():
    os.umask(0o077)
    arguments=sys.argv[1:];local_candidate=bool(arguments and arguments[0]=='--local-candidate')
    if local_candidate: arguments=arguments[1:]
    command, package_arg, *args = arguments
    package, release = read_manifest(package_arg)
    if release.get('kind')=='local-candidate':
        require(local_candidate,'local candidate requires explicit --local-candidate; not a server deployment package')
        require(docker('info','--format','{{.ID}}')==release['local_engine_id'] and docker('context','show')==release['local_docker_context'],'local candidate belongs to another Docker engine/context')
    else: require(not local_candidate,'--local-candidate cannot be used with an archived release')
    if release.get('kind')=='release' and command in ('init','start','resume'):
        verify(package,release)  # A transfer manifest alone is not proof that its offline image was validated.
    if command == 'verify':
        require(not args, 'wrong argument count'); verify(package, release)
        print('PASS: verified archive, source/build/relay inputs and exact OCI/classic identities'); return
    if command == 'load':
        require(not args, 'wrong argument count'); verify(package, release)
        old = docker('image', 'inspect', '--format', '{{.Id}}', release['image_tag'], optional=True)
        require(old is None or old in accepted_ids(release), 'candidate tag already points to another image; preserve it')
        docker('load', '--input', str(package / release['archive']))
        actual = docker('image', 'inspect', '--format', '{{.Id}}', release['image_tag'])
        require(actual in accepted_ids(release), 'post-load image ID is outside verified identities')
        print('PASS: loaded reviewed image; immutable local ID=' + actual); return
    require(command in ('init', 'start', 'resume', 'status', 'stop', 'cleanup') and len(args) == 2, 'invalid lifecycle command or arguments')
    if command in ('init', 'start', 'resume'):
        version = docker('version', '--format', '{{.Server.Version}}')
        require(re.match(r'^\d+\.', version) and int(version.split('.')[0]) >= 28,
                'Docker Engine 28+ required for reviewed loopback publishing; preserve current services')
    require(release.get('format')==2 and release.get('storage')=='docker-named-volumes','r1 bind deployment is blocked; only r2 named volumes accepted')
    instance = Instance(package, release, *args)
    if command == 'stop':
        instance.check_state(); instance.stop_owned(); print('PASS: own app/relay stopped; state retained')
    else: getattr(instance, command)()


if __name__ == '__main__':
    try: main()
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
        print('ERROR: ' + str(error), file=sys.stderr)
        sys.exit(1)
