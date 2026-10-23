#!/usr/bin/env python3
"""Serial, local-only recovery of an accepted stopped r2 fixture; never changes source volumes."""
import hashlib
import configparser
import http.cookiejar as cookiejar
import json
import pathlib
import secrets
import subprocess
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
from manifest import require,read_manifest


def main(args):
    require(len(args)==8,'--recover-source CANDIDATE_DIR SOURCE_STATE SOURCE_INSTANCE PRIVATE_PASSWORD_JSON NEW_PARENT NEW_INSTANCE EXPECTED_NOTE SEARCH_QUERY')
    package,source_state,source_name,credentials,parent,name,note,query=args
    package=pathlib.Path(package).resolve(strict=True);source_state=pathlib.Path(source_state).resolve(strict=True)
    parent=pathlib.Path(parent).resolve(strict=True);credentials=pathlib.Path(credentials)
    require(credentials.is_file() and not credentials.is_symlink() and credentials.stat().st_mode&0o777==0o600,'private password JSON must be regular0600')
    password=json.loads(credentials.read_text())['password'];require(isinstance(password,str) and len(password)>=12,'private test password absent')
    _,manifest=read_manifest(package);require(manifest.get('kind')=='local-candidate','this recovery mode is explicitly local candidate only')
    here=pathlib.Path(__file__).resolve().parent
    target=parent/(name+'-state')
    require(not target.exists(),'recovery target generation exists; inspect original outcome rather than replay')
    base=here.parents[2]/'docs/nkustudy/4b-preflight/evidence/offline/volumes-r2'/('real-recovery-'+name)
    evidence=base;attempt=1
    while evidence.exists():
        attempt+=1;evidence=base.with_name(base.name+'-attempt'+str(attempt))
    evidence.mkdir(mode=0o700)
    private=parent/(name+'-private-snapshots'+('' if attempt==1 else '-attempt'+str(attempt)));private.mkdir(mode=0o700)
    before_tar=private/'source-before.tar';after_tar=private/'source-after.tar'
    records=[];restored_created=False
    opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookiejar.CookieJar()))
    def save(): (evidence/'command-results.json').write_text(json.dumps(records,indent=2)+'\n')
    def command(case,argv):
        started=time.monotonic();p=subprocess.run(argv,capture_output=True,text=True,timeout=360)
        records.append({'case':case,'exit_code':p.returncode,'elapsed_seconds':round(time.monotonic()-started,3),
                        'stdout':p.stdout.strip(),'stderr':p.stderr.strip(),'evidence_class':'real-local-Docker-AMD64-under-emulation'})
        save();require(p.returncode==0,case+' failed; preserve both generations')
    def lifecycle(action,state=target,instance=name):
        command(action+'-'+instance,['bash',str(here/'offline.sh'),'--local-candidate',action,str(package),str(state),instance])
    def http(case,method,path,payload=None,expected=200):
        req=urllib.request.Request('http://127.0.0.1:28787'+path,method=method,
            data=None if payload is None else json.dumps(payload).encode(),headers={'Content-Type':'application/json','Origin':'http://127.0.0.1:28787'})
        try:
            with opener.open(req,timeout=60) as response:status,raw=response.status,response.read()
        except urllib.error.HTTPError as error:status,raw=error.code,error.read()
        records.append({'case':case,'method':method,'path':path,'http_status':status,'expected':expected,
                        'response_sha256':hashlib.sha256(raw).hexdigest(),'evidence_class':'real-HTTP-functional-assertion-not-browser'})
        save();require(status==expected,case+' unexpected HTTP status');return json.loads(raw)
    def state_hashes():
        files=[p for p in source_state.rglob('*') if p.is_file()]
        require(not any(p.is_symlink() for p in files),'source state symlink forbidden')
        return {str(p.relative_to(source_state)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    def tar_hashes(path):
        with tarfile.open(path) as tar:
            return {m.name:{'sha256':hashlib.sha256(tar.extractfile(m).read()).hexdigest(),'bytes':m.size}
                    for m in tar if m.isreg()}
    try:
        # Repeating stop is harmless; it verifies exact ownership. Never cleanup source containers or volumes.
        lifecycle('stop',source_state,source_name);host_before=state_hashes()
        (evidence/'source-host-state-before-hashes.json').write_text(json.dumps(host_before,indent=2)+'\n')
        command('snapshot-source-before',['python3',str(here/'snapshot.py'),'--local-candidate','backup',str(package),str(source_state),source_name,str(before_tar)])
        before=tar_hashes(before_tar);require('vault/'+note in before,'accepted note absent from source snapshot')
        # Source G06 intentionally ended with Git disabled. Verify the fixed local fixture
        # before enabling it only in the new generation; never guess a remote or replay the old init.
        with tarfile.open(before_tar) as tar:
            head=tar.extractfile('vault/.git/HEAD').read().decode().strip()
            config=configparser.RawConfigParser();config.read_string(tar.extractfile('vault/.git/config').read().decode())
            bare=configparser.RawConfigParser();bare.read_string(tar.extractfile('data/fixture-remote.git/config').read().decode())
            require(head=='ref: refs/heads/draft/4b' and config.get('remote "origin"','url')=='/data/fixture-remote.git'
                    and bare.getboolean('core','bare'),'source fixed local Git fixture mismatch')
        (evidence/'source-fixed-git-identity.json').write_text(json.dumps({'HEAD':head,'origin':'/data/fixture-remote.git','bare':True},indent=2)+'\n')
        sha=hashlib.sha256(before_tar.read_bytes()).hexdigest()
        command('restore-new-owned-volumes',['python3',str(here/'snapshot.py'),'--local-candidate','restore',str(package),str(before_tar),sha,str(target),name]);restored_created=True
        from deploy import docker
        from storage import VolumeStore
        store=VolumeStore(target,name,manifest['image_id'],docker);store.check()
        verify_git='test "$(git -C /vault symbolic-ref --short HEAD)" = draft/4b; test "$(git -C /vault remote get-url origin)" = /data/fixture-remote.git; test "$(git -C /data/fixture-remote.git rev-parse --is-bare-repository)" = true; printf "fixed-local-Git-identity-verified\\n"'
        command('restored-fixed-git-identity-readonly',['docker','run','--rm','--pull','never','--platform','linux/amd64','--network','none',
            '--user','1000:1000','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','128m','--memory-swap','128m',
            '--cpus','0.50','--pids-limit','32',*store.mounts(readonly=True),'--entrypoint','sh',manifest['image_id'],'-eu','-c',verify_git])
        lifecycle('start');lifecycle('status')
        http('restored-owner-login','POST','/auth/login',{'password':password})
        content=http('restored-file-exact','GET','/api/files/content?path='+urllib.parse.quote(note))['content']
        require(hashlib.sha256(content.encode()).hexdigest()==before['vault/'+note]['sha256'],'restored note bytes differ')
        hits=http('restored-search-index','GET','/api/search?q='+urllib.parse.quote(query))['hits']
        require(any(x.get('path')==note for x in hits),'restored accepted note missing from search')
        settings=http('restored-safe-policy-read','GET','/api/settings')
        require(settings['git']['enabled'] is False and settings['git']['remote']=='/data/fixture-remote.git'
                and settings['github']['editBranch']=='draft/4b' and settings['github']['baseBranch']=='review'
                and not settings['publicEditor']['enabled'] and not settings['github']['appEnabled']
                and not settings['github']['autoPullRequest'] and not settings['git']['autoSync']
                and not settings['git']['autoCommitOnSave'],'restored safe Git fixture policy mismatch')
        fixture_policy={'git':{'enabled':True,'remote':'/data/fixture-remote.git','autoSync':False,'autoCommitOnSave':False,'lfsPatterns':[]},
                        'github':{'editBranch':'draft/4b','baseBranch':'review','appEnabled':False,'autoPullRequest':False,'autoFollowBase':False}}
        (evidence/'explicit-local-git-fixture-policy.json').write_text(json.dumps(fixture_policy,indent=2)+'\n')
        http('enable-local-only-git-fixture','PUT','/api/settings',fixture_policy)
        http('restored-local-git-init','POST','/api/git/init',{})
        suffix=secrets.token_hex(6);new_note='recovery-new-write-'+suffix+'.md';new_query='OfflineRecoveredWrite'+suffix
        body='---\ntitle: Offline recovery new write\n---\n\n'+new_query+'\n'
        http('restored-new-write','PUT','/api/files/content',{'path':new_note,'content':body})
        require(http('restored-new-read','GET','/api/files/content?path='+new_note)['content']==body,'new write readback mismatch')
        http('restored-local-git-commit','POST','/api/git/commit',{'prefix':'测试','description':'隔离恢复本地提交验证','paths':[new_note]})
        require(http('restored-local-git-log','GET','/api/git/log?path='+new_note)['commits'],'local commit absent from path log')
        lifecycle('stop');lifecycle('resume')
        http('restored-login-after-restart','POST','/auth/login',{'password':password})
        require(any(x.get('path')==new_note for x in http('new-write-search-after-restart','GET','/api/search?q='+new_query)['hits']),'new write missing from rebuilt cold index')
        final=http('restore-safe-disabled-git-policy','PUT','/api/settings',{'git':{'enabled':False,'autoSync':False,'autoCommitOnSave':False},'github':{'appEnabled':False,'autoPullRequest':False,'autoFollowBase':False}})
        require(not final['git']['enabled'] and not final['publicEditor']['enabled'],'restored final safe policy mismatch')
        lifecycle('stop');lifecycle('cleanup')
        command('snapshot-source-after',['python3',str(here/'snapshot.py'),'--local-candidate','backup',str(package),str(source_state),source_name,str(after_tar)])
        require(before==tar_hashes(after_tar),'source volume content changed')
        require(host_before==state_hashes(),'source state/credentials changed')
        target_binding=json.loads((target/'.nkustudy-4b-volumes.json').read_text())
        for role,volume in target_binding['volumes'].items():
            command('retained-restored-volume-'+role,['docker','volume','inspect','--format','{{.Name}} {{index .Labels "org.nkustudy.4b.instance"}}',volume['Name']])
        result={'status':'PASS','checks':len(records),'source_state':str(source_state),'restored_state':str(target),
                'snapshot':str(before_tar),'snapshot_sha256':sha,'source_file_count':len(before),
                'source_state_unchanged':True,'source_volume_bytes_unchanged':True,'volumes_retained':True,
                'setup_env_not_propagated':not (target/'setup.env').exists(),'new_write_search_after_restart':True,
                'local_Git_commit_verified':True,'no_remote_Git_operations':True,'server_touched':False}
    except Exception as error:
        result={'status':'FAIL','checks':len(records),'error':str(error),'source_state':str(source_state),
                'restored_state':str(target),'server_touched':False}
        if restored_created:
            try:lifecycle('stop')
            except Exception:pass
    (evidence/'summary.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));save()
    return 0 if result['status']=='PASS' else 1
