#!/usr/bin/env python3
"""Frozen r3 package and runtime contracts. Synthetic fixtures only; never calls Docker.

Usage: test_bindings.py R3_PACKAGE R2_PACKAGE NEW_EVIDENCE_DIRECTORY
Uses package-owned Python modules and preserves source package byte inventories.
"""
import copy
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import shutil
import subprocess
import sys
from contextlib import redirect_stdout
from unittest.mock import Mock, patch

sys.dont_write_bytecode = True
PACKAGE = pathlib.Path(sys.argv[1]).resolve(strict=True)
ORIGINAL = pathlib.Path(sys.argv[2]).resolve(strict=True)
EVIDENCE = pathlib.Path(sys.argv[3]).resolve()
EVIDENCE.mkdir(parents=True, exist_ok=False, mode=0o700)
sys.path.insert(0, str(PACKAGE))
import deploy
import validate_runtime as runtime
from manifest import read_manifest, verify

spec = importlib.util.spec_from_file_location('verify_package_r3', PACKAGE / 'verify-package.py')
package_validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package_validator)
RECORDS = []
SOURCE_HASHES = {}
ENV = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONNOUSERSITE='1')
for key in ('PYTHONPATH', 'PYTHONHOME'):
    ENV.pop(key, None)


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def inventory(root):
    assert all(p.is_file() and not p.is_symlink() for p in root.iterdir()), 'flat regular package required'
    return {p.name: {'sha256': sha(p), 'bytes': p.stat().st_size} for p in sorted(root.iterdir())}


def save():
    (EVIDENCE / 'command-results.json').write_text(json.dumps(RECORDS, indent=2) + '\n')


def check(case, operation, *, reject=False, fixture=None):
    entry = {'case': case, 'expected': 'reject' if reject else 'accept',
             'evidence_class': 'local-package-or-synthetic-runtime-contract-no-Docker'}
    if fixture is not None:
        entry['input'] = fixture
    try:
        with redirect_stdout(io.StringIO()):
            value = operation()
        if value is False:
            raise AssertionError('assertion returned false')
        assert not reject, 'unexpected acceptance'
        entry['passed'] = True
    except (ValueError, KeyError, TypeError, OSError) as error:
        entry['error'] = str(error)
        entry['passed'] = reject
    except Exception as error:
        entry['error'] = str(error)
        entry['passed'] = False
    RECORDS.append(entry)
    save()
    return entry['passed']


def run(command):
    result = subprocess.run(command, text=True, capture_output=True, env=ENV, timeout=180)
    if result.returncode:
        raise ValueError(result.stderr.strip() or result.stdout.strip() or 'nonzero subprocess')
    return True


def sums(root):
    (root / 'SHA256SUMS').write_text(''.join(sha(p) + '  ' + p.name + '\n'
        for p in sorted(root.iterdir()) if p.name != 'SHA256SUMS' and p.is_file()))


def mutate(case, operation, *, rehash=False):
    """Each input is saved; each working copy is independent and retained."""
    root = EVIDENCE / 'package-fixtures' / case
    root.mkdir(parents=True)
    for source in PACKAGE.iterdir():
        # Tar is never changed in these fixture tests. Ordinary copies preserve r2 inode ownership.
        shutil.copyfile(source, root / source.name)
    operation(root)
    if rehash:
        sums(root)
    check(case, lambda: package_validator.verify_package(root), reject=True,
          fixture={'package': str(root), 'rehash_SHA256SUMS': rehash})


def change_profile(root, update):
    path = root / 'deployment-release.json'
    value = json.loads(path.read_text())
    update(value)
    path.write_text(json.dumps(value, indent=2) + '\n')


def runtime_fixture(role):
    app = role == 'app'
    name = 'nkustudy-4b-r3-contract'
    volumes = {r: {'Name': name + '-' + r, 'Mountpoint': '/var/lib/docker/volumes/' + name + '-' + r + '/_data'} for r in ('vault', 'data')}
    value = {'memory': 536870912 if app else 134217728, 'swap': 536870912 if app else 134217728,
        'cpu': 500000000 if app else 100000000, 'pids': 96 if app else 32,
        'readonly': True, 'privileged': False, 'user': '1000:1000',
        'caps': ['ALL'], 'capadd': None, 'security': ['no-new-privileges:true'],
        'network': name + ('-internal' if app else '-ingress'), 'init': True, 'restart': 'no',
        'ports': {} if app else {'8787/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '28787'}]},
        'networks': {n: {} for n in ([name + '-internal'] if app else [name + '-internal', name + '-ingress'])},
        'mounts': [{'Type': 'volume', 'Destination': '/' + r, 'Name': volumes[r]['Name'], 'Source': volumes[r]['Mountpoint'], 'RW': True} for r in ('vault', 'data')]
            if app else [{'Type': 'bind', 'Destination': '/relay.mjs', 'Source': str(PACKAGE / 'relay.mjs'), 'RW': False}],
        'tmpfs': {'/tmp': 'rw,nosuid,nodev,noexec,size=' + ('64m' if app else '16m') + ',mode=1777'},
        'entrypoint': ['/usr/local/bin/nkustudy-entrypoint'] if app else ['node'],
        'cmd': [] if app else ['--max-old-space-size=16', '/relay.mjs', name],
        'path': '/usr/local/bin/nkustudy-entrypoint' if app else 'node',
        'args': [] if app else ['--max-old-space-size=16', '/relay.mjs', name]}
    return value, volumes, name


def assert_runtime(value, role):
    _, volumes, name = runtime_fixture(role)
    return runtime.validate(value, '/synthetic/state', name, '28787', role, str(PACKAGE), volumes)


def cgroup_fixture(role):
    return '\n'.join(['memory.max=' + ('536870912' if role == 'app' else '134217728'),
                      'memory.swap.max=0', 'pids.max=' + ('96' if role == 'app' else '32'),
                      'cpu.max=' + ('50000 100000' if role == 'app' else '10000 100000')])


def guarded_runtime(environment):
    instance = object.__new__(deploy.Instance)
    instance.name = 'nkustudy-4b-r3-contract'; instance.relay = instance.name + '-relay'
    instance.internal = instance.name + '-internal'; instance.ingress = instance.name + '-ingress'
    instance.state = pathlib.Path('/synthetic/state'); instance.port = '28787'; instance.package = PACKAGE
    instance.check_image = Mock(); instance.check_state = Mock(); instance.identity = Mock()
    instance.store = Mock(); instance.store.check.return_value = runtime_fixture('app')[1]
    def inspect(name, template, optional=False):
        if 'range .Config.Env' in template:
            return environment
        if template == deploy.FILTER:
            return json.dumps(runtime_fixture('relay' if name.endswith('-relay') else 'app')[0])
        if template == '{{.State.Running}}':
            return 'true'
        raise ValueError('unexpected inspect template')
    instance.inspect = Mock(side_effect=inspect)
    def docker(*args, **kwargs):
        if args[0] == 'exec':
            return cgroup_fixture('relay' if args[1].endswith('-relay') else 'app')
        if args[:2] == ('network', 'inspect'):
            return ('true ' if args[-1].endswith('-internal') else 'false ') + instance.name
        raise ValueError('unexpected synthetic Docker operation')
    fake = Mock(side_effect=docker)
    with patch('deploy.docker', fake):
        result = instance.check_runtime()
    assert all(result[r]['status'] == 'VERIFIED' for r in ('app', 'relay'))
    return True


try:
    SOURCE_HASHES = {'r2': inventory(ORIGINAL), 'r3': inventory(PACKAGE)}
    (EVIDENCE / 'source-packages-before.json').write_text(json.dumps(SOURCE_HASHES, indent=2) + '\n')
    check('full-frozen-r3-package', lambda: package_validator.verify_package(PACKAGE))
    check('package-wrapper-verify', lambda: run(['bash', str(PACKAGE / 'offline.sh'), 'verify', str(PACKAGE)]))
    check('archive-label-layer-identities', lambda: verify(*read_manifest(PACKAGE)))
    check('release-json-byte-identical-to-r2', lambda: (PACKAGE / 'release.json').read_bytes() == (ORIGINAL / 'release.json').read_bytes())
    retained = ['Dockerfile', 'container-entrypoint.sh', 'manifest.py', 'relay.mjs', 'snapshot.py',
                'storage.py', 'source-manifest.json', 'nkustudy-webobsidian-4b-1bd3f6c-r2-linux-amd64.tar']
    for name in retained:
        check('immutable-r2-member-' + name, lambda n=name: sha(PACKAGE / n) == sha(ORIGINAL / n))
    for name in ['deploy.py', 'validate_runtime.py', 'offline.sh', 'verify-package.py', 'deployment-release.json', 'release.json', 'relay.mjs']:
        mutate('tampered-' + name, lambda root, n=name: (root / n).write_bytes((root / n).read_bytes() + b'\n# isolated corruption\n'))
    mutate('missing-member', lambda root: (root / 'deploy.py').unlink())
    mutate('undeclared-file', lambda root: (root / 'unexpected.txt').write_text('isolated fixture\n'))
    mutate('undeclared-directory', lambda root: (root / '__pycache__').mkdir())
    mutate('duplicate-checksum', lambda root: (root / 'SHA256SUMS').write_text((root / 'SHA256SUMS').read_text() + (root / 'SHA256SUMS').read_text().splitlines()[0] + '\n'))
    mutate('checksum-traversal', lambda root: (root / 'SHA256SUMS').write_text('0' * 64 + '  ../escape\n'))
    def symlink(root):
        (root / 'relay.mjs').unlink(); (root / 'relay.mjs').symlink_to(PACKAGE / 'relay.mjs')
    mutate('symlink-member', symlink)
    mutate('wrong-deployment-version', lambda root: change_profile(root, lambda p: p.update(deployment_version='r2')), rehash=True)
    mutate('wrong-trust-proxy-profile', lambda root: change_profile(root, lambda p: p.update(trust_proxy=True)), rehash=True)
    mutate('wrong-bound-script-hash', lambda root: change_profile(root, lambda p: p['deployment_files'].update({'deploy.py': '0' * 64})), rehash=True)
    mutate('missing-deployment-binding', lambda root: change_profile(root, lambda p: p['deployment_files'].pop('deploy.py')), rehash=True)
    mutate('empty-deployment-bindings', lambda root: change_profile(root, lambda p: p.update(deployment_files={})), rehash=True)
    # Entrypoint/package mismatch must be refused before any Docker CLI is reached.
    alternate = EVIDENCE / 'package-fixtures' / 'alternate-package-argument'
    shutil.copytree(PACKAGE, alternate)
    check('wrapper-rejects-alternate-package-argument',
          lambda: run(['bash', str(PACKAGE / 'offline.sh'), 'verify', str(alternate)]), reject=True)

    for value in ['NODE_ENV=production\nTRUST_PROXY=1\n', 'TRUST_PROXY=1\nNODE_ENV=production\nCOOKIE_SECURE=auto\n']:
        check('proxy-environment-positive-' + str(len(RECORDS)), lambda v=value: runtime.validate_proxy_environment(v), fixture=value)
    invalid_env = ['', 'NODE_ENV=production\n', 'TRUST_PROXY=1\n', 'NODE_ENV=development\nTRUST_PROXY=1\n',
        'NODE_ENV=production\nTRUST_PROXY=true\n', 'NODE_ENV=production\nTRUST_PROXY=false\n',
        'NODE_ENV=production\nTRUST_PROXY=2\n', 'NODE_ENV=production\nTRUST_PROXY=1\nTRUST_PROXY=1\n',
        'NODE_ENV=production\nTRUST_PROXY=1\nCOOKIE_SECURE=false\n', 'NODE_ENV=production\nTRUST_PROXY=1\nCOOKIE_SECURE=true\n',
        'NODE_ENV=production\nTRUST_PROXY=1\nCOOKIE_SECURE=\n', 'NODE_ENV=production\nTRUST_PROXY=1\nUNRELATED=fixture\n']
    for i, value in enumerate(invalid_env):
        check('proxy-environment-negative-' + str(i + 1), lambda v=value: runtime.validate_proxy_environment(v), reject=True, fixture=value)
    check('check-runtime-integrates-proxy-positive', lambda: guarded_runtime('NODE_ENV=production\nTRUST_PROXY=1\n'))
    check('check-runtime-rejects-proxy-drift', lambda: guarded_runtime('NODE_ENV=production\nTRUST_PROXY=false\n'), reject=True)
    for role in ('app', 'relay'):
        value, _, _ = runtime_fixture(role)
        check(role + '-runtime-positive', lambda v=value, r=role: assert_runtime(v, r), fixture=value)
        negatives = [('memory', 0), ('swap', -1), ('cpu', 0), ('pids', 0), ('readonly', False),
            ('privileged', True), ('user', '0:0'), ('caps', []), ('capadd', ['NET_ADMIN']), ('security', []),
            ('network', 'host'), ('init', False), ('restart', 'always'), ('networks', {'foreign': {}}),
            ('tmpfs', {'/tmp': 'rw,size=1g'}), ('entrypoint', ['sh']), ('cmd', ['bad']), ('path', 'sh'), ('args', ['bad']),
            ('ports', {'8787/tcp': [{'HostIp': '0.0.0.0', 'HostPort': '28787'}]}), ('mounts', [])]
        for key, replacement in negatives:
            altered = copy.deepcopy(value); altered[key] = replacement
            check(role + '-runtime-drift-' + key, lambda v=altered, r=role: assert_runtime(v, r), reject=True, fixture={key: replacement})
        base = cgroup_fixture(role)
        check(role + '-cgroup-positive', lambda b=base, r=role: runtime.validate_cgroup(b, r), fixture=base)
        for key, replacement in [('memory.max', 'max'), ('memory.max', '0'), ('memory.swap.max', 'max'),
                ('memory.swap.max', '1'), ('pids.max', 'max'), ('pids.max', '0'), ('cpu.max', 'max 100000'),
                ('cpu.max', '100000 100000'), ('cpu.max', '0 100000'), ('cpu.max', '50000 0')]:
            altered = '\n'.join(key + '=' + replacement if line.startswith(key + '=') else line for line in base.splitlines())
            check(role + '-cgroup-drift-' + key + '-' + replacement.replace(' ', '_'),
                  lambda b=altered, r=role: runtime.validate_cgroup(b, r), reject=True, fixture=altered)
    check('r3-source-package-unchanged', lambda: inventory(PACKAGE) == SOURCE_HASHES['r3'])
    check('frozen-r2-package-unchanged', lambda: inventory(ORIGINAL) == SOURCE_HASHES['r2'])
except Exception as error:
    RECORDS.append({'case': 'runner-exception', 'passed': False, 'error': str(error)})
finally:
    save()
    result = {'status': 'PASS' if RECORDS and all(r['passed'] for r in RECORDS) else 'FAIL',
        'checks': len(RECORDS), 'passed': sum(r['passed'] for r in RECORDS),
        'failed_cases': [r['case'] for r in RECORDS if not r['passed']],
        'r3_package': str(PACKAGE), 'frozen_r2_package': str(ORIGINAL),
        'script_sha256': sha(pathlib.Path(__file__)), 'Docker_operations': False, 'server_operations': False,
        'evidence_class': 'frozen-package-integrity-and-synthetic-policy-contracts-not-runtime-acceptance'}
    (EVIDENCE / 'summary.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
sys.exit(0 if result['status'] == 'PASS' else 1)
