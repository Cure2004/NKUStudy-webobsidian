#!/usr/bin/env python3
"""Run existing 16 volume and 19 cgroup contracts against package-owned r3 modules.

Redirects all test evidence; never executes Docker. Uses explicit synthetic
resource limits instead of private historical sampler files, and supplies the
new non-secret environment projection to the old mocked inspect transport.
Usage: run_legacy_contracts.py R3_PACKAGE REPOSITORY NEW_EVIDENCE
"""
import hashlib
import importlib.util
import json
import pathlib
import sys
import unittest

sys.dont_write_bytecode = True
package = pathlib.Path(sys.argv[1]).resolve(strict=True)
repo = pathlib.Path(sys.argv[2]).resolve(strict=True)
evidence = pathlib.Path(sys.argv[3]).resolve()
evidence.mkdir(parents=True, exist_ok=False, mode=0o700)
sys.path.insert(0, str(package))
import deploy
import manifest
import snapshot
import storage
import validate_runtime

assert all(pathlib.Path(m.__file__).parent == package for m in (deploy, manifest, snapshot, storage, validate_runtime))
modules = []
sources = {}
for name in ('test_volumes_r2', 'test_cgroup_r3'):
    path = repo / 'scripts' / '4b' / 'offline' / (name + '.py')
    spec = importlib.util.spec_from_file_location(name + '_under_r3', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.EVIDENCE = evidence / name
    module.PACKAGE = package
    modules.append(module)
    sources[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()

def synthetic_resource_input(role):
    values = {'memory.max': '536870912' if role == 'app' else '134217728',
              'memory.swap.max': '0', 'pids.max': '96' if role == 'app' else '32',
              'cpu.max': '50000 100000' if role == 'app' else '10000 100000'}
    modules[1].INPUTS[role] = {'evidence_class': 'synthetic-all-fields-no-container-observation',
                               'synthetic_fields': values,
                               'probe_output': modules[1].output(values)}
    return values
modules[1].saved_input = synthetic_resource_input

original_instance = modules[1].CgroupTests.instance
def current_environment_fixture(self, *args, **kwargs):
    instance, docker = original_instance(self, *args, **kwargs)
    inherited_inspect = instance.inspect.side_effect
    def inspect(name, template):
        if 'range .Config.Env' in template:
            return 'NODE_ENV=production\nTRUST_PROXY=1\n'
        return inherited_inspect(name, template)
    instance.inspect.side_effect = inspect
    return instance, docker
modules[1].CgroupTests.instance = current_environment_fixture

suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromModule(m) for m in modules)
with (evidence / 'unittest-output.txt').open('x') as stream:
    result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
summary = {'status': 'PASS' if result.wasSuccessful() else 'FAIL', 'unittest_cases': result.testsRun,
    'failures': len(result.failures), 'errors': len(result.errors),
    'failed_cases': [str(t) for t, _ in result.failures + result.errors],
    'source_test_sha256': sources, 'runtime_module_root': str(package),
    'environment_fixture_adaptation': 'new r3 inspect projection returns synthetic NODE_ENV=production and TRUST_PROXY=1',
    'evidence_class': 'synthetic-Docker-and-synthetic-cgroup-contracts-not-real-containers', 'Docker_commands': False,
    'historical_evidence_untouched': True}
(evidence / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=2))
raise SystemExit(0 if result.wasSuccessful() else 1)
