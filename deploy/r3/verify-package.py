#!/usr/bin/env python3
"""Verify the full deployment package before lifecycle mutations (not a signature)."""
import hashlib
import json
import pathlib
import re
import sys


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def verify_package(root):
    root = pathlib.Path(root).resolve(strict=True)
    checksums = root / 'SHA256SUMS'
    if checksums.is_symlink() or not checksums.is_file():
        raise ValueError('regular SHA256SUMS required')
    entries = {}
    for line in checksums.read_text().splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})  ([a-zA-Z0-9_.-]+)', line)
        if not match or match[2] in entries or match[2] == 'SHA256SUMS':
            raise ValueError('invalid/duplicate package manifest entry')
        entries[match[2]] = match[1]
    if set(p.name for p in root.iterdir()) != set(entries) | {'SHA256SUMS'}:
        raise ValueError('package file set mismatch; preserve original and investigate')
    for name, digest in entries.items():
        path = root / name
        if path.is_symlink() or not path.is_file() or sha(path) != digest:
            raise ValueError('package SHA256 mismatch: ' + name)
    profile = json.loads((root / 'deployment-release.json').read_text())
    if profile.get('deployment_version') != 'r3-https-20261023' or type(profile.get('trust_proxy')) is not int or profile.get('trust_proxy') != 1:
        raise ValueError('deployment profile mismatch')
    if set(profile) != {'deployment_version', 'trust_proxy', 'image_release', 'deployment_files', 'r2_SHA256SUMS_sha256', 'required_topology', 'server_status'}:
        raise ValueError('deployment metadata fields mismatch')
    required = {'deploy.py', 'validate_runtime.py', 'offline.sh', 'manifest.py', 'storage.py', 'snapshot.py', 'verify-package.py', 'Caddyfile.preview.example', 'release.json'}
    if not isinstance(profile.get('deployment_files'), dict) or set(profile['deployment_files']) != required:
        raise ValueError('deployment binding file set mismatch')
    if not isinstance(profile.get('r2_SHA256SUMS_sha256'), str) or not re.fullmatch(r'[0-9a-f]{64}', profile['r2_SHA256SUMS_sha256']):
        raise ValueError('r2 source checksum binding invalid')
    for name, digest in profile['deployment_files'].items():
        if not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest) or entries.get(name) != digest:
            raise ValueError('deployment binding mismatch: ' + name)
    print('PASS: full r3 deployment file set and SHA256 bindings verified')


if __name__ == '__main__':
    try:
        verify_package(sys.argv[1])
    except (ValueError, KeyError, TypeError, OSError, IndexError) as error:
        print('ERROR: ' + str(error), file=sys.stderr)
        sys.exit(1)
