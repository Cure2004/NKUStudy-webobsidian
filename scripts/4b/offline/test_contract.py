#!/usr/bin/env python3
"""Saved synthetic input tests. Mock CLI results are not container evidence."""
import copy
import hashlib
import io
import json
import os
import pathlib
import subprocess
import tarfile
import tempfile
import time
import unittest

HERE = pathlib.Path(__file__).resolve().parent
EVIDENCE = pathlib.Path(os.environ.get('NKU_4B_CONTRACT_EVIDENCE_DIR',
                                      str(HERE.parents[2] / 'docs/nkustudy/4b-preflight/evidence/offline'))).resolve()
SOURCE = 'cb3a96e8546844416258c1af64549724685eeb04'
CODE = '1bd3f6c088466c8b46b447c9516cec623bc194f6'
LOCK = '671963de571dfc611e7f370482640455928bde108ed0e7c9383fd633f090d7ed'
TAG = 'nkustudy/webobsidian:4b-contract-fixture'
DOCKERFILE = b'# isolated synthetic Dockerfile input\n'
RELAY = b'// synthetic fixed relay fixture\n'
SOURCE_MANIFEST_RAW = json.dumps({'source_commit': SOURCE, 'code_commit': CODE, 'files': [{'path': 'Dockerfile', 'sha256': hashlib.sha256(DOCKERFILE).hexdigest()}]}, sort_keys=True).encode()
SOURCE_MANIFEST = hashlib.sha256(SOURCE_MANIFEST_RAW).hexdigest()
CONFIG = {'os': 'linux', 'architecture': 'amd64', 'config': {'Labels': {
    'org.opencontainers.image.revision': SOURCE, 'org.nkustudy.lock-sha256': LOCK,
    'org.nkustudy.source-manifest-sha256': SOURCE_MANIFEST}}, 'rootfs': {'type': 'layers', 'diff_ids': []}}

MOCK = r'''#!/usr/bin/env python3
import json,os,pathlib,sys
p=pathlib.Path(os.environ['MOCK_DB']); db=json.loads(p.read_text());args=sys.argv[1:]
with open(os.environ['MOCK_LOG'],'a') as f: f.write(json.dumps(args)+'\n')
def done(value=None,code=0,err=None):
 p.write_text(json.dumps(db))
 if value is not None: print(value)
 if err is not None: print(err,file=sys.stderr)
 sys.exit(code)
failure=db.get('cli_failure')
if failure and args[:len(failure['prefix'])]==failure['prefix']: done(code=failure.get('exit',1),err=failure['stderr'])
name=args[-1] if args else ''
role='app' if name==db['name'] else 'relay'
containers=db.setdefault('containers',{}); networks=db.setdefault('networks',{})
def exists(n): return n in containers or (n==db['name'] and db.get('container',False))
def running(n): return containers.get(n,{}).get('running',db.get('running',False) if n==db['name'] else False)
def mounts(n):
 if n==db['name']: return [{'Type':'bind','Destination':dest,'Source':db['state']+dest,'RW':True} for dest in ['/vault','/data']]
 return [{'Type':'bind','Destination':'/relay.mjs','Source':db['package']+'/relay.mjs','RW':False}]
if args[:2]==['image','inspect']:
 if not db.get('image',True): done(code=1,err='Error response from daemon: No such image: '+name)
 fmt=args[args.index('--format')+1]
 if fmt=='{{.Id}}': done(db['id'])
 if 'org.opencontainers.image.revision' in fmt: done(db['id']+' linux/amd64 '+db['source']+' '+db['lock']+' '+db['source_manifest'])
 done(db['id']+' linux/amd64')
if args[:1]==['load']:
 if db.get('fail_load'): done(code=1)
 db['image']=True; done('Loaded fixture')
if args[:1]==['version']: done(db.get('engine','29.7.2'))
if args[:2]==['network','inspect']:
 if name not in networks and not db.get('network',False): done(code=1,err='Error response from daemon: network '+name+' not found')
 if '--format' in args:
  fmt=args[args.index('--format')+1]
  done((('true' if name.endswith('-internal') else 'false')+' ' if '.Internal' in fmt else '')+db.get('network_owner',db['name']))
 done('{}')
if args[:2]==['network','create']: networks[name]=True; db['network']=True; done('mock-network')
if args[:2]==['network','connect']: done('connected')
if args[:2]==['network','rm']: networks.pop(name,None); db['network']=bool(networks); done('removed')
if args[:1]==['inspect']:
 if not exists(name): done(code=1,err='error: no such object: '+name)
 if '--format' not in args: done('{}')
 fmt=args[args.index('--format')+1]
 if 'org.nkustudy.4b.instance' in fmt: done(db.get('owner',db['name'])+' '+role+' '+db['id'] if 'org.nkustudy.4b.role' in fmt else db.get('owner',db['name'])+' '+db['id'])
 if fmt=='{{json .Mounts}}': done(json.dumps(mounts(name)))
 if 'Destination "/vault"' in fmt: done(db['state']+'/vault')
 if 'Destination "/data"' in fmt: done(db['state']+'/data')
 if '.State.Health' in fmt: done(str(running(name)).lower()+' healthy')
 if '.State.Running'==fmt.strip('{}'): done(str(running(name)).lower())
 if fmt.startswith('{"memory"'):
  app=role=='app';size=536870912 if app else 134217728
  runtime={'memory':size,'swap':size,'cpu':500000000 if app else 100000000,'pids':96 if app else 32,'readonly':True,'privileged':False,'user':'1000:1000','caps':['ALL'],'capadd':None,'security':['no-new-privileges:true'],'network':db['name']+('-internal' if app else '-ingress'),'init':True,'restart':'no','ports':{} if app else {'8787/tcp':[{'HostIp':'127.0.0.1','HostPort':os.environ.get('NKU_4B_PORT','28787')}]},'mounts':mounts(name),'tmpfs':{'/tmp':'rw,nosuid,nodev,noexec,size='+('64m' if app else '16m')+',mode=1777'},'networks':{n:{} for n in ([db['name']+'-internal'] if app else [db['name']+'-internal',db['name']+'-ingress'])},'entrypoint':['node'],'cmd':['--max-old-space-size=16','/relay.mjs',db['name']]}
  runtime.update(db.get('runtime_drift',{})); done(json.dumps(runtime))
 done('fixture status')
if args[:1] in (['run'],['create']):
 if '--name' not in args: done('ownership helper mocked')
 name=args[args.index('--name')+1]
 if db.get('fail_run'): done(code=1)
 containers[name]={'running':args[0]=='run' and not db.get('exit_early',False)}
 if name==db['name']: db['container']=True;db['running']=containers[name]['running']
 done('mock-container')
if args[:1]==['stop']:
 if name in containers: containers[name]['running']=False
 if name==db['name']:db['running']=False
 done('stopped')
if args[:1]==['start']:
 containers.setdefault(name,{})['running']=True
 if name==db['name']:db['running']=True
 done('started')
if args[:1]==['rm']:
 containers.pop(name,None)
 if name==db['name']:db['container']=False
 done('removed')
if args[:1]==['stats']: done('fixture stats')
done(code=88)
'''


class ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='nkustudy-4b-offline-contract-')
        cls.base = pathlib.Path(cls.temp.name).resolve()
        cls.package = cls.base / 'package'
        cls.package.mkdir()
        (cls.package / 'Dockerfile').write_bytes(DOCKERFILE)
        (cls.package / 'source-manifest.json').write_bytes(SOURCE_MANIFEST_RAW)
        (cls.package / 'relay.mjs').write_bytes(RELAY)
        raw = json.dumps(CONFIG, sort_keys=True).encode()
        cls.image_id = 'sha256:' + hashlib.sha256(raw).hexdigest()
        archive = cls.package / 'fixture.tar'
        with tarfile.open(archive, 'w') as tar:
            for name, data in [('config.json', raw), ('manifest.json', json.dumps([
                    {'Config': 'config.json', 'RepoTags': [TAG], 'Layers': []}]).encode())]:
                item = tarfile.TarInfo(name)
                item.size = len(data)
                tar.addfile(item, io.BytesIO(data))
        cls.manifest = {'format': 1, 'image_tag': TAG, 'image_id': cls.image_id, 'image_config_digest': cls.image_id,
                        'image_manifest_digest': None, 'image_index_digest': None, 'os': 'linux',
                        'architecture': 'amd64', 'source_commit': SOURCE,
                        'document_commit': 'cb3a96e8546844416258c1af64549724685eeb04', 'code_commit': CODE,
                        'lock_sha256': LOCK, 'build_config_sha256': hashlib.sha256(DOCKERFILE).hexdigest(),
                        'source_manifest_sha256': SOURCE_MANIFEST, 'relay_sha256': hashlib.sha256(RELAY).hexdigest(),
                        'archive': archive.name, 'archive_sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}
        bindir = cls.base / 'bin'
        bindir.mkdir()
        (bindir / 'docker').write_text(MOCK)
        (bindir / 'curl').write_text('#!/bin/sh\n[ "${MOCK_CURL_FAIL:-0}" = 0 ]\n')
        for p in bindir.iterdir(): p.chmod(0o755)
        cls.records = []
        cls.env = dict(os.environ, PATH=str(bindir) + os.pathsep + os.environ['PATH'])
        cls.env.update(MOCK_DB=str(cls.base / 'docker-db.json'), MOCK_LOG=str(cls.base / 'docker-argv.jsonl'))
        EVIDENCE.mkdir(parents=True, exist_ok=True)
        (EVIDENCE / 'synthetic-release.json').write_text(json.dumps(cls.manifest, indent=2) + '\n')
        (EVIDENCE / 'synthetic-config.json').write_text(json.dumps(CONFIG, indent=2) + '\n')

    @classmethod
    def tearDownClass(cls):
        (EVIDENCE / 'contract-command-results.json').write_text(json.dumps(cls.records, indent=2) + '\n')
        cls.temp.cleanup()

    def setUp(self):
        self.package.joinpath('release.json').write_text(json.dumps(self.manifest))
        self.package.joinpath('Dockerfile').write_bytes(DOCKERFILE)
        self.package.joinpath('relay.mjs').write_bytes(RELAY)
        self.state = self.base / ('state-' + self._testMethodName)
        self.name = 'nkustudy-4b-contract'
        self.db = {'id': self.image_id, 'source': SOURCE, 'lock': LOCK, 'source_manifest': SOURCE_MANIFEST, 'name': self.name, 'state': str(self.state), 'package': str(self.package)}
        self.save_db()
        pathlib.Path(self.env['MOCK_LOG']).write_text('')

    def save_db(self): pathlib.Path(self.env['MOCK_DB']).write_text(json.dumps(self.db))

    def invoke(self, command, expected=0, env=None, state=None, name=None):
        args = ['bash', str(HERE / 'offline.sh'), command, str(self.package)]
        if command not in ('verify', 'load'):
            # A pure CLI contract test must not bind/check the concurrently used real test port.
            args = ['python3', '-c', 'import runpy,socket,sys;from unittest.mock import patch; p=sys.argv.pop(1);sys.path.insert(0,str(__import__("pathlib").Path(p).parent));sys.argv[0]=p\nwith patch("socket.socket"):\n runpy.run_path(p,run_name="__main__")',
                    str(HERE / 'deploy.py'), command, str(self.package), str(state or self.state), name or self.name]
        process = subprocess.run(args, env=env or self.env, capture_output=True, text=True, timeout=45)
        self.records.append({'case': self._testMethodName, 'command': command, 'exit_code': process.returncode,
                             'output': process.stdout.strip(), 'error': process.stderr.strip(), 'evidence_class': 'synthetic-mock'})
        if expected == 0: self.assertEqual(process.returncode, 0, process.stderr)
        else: self.assertNotEqual(process.returncode, 0)
        return process

    def test_01_verify_archive(self): self.invoke('verify')

    def test_02_reject_hash_mismatch(self):
        m = dict(self.manifest, archive_sha256='0' * 64)
        self.package.joinpath('release.json').write_text(json.dumps(m))
        self.invoke('load', 1)
        self.assertEqual(pathlib.Path(self.env['MOCK_LOG']).read_text(), '')

    def test_03_reject_wrong_arch(self):
        self.package.joinpath('release.json').write_text(json.dumps(dict(self.manifest, architecture='arm64')))
        self.invoke('verify', 1)

    def test_04_reject_original_tag(self):
        self.package.joinpath('release.json').write_text(json.dumps(dict(self.manifest, image_tag='nkustudy/webobsidian:test')))
        self.invoke('load', 1)

    def test_05_reject_source_mismatch(self):
        self.package.joinpath('release.json').write_text(json.dumps(dict(self.manifest, source_commit='0' * 40)))
        self.invoke('verify', 1)

    def test_06_load_failure(self):
        self.db['fail_load'] = True; self.save_db()
        self.invoke('load', 1)

    def test_07_preserve_existing_tag(self):
        self.db['id'] = 'sha256:' + 'b' * 64; self.save_db()
        self.invoke('load', 1)
        self.assertNotIn('["load"', pathlib.Path(self.env['MOCK_LOG']).read_text())

    def test_08_init_reject_existing_state(self):
        self.state.mkdir(); self.state.joinpath('retained').write_text('unchanged')
        self.invoke('init', 1)
        self.assertEqual(self.state.joinpath('retained').read_text(), 'unchanged')

    def test_09_reject_symlink_state(self):
        self.state.symlink_to(self.package, target_is_directory=True)
        self.invoke('init', 1)

    def test_10_lifecycle_and_safe_flags(self):
        for command in ('load', 'init', 'start', 'status', 'stop', 'resume', 'stop', 'cleanup'): self.invoke(command)
        self.assertTrue(self.state.joinpath('vault/4b-sentinel.md').exists())
        self.assertTrue(self.state.joinpath('data').exists())
        self.assertEqual(self.state.joinpath('setup.env').stat().st_mode & 0o777, 0o600)
        log = [json.loads(x) for x in pathlib.Path(self.env['MOCK_LOG']).read_text().splitlines()]
        run = next(x for x in log if x[0] == 'run' and '--detach' in x)
        for expected in ('1000:1000', '512m', '0.50', '96', '--read-only', '--pull', 'never', '--init'):
            self.assertIn(expected, run)
        self.assertEqual(run[run.index('--memory') + 1], run[run.index('--memory-swap') + 1])
        relay = next(x for x in log if x[0] == 'create')
        self.assertIn('127.0.0.1:28787:8787', relay); self.assertIn('128m', relay)
        self.assertNotIn('--env-file', relay); self.assertNotIn(str(self.state / 'data'), ' '.join(relay))
        self.assertIn('--internal', next(x for x in log if x[:2] == ['network', 'create']))
        self.assertFalse(any(x[0] in ('build', 'pull', 'push') for x in log))
        token = self.state.joinpath('setup.env').read_text().strip().split('=', 1)[1]
        self.assertNotIn(token, json.dumps(self.records))

    def test_11_start_failure_preserves_state(self):
        self.invoke('init'); self.db.update(fail_run=True); self.save_db()
        self.invoke('start', 1)
        self.assertTrue(self.state.joinpath('setup.env').exists())
        self.assertTrue(json.loads(pathlib.Path(self.env['MOCK_DB']).read_text())['network'])

    def test_12_reject_insecure_env(self):
        self.invoke('init'); self.state.joinpath('setup.env').chmod(0o644)
        self.invoke('start', 1)

    def test_13_cleanup_refuses_foreign_container(self):
        self.invoke('init'); self.db.update(container=True, owner='foreign', network=True); self.save_db()
        self.invoke('cleanup', 1)
        self.assertTrue(json.loads(pathlib.Path(self.env['MOCK_DB']).read_text())['container'])

    def test_14_cleanup_refuses_running(self):
        self.invoke('init'); self.invoke('start'); self.invoke('cleanup', 1)

    def test_15_unhealthy_exit_is_failure(self):
        self.invoke('init'); self.db['exit_early'] = True; self.save_db()
        self.invoke('start', 1, env=dict(self.env, MOCK_CURL_FAIL='1'))

    def test_16_reject_other_instance_name(self): self.invoke('init', 1, name='webobsidian')

    def test_17_reject_image_id_not_matching_tar(self):
        self.package.joinpath('release.json').write_text(json.dumps(dict(self.manifest, image_id='sha256:' + 'b' * 64)))
        self.invoke('verify', 1)

    def test_18_reject_lock_mismatch(self):
        self.package.joinpath('release.json').write_text(json.dumps(dict(self.manifest, lock_sha256='c' * 64)))
        self.invoke('verify', 1)

    def test_19_local_alternate_port_and_marker(self):
        env = dict(self.env, NKU_4B_PORT='28788')
        self.invoke('init', env=env); self.invoke('start', env=env)
        log = [json.loads(x) for x in pathlib.Path(self.env['MOCK_LOG']).read_text().splitlines()]
        self.assertIn('127.0.0.1:28788:8787', next(x for x in log if x[0] == 'create'))
        self.invoke('stop', 1)
        self.invoke('stop', env=env); self.invoke('cleanup', env=env)

    def test_20_reject_unreviewed_port(self):
        self.invoke('init', 1, env=dict(self.env, NKU_4B_PORT='8787'))

    def test_21_reject_dockerfile_hash_mismatch(self):
        self.package.joinpath('Dockerfile').write_bytes(b'# changed after review\n')
        self.invoke('load', 1)
        self.assertEqual(pathlib.Path(self.env['MOCK_LOG']).read_text(), '')

    def test_22_reject_source_manifest_label_mismatch(self):
        self.package.joinpath('release.json').write_text(json.dumps(dict(self.manifest, source_manifest_sha256='e' * 64)))
        self.invoke('load', 1)
        self.assertEqual(pathlib.Path(self.env['MOCK_LOG']).read_text(), '')

    def test_23_refuse_resource_drift_before_resume(self):
        self.invoke('init'); self.invoke('start'); self.invoke('stop')
        db = json.loads(pathlib.Path(self.env['MOCK_DB']).read_text())
        db['runtime_drift'] = {'memory': 0}; pathlib.Path(self.env['MOCK_DB']).write_text(json.dumps(db))
        self.invoke('resume', 1); self.invoke('status', 1)
        log = [json.loads(x) for x in pathlib.Path(self.env['MOCK_LOG']).read_text().splitlines()]
        self.assertFalse(any(x[0] == 'start' and x[-1] == self.name for x in log))
        self.assertFalse(json.loads(pathlib.Path(self.env['MOCK_DB']).read_text())['running'])

    def test_24_runtime_negative_inputs(self):
        base = {'memory': 536870912, 'swap': 536870912, 'cpu': 500000000, 'pids': 96,
                'readonly': True, 'privileged': False, 'user': '1000:1000', 'caps': ['ALL'], 'capadd': None,
                'security': ['no-new-privileges:true'], 'network': self.name + '-internal', 'init': True,
                'restart': 'no', 'ports': {}, 'networks': {self.name + '-internal': {}},
                'mounts': [{'Type': 'bind', 'Destination': dest, 'Source': str(self.state) + dest, 'RW': True}
                           for dest in ['/vault', '/data']],
                'tmpfs': {'/tmp': 'rw,nosuid,nodev,noexec,size=64m,mode=1777'}}
        changes = [('valid', {}), ('memory_unlimited', {'memory': 0}), ('swap_unlimited', {'swap': -1}),
                   ('cpu_unlimited', {'cpu': 0}), ('pids_unlimited', {'pids': 0}),
                   ('root_user', {'user': '0:0'}), ('writable_root', {'readonly': False}),
                   ('privileged', {'privileged': True}), ('cap_add', {'capadd': ['SYS_ADMIN']}),
                   ('no_cap_drop', {'caps': []}), ('new_privileges', {'security': []}),
                   ('host_network', {'network': 'host'}), ('restart_always', {'restart': 'always'}),
                   ('public_port', {'ports': {'8787/tcp': [{'HostIp': '0.0.0.0', 'HostPort': '28787'}]}}),
                   ('extra_mount', {'mounts': base['mounts'] + [{'Type': 'bind', 'Destination': '/host', 'Source': '/', 'RW': True}]}),
                   ('unlimited_tmpfs', {'tmpfs': {'/tmp': 'rw'}})]
        evidence = []
        for label, patch in changes:
            value = copy.deepcopy(base); value.update(patch)
            process = subprocess.run(['python3', str(HERE / 'validate_runtime.py'), str(self.state), self.name, '28787'],
                                     input=json.dumps(value), capture_output=True, text=True, timeout=10)
            evidence.append({'case': label, 'input': value, 'exit_code': process.returncode,
                             'stderr': process.stderr.strip(), 'evidence_class': 'synthetic-input'})
            self.assertEqual(process.returncode == 0, label == 'valid', label)
        (EVIDENCE / 'runtime-negative-inputs.json').write_text(json.dumps(evidence, indent=2) + '\n')

    def test_25_http_200_cannot_mask_exited_container(self):
        self.invoke('init'); self.db['exit_early'] = True; self.save_db()
        self.invoke('start', 1)  # Mock curl would return success; named container is stopped.

    def snapshot_invoke(self, args, success=True):
        process = subprocess.run(['python3', str(HERE / 'snapshot.py'), *args], env=self.env,
                                 capture_output=True, text=True, timeout=45)
        self.records.append({'case': self._testMethodName, 'command': ['snapshot.py', *args[:1]],
                             'exit_code': process.returncode, 'output': process.stdout.strip(),
                             'error': process.stderr.strip(), 'evidence_class': 'synthetic-mock'})
        self.assertEqual(process.returncode == 0, success, process.stderr)
        return process

    def setup_snapshot(self):
        self.invoke('init')
        self.state.joinpath('data/settings.json').write_text(json.dumps({'auth': {'userPasswordHash': 'synthetic-hash-not-a-real-credential'}}))
        self.db.update(container=True, running=False, network=True); self.save_db()
        snapshots = self.base / 'snapshots'; snapshots.mkdir(mode=0o700, exist_ok=True)
        return snapshots / (self._testMethodName + '.tar')

    def test_26_snapshot_and_restore_new_generation(self):
        snapshot = self.setup_snapshot()
        self.snapshot_invoke(['backup', str(self.package), str(self.state), self.name, str(snapshot)])
        digest = hashlib.sha256(snapshot.read_bytes()).hexdigest()
        target = self.base / 'restored-26'
        self.snapshot_invoke(['restore', str(self.package), str(snapshot), digest, str(target), 'nkustudy-4b-restored'])
        self.assertEqual(target.joinpath('vault/4b-sentinel.md').read_bytes(), self.state.joinpath('vault/4b-sentinel.md').read_bytes())
        self.assertEqual(target.joinpath('data/settings.json').read_bytes(), self.state.joinpath('data/settings.json').read_bytes())
        self.assertFalse(target.joinpath('setup.env').exists())
        self.assertTrue(target.joinpath('.nkustudy-4b-restore.json').exists())
        self.assertEqual(snapshot.stat().st_mode & 0o777, 0o600)
        self.assertEqual(target.stat().st_mode & 0o777, 0o700)
        (EVIDENCE / 'snapshot-synthetic.tar').write_bytes(snapshot.read_bytes())
        (EVIDENCE / 'snapshot-synthetic.tar').chmod(0o600)
        (EVIDENCE / 'snapshot-synthetic.sha256').write_text(digest + '  snapshot-synthetic.tar\n')

    def test_27_snapshot_refuses_running(self):
        snapshot = self.setup_snapshot(); self.db['running'] = True; self.save_db()
        self.snapshot_invoke(['backup', str(self.package), str(self.state), self.name, str(snapshot)], False)
        self.assertFalse(snapshot.exists())

    def test_28_restore_preserves_existing_target(self):
        snapshot = self.setup_snapshot()
        self.snapshot_invoke(['backup', str(self.package), str(self.state), self.name, str(snapshot)])
        digest = hashlib.sha256(snapshot.read_bytes()).hexdigest()
        self.snapshot_invoke(['restore', str(self.package), str(snapshot), digest, str(self.state), self.name], False)
        self.assertTrue(self.state.joinpath('setup.env').exists())

    def test_29_snapshot_refuses_symlink(self):
        snapshot = self.setup_snapshot()
        self.state.joinpath('vault/link.md').symlink_to(self.state / 'vault/4b-sentinel.md')
        self.snapshot_invoke(['backup', str(self.package), str(self.state), self.name, str(snapshot)], False)
        self.assertFalse(snapshot.exists())
        self.assertTrue(self.state.joinpath('vault/link.md').is_symlink())

    def test_30_restore_refuses_bad_hash(self):
        snapshot = self.setup_snapshot()
        self.snapshot_invoke(['backup', str(self.package), str(self.state), self.name, str(snapshot)])
        target = self.base / 'restored-bad-hash'
        self.snapshot_invoke(['restore', str(self.package), str(snapshot), '0' * 64, str(target), self.name], False)
        self.assertFalse(target.exists())

    def test_31_restore_refuses_path_traversal_and_links(self):
        snapshot = self.setup_snapshot()
        for kind in ('traversal', 'symlink'):
            bad = snapshot.with_name(kind + '.tar')
            with tarfile.open(bad, 'w') as tar:
                for folder in ('vault', 'data'):
                    item = tarfile.TarInfo(folder); item.type = tarfile.DIRTYPE; tar.addfile(item)
                raw = (self.name + ' ' + self.image_id + ' 28787\n').encode()
                item = tarfile.TarInfo('.nkustudy-4b-instance'); item.size = len(raw); tar.addfile(item, io.BytesIO(raw))
                item = tarfile.TarInfo('../outside' if kind == 'traversal' else 'vault/link')
                if kind == 'symlink': item.type = tarfile.SYMTYPE; item.linkname = '/etc/passwd'
                tar.addfile(item)
            bad.chmod(0o600); target = self.base / ('restored-bad-' + kind)
            sha = hashlib.sha256(bad.read_bytes()).hexdigest()
            self.snapshot_invoke(['restore', str(self.package), str(bad), sha, str(target), self.name], False)
            self.assertFalse(target.exists())
            (EVIDENCE / ('snapshot-negative-' + kind + '.tar')).write_bytes(bad.read_bytes())

    def test_32_no_setup_env_requires_restore_metadata(self):
        self.invoke('init'); self.state.joinpath('setup.env').unlink()
        self.invoke('start', 1)

    def test_33_old_engine_refused_before_state_creation(self):
        self.db['engine'] = '27.5.0'; self.save_db()
        self.invoke('init', 1)
        self.assertFalse(self.state.exists())

    def test_34_relay_hash_mismatch_refused(self):
        self.package.joinpath('relay.mjs').write_bytes(b'// modified relay\n')
        self.invoke('load', 1)
        self.assertEqual(pathlib.Path(self.env['MOCK_LOG']).read_text(), '')

    def optional_error(self, action, prefix, message, exit_code=1):
        self.invoke('init')
        before = {str(p.relative_to(self.state)): hashlib.sha256(p.read_bytes()).hexdigest() for p in self.state.rglob('*') if p.is_file()}
        self.db['cli_failure'] = {'prefix': prefix, 'stderr': message, 'exit': exit_code}; self.save_db()
        result = self.invoke(action, 1)
        self.assertNotIn('PASS:', result.stdout)
        after = {str(p.relative_to(self.state)): hashlib.sha256(p.read_bytes()).hexdigest() for p in self.state.rglob('*') if p.is_file()}
        self.assertEqual(after, before)
        fixture_path = EVIDENCE / 'optional-error-fixture-inputs.json'
        fixtures = json.loads(fixture_path.read_text()) if fixture_path.exists() else []
        fixtures.append({'case': self._testMethodName, 'action': action, 'cli_prefix': prefix,
                         'docker_exit_code': exit_code, 'docker_stderr': message,
                         'script_exit_code': result.returncode, 'script_stdout': result.stdout,
                         'script_stderr': result.stderr, 'state_file_hashes_before': before,
                         'state_file_hashes_after': after, 'state_unchanged': after == before,
                         'evidence_class': 'synthetic-Docker-CLI-failure-input'})
        fixture_path.write_text(json.dumps(fixtures, indent=2) + '\n')

    def test_35_stop_daemon_unavailable_is_not_absence(self):
        self.optional_error('stop', ['inspect'], 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?')

    def test_36_cleanup_permission_denied_is_not_absence(self):
        self.optional_error('cleanup', ['inspect'], 'permission denied while trying to connect to the docker API at unix:///var/run/docker.sock')

    def test_37_cleanup_network_error_is_not_absence(self):
        self.optional_error('cleanup', ['network', 'inspect'], 'Error response from daemon: Internal Server Error')

    def test_38_stop_unexpected_cli_exit_is_not_absence(self):
        self.optional_error('stop', ['inspect'], 'docker: unknown command', 125)

    def test_39_wrong_missing_object_name_is_not_absence(self):
        self.optional_error('cleanup', ['inspect'], 'error: no such object: unrelated-service')


if __name__ == '__main__': unittest.main(verbosity=2)
