#!/usr/bin/env python3
"""Verify Docker classic + OCI/containerd save archives without extracting them."""
import gzip
import hashlib
import json
import pathlib
import re
import sys
import tarfile

DIGEST = re.compile(r'sha256:[0-9a-f]{64}')


def require(value, message):
    if not value:
        raise ValueError(message)


def sha_file(path):
    with path.open('rb') as stream:
        return hash_stream(stream)


def hash_stream(stream):
    result = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b''):
        result.update(block)
    return result.hexdigest()


def read_manifest(package):
    package = pathlib.Path(package).resolve(strict=True)
    require(not ((package/'release.json').exists() and (package/'candidate.json').exists()), 'ambiguous candidate/release directory')
    manifest_path = package / ('release.json' if (package/'release.json').exists() else 'candidate.json')
    require(manifest_path.is_file() and not manifest_path.is_symlink(), 'manifest must be regular')
    m = json.loads(manifest_path.read_text())
    base = {'format','image_tag','image_id','os','architecture','source_commit','code_commit','document_commit',
            'lock_sha256','build_config_sha256','source_manifest_sha256','relay_sha256'}
    archive_fields = {'image_config_digest','image_manifest_digest','image_index_digest','archive','archive_sha256'}
    if m.get('format') == 1:
        require(set(m)==base|archive_fields, 'legacy manifest fields mismatch')
    else:
        require(m.get('format')==2 and m.get('storage')=='docker-named-volumes', 'reviewed volume format2 required')
        extra={'kind','storage','entrypoint_sha256'}
        if m.get('kind')=='local-candidate':
            require(manifest_path.name=='candidate.json' and set(m)==base|extra|{'local_engine_id','local_docker_context'}, 'local candidate fields mismatch')
            require(m.get('local_engine_id') and m.get('local_docker_context'), 'local candidate engine binding missing')
        else:
            require(m.get('kind')=='release' and manifest_path.name=='release.json' and set(m)==base|extra|archive_fields, 'release fields mismatch')
    require(re.fullmatch(r'nkustudy/webobsidian:4b-[a-zA-Z0-9_.-]+',m['image_tag']), 'invalid tag')
    for key in ('image_id','image_config_digest','image_manifest_digest','image_index_digest'):
        if key not in m: continue
        require((m[key] is None and key in ('image_manifest_digest','image_index_digest')) or isinstance(m[key],str) and DIGEST.fullmatch(m[key]),'invalid '+key)
    for key in ('lock_sha256','build_config_sha256','source_manifest_sha256','relay_sha256','archive_sha256','entrypoint_sha256'):
        if key in m: require(isinstance(m[key],str) and re.fullmatch(r'[0-9a-f]{64}',m[key]),'invalid '+key)
    require(m['os']=='linux' and m['architecture']=='amd64','only linux/amd64 accepted')
    require(m['code_commit']=='1bd3f6c088466c8b46b447c9516cec623bc194f6','unreviewed application code')
    require(m['source_commit']==m['document_commit']=='cb3a96e8546844416258c1af64549724685eeb04','source baseline mismatch')
    require(m['lock_sha256']=='671963de571dfc611e7f370482640455928bde108ed0e7c9383fd633f090d7ed','lock mismatch')
    if 'archive' in m: require(re.fullmatch(r'[a-zA-Z0-9_.-]+\.tar',m['archive']),'invalid archive filename')
    for filename,key in [('Dockerfile','build_config_sha256'),('source-manifest.json','source_manifest_sha256'),('relay.mjs','relay_sha256')]:
        f=package/filename;require(f.is_file() and not f.is_symlink() and sha_file(f)==m[key],'reviewed '+filename+' SHA256 mismatch')
    source=json.loads((package/'source-manifest.json').read_text())
    require(source.get('source_commit')==m['source_commit'] and source.get('code_commit')==m['code_commit'],'source manifest baseline mismatch')
    expected=[('Dockerfile','build_config_sha256')]
    if m['format']==2:
        f=package/'container-entrypoint.sh';require(f.is_file() and not f.is_symlink() and sha_file(f)==m['entrypoint_sha256'],'fixed entrypoint SHA256 mismatch')
        expected.append(('scripts/4b/container-entrypoint.sh','entrypoint_sha256'))
    for filename,key in expected:
        matches=[x for x in source.get('files',[]) if x.get('path')==filename]
        require(len(matches)==1 and matches[0].get('sha256')==m[key],'source manifest does not bind '+filename)
    require(m['image_id'] in accepted_ids(m),'image ID outside archive/candidate identities')
    return package,m


def accepted_ids(m):
    if m.get('kind')=='local-candidate': return {m['image_id']}
    return {m[key] for key in ('image_config_digest','image_manifest_digest','image_index_digest') if m[key]}


def archive_info(archive):
    with tarfile.open(archive, 'r:') as tar:
        members = tar.getmembers()
        entries = {item.name: item for item in members}
        require(len(entries) == len(members), 'duplicate archive member')
        for item in members:
            p = pathlib.PurePosixPath(item.name)
            require(not p.is_absolute() and '..' not in p.parts and (item.isdir() or item.isreg()), 'unsafe archive member')
        def small(name):
            require(name in entries and entries[name].isreg() and entries[name].size <= 1024 * 1024, 'missing or oversized JSON member')
            return tar.extractfile(name).read()
        docker_entries = json.loads(small('manifest.json'))
        require(isinstance(docker_entries, list) and len(docker_entries) == 1, 'exactly one Docker save image required')
        image = docker_entries[0]
        tags = image.get('RepoTags')
        require(isinstance(tags, list) and len(tags) == 1 and re.fullmatch(r'nkustudy/webobsidian:4b-[a-zA-Z0-9_.-]+', tags[0]), 'exactly one approved candidate tag required')
        config_name = image['Config']
        config_raw = small(config_name)
        config_digest = 'sha256:' + hashlib.sha256(config_raw).hexdigest()
        config = json.loads(config_raw)
        require(config.get('os') == 'linux' and config.get('architecture') == 'amd64', 'runtime config is not linux/amd64')
        layers = image.get('Layers')
        require(isinstance(layers, list) and len(layers) == len(set(layers)), 'invalid or duplicate layer list')
        rootfs = config.get('rootfs', {})
        require(rootfs.get('type') == 'layers' and len(rootfs.get('diff_ids', [])) == len(layers), 'rootfs layer count mismatch')
        # OCI archive blob names are content addresses; hash every blob including attestations.
        for name, item in entries.items():
            if item.isreg() and name.startswith('blobs/'):
                require(re.fullmatch(r'blobs/sha256/[0-9a-f]{64}', name), 'unsupported blob hash algorithm/path')
                require(hash_stream(tar.extractfile(name)) == name.rsplit('/', 1)[1], 'blob SHA256 mismatch')
        manifest_digest = None
        index_digest = None
        if 'index.json' in entries:
            index = json.loads(small('index.json'))
            require(index.get('schemaVersion') == 2 and len(index.get('manifests', [])) == 1, 'OCI root must reference exactly one image')
            root = index['manifests'][0]
            annotations = root.get('annotations', {})
            require(annotations.get('io.containerd.image.name') in (tags[0], 'docker.io/' + tags[0]), 'OCI root tag mismatch')
            runtime_manifests = []
            seen = set()
            def descriptor(d):
                digest = d.get('digest', '')
                require(isinstance(digest, str) and DIGEST.fullmatch(digest), 'invalid OCI descriptor digest')
                name = 'blobs/' + digest.replace(':', '/')
                require(name in entries and entries[name].size == d.get('size'), 'OCI descriptor size/blob mismatch')
                return name
            # Bounded graph walk: attestations are metadata and never executable candidates.
            def walk(d, depth=0):
                require(depth <= 4 and len(seen) <= 32, 'OCI graph budget exceeded')
                name = descriptor(d)
                if d['digest'] in seen: return
                seen.add(d['digest'])
                value = json.loads(small(name))
                media = d.get('mediaType', '')
                if 'image.index' in media or 'manifest.list' in media:
                    children = value.get('manifests', [])
                    require(isinstance(children, list) and children, 'empty OCI index')
                    for child in children: walk(child, depth + 1)
                    return
                require('image.manifest' in media or 'manifest.v2' in media, 'unsupported OCI graph node')
                descriptor(value['config'])
                for layer in value.get('layers', []): descriptor(layer)
                if d.get('annotations', {}).get('vnd.docker.reference.type') == 'attestation-manifest':
                    require(d.get('annotations', {}).get('vnd.docker.reference.digest') and value.get('artifactType') == 'application/vnd.docker.attestation.manifest.v1+json', 'unrecognized attestation metadata')
                    return
                cfg = json.loads(small(descriptor(value['config'])))
                require(cfg.get('os') == 'linux' and cfg.get('architecture') == 'amd64', 'unexpected runnable architecture in OCI image')
                require(value['config']['digest'] == config_digest, 'Docker and OCI runtime config differ')
                require([descriptor(x) for x in value.get('layers', [])] == layers, 'Docker and OCI layer lists differ')
                runtime_manifests.append(d['digest'])
            walk(root)
            require(len(runtime_manifests) == 1, 'exactly one AMD64 runtime manifest required')
            manifest_digest = runtime_manifests[0]
            if 'image.index' in root.get('mediaType', '') or 'manifest.list' in root.get('mediaType', ''):
                index_digest = root['digest']
        for layer, expected_diff in zip(layers, rootfs['diff_ids']):
            require(isinstance(expected_diff, str) and DIGEST.fullmatch(expected_diff), 'invalid rootfs diff ID')
            require(layer in entries and entries[layer].isreg(), 'missing rootfs layer')
            stream = tar.extractfile(layer)
            magic = stream.read(2)
            stream.close()
            with tar.extractfile(layer) as raw:
                if magic == b'\x1f\x8b':
                    with gzip.GzipFile(fileobj=raw) as uncompressed: actual = hash_stream(uncompressed)
                else: actual = hash_stream(raw)
            require('sha256:' + actual == expected_diff, 'uncompressed rootfs layer digest mismatch')
        return {'image_tag': tags[0], 'image_config_digest': config_digest,
                'image_manifest_digest': manifest_digest, 'image_index_digest': index_digest,
                'os': config['os'], 'architecture': config['architecture'],
                'labels': config.get('config', {}).get('Labels', {}), 'rootfs_layers': len(layers),
                'runtime_entrypoint': config.get('config', {}).get('Entrypoint'),
                'runtime_cmd': config.get('config', {}).get('Cmd')}


def verify(package, m):
    require('archive' in m, 'local candidate has no approved offline archive')
    archive = package / m['archive']
    require(archive.is_file() and not archive.is_symlink(), 'archive must be regular')
    require(sha_file(archive) == m['archive_sha256'], 'archive SHA256 mismatch')
    info = archive_info(archive)
    if m.get('format') == 2:
        require(info['runtime_entrypoint'] == ['/usr/local/bin/nkustudy-entrypoint'] and
                info['runtime_cmd'] in (None, []), 'archived app startup guard mismatch')
    for key in ('image_tag', 'image_config_digest', 'image_manifest_digest', 'image_index_digest', 'os', 'architecture'):
        require(info[key] == m[key], 'archive ' + key + ' mismatch')
    for key, value in [('org.opencontainers.image.revision', m['source_commit']),
                       ('org.nkustudy.lock-sha256', m['lock_sha256']),
                       ('org.nkustudy.source-manifest-sha256', m['source_manifest_sha256'])]:
        require(info['labels'].get(key) == value, 'archive source/lock/build label mismatch')
    return info


def main():
    try:
        command, package_arg, *extra = sys.argv[1:]
        if command == 'describe':
            print(json.dumps(archive_info(pathlib.Path(package_arg)), indent=2)); return
        package, m = read_manifest(package_arg)
        if command == 'fields':
            for key in ('image_tag', 'image_id', 'source_commit', 'lock_sha256', 'archive', 'archive_sha256', 'source_manifest_sha256'):
                print(m[key])
        elif command == 'verify':
            verify(package, m)
            print('PASS: archive SHA256, all blobs, AMD64 config/rootfs, source/lock/build labels and exact image identities')
        elif command == 'accept-id':
            require(len(extra) == 1 and extra[0] in accepted_ids(m), 'post-load image ID is not a verified archive identity')
        else: raise ValueError('unknown command')
    except (ValueError, KeyError, TypeError, OSError, tarfile.TarError, json.JSONDecodeError) as error:
        print('ERROR: ' + str(error), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
