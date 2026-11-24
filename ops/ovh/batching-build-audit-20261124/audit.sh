#!/usr/bin/env bash
# Optional read-only metadata audit. Never execute build source or read env values.
set -euo pipefail

audit_python(){
  cat <<'PY'
import ast
import base64
import errno
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys

ROOT = Path('/home/liftorbit-ci/liftorbit-migration')
COMPILE = ROOT / 'sources/current/ga/ga_workers/compile_legacy_ga.py'
OPS = Path('/usr/local/sbin/liftorbit-ops')
MAX_SOURCE = 1048576
MAX_OUTPUT = 1048576
SAFE_KEY = re.compile(r'PP_[A-Z0-9_]{1,120}\Z')
SAFE_CODE_REF = re.compile(r'(?:PP_|D_|CAP_)[A-Z0-9_]{1,120}\Z')
SAFE_SYMBOL = re.compile(r'[A-Za-z_][A-Za-z0-9_.]{0,100}\Z')
INTERESTING = re.compile(r'joint|ppjb|mixed|batch|split|mini|optimiz', re.I)
CONFIGS = {name: ROOT / 'production/current' / (name + '.json') for name in ('gateway', 'ga-worker', 'auth-app')}
CODE_KEYS = {
    'PP_GENERIC_CORE_B64', 'PP_REGEX_FIX_B64', 'PP_CAPACITY_GANTT_PATCH_B64',
    'PP_PARTIAL_MATERIAL_PATCH_B64', 'PP_PARSE_RESOURCE_REPAIR_B64',
    'PP_CLIENT_PROJECT_REPAIR_B64', 'PP_FREEZE_HOTFIX_B64',
    'PP_TECH_PROCESS_PATCH_B64', 'PP_ORDER_PROCESS_LINK_B64',
    'PP_REMOVE_LEGACY_DURATION_B64', 'PP_TIMING_PROFILE_V1_INSTALL',
    'PP_CAPACITY_BATCHING_PATCH_CODE', 'PP_CURRENT_FEATURES_PATCH_V1',
    'PP_GENERIC_GANTT_UI_B64', 'PP_SAVED_PLAN_RESUME_PATCH_CODE',
    'PP_SETUP_FINAL_PATCH_B64', 'PP_CAP_BATCH_BOOT_V2',
    'PP_RESTORE_ETALON_BOOT_V1', 'PP_START_CMD_GOOD',
    'PP_GENERIC_RESTORE_LAUNCH_V2',
}
CODE_NAME = re.compile(r'^PP_(?=.*(?:REAL_OPT|OBJECTIVE|BATCH|JOINT|SPLIT|MINI))[A-Z0-9_]+(?:_B64|_CODE|_PATCH(?:_V[0-9]+)?|_INSTALL|_LAUNCH_V[0-9]+)$')
SENSITIVE_NAME = re.compile(r'TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|DATABASE|PRIVATE_KEY|COOKIE|AUTH_KEY')
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
            if isinstance(value, ast.Constant) and isinstance(value.value, str) and SAFE_CODE_REF.fullmatch(value.value):
                found[kind].add(value.value)
            else:
                dynamic += 1
    return found, dynamic


def symbol(node):
    if isinstance(node, ast.Name):
        value = node.id
    elif isinstance(node, ast.Attribute):
        parent = symbol(node.value)
        value = parent + '.' + node.attr if parent else ''
    else:
        value = ''
    return value if SAFE_SYMBOL.fullmatch(value) else ''


def code_metadata(text):
    pending, seen, findings = [(text, 0)], set(), set()
    total = fragments = 0
    while pending and fragments < 16 and len(findings) < 160:
        source, depth = pending.pop(0)
        digest = hashlib.sha256(source.encode('utf-8')).hexdigest()
        if digest in seen or len(source) > MAX_SOURCE or total + len(source) > 4 * MAX_SOURCE:
            continue
        seen.add(digest); total += len(source)
        try:
            tree = ast.parse(source, filename='<code-metadata-only>')
        except (SyntaxError, ValueError, RecursionError):
            continue
        fragments += 1
        keys, _ = extract_keys(source)
        for names in keys.values():
            for name in names:
                findings.add(('ref', name, '-'))
        for node in ast.walk(tree):
            if len(findings) >= 160:
                break
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and INTERESTING.search(node.name) and SAFE_SYMBOL.fullmatch(node.name):
                args = node.args.posonlyargs + node.args.args + node.args.kwonlyargs
                params = [arg.arg for arg in args if SAFE_SYMBOL.fullmatch(arg.arg)]
                if node.args.vararg: params.append(node.args.vararg.arg)
                if node.args.kwarg: params.append(node.args.kwarg.arg)
                findings.add(('function', node.name, ','.join(params[:16]) or '-'))
            elif isinstance(node, ast.Call):
                name = symbol(node.func)
                if name and INTERESTING.search(name):
                    findings.add(('call', name, '-'))
                if name == 'os.environ.get' and node.args:
                    arg = node.args[0]
                    if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and SAFE_CODE_REF.fullmatch(arg.value):
                        findings.add(('ref', arg.value, '-'))
            elif isinstance(node, ast.Subscript) and symbol(node.value) == 'os.environ':
                arg = node.slice
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and SAFE_CODE_REF.fullmatch(arg.value):
                    findings.add(('ref', arg.value, '-'))
            elif isinstance(node, ast.Assign):
                value = symbol(node.value.func) if isinstance(node.value, ast.Call) else symbol(node.value)
                for target in node.targets:
                    name = symbol(target)
                    if name and value and (INTERESTING.search(name) or INTERESTING.search(value)):
                        findings.add(('binding', name, value))
            elif depth < 3 and isinstance(node, ast.Constant) and isinstance(node.value, str) and len(pending) < 24:
                embedded = node.value
                if 20 <= len(embedded) <= MAX_SOURCE and re.search(r'\b(?:def |class |import |exec\(|compile\()', embedded):
                    pending.append((embedded, depth + 1))
    return fragments, sorted(findings)[:160]


def config_lines(label, config):
    selected = [key for key in config if SAFE_KEY.fullmatch(key) and (key in CODE_KEYS or re.search(r'BATCH|JOINT|SPLIT|MINI|REAL_OPT|OBJECTIVE|GENERIC_RESTORE', key))]
    for key in sorted(selected)[:100]:
        yield f'BATCH_BUILD_CONFIG_KEY label={label} name={key}'
        if SENSITIVE_NAME.search(key) or not (key in CODE_KEYS or CODE_NAME.fullmatch(key)):
            continue
        value = config[key]
        if len(value) > 2 * MAX_SOURCE:
            yield f'BATCH_BUILD_CODE label={label} key={key} status=too_large'
            continue
        encoded = value.encode('utf-8')
        yield f'BATCH_BUILD_CODE label={label} key={key} status=ok bytes={len(encoded)} sha256={hashlib.sha256(encoded).hexdigest()}'
        try:
            if key.endswith('_B64'):
                decoded = base64.b64decode(value, validate=True)
                if decoded[:2] == b'\x1f\x8b':
                    with gzip.GzipFile(fileobj=io.BytesIO(decoded)) as handle:
                        decoded = handle.read(MAX_SOURCE + 1)
                if len(decoded) > MAX_SOURCE:
                    raise ValueError('bounded_code_limit')
                text = decoded.decode('utf-8')
            else:
                text = value
            fragments, findings = code_metadata(text)
            yield f'BATCH_BUILD_CODE_AST label={label} key={key} fragments={fragments} symbols={len(findings)}'
            for kind, name, detail in findings:
                yield f'BATCH_BUILD_CODE_SYMBOL label={label} key={key} kind={kind} name={name} detail={detail}'
        except (ValueError, UnicodeError, OSError, EOFError, RecursionError):
            yield f'BATCH_BUILD_CODE_AST label={label} key={key} status=unavailable'


def inspect_configs():
    for label, source in CONFIGS.items():
        try:
            path = inside_project(source)
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, 'rb') as handle:
                info = os.fstat(handle.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size > 32 * MAX_SOURCE:
                    print(f'BATCH_BUILD_CONFIG label={label} status=unsupported_file')
                    continue
                content = handle.read(32 * MAX_SOURCE + 1)
            config = json.loads(content)
            if not isinstance(config, dict) or not all(isinstance(key, str) and isinstance(value, str) for key, value in config.items()):
                print(f'BATCH_BUILD_CONFIG label={label} status=unsupported_shape')
                continue
            print(f'BATCH_BUILD_CONFIG label={label} status=ok')
            for line in config_lines(label, config):
                print(line)
        except ValueError:
            print(f'BATCH_BUILD_CONFIG label={label} status=unavailable')
        except OSError as error:
            print(f'BATCH_BUILD_CONFIG label={label} status={error_status(error)}')


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
    configs = r'(?:gateway|ga-worker|auth-app)'
    unavailable = r'(?:missing|denied|symlink_refused|unreadable|outside_project|unexpected_owner)'
    patterns = [
        rf'BATCH_BUILD_FILE compile status=(?:ok|not_regular|too_large|changed|{unavailable}) bytes=[0-9]+ sha256=(?:[0-9a-f]{{64}}|none)',
        r'BATCH_BUILD_KEY kind=(?:DATA|RAW|DECODE|GETENV) name=(?:PP_|D_|CAP_)[A-Z0-9_]{1,120}',
        r'BATCH_BUILD_AST status=(?:unavailable|ok dynamic_calls=[0-9]+)',
        rf'BATCH_BUILD_OPS_META status=(?:ok type=(?:file|symlink|other) owner=(?:self|root|other) mode=[0-7]{{4}} readable=[01]|{unavailable})',
        rf'BATCH_BUILD_DIR label={labels} status=(?:ok|not_directory|{unavailable})',
        rf'BATCH_BUILD_ENTRY label={labels} type=(?:dir|file|symlink|other) name=[A-Za-z0-9_.-]{{1,160}}',
        rf'BATCH_BUILD_DIR_COUNT label={labels} emitted=[0-9]+ truncated=[01]',
        r'BATCH_BUILD_SOURCE label=(?:ga|app) file=[A-Za-z0-9_./-]{1,240}',
        rf'BATCH_BUILD_SCAN label=(?:ga|app) status=(?:ok names=[0-9]+ truncated=[01]|{unavailable})',
        rf'BATCH_BUILD_CONFIG label={configs} status=(?:ok|unsupported_file|unsupported_shape|unavailable|{unavailable})',
        rf'BATCH_BUILD_CONFIG_KEY label={configs} name=PP_[A-Z0-9_]{{1,120}}',
        rf'BATCH_BUILD_CODE label={configs} key=PP_[A-Z0-9_]{{1,120}} status=(?:too_large|ok bytes=[0-9]+ sha256=[0-9a-f]{{64}})',
        rf'BATCH_BUILD_CODE_AST label={configs} key=PP_[A-Z0-9_]{{1,120}} (?:status=unavailable|fragments=[0-9]+ symbols=[0-9]+)',
        rf'BATCH_BUILD_CODE_SYMBOL label={configs} key=PP_[A-Z0-9_]{{1,120}} kind=(?:function|call|binding|ref) name=[A-Za-z_][A-Za-z0-9_.]{{0,100}} detail=[A-Za-z0-9_.,-]{{1,1700}}',
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
        inner = 'def _ppjb_joint_optimize(model, batch_sizes):\n return optimize(model)\n'
        outer = 'PATCH=' + repr(inner) + '\nos.getenv("D_TIMING_INSTALL")\nos.environ.get("CAP_BATCH_PATCH")\nos.environ["D_REAL_OPT_CODE"]\noptimize=_ppjb_joint_optimize\n'
        config = {'PP_CAPACITY_BATCHING_PATCH_CODE': outer, 'PP_REAL_OPT_ENABLE': sentinel,
                  'PP_REAL_OPT_TOKEN_B64': base64.b64encode(sentinel.encode()).decode(), 'DATABASE_URL': sentinel}
        lines = list(config_lines('gateway', config))
        assert all(allowed_line(line) for line in lines)
        assert sentinel not in '\n'.join(lines)
        assert any('kind=function name=_ppjb_joint_optimize detail=model,batch_sizes' in line for line in lines)
        assert any('kind=ref name=D_TIMING_INSTALL' in line for line in lines)
        assert any('kind=ref name=CAP_BATCH_PATCH' in line for line in lines)
        assert any('kind=ref name=D_REAL_OPT_CODE' in line for line in lines)
        assert not any('BATCH_BUILD_CODE label=gateway key=PP_REAL_OPT_ENABLE ' in line for line in lines)
        assert not any('BATCH_BUILD_CODE label=gateway key=PP_REAL_OPT_TOKEN_B64 ' in line for line in lines)
        assert not any('DATABASE_URL' in line for line in lines)
        assert not allowed_line('BATCH_BUILD_CODE_SYMBOL label=gateway key=PP_REAL_OPT_CODE kind=function name=optimize detail=' + sentinel + '\n' + sentinel)
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
    inspect_configs()
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
