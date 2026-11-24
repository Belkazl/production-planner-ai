#!/usr/bin/env bash
# Optional read-only metadata audit. Never execute build source or read env values.
set -euo pipefail

audit_python(){
  cat <<'PY'
import ast
import errno
import hashlib
import os
from pathlib import Path
import re
import stat
import sys

ROOT = Path('/home/liftorbit-ci/liftorbit-migration')
COMPILE = ROOT / 'sources/current/ga/ga_workers/compile_legacy_ga.py'
OPS = Path('/usr/local/sbin/liftorbit-ops')
MAX_SOURCE = 1048576
MAX_OUTPUT = 131072
SAFE_KEY = re.compile(r'PP_[A-Z0-9_]{1,120}\Z')
SAFE_NAME = re.compile(r'[A-Za-z0-9_.-]{1,160}\Z')
SAFE_RELATIVE = re.compile(r'[A-Za-z0-9_./-]{1,240}\Z')
RELATED = re.compile(r'batch|joint|split|mini', re.I)
SOURCE_SUFFIXES = {'.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.sh', '.yml', '.yaml'}
SKIP_DIRS = {'.git', 'node_modules', '__pycache__', '.venv', 'venv', 'data', 'storage', 'dumps', 'backups'}
DIRECTORIES = {
    'root': ROOT,
    'sources': ROOT / 'sources',
    'current': ROOT / 'sources/current',
    'ga': ROOT / 'sources/current/ga',
    'app_root': ROOT / 'sources/ovh-app',
    'app': ROOT / 'sources/ovh-app/current',
}


def error_status(error):
    if isinstance(error, FileNotFoundError):
        return 'missing'
    if isinstance(error, PermissionError):
        return 'denied'
    return 'symlink_refused' if getattr(error, 'errno', None) == errno.ELOOP else 'unreadable'


def inside_project(path):
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(ROOT.resolve(strict=True)):
        raise ValueError('outside_project')
    return resolved


def extract_keys(source):
    tree = ast.parse(source, filename='<build-metadata-only>')
    found = {kind: set() for kind in ('DATA', 'RAW', 'DECODE', 'GETENV')}
    dynamic = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'DATA_KEYS' for target in node.targets):
            if isinstance(node.value, (ast.List, ast.Tuple)):
                for item in node.value.elts:
                    if isinstance(item, ast.Constant) and isinstance(item.value, str) and SAFE_KEY.fullmatch(item.value):
                        found['DATA'].add(item.value)
        if not isinstance(node, ast.Call):
            continue
        kind = None
        if isinstance(node.func, ast.Name) and node.func.id in ('raw', 'decode'):
            kind = node.func.id.upper()
        elif isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name) and node.func.value.id == 'os' and node.func.attr == 'getenv':
            kind = 'GETENV'
        if kind:
            value = node.args[0] if node.args else None
            if isinstance(value, ast.Constant) and isinstance(value.value, str) and SAFE_KEY.fullmatch(value.value):
                found[kind].add(value.value)
            else:
                dynamic += 1
    return found, dynamic


def inspect_compile():
    size = 0
    try:
        path = inside_project(COMPILE)
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, 'rb') as handle:
            info = os.fstat(handle.fileno())
            size = info.st_size
            if not stat.S_ISREG(info.st_mode):
                status = 'not_regular'
            elif info.st_uid != os.getuid():
                status = 'unexpected_owner'
            elif size > MAX_SOURCE:
                status = 'too_large'
            else:
                content = handle.read(MAX_SOURCE + 1)
                status = 'ok' if len(content) == size else 'changed'
        if status != 'ok':
            print(f'BATCH_BUILD_FILE compile status={status} bytes={size} sha256=none')
            return
    except ValueError:
        print('BATCH_BUILD_FILE compile status=outside_project bytes=0 sha256=none')
        return
    except OSError as error:
        print(f'BATCH_BUILD_FILE compile status={error_status(error)} bytes={size} sha256=none')
        return
    print(f'BATCH_BUILD_FILE compile status=ok bytes={size} sha256={hashlib.sha256(content).hexdigest()}')
    try:
        keys, dynamic = extract_keys(content.decode('utf-8'))
    except (SyntaxError, UnicodeError, ValueError, RecursionError):
        print('BATCH_BUILD_AST status=unavailable')
        return
    for kind, names in keys.items():
        for name in sorted(names):
            print(f'BATCH_BUILD_KEY kind={kind} name={name}')
    print(f'BATCH_BUILD_AST status=ok dynamic_calls={dynamic}')


def inspect_ops_metadata():
    try:
        info = OPS.lstat()
        kind = 'file' if stat.S_ISREG(info.st_mode) else 'symlink' if stat.S_ISLNK(info.st_mode) else 'other'
        owner = 'self' if info.st_uid == os.getuid() else 'root' if info.st_uid == 0 else 'other'
        mode = format(stat.S_IMODE(info.st_mode), '04o')
        readable = int(os.access(OPS, os.R_OK, follow_symlinks=False))
        print(f'BATCH_BUILD_OPS_META status=ok type={kind} owner={owner} mode={mode} readable={readable}')
    except OSError as error:
        print(f'BATCH_BUILD_OPS_META status={error_status(error)}')


def inspect_directories():
    for label, path in DIRECTORIES.items():
        try:
            target = inside_project(path)
            info = target.stat()
            if not stat.S_ISDIR(info.st_mode):
                print(f'BATCH_BUILD_DIR label={label} status=not_directory')
                continue
            if info.st_uid != os.getuid():
                print(f'BATCH_BUILD_DIR label={label} status=unexpected_owner')
                continue
            with os.scandir(target) as scan:
                entries = sorted(list(scan), key=lambda entry: entry.name)
            print(f'BATCH_BUILD_DIR label={label} status=ok')
            emitted = 0
            for entry in entries:
                if not SAFE_NAME.fullmatch(entry.name):
                    continue
                kind = 'symlink' if entry.is_symlink() else 'dir' if entry.is_dir(follow_symlinks=False) else 'file' if entry.is_file(follow_symlinks=False) else 'other'
                print(f'BATCH_BUILD_ENTRY label={label} type={kind} name={entry.name}')
                emitted += 1
                if emitted >= 64:
                    break
            print(f'BATCH_BUILD_DIR_COUNT label={label} emitted={emitted} truncated={int(len(entries) > emitted)}')
        except ValueError:
            print(f'BATCH_BUILD_DIR label={label} status=outside_project')
        except OSError as error:
            print(f'BATCH_BUILD_DIR label={label} status={error_status(error)}')


def inspect_source_names():
    for label in ('ga', 'app'):
        visited = emitted = 0
        truncated = False
        try:
            target = inside_project(DIRECTORIES[label])
            if target.stat().st_uid != os.getuid():
                print(f'BATCH_BUILD_SCAN label={label} status=unexpected_owner')
                continue
            def on_error(_error):
                # No retries, alternate roots or escalation for unreadable directories.
                nonlocal truncated
                truncated = True
            for directory, subdirs, names in os.walk(target, followlinks=False, onerror=on_error):
                visited += 1
                if visited > 160:
                    truncated = True
                    break
                relative_dir = Path(directory).relative_to(target)
                subdirs[:] = sorted(name for name in subdirs if name not in SKIP_DIRS and SAFE_NAME.fullmatch(name) and not (Path(directory) / name).is_symlink())
                if len(relative_dir.parts) >= 4:
                    truncated = truncated or bool(subdirs)
                    subdirs[:] = []
                for name in sorted(names):
                    if not SAFE_NAME.fullmatch(name) or not RELATED.search(name) or Path(name).suffix.lower() not in SOURCE_SUFFIXES:
                        continue
                    path = Path(directory) / name
                    if path.is_symlink():
                        continue
                    relative = path.relative_to(target).as_posix()
                    if not SAFE_RELATIVE.fullmatch(relative):
                        continue
                    print(f'BATCH_BUILD_SOURCE label={label} file={relative}')
                    emitted += 1
                    if emitted >= 100:
                        truncated = True
                        break
                if emitted >= 100:
                    break
            print(f'BATCH_BUILD_SCAN label={label} status=ok names={emitted} truncated={int(truncated)}')
        except ValueError:
            print(f'BATCH_BUILD_SCAN label={label} status=outside_project')
        except OSError as error:
            print(f'BATCH_BUILD_SCAN label={label} status={error_status(error)}')


def allowed_line(line):
    labels = r'(?:root|sources|current|ga|app_root|app)'
    unavailable = r'(?:missing|denied|symlink_refused|unreadable|outside_project|unexpected_owner)'
    patterns = [
        rf'BATCH_BUILD_FILE compile status=(?:ok|not_regular|too_large|changed|{unavailable}) bytes=[0-9]+ sha256=(?:[0-9a-f]{{64}}|none)',
        r'BATCH_BUILD_KEY kind=(?:DATA|RAW|DECODE|GETENV) name=PP_[A-Z0-9_]{1,120}',
        r'BATCH_BUILD_AST status=(?:unavailable|ok dynamic_calls=[0-9]+)',
        rf'BATCH_BUILD_OPS_META status=(?:ok type=(?:file|symlink|other) owner=(?:self|root|other) mode=[0-7]{{4}} readable=[01]|{unavailable})',
        rf'BATCH_BUILD_DIR label={labels} status=(?:ok|not_directory|{unavailable})',
        rf'BATCH_BUILD_ENTRY label={labels} type=(?:dir|file|symlink|other) name=[A-Za-z0-9_.-]{{1,160}}',
        rf'BATCH_BUILD_DIR_COUNT label={labels} emitted=[0-9]+ truncated=[01]',
        r'BATCH_BUILD_SOURCE label=(?:ga|app) file=[A-Za-z0-9_./-]{1,240}',
        rf'BATCH_BUILD_SCAN label=(?:ga|app) status=(?:ok names=[0-9]+ truncated=[01]|{unavailable})',
        r'BATCH_BUILD_ENV_KEYS status=not_configured',
        r'BATCH_BUILD_DONE',
        r'BATCH_BUILD_ERROR status=unavailable',
    ]
    return any(re.fullmatch(pattern, line) for pattern in patterns)


def main():
    if sys.argv[1:] == ['--self-test']:
        sentinel = 'PRIVATE_VALUE_MUST_NOT_APPEAR'
        source = "DATA_KEYS=['PP_JOINT_MINIBATCH_CODE','not_a_key']\nraw('PP_SPLIT_CODE')\ndecode('PP_BATCH_B64')\nos.getenv('PP_MINI_ENABLE','" + sentinel + "')\nos.getenv(name)\nother.raw('PP_NOT_ALLOWED')\nvalue='" + sentinel + "'\n"
        keys, dynamic = extract_keys(source)
        assert keys == {'DATA': {'PP_JOINT_MINIBATCH_CODE'}, 'RAW': {'PP_SPLIT_CODE'}, 'DECODE': {'PP_BATCH_B64'}, 'GETENV': {'PP_MINI_ENABLE'}}
        assert dynamic == 1
        lines = [f'BATCH_BUILD_KEY kind={kind} name={key}' for kind, names in keys.items() for key in names]
        assert all(allowed_line(line) for line in lines)
        assert sentinel not in '\n'.join(lines)
        assert not allowed_line('BATCH_BUILD_KEY kind=RAW name=PP_BATCH_CODE=' + sentinel)
        assert not allowed_line('BATCH_BUILD_SOURCE label=ga file=batch.py\n' + sentinel)
        assert not allowed_line(sentinel)
        assert allowed_line('BATCH_BUILD_OPS_META status=ok type=file owner=root mode=0755 readable=0')
        assert allowed_line('BATCH_BUILD_FILE compile status=denied bytes=0 sha256=none')
        print('BATCH_BUILD_SELF_TEST_PASS')
        return
    if len(sys.argv) == 3 and sys.argv[1] == '--filter':
        content = Path(sys.argv[2]).read_bytes()[:MAX_OUTPUT]
        accepted = rejected = 0
        for line in content.decode('utf-8', errors='replace').splitlines():
            if allowed_line(line):
                print(line)
                accepted += 1
            else:
                rejected += 1
        print(f'BATCH_BUILD_FILTER accepted={accepted} rejected={rejected}')
        return
    if len(sys.argv) != 1:
        raise SystemExit(6)
    inspect_ops_metadata()
    inspect_directories()
    inspect_compile()
    inspect_source_names()
    # No env file path has been confirmed. Do not probe guessed .env locations.
    print('BATCH_BUILD_ENV_KEYS status=not_configured')
    print('BATCH_BUILD_DONE')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Suppress tracebacks, exception text and source snippets in all modes.
        print('BATCH_BUILD_ERROR status=unavailable')
        raise SystemExit(1)
PY
}

if test "${1:-}" = --self-test && test "$#" -eq 1; then
  audit_python | python3 - --self-test
  exit
fi
test "$#" -eq 0
test "$DEPLOY_HOST" = 51.255.163.121
test "$DEPLOY_USER" = liftorbit-ci
umask 077
audit_stage=$(mktemp -d)
trap 'rm -rf "$audit_stage"' EXIT
printf '%s\n' "$DEPLOY_KEY" > "$audit_stage/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$audit_stage/known-hosts"
chmod 600 "$audit_stage/key" "$audit_stage/known-hosts"
ssh_exit=0
audit_python | timeout 90 ssh -i "$audit_stage/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$audit_stage/known-hosts" -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 "$DEPLOY_USER@$DEPLOY_HOST" python3 - > "$audit_stage/output" 2> "$audit_stage/transport-private.log" || ssh_exit=$?
audit_python | python3 - --filter "$audit_stage/output"
printf 'BATCH_BUILD_TRANSPORT exit=%s\n' "$ssh_exit"
exit "$ssh_exit"
