#!/usr/bin/env python3
"""No real containers: named-volume ownership, startup/relay and failure contracts."""
import copy
import io
import json
import pathlib
import subprocess
import sys
import tempfile
import tarfile
import hashlib
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch
import deploy
import snapshot
from manifest import read_manifest
from storage import VolumeStore
from validate_runtime import validate

EVIDENCE=pathlib.Path(__file__).resolve().parents[3]/'docs/nkustudy/4b-preflight/evidence/offline/volumes-r2/full-contract-r2'
PACKAGE=pathlib.Path('/Users/carlos/Documents/ChatGPT/New project 3/4b-artifacts-20261022/candidate-r2-runtime')


class FakeDocker:
    def __init__(self,m): self.m=m;self.calls=[];self.volumes={};self.files={}
    def __call__(self,*args,optional=False):
        self.calls.append(list(args))
        if args[:2]==('image','inspect'):
            if args[3]=='{{.Id}}': return self.m['image_id']
            return ' '.join([self.m['image_id'],'linux/amd64',self.m['source_commit'],self.m['lock_sha256'],self.m['source_manifest_sha256']])
        if args[:2]==('volume','inspect'):
            name=args[-1]
            if name not in self.volumes:
                if optional:return None
                raise ValueError('volume missing')
            return json.dumps(self.volumes[name])
        if args[:2]==('volume','create'):
            labels={args[i+1].split('=',1)[0]:args[i+1].split('=',1)[1] for i,x in enumerate(args) if x=='--label'}
            name=args[-1];self.volumes[name]={'Name':name,'Driver':'local','Scope':'local','Options':None,'Labels':labels,'Mountpoint':'/var/lib/docker/volumes/'+name+'/_data'}
            self.files[name]={}
            return name
        if args[:1]==('run',) and '-e' in args:
            code=args[args.index('-e')+1]
            mounts=[args[i+1] for i,x in enumerate(args) if x=='--mount']
            roles={dict(x.split('=',1) for x in mount.split(',') if '=' in x)['target']:dict(x.split('=',1) for x in mount.split(',') if '=' in x)['source'] for mount in mounts}
            if 'writeFileSync("/vault/4b-sentinel.md"' in code:self.files[roles['/vault']]['4b-sentinel.md']=b'Isolated sentinel\n'
            if 'const restore=process.argv' in code:
                restoring=args[args.index('-e')+2]=='restore';staging=pathlib.Path(roles['/staging'])
                for role in ('vault','data'):
                    files=self.files[roles['/'+role]]
                    if restoring:
                        files.update({str(p.relative_to(staging/role)):p.read_bytes() for p in (staging/role).rglob('*') if p.is_file()})
                    else:
                        (staging/role).mkdir(mode=0o700)
                        for relative,content in files.items():
                            path=staging/role/relative;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(content)
            if 'persisted-password-present' in code:
                require_file=self.files[roles['/data']].get('settings.json')
                if not require_file:raise ValueError('settings absent')
                return 'persisted-password-present'
            return ''
        if args[:1]==('ps',):return ''
        if args[:1]==('inspect',) or args[:2]==('network','inspect'):
            if optional:return None
            raise ValueError('unexpected inspect in mocked startup')
        if args[:1]==('info',):return self.m['local_engine_id']
        if args[:1]==('context',):return self.m['local_docker_context']
        return 'mock-receipt'


class VolumeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): EVIDENCE.mkdir(parents=True,exist_ok=True);cls.receipts=[]
    @classmethod
    def tearDownClass(cls): (EVIDENCE/'full-contract-results.json').write_text(json.dumps(cls.receipts,indent=2)+'\n')
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='nku4b-r2-contract-');self.base=pathlib.Path(self.tmp.name).resolve();self.state=self.base/'state'
        self.package,self.m=read_manifest(PACKAGE);self.name='nkustudy-4b-r2-contract'
        self.fake=FakeDocker(self.m);self.patch=patch('deploy.docker',self.fake);self.patch.start()
        self.instance=deploy.Instance(self.package,self.m,str(self.state),self.name)
    def tearDown(self):
        self.receipts.append({'case':self._testMethodName,'docker_commands':self.fake.calls,'evidence_class':'synthetic-Docker-contract-no-real-containers'})
        self.patch.stop();self.tmp.cleanup()
    def init(self):
        with redirect_stdout(io.StringIO()):self.instance.init()
    def test_01_init_labels_and_private_state(self):
        self.init();self.assertEqual(set(self.fake.volumes),{self.name+'-vault',self.name+'-data'})
        self.instance.store.check();self.assertEqual((self.state/'setup.env').stat().st_mode&0o777,0o600)
        self.assertFalse((self.state/'vault').exists());self.assertFalse((self.state/'data').exists())
        helper=next(x for x in self.fake.calls if x[0]=='run')
        self.assertIn('none',helper);self.assertIn('--entrypoint',helper);self.assertIn('node',helper)
        self.assertFalse(any('safe.directory' in x for cmd in self.fake.calls for x in cmd))
    def test_02_start_exact_volume_and_relay_args(self):
        self.init()
        with patch('deploy.socket.socket'),patch.object(self.instance,'wait_health') as health:
            self.instance.start();health.assert_called_once()
        app=next(x for x in self.fake.calls if x[:2]==['run','--detach'])
        relay=next(x for x in self.fake.calls if x[0]=='create')
        for role in ('vault','data'):self.assertIn('type=volume,source='+self.name+'-'+role+',target=/'+role,app)
        self.assertFalse(any('type=bind' in x for x in app));self.assertNotIn('--publish',app)
        self.assertIn('512m',app);self.assertIn('128m',relay);self.assertNotIn('--env-file',relay)
        self.assertIn('--max-old-space-size=16',relay);self.assertIn('/relay.mjs',relay)
        self.assertLess(next(i for i,x in enumerate(self.fake.calls) if x[:2]==['network','connect']),next(i for i,x in enumerate(self.fake.calls) if x[:1]==['start']))
    def test_03_existing_state_preserved(self):
        self.state.mkdir();(self.state/'retained').write_text('unchanged')
        with self.assertRaises(ValueError):self.instance.init()
        self.assertEqual((self.state/'retained').read_text(),'unchanged')
    def test_04_existing_volume_preserved(self):
        self.fake.volumes[self.name+'-vault']={'foreign':True}
        with self.assertRaises(ValueError):self.instance.init()
        self.assertFalse(self.state.exists())
    def test_05_foreign_label_refused(self):
        self.init();self.fake.volumes[self.name+'-vault']['Labels']['org.nkustudy.4b.instance']='foreign'
        with self.assertRaises(ValueError):self.instance.check_state()
    def test_06_mountpoint_drift_refused(self):
        self.init();self.fake.volumes[self.name+'-data']['Mountpoint']='/var/lib/docker/volumes/foreign/_data'
        with self.assertRaises(ValueError):self.instance.check_state()
    def test_07_volume_bind_driver_option_refused(self):
        self.init();self.fake.volumes[self.name+'-vault']['Options']={'type':'none','device':'/','o':'bind'}
        with self.assertRaises(ValueError):self.instance.check_state()
    def test_08_cleanup_retains_volumes_and_credentials(self):
        self.init();before=(self.state/'setup.env').read_bytes()
        with redirect_stdout(io.StringIO()):self.instance.cleanup()
        self.assertEqual((self.state/'setup.env').read_bytes(),before);self.assertEqual(len(self.fake.volumes),2)
        self.assertFalse(any(x[:2]==['volume','rm'] for x in self.fake.calls))
    def test_09_explicit_candidate_flag_required(self):
        with patch.object(sys,'argv',['deploy.py','init',str(PACKAGE),str(self.state),self.name]):
            with self.assertRaises(ValueError):deploy.main()
        self.assertFalse(self.state.exists())
    def test_10_candidate_engine_mismatch_refused(self):
        def wrong(*args,**kwargs): return 'different-engine' if args[:1]==('info',) else self.fake(*args,**kwargs)
        with patch('deploy.docker',wrong),patch.object(sys,'argv',['deploy.py','--local-candidate','init',str(PACKAGE),str(self.state),self.name]):
            with self.assertRaises(ValueError):deploy.main()
        self.assertFalse(self.state.exists())
    def test_11_actual_missing_volume_message(self):
        p=subprocess.CompletedProcess([],1,'[]','Error response from daemon: get exact-volume: no such volume\n')
        with patch('deploy.subprocess.run',return_value=p):
            self.assertIsNone(_REAL_DOCKER('volume','inspect','exact-volume',optional=True))
            with self.assertRaises(ValueError):_REAL_DOCKER('volume','inspect','other-volume',optional=True)

    def runtime(self,role):
        app=role=='app';volumes=self.instance.store.check()
        return {'memory':536870912 if app else 134217728,'swap':536870912 if app else 134217728,
                'cpu':500000000 if app else 100000000,'pids':96 if app else 32,'readonly':True,'privileged':False,
                'user':'1000:1000','caps':['ALL'],'capadd':None,'security':['no-new-privileges:true'],
                'network':self.name+('-internal' if app else '-ingress'),'init':True,'restart':'no',
                'ports':{} if app else {'8787/tcp':[{'HostIp':'127.0.0.1','HostPort':'28787'}]},
                'networks':{x:{} for x in ([self.name+'-internal'] if app else [self.name+'-internal',self.name+'-ingress'])},
                'mounts':[{'Type':'volume','Destination':'/'+r,'Name':volumes[r]['Name'],'Source':volumes[r]['Mountpoint'],'RW':True} for r in ('vault','data')] if app else [{'Type':'bind','Destination':'/relay.mjs','Source':str(self.package/'relay.mjs'),'RW':False}],
                'tmpfs':{'/tmp':'rw,nosuid,nodev,noexec,size='+('64m' if app else '16m')+',mode=1777'},
                'entrypoint':['/usr/local/bin/nkustudy-entrypoint'] if app else ['node'],
                'cmd':[] if app else ['--max-old-space-size=16','/relay.mjs',self.name],
                'path':'/usr/local/bin/nkustudy-entrypoint' if app else 'node',
                'args':[] if app else ['--max-old-space-size=16','/relay.mjs',self.name]}
    def test_12_app_relay_runtime_positive_and_guard_negatives(self):
        self.init();volumes=self.instance.store.check();cases=[]
        for role in ('app','relay'):
            base=self.runtime(role);validate(base,str(self.state),self.name,'28787',role,str(self.package),volumes)
            for key,value in [('memory',0),('swap',-1),('pids',0),('cpu',0),('path','sh'),('args',['-c','wrong']),('entrypoint',['sh']),('cmd',['wrong'])]:
                bad=copy.deepcopy(base);bad[key]=value
                with self.assertRaises(ValueError):validate(bad,str(self.state),self.name,'28787',role,str(self.package),volumes)
                cases.append({'role':role,'field':key,'invalid':value,'rejected':True})
        (EVIDENCE/'runtime-guard-negative-inputs.json').write_text(json.dumps(cases,indent=2)+'\n')
    def snapshot_seed(self):
        self.init();self.fake.files[self.name+'-data']['settings.json']=b'{"auth":{"userPasswordHash":"synthetic-not-real-credential"}}'
        parent=self.base/'snapshots';parent.mkdir(mode=0o700);return parent/'fixture.tar'
    def test_13_volume_snapshot_restore_new_generation(self):
        archive=self.snapshot_seed();target=self.base/'restored';new_name='nkustudy-4b-r2-restored'
        before=copy.deepcopy(self.fake.files)
        with patch('snapshot.docker',self.fake),redirect_stdout(io.StringIO()):
            snapshot.backup(self.package,self.m,str(self.state),self.name,str(archive))
            snapshot.restore(self.package,self.m,str(archive),hashlib.sha256(archive.read_bytes()).hexdigest(),str(target),new_name)
        for role in ('vault','data'):
            self.assertEqual(before[self.name+'-'+role],self.fake.files[new_name+'-'+role])
            self.assertEqual(before[self.name+'-'+role],self.fake.files[self.name+'-'+role])
        self.assertFalse((target/'setup.env').exists());self.assertTrue((target/'.nkustudy-4b-restore.json').is_file())
        (EVIDENCE/'volume-snapshot-synthetic.tar').write_bytes(archive.read_bytes())
    def test_14_bad_snapshot_hash_creates_no_volume(self):
        archive=self.snapshot_seed();before=copy.deepcopy(self.fake.volumes)
        with patch('snapshot.docker',self.fake),redirect_stdout(io.StringIO()):
            snapshot.backup(self.package,self.m,str(self.state),self.name,str(archive))
            with self.assertRaises(ValueError):snapshot.restore(self.package,self.m,str(archive),'0'*64,str(self.base/'bad-restore'),'nkustudy-4b-r2-bad')
        self.assertEqual(before,self.fake.volumes)
    def test_16_formal_release_requires_archive_validation(self):
        release=dict(self.m,kind='release')
        with patch('deploy.read_manifest',return_value=(self.package,release)),patch('deploy.verify',side_effect=ValueError('archive not validated')) as verifier,patch.object(sys,'argv',['deploy.py','init',str(PACKAGE),str(self.state),self.name]):
            with self.assertRaises(ValueError):deploy.main()
            verifier.assert_called_once_with(self.package,release)
        self.assertFalse(self.state.exists())
    def test_15_snapshot_path_traversal_rejected_before_volumes(self):
        self.init();archive=self.base/'bad.tar'
        with tarfile.open(archive,'w') as tar:
            for name in ('vault','data','../escape'):
                item=tarfile.TarInfo(name);item.type=tarfile.DIRTYPE;tar.addfile(item)
        archive.chmod(0o600);before=copy.deepcopy(self.fake.volumes)
        with patch('snapshot.docker',self.fake):
            with self.assertRaises(ValueError):snapshot.restore(self.package,self.m,str(archive),hashlib.sha256(archive.read_bytes()).hexdigest(),str(self.base/'bad-restore'),'nkustudy-4b-r2-bad')
        self.assertEqual(before,self.fake.volumes)


_REAL_DOCKER=deploy.docker
if __name__=='__main__':unittest.main(verbosity=2)
