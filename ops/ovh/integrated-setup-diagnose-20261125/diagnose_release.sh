#!/usr/bin/env bash
set -euo pipefail

# Read only the failed release's two fixed logs. Private bytes stay on the host.
diagnostic_python() {
cat <<'PY'
import collections
import errno
import os
import pathlib
import re
import stat
import subprocess
import sys

BACKUP = pathlib.Path('/home/liftorbit-ci/liftorbit-migration/patch-backups/integrated-setup-release-20261125/45574565059-1')
LIMIT = 1024 * 1024
PREFIX = 'INTEGRATED_SETUP_DIAG'
SERVICES = ('postgres-main', 'postgres-auth', 'planner-gateway', 'auth-gateway', 'ga-worker', 'app')
SERVICE_RE = re.compile(r'LIFTORBIT_SERVICE (' + '|'.join(SERVICES) + r') state=(created|running|paused|restarting|removing|exited|dead|missing|unknown) health=(healthy|unhealthy|starting|none|missing|unknown|n/a) oom=(true|false|unknown)')
FAILURES = {
    'build_failure': r'failed to solve|failed to build|did not complete successfully|executor failed',
    'assertion_error': r'AssertionError|ERR_ASSERTION',
    'syntax_error': r'SyntaxError',
    'module_missing': r'ModuleNotFoundError|Cannot find module|Cannot find package|MODULE_NOT_FOUND',
    'permission_denied': r'PermissionError|EACCES|permission denied',
    'disk_full': r'No space left on device|ENOSPC',
    'out_of_memory': r'out of memory|OOMKilled',
    'timeout': r'timed out|ETIMEDOUT|TimeoutError',
    'connection_refused': r'connection refused|ECONNREFUSED',
    'dns_failure': r'EAI_AGAIN|ENOTFOUND|Temporary failure in name resolution',
    'unhealthy': r'container .{0,100} is unhealthy|service .{0,100} unhealthy',
    'nonzero_exit': r'exit code[: ]+[1-9][0-9]*|exited with code [1-9][0-9]*',
}
# Exact, already public build-patcher error labels; no arbitrary error messages.
PUBLIC_CODES = ('STOP_PATCH_abortUpstream_0', 'STOP_PATCH_rev_0', 'STOP_PATCH_capture_0', 'STOP_PATCH_signalInit_0', 'STOP_PATCH_blockLateFinal_0')
FILES = ('feature-stop.ts', 'build-bridge.ts', 'python-ga-upstream-build.ts', 'tenant-model-build.ts', 'ga-worker-build.ts', 'index.ts', 'Dockerfile', 'python-ga-upstream.test.mjs', 'python-ga-state.test.mjs', 'continuation-compat-contract.cjs', 'account-model-boundary.cjs', 'early-stop-contract.cjs', 'async-plan-transport-contract.cjs')
CLASSES = ('Error', 'TypeError', 'SyntaxError', 'ReferenceError', 'AssertionError', 'ModuleNotFoundError', 'PermissionError', 'TimeoutError')
ANSI_RE = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')

def emit(kind, suffix):
    print(PREFIX + '_' + kind + ' ' + suffix)

def summarize(label, value):
    value = ANSI_RE.sub('', value)
    lines = []
    def add(kind, suffix):
        lines.append(PREFIX + '_' + kind + ' ' + label + ' ' + suffix)
    for name, pattern in FAILURES.items():
        count = len(re.findall(pattern, value, flags=re.I))
        if count:
            add('MATCH', f'label={name} count={min(count, 1000000)}')
    for code in PUBLIC_CODES:
        count = len(re.findall(r'(?<![A-Za-z0-9_])' + re.escape(code) + r'(?![A-Za-z0-9_])', value))
        if count:
            add('PUBLIC_CODE', f'code={code} count={min(count, 1000000)}')
    for name in CLASSES:
        count = len(re.findall(r'(?<![A-Za-z0-9_])' + name + r'(?![A-Za-z0-9_])', value))
        if count:
            add('EXCEPTION', f'class={name} count={min(count, 1000000)}')
    frames = collections.Counter()
    for filename in FILES:
        pattern = r'(?<![A-Za-z0-9_.-])' + re.escape(filename) + r':([0-9]{1,7})(?::([0-9]{1,7}))?'
        for match in re.finditer(pattern, value):
            frames[(filename, int(match[1]), int(match[2] or 0))] += 1
    for (filename, line, column), count in sorted(frames.items())[:32]:
        add('TRACE', f'file={filename} line={line} column={column} count={min(count, 1000000)}')
    steps = collections.Counter()
    for match in re.finditer(r'^#([0-9]{1,4}) \[([^\]\r\n]{1,120}) ([0-9]{1,4})/([0-9]{1,4})\] (RUN|COPY|ADD|FROM|WORKDIR)\b', value, re.M):
        service = match[2] if match[2] in SERVICES else 'other'
        steps[(int(match[1]), service, int(match[3]), int(match[4]), match[5].lower())] += 1
    for (step, service, index, total, kind), count in sorted(steps.items())[:32]:
        add('BUILD_STEP', f'step={step} service={service} index={index} total={total} kind={kind} count={min(count, 1000000)}')
    exits = collections.Counter(int(match[1]) for match in re.finditer(r'exit code[: ]+([0-9]{1,3})(?![0-9])', value, re.I) if int(match[1]) <= 255)
    for code, count in sorted(exits.items())[:16]:
        add('EXIT', f'code={code} count={min(count, 1000000)}')
    for marker, token in (('update_attempted', 'OVH_STAGING_RUNTIME_UPDATE_ATTEMPTED'), ('smoke_ok', 'OVH_SIX_SERVICE_LOCAL_STAGING_SMOKE_OK')):
        add('MARKER', f'name={marker} present={int(token in value.splitlines())}')
    return lines

def read_log(label):
    path = BACKUP / (label + '-private.log')
    status, size, data = 'ok', 0, b''
    try:
        if any(parent.is_symlink() for parent in (BACKUP, BACKUP.parent, BACKUP.parent.parent)):
            raise OSError(errno.ELOOP, 'fixed path rejected')
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as handle:
            before = os.fstat(handle.fileno())
            if not stat.S_ISREG(before.st_mode):
                status = 'not_regular'
            elif before.st_uid != os.getuid():
                status = 'unexpected_owner'
            else:
                size = before.st_size
                handle.seek(max(0, size - LIMIT))
                data = handle.read(LIMIT)
                after = os.fstat(handle.fileno())
                if (before.st_ino, before.st_dev, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_dev, after.st_size, after.st_mtime_ns):
                    status, data = 'changed', b''
    except FileNotFoundError:
        status = 'missing'
    except OSError as error:
        status = 'symlink_refused' if error.errno == errno.ELOOP else 'unreadable'
    emit('LOG', f'{label} status={status} bytes={size} scanned_bytes={len(data)} truncated={int(size > len(data))}')
    if status == 'ok':
        for line in summarize(label, data.decode('utf-8', errors='replace')):
            print(line)

def exit_code(value):
    return min(255, value if value >= 0 else 128 - value)

def health(name):
    try:
        result = subprocess.run(['sudo', '-n', '/usr/local/sbin/liftorbit-ops', name], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=45, check=False)
        code, content = exit_code(result.returncode), result.stdout[-LIMIT:].decode('utf-8', errors='replace')
    except subprocess.TimeoutExpired:
        code, content = 124, ''
    except OSError:
        code, content = 127, ''
    emit('OP', f'{name} exit={code}')
    if name == 'status':
        statuses = {}
        for line in content.splitlines():
            match = SERVICE_RE.fullmatch(line)
            if match:
                statuses[match[1]] = line
        for service in SERVICES:
            if service in statuses:
                print(statuses[service])
        emit('STATUS', f'recognized={len(statuses)} expected=6')
    else:
        emit('SMOKE', 'marker=' + str(int('OVH_SIX_SERVICE_LOCAL_STAGING_SMOKE_OK' in content.splitlines())))

def public_http(name, path, expected):
    try:
        result = subprocess.run(['curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '10', 'https://app.liftorbit.app' + path], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=12, check=False)
        status = result.stdout.decode('ascii', errors='replace')
        status = status if re.fullmatch(r'[0-9]{3}', status) else '000'
        code = exit_code(result.returncode)
    except subprocess.TimeoutExpired:
        status, code = '000', 124
    except OSError:
        status, code = '000', 127
    emit('HTTP', f'{name} code={status} expected={expected} exit={code}')

def allowed(line):
    label = '(?:update|rollback)'
    patterns = [
        rf'{PREFIX}_LOG {label} status=(?:ok|missing|unreadable|unexpected_owner|not_regular|symlink_refused|changed) bytes=[0-9]+ scanned_bytes=[0-9]+ truncated=[01]',
        rf'{PREFIX}_MATCH {label} label=(?:' + '|'.join(FAILURES) + r') count=[0-9]{1,7}',
        rf'{PREFIX}_PUBLIC_CODE {label} code=(?:' + '|'.join(PUBLIC_CODES) + r') count=[0-9]{1,7}',
        rf'{PREFIX}_EXCEPTION {label} class=(?:' + '|'.join(CLASSES) + r') count=[0-9]{1,7}',
        rf'{PREFIX}_TRACE {label} file=(?:' + '|'.join(re.escape(name) for name in FILES) + r') line=[0-9]{1,7} column=[0-9]{1,7} count=[0-9]{1,7}',
        rf'{PREFIX}_BUILD_STEP {label} step=[0-9]{{1,4}} service=(?:' + '|'.join(SERVICES) + r'|other) index=[0-9]{1,4} total=[0-9]{1,4} kind=(?:run|copy|add|from|workdir) count=[0-9]{1,7}',
        rf'{PREFIX}_EXIT {label} code=[0-9]{{1,3}} count=[0-9]{{1,7}}',
        rf'{PREFIX}_MARKER {label} name=(?:update_attempted|smoke_ok) present=[01]',
        rf'{PREFIX}_OP (?:status|smoke) exit=[0-9]{{1,3}}',
        SERVICE_RE.pattern,
        rf'{PREFIX}_STATUS recognized=[0-6] expected=6',
        rf'{PREFIX}_SMOKE marker=[01]',
        rf'{PREFIX}_HTTP bridge code=[0-9]{{3}} expected=200 exit=[0-9]{{1,3}}',
        rf'{PREFIX}_HTTP auth code=[0-9]{{3}} expected=401 exit=[0-9]{{1,3}}',
        rf'{PREFIX}_INTERNAL_ERROR',
        rf'{PREFIX}_DONE',
    ]
    return any(re.fullmatch(pattern, line) for pattern in patterns)

def main():
    if sys.argv[1:] == ['--self-test']:
        sentinel = 'PRIVATE_SECRET_SENTINEL'
        value = '\n'.join([
            '#34 [app 8/8] RUN bun run build-bridge.ts && bun run feature-stop.ts ' + sentinel,
            '#34 0.4 Error: STOP_PATCH_abortUpstream_0 ' + sentinel,
            '#34 0.4 at /private/' + sentinel + '/feature-stop.ts:3:68',
            '#34 0.4 at /private/' + sentinel + '.ts:789:1',
            'failed to solve: ' + sentinel + ': exit code: 1',
            'STOP_PATCH_' + sentinel + '_0',
            'exit code: 999',
        ])
        lines = summarize('update', value)
        assert all(allowed(line) for line in lines)
        assert sentinel not in '\n'.join(lines)
        assert any('code=STOP_PATCH_abortUpstream_0 count=1' in line for line in lines)
        assert any('file=feature-stop.ts line=3 column=68' in line for line in lines)
        assert any('step=34 service=app index=8 total=8 kind=run' in line for line in lines)
        assert not any('code=999' in line for line in lines)
        assert not allowed(sentinel)
        assert not allowed('LIFTORBIT_SERVICE app state=running health=healthy oom=false ' + sentinel)
        print(PREFIX + '_SELF_TEST_PASS')
    elif len(sys.argv) == 3 and sys.argv[1] == '--filter':
        data = pathlib.Path(sys.argv[2]).read_bytes()[:LIMIT]
        accepted = rejected = 0
        for line in data.decode('utf-8', errors='replace').splitlines():
            if allowed(line):
                print(line)
                accepted += 1
            else:
                rejected += 1
        emit('FILTER', f'accepted={accepted} rejected={rejected}')
        if rejected:
            raise SystemExit(6)
    elif len(sys.argv) == 1:
        read_log('update')
        read_log('rollback')
        health('status')
        health('smoke')
        public_http('bridge', '/__bridge_health', 200)
        public_http('auth', '/api/auth/me', 401)
        print(PREFIX + '_DONE')
    else:
        raise SystemExit(6)

if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(PREFIX + '_INTERNAL_ERROR')
        raise SystemExit(6)
PY
}

if test "${1:-}" = --self-test && test "$#" -eq 1; then
  diagnostic_python | PYTHONDONTWRITEBYTECODE=1 python3 -I - --self-test
  exit
fi
test "$#" -eq 0
test "$DEPLOY_HOST" = 51.255.163.121
test "$DEPLOY_USER" = liftorbit-ci
test "$GITHUB_REF" = refs/heads/fix/gantt-zoom-500-20261124
umask 077
diagnose_stage=$(mktemp -d)
trap 'rm -rf "$diagnose_stage"' EXIT
printf '%s\n' "$DEPLOY_KEY" > "$diagnose_stage/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$diagnose_stage/known-hosts"
chmod 600 "$diagnose_stage/key" "$diagnose_stage/known-hosts"
ssh_exit=0
diagnostic_python | timeout 150 ssh -i "$diagnose_stage/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$diagnose_stage/known-hosts" -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 "$DEPLOY_USER@$DEPLOY_HOST" 'PYTHONDONTWRITEBYTECODE=1 python3 -I -' > "$diagnose_stage/output" 2> "$diagnose_stage/transport-private.log" || ssh_exit=$?
diagnostic_python | PYTHONDONTWRITEBYTECODE=1 python3 -I - --filter "$diagnose_stage/output"
printf 'INTEGRATED_SETUP_DIAG_TRANSPORT exit=%s\n' "$ssh_exit"
exit "$ssh_exit"
