#!/usr/bin/env python3
"""No Docker calls: saved resource inputs plus explicit synthetic CPU/controller fixtures."""
import contextlib
import copy
import hashlib
import io
import json
import pathlib
import shlex
import subprocess
import unittest
from unittest.mock import Mock, patch
import deploy
from validate_runtime import CGROUP_PROBE, validate_cgroup

REPO = pathlib.Path(__file__).resolve().parents[3]
EVIDENCE = REPO / 'docs/nkustudy/4b-preflight/evidence/offline/volumes-r2/cgroup-r3'
INPUTS = {}


def saved_input(role):
    path = REPO / ('docs/nkustudy/4b-preflight/evidence/container/r2/resources-final-' + role + '.jsonl')
    raw = path.open().readline()
    item = json.loads(raw)
    if item['cgroup']['exitCode'] != 0:
        raise ValueError('saved resource input failed')
    lines = item['cgroup']['stdout'].splitlines()
    values = {key: lines[lines.index(key) + 1] for key in ('memory.max', 'memory.swap.max', 'pids.max')}
    # The old sampler did not read cpu.max. Never claim this expected CPU fixture was observed.
    values['cpu.max'] = '50000 100000' if role == 'app' else '10000 100000'
    INPUTS[role] = {'source': str(path.relative_to(REPO)), 'saved_first_line': raw,
                    'saved_line_sha256': hashlib.sha256(raw.encode()).hexdigest(),
                    'observed_fields': ['memory.max', 'memory.swap.max', 'pids.max'],
                    'synthetic_fields': {'cpu.max': values['cpu.max']}, 'probe_output': output(values)}
    return values


def output(values):
    return '\n'.join(key + '=' + values[key] for key in ('memory.max', 'memory.swap.max', 'pids.max', 'cpu.max'))


class CgroupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        EVIDENCE.mkdir(parents=True, exist_ok=True)
        cls.samples = {role: saved_input(role) for role in ('app', 'relay')}
        cls.negatives = []
        cls.shell_receipts = []

    @classmethod
    def tearDownClass(cls):
        (EVIDENCE / 'saved-and-synthetic-inputs.json').write_text(json.dumps(INPUTS, indent=2) + '\n')
        (EVIDENCE / 'negative-inputs.json').write_text(json.dumps(cls.negatives, indent=2) + '\n')
        (EVIDENCE / 'probe-command.sh').write_text(CGROUP_PROBE + '\n')
        (EVIDENCE / 'host-shell-fixture-receipts.json').write_text(json.dumps(cls.shell_receipts, indent=2) + '\n')

    def instance(self, running='true', fail_exec=False, limits=None):
        instance = object.__new__(deploy.Instance)
        instance.name = 'nkustudy-4b-cgroup-contract'; instance.relay = instance.name + '-relay'
        instance.internal = instance.name + '-internal'; instance.ingress = instance.name + '-ingress'
        instance.state = pathlib.Path('/synthetic/private/state'); instance.port = '28787'
        instance.package = pathlib.Path('/synthetic/package'); instance.image_id = 'sha256:' + 'a' * 64
        instance.store = Mock(); instance.store.check.return_value = {'vault': {}, 'data': {}}
        instance.check_image = Mock(); instance.check_state = Mock(); instance.identity = Mock()
        instance.inspect = Mock(side_effect=lambda name, template: '{}' if template == deploy.FILTER else running)
        def docker(*args, **kwargs):
            if args[0] == 'exec':
                if fail_exec: raise ValueError('Docker command failed: exec; preserve candidate state')
                role = 'relay' if args[1].endswith('-relay') else 'app'
                return output(limits if limits is not None else self.samples[role])
            if args[:2] == ('network', 'inspect'):
                return ('true ' if args[-1].endswith('-internal') else 'false ') + instance.name
            return ''
        return instance, Mock(side_effect=docker)

    def test_01_saved_app_memory_pids_with_synthetic_cpu_positive(self):
        self.assertEqual(validate_cgroup(output(self.samples['app']), 'app')['memory.max'], '536870912')

    def test_02_saved_relay_memory_pids_with_synthetic_cpu_positive(self):
        self.assertEqual(validate_cgroup(output(self.samples['relay']), 'relay')['pids.max'], '32')

    def test_03_equivalent_cpu_ratios(self):
        for role, cpu in (('app', '25000 50000'), ('relay', '5000 50000')):
            sample = dict(self.samples[role], **{'cpu.max': cpu})
            self.assertEqual(validate_cgroup(output(sample), role)['cpu.max'], cpu)

    def test_04_unlimited_and_drift_rejected(self):
        changes = [('memory.max', 'max'), ('memory.max', '1073741824'), ('memory.max', '0'),
                   ('memory.swap.max', 'max'), ('memory.swap.max', '134217728'),
                   ('pids.max', 'max'), ('pids.max', '256'), ('pids.max', '0'),
                   ('cpu.max', 'max 100000'), ('cpu.max', '100000 100000'),
                   ('cpu.max', '0 100000'), ('cpu.max', '50000 0')]
        for role in ('app', 'relay'):
            for field, value in changes:
                sample = dict(self.samples[role], **{field: value})
                with self.assertRaises(ValueError): validate_cgroup(output(sample), role)
                self.negatives.append({'role': role, 'field': field, 'value': value, 'rejected': True})

    def test_05_incomplete_or_malformed_output_rejected(self):
        base = output(self.samples['app'])
        cases = ['', '\n'.join(base.splitlines()[:-1]), base + '\nunknown=0',
                 base.replace('memory.max=', 'pids.max=', 1), base.replace('cpu.max=50000 100000', 'cpu.max=0.5'),
                 base.replace('cpu.max=50000 100000', 'cpu.max=50000  100000'),
                 base.replace('memory.swap.max=0', 'memory.swap.max=-1')]
        for value in cases:
            with self.assertRaises(ValueError): validate_cgroup(value, 'app')
            self.negatives.append({'role': 'app', 'probe_output': value, 'rejected': True})

    def test_06_unknown_role_rejected(self):
        with self.assertRaises(ValueError): validate_cgroup(output(self.samples['app']), 'unknown')

    def test_07_running_checks_both_nonprivileged_shells(self):
        instance, docker = self.instance()
        with patch('deploy.docker', docker), patch('validate_runtime.validate'):
            result = instance.check_runtime()
        self.assertEqual([result[r]['status'] for r in ('app', 'relay')], ['VERIFIED', 'VERIFIED'])
        calls = [c.args for c in docker.call_args_list if c.args[0] == 'exec']
        self.assertEqual(calls, [('exec', instance.name, 'sh', '-eu', '-c', CGROUP_PROBE),
                                 ('exec', instance.relay, 'sh', '-eu', '-c', CGROUP_PROBE)])

    def test_08_stopped_metadata_has_no_exec_or_enforcement_pass(self):
        instance, docker = self.instance(running='false')
        with patch('deploy.docker', docker), patch('validate_runtime.validate'):
            result = instance.check_runtime()
        self.assertEqual([result[r]['status'] for r in ('app', 'relay')], ['NOT-AVAILABLE', 'NOT-AVAILABLE'])
        self.assertFalse(any(c.args[0] == 'exec' for c in docker.call_args_list))

    def test_09_stopped_instances_cannot_satisfy_readiness(self):
        instance, docker = self.instance(running='false')
        with patch('deploy.docker', docker), patch('validate_runtime.validate'):
            with self.assertRaises(ValueError): instance.require_enforcement()

    def test_10_exec_read_permission_failure_closed(self):
        instance, docker = self.instance(fail_exec=True)
        with patch('deploy.docker', docker), patch('validate_runtime.validate'):
            with self.assertRaises(ValueError): instance.check_runtime()

    def test_11_valid_hostconfig_cannot_mask_actual_drift(self):
        bad = dict(self.samples['app'], **{'memory.max': 'max'})
        instance, docker = self.instance(limits=bad)
        with patch('deploy.docker', docker), patch('validate_runtime.validate'):
            with self.assertRaises(ValueError): instance.check_runtime()

    def test_12_status_stopped_explicitly_metadata_only(self):
        instance, docker = self.instance(running='false'); stream = io.StringIO()
        with patch('deploy.docker', docker), patch('validate_runtime.validate'), contextlib.redirect_stdout(stream):
            instance.status()
        self.assertEqual(stream.getvalue().count('NOT-AVAILABLE'), 2)
        self.assertNotIn('VERIFIED', stream.getvalue())

    def test_13_start_enforcement_failure_stops_owned_only(self):
        instance, docker = self.instance(); instance.ensure_absent = Mock(); instance.auth_arguments = Mock(return_value=[])
        instance.common = Mock(return_value=['run', '--detach']); instance.store.mounts.return_value = []
        instance.wait_health = Mock(side_effect=ValueError('actual cgroup unreadable')); instance.stop_owned = Mock()
        with patch('deploy.docker', docker), patch('deploy.socket.socket'):
            with self.assertRaises(ValueError): instance.start()
        instance.stop_owned.assert_called_once()
        self.assertFalse(any(c.args[0] in ('rm', 'volume') for c in docker.call_args_list))

    def test_14_resume_failure_stops_owned_only(self):
        instance, docker = self.instance(running='false')
        instance.check_runtime = Mock(return_value={}); instance.wait_health = Mock(side_effect=ValueError('actual cgroup unreadable'))
        instance.stop_owned = Mock()
        with patch('deploy.docker', docker):
            with self.assertRaises(ValueError): instance.resume()
        instance.stop_owned.assert_called_once()
        self.assertFalse(any(c.args[0] in ('rm', 'volume') for c in docker.call_args_list))

    def test_15_readiness_does_not_curl_without_enforcement(self):
        instance, _ = self.instance(); instance.require_enforcement = Mock(side_effect=ValueError('actual cgroup unavailable'))
        with patch('deploy.subprocess.run') as process:
            with self.assertRaises(ValueError): instance.wait_health()
        process.assert_not_called()

    def test_16_cli_exec_failure_is_not_optional_absence(self):
        result = subprocess.CompletedProcess([], 1, '', 'cat: cpu.max: Permission denied\n')
        with patch('deploy.subprocess.run', return_value=result):
            with self.assertRaises(ValueError): deploy.docker('exec', 'nkustudy-4b-fixture', 'sh', '-eu', '-c', CGROUP_PROBE)

    def test_17_unknown_running_state_fails_before_exec(self):
        instance, docker = self.instance(running='unavailable')
        with patch('deploy.docker', docker), patch('validate_runtime.validate'):
            with self.assertRaises(ValueError): instance.check_runtime()
        self.assertFalse(any(c.args[0] == 'exec' for c in docker.call_args_list))

    def shell_fixture(self, name, missing=None, empty=None, controller=True):
        root = EVIDENCE / 'shell-fixtures' / name; root.mkdir(parents=True, exist_ok=False)
        if controller: (root / 'cgroup.controllers').write_text('memory pids cpu\n')
        for key, value in self.samples['app'].items():
            if key != missing: (root / key).write_text('' if key == empty else value + '\n')
        command = CGROUP_PROBE.replace('/sys/fs/cgroup', shlex.quote(str(root)))
        process = subprocess.run(['/bin/sh', '-eu', '-c', command], capture_output=True, text=True, timeout=5)
        self.shell_receipts.append({'case': name, 'root_substitution': str(root),
            'scope': 'real-host-shell-with-saved-synthetic-files-not-kernel-enforcement',
            'command': command, 'exit_code': process.returncode, 'stdout': process.stdout, 'stderr': process.stderr})
        return process

    def test_18_shell_missing_v2_file_and_read_failure_closed(self):
        for name, options in (('missing-v2-controller-marker', {'controller': False}),
                              ('missing-cpu-file', {'missing': 'cpu.max'}),
                              ('empty-memory-read-failed', {'empty': 'memory.max'})):
            self.assertNotEqual(self.shell_fixture(name, **options).returncode, 0)

    def test_19_shell_normal_reads_fixed_files_only(self):
        result = self.shell_fixture('normal-fixed-files')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(validate_cgroup(result.stdout, 'app')['memory.max'], '536870912')


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(CgroupTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    summary = {'evidence_class': 'saved-real-three-fields-plus-explicit-synthetic-CPU-and-mocked-Docker-no-real-exec',
               'unittest_cases': result.testsRun, 'failed_cases': len(result.failures), 'errors': len(result.errors),
               'passed_cases': result.testsRun - len(result.failures) - len(result.errors),
               'limit_negative_inputs_within_case04': 24, 'malformed_inputs_within_case05': 7,
               'real_host_shell_saved_fixture_inputs_within_cases18_19': 4,
               'no_addition_of_assertions_or_subinputs_to_case_count': True, 'real_container_exec_calls': 0,
               'scripts': {p: hashlib.sha256((REPO / p).read_bytes()).hexdigest()
                           for p in ('scripts/4b/offline/deploy.py', 'scripts/4b/offline/validate_runtime.py', 'scripts/4b/offline/test_cgroup_r3.py')}}
    (EVIDENCE / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    raise SystemExit(0 if result.wasSuccessful() else 1)
