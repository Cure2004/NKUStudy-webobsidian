#!/usr/bin/env python3
"""Validate saved real Docker29 input and preserve altered counterexamples outside Git."""
import copy
import hashlib
import io
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tarfile
from manifest import archive_info, sha_file

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[2]
EVIDENCE = REPO / 'docs/nkustudy/4b-preflight/evidence/offline'
source = pathlib.Path(sys.argv[1]).resolve(strict=True)
fixtures = pathlib.Path(sys.argv[2]).resolve()
fixtures.mkdir(mode=0o700, parents=True, exist_ok=True)
package = fixtures / 'real-input-package'
package.mkdir(mode=0o700, exist_ok=True)
archive = package / 'real-image-format-study.tar'
if not archive.exists(): os.link(source, archive)
info = archive_info(archive)
shutil.copyfile(REPO / 'Dockerfile', package / 'Dockerfile')
shutil.copyfile(REPO / 'docs/nkustudy/4b-preflight/evidence/build/source-manifest.json', package / 'source-manifest.json')
shutil.copyfile(REPO / 'scripts/4b/relay.mjs', package / 'relay.mjs')
release = {key: info[key] for key in ('image_tag', 'image_config_digest', 'image_manifest_digest', 'image_index_digest', 'os', 'architecture')}
release.update(format=1, image_id=info['image_index_digest'] or info['image_config_digest'],
               source_commit='cb3a96e8546844416258c1af64549724685eeb04',
               document_commit='cb3a96e8546844416258c1af64549724685eeb04',
               code_commit='1bd3f6c088466c8b46b447c9516cec623bc194f6',
               lock_sha256='671963de571dfc611e7f370482640455928bde108ed0e7c9383fd633f090d7ed',
               build_config_sha256=sha_file(package / 'Dockerfile'),
               source_manifest_sha256=sha_file(package / 'source-manifest.json'),
               relay_sha256=sha_file(package / 'relay.mjs'), archive=archive.name, archive_sha256=sha_file(archive))
records = []


def run(case, manifest, command='verify', extra=None, expected=0):
    (package / 'release.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (EVIDENCE / ('real-input-' + case + '.json')).write_text(json.dumps(manifest, indent=2) + '\n')
    p = subprocess.run(['python3', str(HERE / 'manifest.py'), command, str(package), *(extra or [])], capture_output=True, text=True, timeout=120)
    records.append({'case': case, 'exit_code': p.returncode, 'expected_success': expected == 0,
                    'stdout': p.stdout.strip(), 'stderr': p.stderr.strip(), 'archive': str(package / manifest['archive']),
                    'archive_sha256': manifest['archive_sha256'], 'evidence_class': 'saved-real-archive-input'})
    if (p.returncode == 0) != (expected == 0): raise AssertionError(case + ': ' + p.stderr)


try:
    run('oci-positive', release)
    for key in ('image_index_digest', 'image_manifest_digest', 'image_config_digest'):
        run('accept-' + key, release, 'accept-id', [release[key]])
    run('reject-unknown-id', release, 'accept-id', ['sha256:' + '0' * 64], 1)
    run('wrong-architecture', dict(release, architecture='arm64'), expected=1)
    run('wrong-archive-hash', dict(release, archive_sha256='0' * 64), expected=1)
    run('wrong-runtime-config', dict(release, image_config_digest='sha256:' + '1' * 64), expected=1)
    (package / 'relay.mjs').write_bytes(b'// altered fixed relay input\n')
    run('wrong-relay-file', release, expected=1)
    shutil.copyfile(REPO / 'scripts/4b/relay.mjs', package / 'relay.mjs')
    corrupted = package / 'corrupt-blob.tar'
    if not corrupted.exists():
        with tarfile.open(archive, 'r:') as original, tarfile.open(corrupted, 'w') as out:
            changed = False
            for item in original:
                stream = original.extractfile(item) if item.isreg() else None
                if not changed and item.isreg() and item.name.startswith('blobs/sha256/') and item.size > 1024:
                    data = bytearray(stream.read()); data[-1] ^= 1; stream = io.BytesIO(data); changed = True
                out.addfile(item, stream)
    bad = dict(release, archive=corrupted.name, archive_sha256=sha_file(corrupted))
    run('valid-outer-hash-corrupt-blob', bad, expected=1)
    (package / 'release.json').write_text(json.dumps(release, indent=2) + '\n')
finally:
    (EVIDENCE / 'real-archive-command-results.json').write_text(json.dumps(records, indent=2) + '\n')
    print(json.dumps({'tests': len(records), 'pass': sum((r['exit_code'] == 0) == r['expected_success'] for r in records),
                      'fixture_directory': str(fixtures), 'evidence_class': 'real-archive-validation-only-no-containers'}, indent=2))
