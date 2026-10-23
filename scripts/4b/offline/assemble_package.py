#!/usr/bin/env python3
"""Local assembly only, after container acceptance; never exports/builds/pulls images."""
import json
import os
import pathlib
import shutil
import sys
from manifest import archive_info, sha_file, verify, require

here = pathlib.Path(__file__).resolve().parent
repo = here.parents[2]
archive = pathlib.Path(sys.argv[1]).resolve(strict=True)
package = archive.parent
require(archive.is_file() and archive.name.endswith('.tar') and not archive.is_symlink(), 'regular image tar required')
require(not (package / 'release.json').exists(), 'release already assembled; preserve it')
require({p.name for p in package.iterdir()} == {archive.name}, 'new package directory must contain only the reviewed image tar')
info = archive_info(archive)
expected_tag = 'nkustudy/webobsidian:4b-1bd3f6c-r2'
require(info['image_tag'] == expected_tag, 'unexpected reviewed image tag')
build_record = json.loads((repo / 'docs/nkustudy/4b-preflight/evidence/build/final-image-r2.json').read_text())
require(build_record['Id'] == (info['image_index_digest'] or info['image_manifest_digest'] or info['image_config_digest']),
        'archive identity differs from saved final build receipt')
os.umask(0o022)
for source, target in [
        (repo / 'Dockerfile', 'Dockerfile'),
        (repo / 'docs/nkustudy/4b-preflight/evidence/build/source-manifest-r2.json', 'source-manifest.json'),
        (repo / 'scripts/4b/relay.mjs', 'relay.mjs'),
        (repo / 'scripts/4b/container-entrypoint.sh', 'container-entrypoint.sh'),
        (repo / 'docs/nkustudy/4b-preflight/deployment-package.md', 'deployment-package.md'),
        (repo / 'docs/nkustudy/4b-preflight/server-readiness.md', 'server-readiness.md')]:
    require(not (package / target).exists(), 'package member exists: ' + target)
    shutil.copyfile(source, package / target)
for name in ('offline.sh', 'deploy.py', 'manifest.py', 'validate_runtime.py', 'snapshot.py', 'storage.py'):
    require(not (package / name).exists(), 'package script exists: ' + name)
    shutil.copyfile(here / name, package / name)
    (package / name).chmod(0o755)
release = {key: info[key] for key in ('image_tag', 'image_config_digest', 'image_manifest_digest', 'image_index_digest', 'os', 'architecture')}
release.update(format=2, kind='release', storage='docker-named-volumes', entrypoint_sha256=sha_file(package / 'container-entrypoint.sh'), image_id=info['image_index_digest'] or info['image_manifest_digest'] or info['image_config_digest'],
               source_commit='cb3a96e8546844416258c1af64549724685eeb04',
               document_commit='cb3a96e8546844416258c1af64549724685eeb04',
               code_commit='1bd3f6c088466c8b46b447c9516cec623bc194f6',
               lock_sha256='671963de571dfc611e7f370482640455928bde108ed0e7c9383fd633f090d7ed',
               build_config_sha256=sha_file(package / 'Dockerfile'),
               source_manifest_sha256=sha_file(package / 'source-manifest.json'),
               relay_sha256=sha_file(package / 'relay.mjs'), archive=archive.name, archive_sha256=sha_file(archive))
(package / 'release.json').write_text(json.dumps(release, indent=2) + '\n')
verify(package, release)
files = sorted(p for p in package.iterdir() if p.is_file())
require(not any(p.is_symlink() for p in files), 'package symlink member')
(package / 'SHA256SUMS').write_text(''.join(sha_file(p) + '  ' + p.name + '\n' for p in files))
print(json.dumps({'status': 'PASS', 'evidence_class': 'offline-package-assembly-not-server-deployment',
                  'directory': str(package), 'files': len(files) + 1, 'release': release}, indent=2))
