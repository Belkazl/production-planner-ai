#!/usr/bin/env bash
set -euo pipefail

# Read only one fixed failed-update log. Private bytes stay on the host.
diagnostic_python() {
cat <<'PY'
import collections
import errno
import hashlib
import os
import pathlib
import re
import stat
import subprocess
import sys

BACKUP = pathlib.Path('/home/liftorbit-ci/liftorbit-migration/patch-backups/zoom-label-release-20261125/45588278666-1')
LIMIT = 1024 * 1024
PREFIX = 'ZOOM_LABEL_DIAG'
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
    'file_missing': r'No such file or directory|ENOENT|cannot stat',
    'source_guard': r'SOURCE_DRIFT|SOURCE_GUARD|GUARD_REJECTED|BASELINE_DRIFT|source verification failed',
    'unsafe_path': r'symlink|unsafe path|path rejected|outside allowed|unexpected owner',
    'shell_or_compose': r'command not found|bad substitution|unbound variable|invalid interpolation|additional properties|yaml:|compose.*(?:invalid|error)',
    'lock_busy': r'lock.*(?:busy|held)|another.*(?:deployment|update)|resource temporarily unavailable',
    'copy_failure': r'cp:|rsync:|cannot copy|cannot create regular file',
    'docker_daemon': r'Cannot connect to the Docker daemon|error during connect|failed to initialize builder',
    'network_download': r'failed to fetch|failed to resolve|failed to authorize|TLS handshake|certificate.*(?:expired|unknown)|too many requests',
    'explicit_refusal': r'not permitted|not authorized|refusing|rejected|not allowed',
}
# Exact, already public build-patcher error labels; no arbitrary error messages.
PUBLIC_CODES = ('STOP_PATCH_abortUpstream_0', 'STOP_PATCH_rev_0', 'STOP_PATCH_capture_0', 'STOP_PATCH_signalInit_0', 'STOP_PATCH_blockLateFinal_0')
FILES = ('restart-optimizer-ui.js', 'auth-runtime.js', 'compose.yaml', 'docker-compose.yml', 'feature-stop.ts', 'build-bridge.ts', 'python-ga-upstream-build.ts', 'tenant-model-build.ts', 'ga-worker-build.ts', 'index.ts', 'Dockerfile', 'python-ga-upstream.test.mjs', 'python-ga-state.test.mjs', 'continuation-compat-contract.cjs', 'account-model-boundary.cjs', 'early-stop-contract.cjs', 'async-plan-transport-contract.cjs')
CLASSES = ('Error', 'TypeError', 'SyntaxError', 'ReferenceError', 'AssertionError', 'ModuleNotFoundError', 'PermissionError', 'TimeoutError', 'OSError', 'ValueError', 'FileNotFoundError', 'CalledProcessError')
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
    emit('LOG', f'{label} status={status} bytes={size} scanned_bytes={len(data)} truncated={int(size > len(data))} lines_scanned={len(data.splitlines())} scanned_sha256={hashlib.sha256(data).hexdigest()}')
    if status == 'ok':
        for line in summarize(label, data.decode('utf-8', errors='replace')):
            print(line)

def allowed(line):
    label = 'update'
    patterns = [
        rf'{PREFIX}_LOG {label} status=(?:ok|missing|unreadable|unexpected_owner|not_regular|symlink_refused|changed) bytes=[0-9]+ scanned_bytes=[0-9]+ truncated=[01] lines_scanned=[0-9]+ scanned_sha256=[0-9a-f]{{64}}',
        rf'{PREFIX}_MATCH {label} label=(?:' + '|'.join(FAILURES) + r') count=[0-9]{1,7}',
        rf'{PREFIX}_PUBLIC_CODE {label} code=(?:' + '|'.join(PUBLIC_CODES) + r') count=[0-9]{1,7}',
        rf'{PREFIX}_EXCEPTION {label} class=(?:' + '|'.join(CLASSES) + r') count=[0-9]{1,7}',
        rf'{PREFIX}_TRACE {label} file=(?:' + '|'.join(re.escape(name) for name in FILES) + r') line=[0-9]{1,7} column=[0-9]{1,7} count=[0-9]{1,7}',
        rf'{PREFIX}_BUILD_STEP {label} step=[0-9]{{1,4}} service=(?:' + '|'.join(SERVICES) + r'|other) index=[0-9]{1,4} total=[0-9]{1,4} kind=(?:run|copy|add|from|workdir) count=[0-9]{1,7}',
        rf'{PREFIX}_EXIT {label} code=[0-9]{{1,3}} count=[0-9]{{1,7}}',
        rf'{PREFIX}_MARKER {label} name=(?:update_attempted|smoke_ok) present=[01]',
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
            'cp: cannot stat ' + sentinel + ': No such file or directory',
            'SOURCE_DRIFT_' + sentinel,
            'PermissionError: ' + sentinel,
            'yaml: invalid interpolation ' + sentinel,
        ])
        lines = summarize('update', value)
        assert all(allowed(line) for line in lines)
        assert sentinel not in '\n'.join(lines)
        assert any('code=STOP_PATCH_abortUpstream_0 count=1' in line for line in lines)
        assert any('file=feature-stop.ts line=3 column=68' in line for line in lines)
        assert any('step=34 service=app index=8 total=8 kind=run' in line for line in lines)
        assert not any('code=999' in line for line in lines)
        assert any('label=file_missing' in line for line in lines)
        assert any('label=source_guard' in line for line in lines)
        assert any('label=shell_or_compose' in line for line in lines)
        assert allowed(PREFIX + '_LOG update status=ok bytes=2 scanned_bytes=2 truncated=0 lines_scanned=1 scanned_sha256=' + 'a'*64)
        assert not allowed(PREFIX + '_LOG rollback status=ok bytes=2 scanned_bytes=2 truncated=0 lines_scanned=1 scanned_sha256=' + 'a'*64)
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
diagnostic_python | timeout 45 ssh -i "$diagnose_stage/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$diagnose_stage/known-hosts" -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 "$DEPLOY_USER@$DEPLOY_HOST" 'PYTHONDONTWRITEBYTECODE=1 python3 -I -' > "$diagnose_stage/output" 2> "$diagnose_stage/transport-private.log" || ssh_exit=$?
diagnostic_python | PYTHONDONTWRITEBYTECODE=1 python3 -I - --filter "$diagnose_stage/output"
printf 'ZOOM_LABEL_DIAG_TRANSPORT exit=%s\n' "$ssh_exit"
exit "$ssh_exit"
