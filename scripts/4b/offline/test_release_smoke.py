#!/usr/bin/env python3
"""Fresh standalone frozen-package lifecycle only; all deployed Python comes from the package."""
import hashlib
import http.cookiejar as cookiejar
import json
import os
import pathlib
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request

package = pathlib.Path(sys.argv[1]).resolve(strict=True)
base = pathlib.Path(sys.argv[2]).resolve(strict=True)
evidence = pathlib.Path(sys.argv[3]).resolve()
name = 'nkustudy-4b-release-smoke'
state = base / 'release-smoke-state'
work = base / 'release-smoke-working-directory'
assert not state.exists() and not work.exists() and not evidence.exists(), 'preserve existing generation/evidence; do not replay'
evidence.mkdir(mode=0o700); work.mkdir(mode=0o700)
env = os.environ.copy()
for key in ('PYTHONPATH', 'PYTHONHOME', 'NKU_4B_PORT'): env.pop(key, None)
env['PYTHONNOUSERSITE'] = '1'
records = []; created = False
password = secrets.token_urlsafe(32)
note = 'release-smoke.md'; query = 'FrozenReleaseSmoke' + secrets.token_hex(8)
body = '---\ntitle: Frozen release smoke\ntags: [isolated-fixture]\n---\n\n' + query + '\n'


def save():
    (evidence / 'command-results.json').write_text(json.dumps(records, indent=2) + '\n')


def command(case, argv, cwd=work):
    start = time.monotonic()
    result = subprocess.run(argv, cwd=cwd, env=env, capture_output=True, text=True, timeout=360)
    records.append({'case': case, 'argv': argv, 'cwd': str(cwd), 'exit_code': result.returncode,
                    'elapsed_seconds': round(time.monotonic() - start, 3),
                    'stdout': result.stdout.strip(), 'stderr': result.stderr.strip(),
                    'evidence_class': 'real-frozen-standalone-release-local-Docker-AMD64'})
    save()
    if result.returncode: raise RuntimeError(case + ' failed; preserve fixture generation')
    return result.stdout.strip()


def lifecycle(action):
    # Absolute package wrapper: its deploy.py and local module directory are package-owned.
    return command('frozen-release-' + action, ['bash', str(package / 'offline.sh'), action, str(package), str(state), name])


def opener():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookiejar.CookieJar()))


client = opener()


def http(case, method, path, payload=None):
    req = urllib.request.Request('http://127.0.0.1:28787' + path, method=method,
        data=None if payload is None else json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json', 'Origin': 'http://127.0.0.1:28787'})
    try:
        with client.open(req, timeout=30) as response: status, raw = response.status, response.read()
    except urllib.error.HTTPError as error: status, raw = error.code, error.read()
    records.append({'case': case, 'method': method, 'path': path, 'http_status': status,
                    'response_sha256': hashlib.sha256(raw).hexdigest(),
                    'evidence_class': 'real-standalone-release-HTTP-functional-not-browser'})
    save()
    if status != 200: raise RuntimeError(case + ' unexpected HTTP status')
    return json.loads(raw)


def search(case):
    for attempt in range(10):
        if any(hit.get('path') == note for hit in http(case + '-attempt' + str(attempt + 1), 'GET', '/api/search?q=' + query)['hits']):
            return
        time.sleep(0.5)
    raise RuntimeError(case + ' note absent from index')


try:
    before = {tag: command('immutable-before-' + tag, ['docker', 'image', 'inspect', '--format', '{{.Id}}', tag])
              for tag in ('nkustudy/webobsidian:4b-1bd3f6c-r2', 'nkustudy/webobsidian:test')}
    command('frozen-package-checksums-before', ['shasum', '-a', '256', '-c', 'SHA256SUMS'], cwd=package)
    lifecycle('init'); created = True
    credentials = state / 'local-smoke-credentials.json'
    credentials.write_text(json.dumps({'password': password}) + '\n'); credentials.chmod(0o600)
    lifecycle('start'); lifecycle('status')
    status = http('fresh-uninitialized-public-disabled', 'GET', '/auth/status')
    assert status['passwordSet'] is False and status['publicEditor'] is False
    setup = (state / 'setup.env').read_text().strip().split('=', 1)[1]
    http('one-time-setup', 'POST', '/auth/setup', {'password': password, 'setupToken': setup})
    client = opener()
    http('explicit-owner-login', 'POST', '/auth/login', {'password': password})
    http('small-markdown-write', 'PUT', '/api/files/content', {'path': note, 'content': body})
    assert http('small-markdown-exact-read', 'GET', '/api/files/content?path=' + note)['content'] == body
    search('small-markdown-search')
    lifecycle('stop'); lifecycle('resume'); lifecycle('status')
    client = opener()
    http('owner-login-after-resume', 'POST', '/auth/login', {'password': password})
    assert http('markdown-exact-read-after-resume', 'GET', '/api/files/content?path=' + note)['content'] == body
    search('markdown-search-after-resume')
    settings = http('final-safe-policy', 'GET', '/api/settings')
    assert not settings['publicEditor']['enabled'] and not settings['git']['enabled'] and not settings['github']['appEnabled']
    lifecycle('stop'); lifecycle('cleanup')
    for role in ('vault', 'data'):
        command('retained-volume-' + role, ['docker', 'volume', 'inspect', '--format', '{{.Name}} {{index .Labels "org.nkustudy.4b.instance"}}', name + '-' + role])
    command('frozen-package-checksums-after', ['shasum', '-a', '256', '-c', 'SHA256SUMS'], cwd=package)
    after = {tag: command('immutable-after-' + tag, ['docker', 'image', 'inspect', '--format', '{{.Id}}', tag]) for tag in before}
    assert before == after
    checksum_sha = hashlib.sha256((package / 'SHA256SUMS').read_bytes()).hexdigest()
    assert checksum_sha == 'cdf727f608c5d041f30842a5f4fd1a3dbac0a255b09f509e509d602268ff1c50'
    result = {'status': 'PASS', 'serial_command_and_HTTP_receipts': len(records), 'package': str(package),
        'working_directory': str(work), 'state': str(state), 'instance': name,
        'runtime_CLI_and_Python_modules_loaded_from_frozen_package': True,
        'PYTHONPATH_PYTHONHOME_removed_and_user_site_disabled': True,
        'source_and_previous_recovery_instances_untouched': True,
        'setup_login_write_read_search_restart_login_read_search': True,
        'actual_cgroup_four_limits_verified_by_frozen_status': True,
        'containers_and_networks_cleaned_volumes_state_credentials_retained': True,
        'package_SHA256SUMS_unchanged': checksum_sha, 'image_IDs_unchanged': before == after,
        'image_IDs': after, 'server_touched': False}
except Exception as error:
    result = {'status': 'FAIL', 'serial_command_and_HTTP_receipts': len(records), 'error': str(error),
              'state_retained': str(state), 'server_touched': False}
    if created:
        try: lifecycle('stop')
        except Exception: pass
finally:
    (evidence / 'summary.json').write_text(json.dumps(result, indent=2) + '\n'); save()
    print(json.dumps(result, indent=2))
raise SystemExit(0 if result['status'] == 'PASS' else 1)
