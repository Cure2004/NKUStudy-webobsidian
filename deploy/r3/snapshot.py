#!/usr/bin/env python3
"""Fixture-only consistent snapshots of stopped, labelled Linux Docker volumes."""
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from manifest import read_manifest,accepted_ids,require,verify
from deploy import Instance,docker


def canonical(path,exists=True):
    p=pathlib.Path(path)
    require(p.is_absolute() and str(p)!='/' and ',' not in str(p) and '\n' not in str(p),'unsafe path')
    require(p.parent.resolve(strict=True)==p.parent and not p.is_symlink(),'noncanonical/symlink path')
    require(p.exists() if exists else not p.exists(),'path existence does not match operation')
    return p


def digest(path):
    value=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):value.update(block)
    return value.hexdigest()


def stopped(instance):
    instance.check_image();instance.check_state()
    for name,role in ((instance.name,'app'),(instance.relay,'relay')):
        if docker('inspect',name,optional=True) is not None:
            instance.identity(name,role)
            require(instance.inspect(name,'{{.State.Running}}')=='false','stop app and relay before snapshot')
    for role in ('vault','data'):
        consumers=docker('ps','--all','--filter','volume='+instance.store.volume_name(role),'--format','{{.Names}}').splitlines()
        require(all(value==instance.name for value in consumers),'another container is attached to this generation volume')


def safe_members(tar):
    members=tar.getmembers();names=[m.name for m in members]
    require(len(names)==len(set(names)),'duplicate snapshot members')
    for item in members:
        p=pathlib.PurePosixPath(item.name)
        require(not p.is_absolute() and '..' not in p.parts and p.parts and p.parts[0] in ('vault','data','.nkustudy-4b-instance'),'unsafe snapshot path')
        require(item.isdir() or item.isreg(),'snapshot links/special files forbidden')
        require(p.parts[0]!='.nkustudy-4b-instance' or item.name=='.nkustudy-4b-instance','invalid marker member')
    require(all(x in names for x in ('vault','data','.nkustudy-4b-instance')),'snapshot incomplete')
    require(tar.getmember('vault').isdir() and tar.getmember('data').isdir(),'invalid snapshot roots')
    marker=tar.getmember('.nkustudy-4b-instance');require(marker.isreg() and marker.size<512,'invalid snapshot marker')
    return members


def backup(package,m,state,name,output):
    state=canonical(state);output=canonical(output,False)
    require(output.parent.stat().st_mode&0o777==0o700,'snapshot parent must be0700')
    require(not output.is_relative_to(state),'snapshot must be outside state')
    instance=Instance(package,m,str(state),name);stopped(instance)
    staging=pathlib.Path(tempfile.mkdtemp(prefix='snapshot-staging-',dir=output.parent))
    # Staging is retained as private evidence, including on failure; never clean source volumes.
    instance.store.copy_tree(staging)
    shutil.copyfile(state/'.nkustudy-4b-instance',staging/'.nkustudy-4b-instance')
    partial=output.with_name(output.name+'.partial');require(not partial.exists(),'partial snapshot exists')
    def check(item):
        require(item.isdir() or item.isreg(),'snapshot refuses links/devices')
        item.mode=0o700 if item.isdir() else 0o600;item.uid=1000;item.gid=1000;item.uname='';item.gname=''
        return item
    with partial.open('xb') as out:
        os.chmod(partial,0o600)
        with tarfile.open(fileobj=out,mode='w') as tar:
            for root in ('vault','data','.nkustudy-4b-instance'):tar.add(staging/root,arcname=root,filter=check)
    stopped(instance)
    os.link(partial,output);partial.unlink()
    print('PASS: stopped named-volume fixture snapshot; SHA256='+digest(output)+'; private staging retained')


def restore(package,m,archive,expected,target,name):
    archive=canonical(archive);target=canonical(target,False)
    require(archive.is_file() and archive.stat().st_mode&0o777==0o600,'snapshot must be regular0600')
    require(re.fullmatch(r'[0-9a-f]{64}',expected) and digest(archive)==expected,'snapshot SHA256 mismatch')
    with tarfile.open(archive,'r:') as tar:
        members=safe_members(tar);marker=tar.extractfile('.nkustudy-4b-instance').read().decode().strip().split(' ')
        require(len(marker)==3 and marker[1] in accepted_ids(m) and marker[2] in ('28787','28788'),'snapshot image/port mismatch')
        require(re.fullmatch(r'nkustudy-4b-[a-z0-9][a-z0-9-]{0,40}',marker[0]),'snapshot source instance invalid')
        instance=Instance(package,m,str(target),name);instance.check_image();instance.ensure_absent();instance.store.ensure_absent()
        staging=pathlib.Path(tempfile.mkdtemp(prefix='restore-staging-',dir=archive.parent))
        for item in sorted(members,key=lambda x:(len(pathlib.PurePosixPath(x.name).parts),x.name)):
            path=staging/item.name
            if item.isdir():path.mkdir(mode=0o700)
            else:
                require(path.parent.is_dir(),'missing snapshot parent')
                with path.open('xb') as out,tar.extractfile(item) as inp:shutil.copyfileobj(inp,out,1024*1024)
                path.chmod(0o600)
    # Validate persisted authentication before creating any destination state/volume.
    settings=staging/'data/settings.json'
    require(settings.is_file() and not settings.is_symlink(),'restored settings missing')
    auth=json.loads(settings.read_text()).get('auth',{})
    require(auth.get('userPasswordHash') or auth.get('passwordHash'),'restored password absent')
    target.mkdir(mode=0o700)
    (target/'.nkustudy-4b-instance').write_text(name+' '+instance.image_id+' '+instance.port+'\n')
    instance.store.create();instance.store.copy_tree(staging,restore=True)
    meta={'format':2,'storage':'docker-named-volumes','image_id':instance.image_id,'instance':name,'port':instance.port,'snapshot_sha256':expected}
    (target/'.nkustudy-4b-restore.json').write_text(json.dumps(meta,indent=2)+'\n')
    (target/'.nkustudy-4b-restore.json').chmod(0o600)
    instance.store.password_ready()
    print('PASS: restored into new owned Linux volumes; source volumes/state retained; no setup.env propagated')


def main():
    os.umask(0o077);args=sys.argv[1:];local=bool(args and args[0]=='--local-candidate')
    if local:args=args[1:]
    command,package_arg,*values=args;package,m=read_manifest(package_arg)
    require(m.get('format')==2 and m.get('storage')=='docker-named-volumes','r2 volume snapshot format required')
    if m.get('kind')=='local-candidate':
        require(local,'explicit --local-candidate required')
        require(docker('info','--format','{{.ID}}')==m['local_engine_id'] and docker('context','show')==m['local_docker_context'],'candidate belongs to another local engine')
    else:
        require(not local,'local flag forbidden for formal release')
        if command=='restore':verify(package,m)
    if command=='backup' and len(values)==3:backup(package,m,*values)
    elif command=='restore' and len(values)==4:restore(package,m,*values)
    else:raise ValueError('snapshot.py [--local-candidate] backup PACKAGE STATE INSTANCE SNAPSHOT | restore PACKAGE SNAPSHOT SHA NEW_STATE NEW_INSTANCE')


if __name__=='__main__':
    try:main()
    except (ValueError,KeyError,TypeError,OSError,tarfile.TarError,subprocess.SubprocessError) as error:
        print('ERROR: '+str(error),file=sys.stderr);sys.exit(1)
