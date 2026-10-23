#!/usr/bin/env python3
"""Local serial-window test: true offline commands + auth/write/recovery; no remote hosts."""
import hashlib
import http.cookiejar
import json
import os
import pathlib
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

if len(sys.argv)>1 and sys.argv[1]=='--recover-source':
    from recovery_real import main as recovery_main
    sys.exit(recovery_main(sys.argv[2:]))

HERE = pathlib.Path(__file__).resolve().parent
EVIDENCE = HERE.parents[2] / 'docs/nkustudy/4b-preflight/evidence/offline'
package = pathlib.Path(sys.argv[1]).resolve(strict=True)
base = pathlib.Path(sys.argv[2]).resolve(strict=True)
name = sys.argv[3]
state, restored = base / (name + '-state'), base / (name + '-restored')
restored_name = name + '-restored'
snapshot_dir = base / (name + '-private-snapshots')
snapshot_dir.mkdir(mode=0o700)
snapshot = snapshot_dir / 'fixture.tar'
password = secrets.token_urlsafe(32)
local_candidate=(package/'candidate.json').is_file()
mode=['--local-candidate'] if local_candidate else []
records = []
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
body = '---\ntitle: Offline recovery fixture\ntags: [4b-offline]\n---\n\nOfflineRecoverySentinelZebra640\n'


def save():
    EVIDENCE.joinpath('real-lifecycle-command-results.json').write_text(json.dumps(records, indent=2) + '\n')


def command(case, args):
    start = time.monotonic()
    process = subprocess.run(args, capture_output=True, text=True, timeout=240)
    records.append({'case': case, 'command': args[:3], 'exit_code': process.returncode,
                    'elapsed_seconds': round(time.monotonic() - start, 3), 'stdout': process.stdout.strip(),
                    'stderr': process.stderr.strip(), 'evidence_class': 'real-local-docker-amd64-under-emulation'})
    save()
    if process.returncode: raise RuntimeError(case + ' failed; candidate state retained')
    return process.stdout


def lifecycle(action, target=state, instance=name):
    return command(action + '-' + instance, ['bash', str(HERE / 'offline.sh'), *mode, action, str(package), str(target), instance])


def http(case, method, path, payload=None, expected=200):
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request('http://127.0.0.1:28787' + path, data=data, method=method,
                                     headers={'Content-Type': 'application/json', 'Origin': 'http://127.0.0.1:28787'})
    try:
        with opener.open(request, timeout=20) as response: status, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, raw = error.code, error.read()
    records.append({'case': case, 'method': method, 'path': path, 'http_status': status,
                    'expected': expected, 'response_sha256': hashlib.sha256(raw).hexdigest(),
                    'evidence_class': 'real-local-http-functional-assertion-not-browser'})
    save()
    if status != expected: raise RuntimeError(case + ': HTTP status differs')
    return json.loads(raw)


try:
    for action in (() if local_candidate else ('verify', 'load')):
        command(action, ['bash', str(HERE / 'offline.sh'), *mode, action, str(package)])
    lifecycle('init')
    credentials = state / 'local-test-credentials.json'
    credentials.write_text(json.dumps({'password': password}) + '\n'); credentials.chmod(0o600)
    lifecycle('start'); lifecycle('status')
    status = http('first-auth-status', 'GET', '/auth/status')
    assert status['passwordSet'] is False and status['publicEditor'] is False
    http('retired-password-rejected', 'POST', '/auth/login', {'password': '123456'}, 401)
    setup = state.joinpath('setup.env').read_text().strip().split('=', 1)[1]
    http('setup', 'POST', '/auth/setup', {'password': password, 'setupToken': setup})
    http('setup-replay-rejected', 'POST', '/auth/setup', {'password': password, 'setupToken': setup}, 409)
    http('write-fixture', 'PUT', '/api/files/content', {'path': 'offline-recovery.md', 'content': body})
    assert http('read-fixture', 'GET', '/api/files/content?path=offline-recovery.md')['content'] == body
    assert any(hit.get('path') == 'offline-recovery.md' for hit in http('search-fixture', 'GET', '/api/search?q=OfflineRecoverySentinelZebra640')['hits'])
    lifecycle('stop'); lifecycle('resume')
    assert http('resume-read-fixture', 'GET', '/api/files/content?path=offline-recovery.md')['content'] == body
    lifecycle('stop')
    command('snapshot-backup', ['python3', str(HERE / 'snapshot.py'), *mode, 'backup', str(package), str(state), name, str(snapshot)])
    digest = hashlib.sha256(snapshot.read_bytes()).hexdigest()
    command('snapshot-restore', ['python3', str(HERE / 'snapshot.py'), *mode, 'restore', str(package), str(snapshot), digest, str(restored), restored_name])
    lifecycle('cleanup')
    lifecycle('start', restored, restored_name)
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    http('restore-password-login', 'POST', '/auth/login', {'password': password})
    assert http('restore-content-exact', 'GET', '/api/files/content?path=offline-recovery.md')['content'] == body
    assert any(hit.get('path') == 'offline-recovery.md' for hit in http('restore-search-index', 'GET', '/api/search?q=OfflineRecoverySentinelZebra640')['hits'])
    assert not restored.joinpath('setup.env').exists()
    lifecycle('status', restored, restored_name)
    lifecycle('stop', restored, restored_name); lifecycle('cleanup', restored, restored_name)
    result = {'status': 'PASS', 'checks': len(records), 'private_fixture_state': str(state),
              'restored_state': str(restored), 'snapshot': str(snapshot), 'snapshot_sha256': digest,
              'setup_env_not_copied': True, 'original_state_retained': state.exists(),
              'restored_state_retained': restored.exists(), 'server_touched': False}
except Exception as error:
    result = {'status': 'FAIL', 'checks': len(records), 'error': str(error), 'state_retained': str(state), 'server_touched': False}
    for target, instance in ((restored, restored_name), (state, name)):
        if target.joinpath('.nkustudy-4b-instance').exists():
            try: lifecycle('stop', target, instance)
            except Exception: pass
finally:
    EVIDENCE.joinpath('real-lifecycle-summary.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    save()
if result['status'] != 'PASS': sys.exit(1)
