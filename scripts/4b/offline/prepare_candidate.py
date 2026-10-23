#!/usr/bin/env python3
"""Read-only image binding for explicitly local r2 tests; never creates an archive or image."""
import json
import os
import pathlib
import shutil
import subprocess
import sys
from manifest import require, sha_file, read_manifest


def query(*args):
    p=subprocess.run(['docker',*args],capture_output=True,text=True,timeout=60)
    require(p.returncode==0,'Docker read-only candidate query failed')
    return p.stdout.strip()


try:
    os.umask(0o077)
    tag,target,source_arg=sys.argv[1:]
    require(tag=='nkustudy/webobsidian:4b-1bd3f6c-r2','only reviewed r2 tag accepted')
    target=pathlib.Path(target);source=pathlib.Path(source_arg).resolve(strict=True)
    require(target.is_absolute() and not target.exists() and not target.is_symlink() and target.parent.resolve(strict=True)==target.parent,'fresh canonical candidate directory required')
    repo=pathlib.Path(__file__).resolve().parents[3]
    info=json.loads(query('image','inspect','--format','{{json .}}',tag))
    require(info['Os']=='linux' and info['Architecture']=='amd64','AMD64 image required')
    require(info['Config']['Entrypoint']==['/usr/local/bin/nkustudy-entrypoint'] and not info['Config'].get('Cmd'),'fixed app entrypoint required')
    labels=info['Config']['Labels']
    require(labels.get('org.nkustudy.source-manifest-sha256')==sha_file(source),'image source manifest label mismatch')
    target.mkdir(mode=0o700)
    for src,name in [(repo/'Dockerfile','Dockerfile'),(source,'source-manifest.json'),
                     (repo/'scripts/4b/relay.mjs','relay.mjs'),(repo/'scripts/4b/container-entrypoint.sh','container-entrypoint.sh')]:
        shutil.copyfile(src,target/name)
    m={'format':2,'kind':'local-candidate','storage':'docker-named-volumes','image_tag':tag,'image_id':info['Id'],
       'os':info['Os'],'architecture':info['Architecture'],'source_commit':labels['org.opencontainers.image.revision'],
       'code_commit':'1bd3f6c088466c8b46b447c9516cec623bc194f6','document_commit':'cb3a96e8546844416258c1af64549724685eeb04',
       'lock_sha256':labels['org.nkustudy.lock-sha256'],'build_config_sha256':sha_file(target/'Dockerfile'),
       'source_manifest_sha256':sha_file(target/'source-manifest.json'),'relay_sha256':sha_file(target/'relay.mjs'),
       'entrypoint_sha256':sha_file(target/'container-entrypoint.sh'),
       'local_engine_id':query('info','--format','{{.ID}}'),'local_docker_context':query('context','show')}
    (target/'candidate.json').write_text(json.dumps(m,indent=2)+'\n')
    read_manifest(target)
    print(json.dumps({'status':'PASS','kind':'local-candidate-only-no-archive','candidate_directory':str(target),
                      'image_id':m['image_id'],'entrypoint_sha256':m['entrypoint_sha256'],
                      'usage':'offline.sh --local-candidate init|start|status|stop|resume|cleanup DIR STATE INSTANCE'},indent=2))
except (ValueError,KeyError,TypeError,OSError,subprocess.SubprocessError) as error:
    print('ERROR: '+str(error),file=sys.stderr);sys.exit(1)
