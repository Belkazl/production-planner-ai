#!/usr/bin/env bash
# Read-only diagnosis of the fixed failed release; never print private log lines.
set -euo pipefail

diagnostic_python(){
  cat <<'PY'
import collections
import errno
import os
import pathlib
import re
import stat
import subprocess
import sys

LIMIT = 262144
BACKUP = pathlib.Path('/home/liftorbit-ci/liftorbit-migration/patch-backups/optimizer-repair-20261124/45434390899')
SERVICES = ('postgres-main', 'postgres-auth', 'planner-gateway', 'auth-gateway', 'ga-worker', 'app')
SERVICE_RE = re.compile(r'LIFTORBIT_SERVICE (' + '|'.join(SERVICES) + r') state=(created|running|paused|restarting|removing|exited|dead|missing|unknown) health=(healthy|unhealthy|starting|none|missing|unknown|n/a) oom=(true|false|unknown)')
FAILURES = {
    'build_failure': r'failed to solve|failed to build|build failed|did not complete successfully|executor failed',
    'syntax_error': r'\bSyntaxError\b|\bIndentationError\b|\bTabError\b',
    'module_missing': r'\bModuleNotFoundError\b|cannot find module|module not found',
    'import_error': r'\bImportError\b',
    'runtime_error': r'\bNameError\b|\bTypeError\b|\bReferenceError\b|\bRuntimeError\b',
    'permission_denied': r'permission denied|operation not permitted|a password is required|not allowed to execute',
    'disk_full': r'no space left on device|disk quota exceeded',
    'out_of_memory': r'out of memory|oomkilled|oom=true|cannot allocate memory',
    'timeout': r'timed out|timeout|deadline exceeded|context deadline',
    'connection_refused': r'connection refused|could not connect|failed to connect',
    'dns_failure': r'temporary failure in name resolution|could not resolve|no such host',
    'network_unreachable': r'network is unreachable|no route to host|connection reset|unexpected eof',
    'image_access_denied': r'pull access denied|authentication required|unauthorized|requested access.*denied',
    'daemon_error': r'error response from daemon|cannot connect to the docker daemon',
    'unhealthy': r'\bunhealthy\b|dependency failed to start|healthcheck failed',
    'nonzero_exit': r'exit code[:= ]+[1-9][0-9]*\b|exited with code [1-9][0-9]*\b|returned a non-zero code',
}
MARKERS = {
    'update_attempted': 'OVH_STAGING_RUNTIME_UPDATE_ATTEMPTED',
    'smoke_ok': 'OVH_SIX_SERVICE_LOCAL_STAGING_SMOKE_OK',
}
EXIT_RE = re.compile(r'(?:exit(?:ed with)? code[:= ]+|returned a non-zero code:\s*)([0-9]{1,3})\b', re.I)

def classified_lines(label, text):
    lines = []
    last_failure = (-1, 'none')
    for name, expression in FAILURES.items():
        matches = list(re.finditer(expression, text, re.I))
        if matches:
            lines.append(f'OPTIMIZER_REPAIR_DIAG_MATCH {label} {name} count={len(matches)}')
            last_failure = max(last_failure, (matches[-1].start(), name))
    lines.append(f'OPTIMIZER_REPAIR_DIAG_LAST_FAILURE {label} label={last_failure[1]}')
    for name, marker in MARKERS.items():
        lines.append(f'OPTIMIZER_REPAIR_DIAG_MARKER {label} {name} present={int(any(line == marker for line in text.splitlines()))}')
    codes = collections.Counter(int(match.group(1)) for match in EXIT_RE.finditer(text) if int(match.group(1)) <= 255)
    for code, count in sorted(codes.items()):
        lines.append(f'OPTIMIZER_REPAIR_DIAG_EXIT {label} code={code} count={count}')
    # Report only the last strictly valid status for each known service.
    statuses = {}
    for line in text.splitlines():
        match = SERVICE_RE.fullmatch(line)
        if match:
            statuses[match.group(1)] = match.groups()
    for service in SERVICES:
        if service in statuses:
            name, state, health, oom = statuses[service]
            lines.append(f'OPTIMIZER_REPAIR_DIAG_LOG_SERVICE {label} {name} state={state} health={health} oom={oom}')
    return lines

def inspect_log(label):
    path = BACKUP / (label + '-private.log')
    status, total, data = 'ok', 0, b''
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, 'rb') as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode):
                status = 'not_regular'
            elif info.st_uid != os.getuid():
                status = 'unexpected_owner'
            else:
                total = info.st_size
                handle.seek(max(0, total - LIMIT))
                data = handle.read(LIMIT)
    except FileNotFoundError:
        status = 'missing'
    except OSError as error:
        status = 'symlink_refused' if error.errno == errno.ELOOP else 'unreadable'
    print(f'OPTIMIZER_REPAIR_DIAG_LOG {label} status={status} bytes={total} scanned_bytes={len(data)} truncated={int(total > len(data))}')
    if status == 'ok':
        for line in classified_lines(label, data.decode('utf-8', errors='replace')):
            print(line)

def inspect_operation(name):
    # These are the existing read-only wrapper commands; update is never invoked.
    try:
        result = subprocess.run(['sudo', '-n', '/usr/local/sbin/liftorbit-ops', name], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=45, check=False)
        code, timed_out, content = result.returncode, 0, result.stdout[-LIMIT:]
    except subprocess.TimeoutExpired:
        code, timed_out, content = 124, 1, b''
    except OSError:
        code, timed_out, content = 127, 0, b''
    code = min(255, code if code >= 0 else 128 - code)
    print(f'OPTIMIZER_REPAIR_DIAG_OP {name} exit={code} timeout={timed_out}')
    text = content.decode('utf-8', errors='replace')
    if name == 'status':
        seen = set()
        for line in text.splitlines():
            match = SERVICE_RE.fullmatch(line)
            if match and match.group(1) not in seen:
                seen.add(match.group(1))
                print(line)
        print(f'OPTIMIZER_REPAIR_DIAG_STATUS recognized={len(seen)} expected={len(SERVICES)}')
    else:
        print('OPTIMIZER_REPAIR_DIAG_SMOKE marker=' + str(int(MARKERS['smoke_ok'] in text.splitlines())))

def inspect_http(name, path, expected):
    try:
        result = subprocess.run(['curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '10', 'https://app.liftorbit.app' + path], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=12, check=False)
        code = result.stdout.decode('ascii', errors='replace')
        code = code if re.fullmatch(r'[0-9]{3}', code) else '000'
        exit_code = min(255, result.returncode if result.returncode >= 0 else 128 - result.returncode)
    except subprocess.TimeoutExpired:
        code, exit_code = '000', 124
    except OSError:
        code, exit_code = '000', 127
    print(f'OPTIMIZER_REPAIR_DIAG_HTTP {name} code={code} expected={expected} exit={exit_code}')

def allowed_line(line):
    label = r'(?:update|rollback)'
    failure = '(?:none|' + '|'.join(FAILURES) + ')'
    service = SERVICE_RE.pattern.removeprefix('LIFTORBIT_SERVICE ')
    patterns = [
        rf'OPTIMIZER_REPAIR_DIAG_LOG {label} status=(?:ok|missing|unreadable|unexpected_owner|not_regular|symlink_refused) bytes=[0-9]+ scanned_bytes=[0-9]+ truncated=[01]',
        rf'OPTIMIZER_REPAIR_DIAG_MATCH {label} (?:' + '|'.join(FAILURES) + r') count=[0-9]+',
        rf'OPTIMIZER_REPAIR_DIAG_LAST_FAILURE {label} label={failure}',
        rf'OPTIMIZER_REPAIR_DIAG_MARKER {label} (?:update_attempted|smoke_ok) present=[01]',
        rf'OPTIMIZER_REPAIR_DIAG_EXIT {label} code=[0-9]{{1,3}} count=[0-9]+',
        rf'OPTIMIZER_REPAIR_DIAG_LOG_SERVICE {label} {service}',
        r'OPTIMIZER_REPAIR_DIAG_OP (?:status|smoke) exit=[0-9]{1,3} timeout=[01]',
        SERVICE_RE.pattern,
        r'OPTIMIZER_REPAIR_DIAG_STATUS recognized=[0-6] expected=6',
        r'OPTIMIZER_REPAIR_DIAG_SMOKE marker=[01]',
        r'OPTIMIZER_REPAIR_DIAG_HTTP bridge code=[0-9]{3} expected=200 exit=[0-9]{1,3}',
        r'OPTIMIZER_REPAIR_DIAG_HTTP auth code=[0-9]{3} expected=401 exit=[0-9]{1,3}',
        r'OPTIMIZER_REPAIR_DIAG_DONE',
    ]
    return any(re.fullmatch(pattern, line) for pattern in patterns)

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else '--remote'
    if mode == '--self-test':
        secret = 'SENSITIVE_SENTINEL_do_not_print'
        text = '\n'.join([
            'failed to solve: ' + secret + ': exit code: 1',
            'ModuleNotFoundError: ' + secret,
            'OVH_STAGING_RUNTIME_UPDATE_ATTEMPTED',
            'LIFTORBIT_SERVICE ga-worker state=exited health=unhealthy oom=false',
            'LIFTORBIT_SERVICE app state=running health=healthy oom=false ' + secret,
            'LIFTORBIT_SERVICE ' + secret + ' state=running health=healthy oom=false',
            'exit code: 999',
        ])
        lines = classified_lines('update', text)
        assert all(allowed_line(line) for line in lines)
        assert secret not in '\n'.join(lines)
        assert 'OPTIMIZER_REPAIR_DIAG_EXIT update code=1 count=1' in lines
        assert not any('code=999' in line for line in lines)
        assert 'OPTIMIZER_REPAIR_DIAG_MARKER update update_attempted present=1' in lines
        assert 'OPTIMIZER_REPAIR_DIAG_LOG_SERVICE update ga-worker state=exited health=unhealthy oom=false' in lines
        assert not any('LOG_SERVICE update app' in line for line in lines)
        assert not allowed_line(secret)
        assert not allowed_line('OPTIMIZER_REPAIR_DIAG_MATCH update ' + secret + ' count=1')
        assert allowed_line('LIFTORBIT_SERVICE app state=running health=healthy oom=false')
        assert not allowed_line('LIFTORBIT_SERVICE app state=running health=healthy oom=false\n' + secret)
        print('OPTIMIZER_REPAIR_DIAG_SELF_TEST_PASS')
    elif mode == '--filter' and len(sys.argv) == 3:
        data = pathlib.Path(sys.argv[2]).read_bytes()[:LIMIT]
        accepted = rejected = 0
        for line in data.decode('utf-8', errors='replace').splitlines():
            if allowed_line(line):
                accepted += 1
                print(line)
            else:
                rejected += 1
        print(f'OPTIMIZER_REPAIR_DIAG_FILTER accepted={accepted} rejected={rejected}')
    elif mode == '--remote' and len(sys.argv) == 1:
        inspect_log('update')
        inspect_log('rollback')
        inspect_operation('status')
        inspect_operation('smoke')
        inspect_http('bridge', '/__bridge_health', 200)
        inspect_http('auth', '/api/auth/me', 401)
        print('OPTIMIZER_REPAIR_DIAG_DONE')
    else:
        raise SystemExit(6)

if __name__ == '__main__':
    main()
PY
}

if test "${1:-}" = --self-test && test "$#" -eq 1; then
  diagnostic_python | python3 - --self-test
  exit
fi
test "$#" -eq 0
test "$DEPLOY_HOST" = 51.255.163.121
test "$DEPLOY_USER" = liftorbit-ci
umask 077
diagnose_stage=$(mktemp -d)
trap 'rm -rf "$diagnose_stage"' EXIT
printf '%s\n' "$DEPLOY_KEY" > "$diagnose_stage/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$diagnose_stage/known-hosts"
chmod 600 "$diagnose_stage/key" "$diagnose_stage/known-hosts"
ssh_exit=0
diagnostic_python | timeout 150 ssh -i "$diagnose_stage/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$diagnose_stage/known-hosts" -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 "$DEPLOY_USER@$DEPLOY_HOST" python3 - > "$diagnose_stage/output" 2> "$diagnose_stage/transport-private.log" || ssh_exit=$?
diagnostic_python | python3 - --filter "$diagnose_stage/output"
printf 'OPTIMIZER_REPAIR_DIAG_TRANSPORT exit=%s\n' "$ssh_exit"
exit "$ssh_exit"
