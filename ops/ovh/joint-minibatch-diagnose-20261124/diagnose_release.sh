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
BACKUP = pathlib.Path('/home/liftorbit-ci/liftorbit-migration/patch-backups/joint-minibatch-release-20261124/45476356438-1')
SERVICES = ('postgres-main', 'postgres-auth', 'planner-gateway', 'auth-gateway', 'ga-worker', 'app')
SERVICE_RE = re.compile(r'LIFTORBIT_SERVICE (' + '|'.join(SERVICES) + r') state=(created|running|paused|restarting|removing|exited|dead|missing|unknown) health=(healthy|unhealthy|starting|none|missing|unknown|n/a) oom=(true|false|unknown)')
FAILURES = {
    'build_failure': r'failed to solve|failed to build|build failed|did not complete successfully|executor failed',
    'syntax_error': r'\bSyntaxError\b|\bIndentationError\b|\bTabError\b',
    'module_missing': r'\bModuleNotFoundError\b|cannot find module|module not found',
    'import_error': r'\bImportError\b',
    'assertion_error': r'\bAssertionError\b|assertion failed',
    'runtime_error': r'\bNameError\b|\bTypeError\b|\bReferenceError\b|\bRuntimeError\b',
    'permission_denied': r'\bPermissionError\b|\bEACCES\b|permission denied|operation not permitted|a password is required|not allowed to execute',
    'disk_full': r'no space left on device|disk quota exceeded',
    'out_of_memory': r'out of memory|oomkilled|oom=true|cannot allocate memory',
    'timeout': r'timed out|timeout|deadline exceeded|context deadline',
    'connection_refused': r'connection refused|could not connect|failed to connect',
    'dns_failure': r'temporary failure in name resolution|could not resolve|no such host',
    'network_unreachable': r'network is unreachable|no route to host|connection reset|unexpected eof',
    'image_access_denied': r'pull access denied|authentication required|unauthorized|requested access.*denied',
    'daemon_error': r'error response from daemon|cannot connect to the docker daemon',
    'unknown_error': r'\bError\b|\bException\b|Traceback \(most recent call last\)',
    'unhealthy': r'\bunhealthy\b|dependency failed to start|healthcheck failed',
    'nonzero_exit': r'exit code[:= ]+[1-9][0-9]*\b|exited with code [1-9][0-9]*\b|returned a non-zero code',
}
MARKERS = {
    'update_attempted': 'OVH_STAGING_RUNTIME_UPDATE_ATTEMPTED',
    'smoke_ok': 'OVH_SIX_SERVICE_LOCAL_STAGING_SMOKE_OK',
}
EXIT_RE = re.compile(r'(?:exit(?:ed with)? code[:= ]+|returned a non-zero code:\s*)([0-9]{1,3})\b', re.I)

ROOT = pathlib.Path('/home/liftorbit-ci/liftorbit-migration')
STAGE = ROOT / 'sources/ovh-app/joint-minibatch-release-20261124-45476356438-1'
TARGETS = {
    'upstream': ('app/python-ga-upstream.mjs', ROOT / 'sources/ovh-app/current/python-ga-upstream.mjs'),
    'restart_ui': ('app/restart-optimizer-ui.js', ROOT / 'sources/ovh-app/current/restart-optimizer-ui.js'),
    'adapter': ('ga/full_runtime_adapter.py', ROOT / 'sources/current/ga/ga_workers/full_runtime_adapter.py'),
    'joint_search': ('ga/joint_minibatch.py', ROOT / 'sources/current/ga/ga_workers/joint_minibatch.py'),
    'joint_continuation': ('ga/joint_continuation.py', ROOT / 'sources/current/ga/ga_workers/joint_continuation.py'),
}
SOURCE_LIMIT = 4 * 1024 * 1024
HASH_RE = re.compile(r'[0-9a-f]{64}')
STAGES = {
    'image_build': r'(?m)load build definition|building with|failed to solve|^#[0-9]+ \[',
    'image_export': r'exporting to image|exporting layers|writing image sha256',
    'runtime_recreate': r'(?m)^.*Container [A-Za-z0-9_.-]+ +(Creating|Created|Recreating|Recreated|Starting|Started)\s*$',
    'runtime_report': r'(?m)^LIFTORBIT_SERVICE ',
    'update_complete': r'(?m)^OVH_STAGING_RUNTIME_UPDATE_ATTEMPTED$',
}
TRACE_FILES = (
    '<stdin>', '<string>', 'Dockerfile', 'test_process_isolation.py', 'test_full_runtime.py',
    'manager.py', 'server.py', 'fixture.py', 'full_runtime_adapter.py', 'compile_legacy_ga.py',
    'continuation.py', 'constraints.py', 'joint_minibatch.py', 'joint_continuation.py',
    'python-ga-upstream.mjs', 'python-ga-upstream.test.mjs', 'python-ga-state.test.mjs',
    'ga-account-owned-recovery.test.mjs', 'account-model-boundary.cjs', 'ga-process-workers.cjs',
    'continuation-compat-contract.cjs', 'async-plan-transport-contract.cjs',
    'ga-continuation-resume-safe.test.mjs', 'continue-seed-guard.test.mjs',
    'stored-completed-recovery.test.mjs', 'jsonb-decode.test.mjs',
    'ga-resource-integration.cjs', 'ga-resource-repair.cjs', 'start-over-ui.cjs',
    'start-over-session.cjs', 'optimizer-action-labels.cjs', 'gantt-details.cjs',
    'order-accordion.cjs', 'production-order-etalon-smoke.cjs',
    'python-ga-upstream-build.ts', 'ga-worker-build.ts', 'build-bridge.ts', 'index.ts',
    'auth-runtime.js', 'restart-optimizer-ui.js', 'other',
)
EXCEPTION_CLASSES = ('AssertionError', 'SyntaxError', 'IndentationError', 'TabError',
    'ModuleNotFoundError', 'ImportError', 'PermissionError', 'NameError', 'TypeError',
    'ReferenceError', 'RuntimeError', 'ValueError', 'TimeoutError', 'OSError')
PUBLIC_TESTS = (
    'test_ten_real_child_processes_and_isolated_plans',
    'test_candidate_preview_stays_account_isolated',
    'test_hard_cancel_one_while_other_jobs_finish',
    'test_cancel_queued_job_without_spawning',
    'test_timeout_terminates_cpu_process',
    'test_private_http_auth_and_tenant_ownership',
)
COMMAND_KINDS = {
    'python_tests': r'\bpython(?:3)?\b.*\bunittest\b',
    'python_compile': r'\bpython(?:3)?\b.*\bpy_compile\b',
    'python_inline': r'\bpython(?:3)?\b.*(?:\s-c(?:\s|$)|\s-(?:\s|$))',
    'bun_tests': r'\bbun\s+(?:test\b|(?:run\s+)?tests/)',
    'bun_build': r'\bbun\s+(?:build\b|run\s+[A-Za-z0-9_.-]*build[A-Za-z0-9_.-]*)',
    'node_tests': r'\bnode\s+(?:--test\b|tests/)',
    'package_install': r'\b(?:pip|pip3|npm|bun)\s+install\b|\bapt-get\s+.*install\b',
}
APP_BUILD_TESTS = tuple(name for name in TRACE_FILES if name.endswith(('.cjs', '.test.mjs')))
ASSERTION_OPERATORS = ('strictEqual', 'deepStrictEqual', 'notStrictEqual',
    'notDeepStrictEqual', 'equal', 'deepEqual', 'notEqual', 'match', 'doesNotMatch',
    'ok', 'throws', 'rejects', 'fail')

def inspect_dockerfile():
    import hashlib
    try:
        data = bounded_read(ROOT / 'sources/ovh-app/current/Dockerfile', 65536)
        text = data.decode('utf-8')
        known, unknown = [], 0
        for number, line in enumerate(text.splitlines(), 1):
            if number > 9999:
                raise ValueError()
            for match in re.finditer(r'(?<![A-Za-z0-9_./-])tests/([A-Za-z0-9_.-]+)', line):
                name = match.group(1)
                if name in APP_BUILD_TESTS:
                    known.append((number, name))
                else:
                    unknown += 1
        print(f'JOINT_RELEASE_DIAG_DOCKERFILE status=ok bytes={len(data)} sha256={hashlib.sha256(data).hexdigest()} known_tests={len(known)} unknown_test_refs={unknown}')
        for number, name in known[:64]:
            print(f'JOINT_RELEASE_DIAG_DOCKER_TEST file={name} line={number}')
    except (OSError, ValueError, UnicodeError):
        print('JOINT_RELEASE_DIAG_DOCKERFILE status=rejected')

def build_metadata(label, text):
    # Extract only fixed enums and bounded integers. Never forward stack source,
    # arbitrary basenames, test names, commands or assertion messages.
    text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text)
    frames, steps, commands, errors, mentions = (collections.Counter() for _ in range(5))
    for raw in text.splitlines():
        if len(raw) > 16384:
            continue
        prefix = re.match(r'^#([0-9]{1,4})\s+(?:[0-9]+(?:\.[0-9]+)?\s+)?', raw)
        step = int(prefix.group(1)) if prefix else 0
        line = raw[prefix.end():] if prefix else raw
        header = re.match(r'^#([0-9]{1,4})\s+\[([^\]\r\n]{1,200})\]\s+(RUN|COPY|ADD|FROM|WORKDIR|ENV|EXPOSE|CMD)\b(.*)$', raw)
        if header:
            words = header.group(2).split()
            service = words[0] if words and words[0] in SERVICES else 'other'
            index = re.search(r'\b([0-9]{1,4})/([0-9]{1,4})\b', header.group(2))
            position, total = (int(index.group(1)), int(index.group(2))) if index else (0, 0)
            steps[(int(header.group(1)), service, position, total, header.group(3).lower())] += 1
            kinds = [name for name, pattern in COMMAND_KINDS.items() if re.search(pattern, header.group(4))]
            for kind in kinds or ['other']:
                commands[(int(header.group(1)), kind)] += 1
        if re.match(r'^ERROR\b', line):
            errors[step] += 1
        py = re.search(r'\bFile [\"\']([^\"\'\r\n]{1,512})[\"\'], line ([0-9]{1,7})\b', line)
        if py:
            name = py.group(1).replace('\\', '/').rsplit('/', 1)[-1]
            known = name in TRACE_FILES
            frames[(step, name if known else 'other', int(py.group(2)) if known else 0, 0)] += 1
        # JS/Bun frames and Dockerfile diagnostics; only known literal basenames.
        for name in TRACE_FILES:
            if name in ('other', '<stdin>', '<string>'):
                continue
            for match in re.finditer(r'(?<![A-Za-z0-9_.-])' + re.escape(name) + r':([0-9]{1,7})(?::([0-9]{1,7}))?(?![0-9])', line):
                frames[(step, name, int(match.group(1)), int(match.group(2) or 0))] += 1
        for name in APP_BUILD_TESTS:
            if re.search(r'(?<![A-Za-z0-9_.-])' + re.escape(name) + r'(?![A-Za-z0-9_.-])', line):
                mentions[(step, name)] += 1
    lines = []
    for (step, service, index, total, kind), count in sorted(steps.items())[:32]:
        lines.append(f'JOINT_RELEASE_DIAG_BUILD_STEP {label} step={step} service={service} index={index} total={total} kind={kind} count={count}')
    for (step, kind), count in sorted(commands.items())[:32]:
        lines.append(f'JOINT_RELEASE_DIAG_BUILD_COMMAND {label} step={step} kind={kind} count={count}')
    for step, count in sorted(errors.items())[:32]:
        lines.append(f'JOINT_RELEASE_DIAG_BUILD_ERROR {label} step={step} count={count}')
    for (step, name, number, column), count in sorted(frames.items())[:32]:
        lines.append(f'JOINT_RELEASE_DIAG_TRACE {label} step={step} file={name} line={number} column={column} count={count}')
    for (step, name), count in sorted(mentions.items())[:64]:
        lines.append(f'JOINT_RELEASE_DIAG_PUBLIC_TEST_MENTION {label} step={step} file={name} count={count}')
    for operator in ASSERTION_OPERATORS:
        count = len(re.findall(r'\boperator\s*:\s*[\"\']' + re.escape(operator) + r'[\"\']', text))
        if count:
            lines.append(f'JOINT_RELEASE_DIAG_ASSERTION_OPERATOR {label} operator={operator} count={count}')
    for name in EXCEPTION_CLASSES:
        count = len(re.findall(r'\b' + re.escape(name) + r'\b', text))
        if count:
            lines.append(f'JOINT_RELEASE_DIAG_EXCEPTION {label} class={name} count={count}')
    for name in PUBLIC_TESTS:
        # Only unittest FAIL/ERROR identifiers, not arbitrary appearances in commands.
        count = len(re.findall(r'(?m)^(?:#[0-9]{1,4}\s+[0-9.]+\s+)?(?:FAIL|ERROR):\s+' + re.escape(name) + r'\b', text))
        if count:
            lines.append(f'JOINT_RELEASE_DIAG_TEST {label} name={name} count={count}')
    if re.search(r'\bERR_ASSERTION\b', text):
        lines.append(f'JOINT_RELEASE_DIAG_ASSERTION_KIND {label} label=node_assertion')
    return lines

def valid_manifest(text):
    rows = [line.split('\t') for line in text.splitlines()]
    wanted = {name for name, _ in TARGETS.values()}
    if not 11 <= len(rows) <= 68 or any(len(row) != 4 for row in rows):
        raise ValueError()
    if len({row[1] for row in rows}) != len(rows):
        raise ValueError()
    if {row[1] for row in rows if row[0] == 'WRITE'} != wanted:
        raise ValueError()
    for role, name, before, after in rows:
        if role not in {'WRITE', 'PRESERVE'} or not HASH_RE.fullmatch(after):
            raise ValueError()
        if before == 'MISSING':
            if name not in {'ga/joint_minibatch.py', 'ga/joint_continuation.py'}:
                raise ValueError()
        elif not HASH_RE.fullmatch(before):
            raise ValueError()
        if role == 'PRESERVE' and before != after:
            raise ValueError()
        if name.startswith('ga/'):
            if not re.fullmatch(r'ga/[A-Za-z_][A-Za-z0-9_]*\.py', name):
                raise ValueError()
        elif name not in {'app/auth-runtime.js', 'app/python-ga-upstream.mjs', 'app/python-ga-upstream-build.ts', 'app/restart-optimizer-ui.js'}:
            raise ValueError()
    return {name: before for role, name, before, _ in rows if role == 'WRITE'}, len(rows)

def bounded_read(path, maximum):
    if not path.parent.resolve(strict=True).is_relative_to(ROOT.resolve(strict=True)):
        raise ValueError()
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        if (not stat.S_ISREG(before.st_mode) or before.st_uid not in (0, os.getuid())
                or before.st_size > maximum):
            raise ValueError()
        data = handle.read(maximum + 1)
        after = os.fstat(handle.fileno())
        if (len(data) != before.st_size or len(data) > maximum
                or (before.st_ino, before.st_dev, before.st_size, before.st_mtime_ns)
                != (after.st_ino, after.st_dev, after.st_size, after.st_mtime_ns)):
            raise ValueError()
        return data

def metadata(area, label, path):
    status, mode, owner, group, readable, size = 'missing', '0000', 'unknown', 'unknown', 0, 0
    try:
        info = path.lstat()
        mode, size = f'{stat.S_IMODE(info.st_mode):04o}', info.st_size
        owner = 'ci' if info.st_uid == os.getuid() else 'root' if info.st_uid == 0 else 'other'
        group = 'ci' if info.st_gid == os.getgid() else 'root' if info.st_gid == 0 else 'other'
        if stat.S_ISLNK(info.st_mode):
            status = 'symlink_refused'
        elif not stat.S_ISREG(info.st_mode):
            status = 'not_regular'
        elif not path.parent.resolve(strict=True).is_relative_to(ROOT.resolve(strict=True)):
            status = 'outside_root'
        else:
            status = 'ok'
            readable = int(os.access(path, os.R_OK))
    except FileNotFoundError:
        pass
    except OSError:
        status = 'unreadable'
    print(f'JOINT_RELEASE_DIAG_FILE {area} {label} status={status} mode={mode} owner={owner} group={group} readable={readable} bytes={size}')
    return status

def inspect_sources():
    import hashlib
    expected, row_count, manifest_status = {}, 0, 'unreadable'
    try:
        expected, row_count = valid_manifest(bounded_read(BACKUP / 'manifest.tsv', 32768).decode('ascii'))
        manifest_status = 'ok'
    except FileNotFoundError:
        manifest_status = 'missing'
    except (OSError, ValueError, UnicodeError):
        manifest_status = 'rejected'
    print(f'JOINT_RELEASE_DIAG_MANIFEST status={manifest_status} rows={row_count}')
    matches, absent = 0, 0
    for label, (name, target) in TARGETS.items():
        current_status = metadata('current', label, target)
        metadata('stage', label, STAGE / name)
        metadata('backup', label, BACKUP / name)
        before = expected.get(name)
        match = 0
        if before == 'MISSING' and current_status == 'missing':
            match = 1
        elif before and before != 'MISSING' and current_status == 'ok':
            try:
                match = int(hashlib.sha256(bounded_read(target, SOURCE_LIMIT)).hexdigest() == before)
            except (OSError, ValueError):
                pass
        matches += match
        if label in {'joint_search', 'joint_continuation'} and current_status == 'missing':
            absent += 1
        print(f'JOINT_RELEASE_DIAG_SOURCE {label} old_match={match} expected_missing={int(before == "MISSING")} manifest_valid={int(manifest_status == "ok")}')
    print(f'JOINT_RELEASE_DIAG_ROLLBACK old_matches={matches} expected=5 new_modules_absent={absent}')

def classified_lines(label, text):
    lines = []
    last_failure = (-1, 'none')
    for name, expression in FAILURES.items():
        matches = list(re.finditer(expression, text, re.I))
        if matches:
            lines.append(f'JOINT_RELEASE_DIAG_MATCH {label} {name} count={len(matches)}')
            last_failure = max(last_failure, (matches[-1].start(), name))
    lines.append(f'JOINT_RELEASE_DIAG_LAST_FAILURE {label} label={last_failure[1]}')
    last_stage = (-1, 'none')
    for name, expression in STAGES.items():
        matches = list(re.finditer(expression, text, re.I))
        if matches:
            last_stage = max(last_stage, (matches[-1].start(), name))
    lines.append(f'JOINT_RELEASE_DIAG_STAGE {label} label={last_stage[1]}')
    for name, marker in MARKERS.items():
        lines.append(f'JOINT_RELEASE_DIAG_MARKER {label} {name} present={int(any(line == marker for line in text.splitlines()))}')
    codes = collections.Counter(int(match.group(1)) for match in EXIT_RE.finditer(text) if int(match.group(1)) <= 255)
    for code, count in sorted(codes.items()):
        lines.append(f'JOINT_RELEASE_DIAG_EXIT {label} code={code} count={count}')
    # Report only the last strictly valid status for each known service.
    statuses = {}
    for line in text.splitlines():
        match = SERVICE_RE.fullmatch(line)
        if match:
            statuses[match.group(1)] = match.groups()
    for service in SERVICES:
        if service in statuses:
            name, state, health, oom = statuses[service]
            lines.append(f'JOINT_RELEASE_DIAG_LOG_SERVICE {label} {name} state={state} health={health} oom={oom}')
    lines.extend(build_metadata(label, text))
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
    print(f'JOINT_RELEASE_DIAG_LOG {label} status={status} bytes={total} scanned_bytes={len(data)} truncated={int(total > len(data))}')
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
    print(f'JOINT_RELEASE_DIAG_OP {name} exit={code} timeout={timed_out}')
    text = content.decode('utf-8', errors='replace')
    if name == 'status':
        seen = set()
        for line in text.splitlines():
            match = SERVICE_RE.fullmatch(line)
            if match and match.group(1) not in seen:
                seen.add(match.group(1))
                print(line)
        print(f'JOINT_RELEASE_DIAG_STATUS recognized={len(seen)} expected={len(SERVICES)}')
    else:
        print('JOINT_RELEASE_DIAG_SMOKE marker=' + str(int(MARKERS['smoke_ok'] in text.splitlines())))

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
    print(f'JOINT_RELEASE_DIAG_HTTP {name} code={code} expected={expected} exit={exit_code}')

def allowed_line(line):
    label = r'(?:update|rollback)'
    failure = '(?:none|' + '|'.join(FAILURES) + ')'
    service = SERVICE_RE.pattern.removeprefix('LIFTORBIT_SERVICE ')
    patterns = [
        rf'JOINT_RELEASE_DIAG_LOG {label} status=(?:ok|missing|unreadable|unexpected_owner|not_regular|symlink_refused) bytes=[0-9]+ scanned_bytes=[0-9]+ truncated=[01]',
        rf'JOINT_RELEASE_DIAG_MATCH {label} (?:' + '|'.join(FAILURES) + r') count=[0-9]+',
        rf'JOINT_RELEASE_DIAG_LAST_FAILURE {label} label={failure}',
        rf'JOINT_RELEASE_DIAG_MARKER {label} (?:update_attempted|smoke_ok) present=[01]',
        rf'JOINT_RELEASE_DIAG_EXIT {label} code=[0-9]{{1,3}} count=[0-9]+',
        rf'JOINT_RELEASE_DIAG_LOG_SERVICE {label} {service}',
        r'JOINT_RELEASE_DIAG_OP (?:status|smoke) exit=[0-9]{1,3} timeout=[01]',
        SERVICE_RE.pattern,
        r'JOINT_RELEASE_DIAG_STATUS recognized=[0-6] expected=6',
        r'JOINT_RELEASE_DIAG_SMOKE marker=[01]',
        r'JOINT_RELEASE_DIAG_HTTP bridge code=[0-9]{3} expected=200 exit=[0-9]{1,3}',
        r'JOINT_RELEASE_DIAG_HTTP auth code=[0-9]{3} expected=401 exit=[0-9]{1,3}',
        rf'JOINT_RELEASE_DIAG_STAGE {label} label=(?:none|' + '|'.join(STAGES) + ')',
        r'JOINT_RELEASE_DIAG_MANIFEST status=(?:ok|missing|unreadable|rejected) rows=[0-9]{1,2}',
        r'JOINT_RELEASE_DIAG_FILE (?:current|stage|backup) (?:upstream|restart_ui|adapter|joint_search|joint_continuation) status=(?:ok|missing|unreadable|symlink_refused|not_regular|outside_root) mode=[0-7]{4} owner=(?:ci|root|other|unknown) group=(?:ci|root|other|unknown) readable=[01] bytes=[0-9]+',
        r'JOINT_RELEASE_DIAG_SOURCE (?:upstream|restart_ui|adapter|joint_search|joint_continuation) old_match=[01] expected_missing=[01] manifest_valid=[01]',
        r'JOINT_RELEASE_DIAG_ROLLBACK old_matches=[0-5] expected=5 new_modules_absent=[0-2]',
        rf'JOINT_RELEASE_DIAG_BUILD_STEP {label} step=[0-9]{{1,4}} service=(?:' + '|'.join(SERVICES) + r'|other) index=[0-9]{1,4} total=[0-9]{1,4} kind=(?:run|copy|add|from|workdir|env|expose|cmd) count=[0-9]+',
        rf'JOINT_RELEASE_DIAG_BUILD_COMMAND {label} step=[0-9]{{1,4}} kind=(?:' + '|'.join(COMMAND_KINDS) + r'|other) count=[0-9]+',
        rf'JOINT_RELEASE_DIAG_BUILD_ERROR {label} step=[0-9]{{1,4}} count=[0-9]+',
        rf'JOINT_RELEASE_DIAG_TRACE {label} step=[0-9]{{1,4}} file=(?:' + '|'.join(re.escape(name) for name in TRACE_FILES) + r') line=[0-9]{1,7} column=[0-9]{1,7} count=[0-9]+',
        rf'JOINT_RELEASE_DIAG_EXCEPTION {label} class=(?:' + '|'.join(EXCEPTION_CLASSES) + r') count=[0-9]+',
        rf'JOINT_RELEASE_DIAG_TEST {label} name=(?:' + '|'.join(PUBLIC_TESTS) + r') count=[0-9]+',
        rf'JOINT_RELEASE_DIAG_ASSERTION_KIND {label} label=node_assertion',
        r'JOINT_RELEASE_DIAG_DOCKERFILE status=ok bytes=[0-9]+ sha256=[0-9a-f]{64} known_tests=[0-9]+ unknown_test_refs=[0-9]+',
        r'JOINT_RELEASE_DIAG_DOCKERFILE status=rejected',
        r'JOINT_RELEASE_DIAG_DOCKER_TEST file=(?:' + '|'.join(re.escape(name) for name in APP_BUILD_TESTS) + r') line=[0-9]{1,4}',
        rf'JOINT_RELEASE_DIAG_PUBLIC_TEST_MENTION {label} step=[0-9]{{1,4}} file=(?:' + '|'.join(re.escape(name) for name in APP_BUILD_TESTS) + r') count=[0-9]+',
        rf'JOINT_RELEASE_DIAG_ASSERTION_OPERATOR {label} operator=(?:' + '|'.join(ASSERTION_OPERATORS) + r') count=[0-9]+',
        r'JOINT_RELEASE_DIAG_INTERNAL_ERROR',
        r'JOINT_RELEASE_DIAG_DONE',
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
        assert 'JOINT_RELEASE_DIAG_EXIT update code=1 count=1' in lines
        assert not any('code=999' in line for line in lines)
        assert 'JOINT_RELEASE_DIAG_MARKER update update_attempted present=1' in lines
        assert 'JOINT_RELEASE_DIAG_LOG_SERVICE update ga-worker state=exited health=unhealthy oom=false' in lines
        assert not any('LOG_SERVICE update app' in line for line in lines)
        assert not allowed_line(secret)
        assert not allowed_line('JOINT_RELEASE_DIAG_MATCH update ' + secret + ' count=1')
        assert allowed_line('LIFTORBIT_SERVICE app state=running health=healthy oom=false')
        assert not allowed_line('LIFTORBIT_SERVICE app state=running health=healthy oom=false\n' + secret)
        assert allowed_line('JOINT_RELEASE_DIAG_FILE stage joint_search status=ok mode=0600 owner=ci group=ci readable=1 bytes=1234')
        assert not allowed_line('JOINT_RELEASE_DIAG_FILE stage ' + secret + ' status=ok mode=0600 owner=ci group=ci readable=1 bytes=1234')
        assert allowed_line('JOINT_RELEASE_DIAG_SOURCE adapter old_match=1 expected_missing=0 manifest_valid=1')
        assert allowed_line('JOINT_RELEASE_DIAG_ROLLBACK old_matches=5 expected=5 new_modules_absent=2')
        permission = classified_lines('update', 'PermissionError: ' + secret + ' EACCES permission denied')
        assert any('permission_denied count=3' in line for line in permission)
        assert all(allowed_line(line) for line in permission)
        assert secret not in '\n'.join(permission)
        trace = build_metadata('update', '\n'.join([
            '#17 [ga-worker 5/5] RUN python -m unittest tests.test_process_isolation ' + secret,
            '#17 0.52 FAIL: test_cancel_queued_job_without_spawning (private.' + secret + ')',
            '#17 0.53   File "/srv/tests/test_process_isolation.py", line 99, in ' + secret,
            '#17 0.54     self.assertEqual(' + secret + ')',
            '#17 0.55 AssertionError: ' + secret,
            '#17 ERROR: process ' + secret,
            '#18 [app 8/8] RUN python3 - <<PY ' + secret,
            '#18 0.10   File "<stdin>", line 31, in <module>',
            '#18 0.10   File "/private/' + secret + '.py", line 999, in ' + secret,
            '#18 0.10   at /app/tests/python-ga-upstream.test.mjs:76:9 ' + secret,
            '#18 0.11   at /app/tests/\x1b[31mcontinuation-compat-contract.cjs\x1b[0m:42:7 ' + secret,
            '#18 0.12   operator: "match", actual: "' + secret + '", expected: "' + secret + '"',
            '#18 0.10   at /private/' + secret + '.mjs:123:4',
            'Dockerfile:8',
            '#19 [private-' + secret + ' 2/3] RUN ' + secret,
            '#19 0.10 FAIL: private_test_' + secret + ' (private)',
        ]))
        assert all(allowed_line(line) for line in trace)
        assert secret not in '\n'.join(trace)
        assert any('file=<stdin> line=31 column=0' in line for line in trace)
        assert any('file=test_process_isolation.py line=99 column=0' in line for line in trace)
        assert any('file=python-ga-upstream.test.mjs line=76 column=9' in line for line in trace)
        assert any('file=continuation-compat-contract.cjs line=42 column=7' in line for line in trace)
        assert any('operator=match count=1' in line for line in trace)
        assert any('file=other line=0 column=0' in line for line in trace)
        assert any('service=ga-worker index=5 total=5 kind=run' in line for line in trace)
        assert any('step=18 kind=python_inline' in line for line in trace)
        assert any('name=test_cancel_queued_job_without_spawning count=1' in line for line in trace)
        assert not allowed_line('JOINT_RELEASE_DIAG_TRACE update step=1 file=' + secret + '.py line=1 column=0 count=1')
        print('JOINT_RELEASE_DIAG_SELF_TEST_PASS')
    elif mode == '--filter' and len(sys.argv) == 3:
        with pathlib.Path(sys.argv[2]).open('rb') as handle:
            data = handle.read(LIMIT)
        accepted = rejected = 0
        for line in data.decode('utf-8', errors='replace').splitlines():
            if allowed_line(line):
                accepted += 1
                print(line)
            else:
                rejected += 1
        print(f'JOINT_RELEASE_DIAG_FILTER accepted={accepted} rejected={rejected}')
    elif mode == '--remote' and len(sys.argv) == 1:
        inspect_sources()
        inspect_dockerfile()
        inspect_log('update')
        inspect_log('rollback')
        inspect_operation('status')
        inspect_operation('smoke')
        inspect_http('bridge', '/__bridge_health', 200)
        inspect_http('auth', '/api/auth/me', 401)
        print('JOINT_RELEASE_DIAG_DONE')
    else:
        raise SystemExit(6)

if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('JOINT_RELEASE_DIAG_INTERNAL_ERROR')
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
printf 'JOINT_RELEASE_DIAG_TRANSPORT exit=%s\n' "$ssh_exit"
exit "$ssh_exit"
