#!/usr/bin/env python3
"""Saved real r2 tar + isolated altered files; never changes release package or Docker state."""
import copy
import gzip
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
PACKAGE = pathlib.Path(sys.argv[1]).resolve(strict=True)
FIXTURES = pathlib.Path(sys.argv[2]).resolve()
FIXTURES.mkdir(mode=0o700, parents=True, exist_ok=False)
EVIDENCE = REPO / 'docs/nkustudy/4b-preflight/evidence/offline/volumes-r2/release-r2/archive-contracts'
EVIDENCE.mkdir()
RELEASE = json.loads((PACKAGE / 'release.json').read_text())
SOURCE = PACKAGE / RELEASE['archive']
RECORDS = []
INPUTS = {}


def case_dir(name):
    path = FIXTURES / name; path.mkdir(mode=0o700)
    for source in PACKAGE.iterdir():
        if source.is_file() and source.suffix != '.tar' and source.name != 'SHA256SUMS':
            shutil.copyfile(source, path / source.name)
    os.link(SOURCE, path / SOURCE.name)
    return path


def check(name, path, manifest=None, success=False, command='verify', extra=()):
    if manifest is None: manifest = copy.deepcopy(RELEASE)
    (path / 'release.json').write_text(json.dumps(manifest, indent=2) + '\n')
    argv = ['python3', str(PACKAGE / 'manifest.py'), command, str(path), *extra]
    process = subprocess.run(argv, capture_output=True, text=True, timeout=120)
    good = (process.returncode == 0) == success
    record = {'case': name, 'exit_code': process.returncode, 'expected_success': success, 'passed': good,
              'stdout': process.stdout.strip(), 'stderr': process.stderr.strip(), 'fixture_directory': str(path),
              'archive_sha256': manifest['archive_sha256'], 'evidence_class': 'saved-real-r2-archive-and-explicit-altered-counterexample-no-Docker'}
    RECORDS.append(record)
    (EVIDENCE / (name + '-manifest.json')).write_text(json.dumps(manifest, indent=2) + '\n')
    (EVIDENCE / 'command-results.json').write_text(json.dumps(RECORDS, indent=2) + '\n')
    if not good: raise AssertionError(name + ': ' + process.stderr)


def variant(name, config_change=None, layer_change=False, corrupt_blob=False, multiple_tags=False):
    """Classic projection keeps real config/layers; changed content addresses are recomputed.

    This projection is a validator fixture, not evidence of a real classic-store Docker load.
    """
    target = FIXTURES / (name + '.tar')
    with tarfile.open(SOURCE) as original:
        members = original.getmembers(); by_name = {m.name: m for m in members}
        image = json.loads(original.extractfile('manifest.json').read())[0]
        config = json.loads(original.extractfile(image['Config']).read())
        overrides = {}; extra = {}
        if config_change:
            config_change(config)
            data = json.dumps(config, separators=(',', ':')).encode()
            image['Config'] = 'blobs/sha256/' + hashlib.sha256(data).hexdigest()
            extra[image['Config']] = data
        if layer_change:
            old = image['Layers'][0]; raw = original.extractfile(old).read()
            assert raw.startswith(b'\x1f\x8b'), 'real layer must be gzip for gzip counterexample'
            plain = bytearray(gzip.decompress(raw)); plain[-1] ^= 1
            data = gzip.compress(plain, mtime=0)
            new = 'blobs/sha256/' + hashlib.sha256(data).hexdigest()
            extra[new] = data; image['Layers'][0] = new
        if multiple_tags: image['RepoTags'].append('nkustudy/webobsidian:4b-unapproved-extra')
        overrides['manifest.json'] = json.dumps([image]).encode()
        if corrupt_blob:
            old = image['Layers'][0]; data = bytearray(original.extractfile(old).read()); data[-1] ^= 1
            overrides[old] = bytes(data)
        with tarfile.open(target, 'w') as out:
            for item in members:
                if item.name == 'index.json': continue
                changed = overrides.get(item.name)
                if changed is not None:
                    item = copy.copy(item); item.size = len(changed); out.addfile(item, io.BytesIO(changed))
                else: out.addfile(item, original.extractfile(item) if item.isreg() else None)
            for filename, data in extra.items():
                if filename in by_name: continue
                item = tarfile.TarInfo(filename); item.size = len(data); item.mode = 0o600
                out.addfile(item, io.BytesIO(data))
    INPUTS[name] = {'archive': str(target), 'sha256': sha_file(target), 'input': str(SOURCE),
                    'transformation': 'Docker classic manifest projection; all original blobs retained; explicit mutated config/layer; new content addresses recomputed',
                    'config_changed': bool(config_change), 'gzip_layer_content_changed': layer_change,
                    'old_blob_name_intentionally_corrupt': corrupt_blob, 'multiple_tags': multiple_tags}
    return target


def manifest_for_tar(path, *, config=None, info=None):
    manifest = copy.deepcopy(RELEASE)
    manifest.update(archive=path.name, archive_sha256=sha_file(path), image_manifest_digest=None, image_index_digest=None)
    if info is None:
        # For intentionally bad config/arch/layer fixtures, use the actual config blob digest
        # without claiming the full archive has passed validation.
        with tarfile.open(path) as tar:
            image = json.loads(tar.extractfile('manifest.json').read())[0]
            digest = 'sha256:' + hashlib.sha256(tar.extractfile(image['Config']).read()).hexdigest()
    else: digest = info['image_config_digest']
    manifest.update(image_id=digest, image_config_digest=digest)
    return manifest


try:
    positive = case_dir('oci-positive')
    check('oci-positive', positive, success=True)
    for field in ('image_config_digest', 'image_manifest_digest', 'image_index_digest'):
        check('accept-' + field, case_dir('accept-' + field), success=True, command='accept-id', extra=(RELEASE[field],))
    check('reject-unknown-id', case_dir('reject-unknown-id'), command='accept-id', extra=('sha256:' + '0' * 64,))
    for name, key, value in [('manifest-wrong-architecture', 'architecture', 'arm64'),
                              ('wrong-archive-hash', 'archive_sha256', '0' * 64),
                              ('wrong-config-identity', 'image_config_digest', 'sha256:' + '1' * 64),
                              ('missing-archive', 'archive', 'absent-image.tar')]:
        manifest = copy.deepcopy(RELEASE); manifest[key] = value
        check(name, case_dir(name), manifest)
    for name, filename in [('relay-file-altered', 'relay.mjs'), ('entrypoint-file-altered', 'container-entrypoint.sh'), ('build-file-altered', 'Dockerfile')]:
        path = case_dir(name); (path / filename).write_bytes(b'# isolated altered fixture\n')
        check(name, path)
    path = case_dir('entrypoint-source-binding-drift')
    (path / 'container-entrypoint.sh').write_text('# isolated wrong guard\n')
    manifest = copy.deepcopy(RELEASE); manifest['entrypoint_sha256'] = sha_file(path / 'container-entrypoint.sh')
    check('entrypoint-source-binding-drift', path, manifest)
    path = case_dir('source-file-rehashed-image-label-mismatch')
    source = json.loads((path / 'source-manifest.json').read_text()); source['isolated_fixture_note'] = 'altered hash'
    (path / 'source-manifest.json').write_text(json.dumps(source, indent=2) + '\n')
    manifest = copy.deepcopy(RELEASE); manifest['source_manifest_sha256'] = sha_file(path / 'source-manifest.json')
    check('source-file-rehashed-image-label-mismatch', path, manifest)

    classic = variant('classic-positive')
    classic_info = archive_info(classic)
    path = case_dir('classic-positive'); os.link(classic, path / classic.name)
    check('classic-positive', path, manifest_for_tar(classic, info=classic_info), success=True)
    changes = [
        ('actual-config-arm64', lambda c: c.update(architecture='arm64'), False, False, False),
        ('actual-config-32bit', lambda c: c.update(architecture='386'), False, False, False),
        ('actual-config-guard-bypass', lambda c: c['config'].update(Entrypoint=['sh']), False, False, False),
        ('actual-config-source-label', lambda c: c['config']['Labels'].update({'org.nkustudy.source-manifest-sha256': '0' * 64}), False, False, False),
        ('actual-rootfs-diff-id', lambda c: c['rootfs']['diff_ids'].__setitem__(0, 'sha256:' + '0' * 64), False, False, False),
        ('valid-gzip-blob-wrong-uncompressed-diff-id', None, True, False, False),
        ('valid-outer-hash-corrupt-inner-blob', None, False, True, False),
        ('multiple-tags', None, False, False, True)]
    for name, change, layer, corrupt, tags in changes:
        archive = variant(name, change, layer, corrupt, tags)
        path = case_dir(name); os.link(archive, path / archive.name)
        check(name, path, manifest_for_tar(archive))
finally:
    (EVIDENCE / 'altered-archive-inputs.json').write_text(json.dumps(INPUTS, indent=2) + '\n')
    summary = {'cases': len(RECORDS), 'passed_cases': sum(r['passed'] for r in RECORDS),
               'normal_cases': sum(r['expected_success'] for r in RECORDS),
               'expected_failure_cases': sum(not r['expected_success'] for r in RECORDS),
               'fixture_directory': str(FIXTURES), 'formal_package_unmodified': True,
               'classic_positive_is_projection_fixture_not_real_classic_engine_load': True,
               'no_Docker_commands_or_containers': True, 'source_tar_sha256': sha_file(SOURCE),
               'test_script_sha256': sha_file(pathlib.Path(__file__)),
               'evidence_class': 'actual-r2-archive-and-saved-altered-inputs'}
    (EVIDENCE / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary, indent=2))
