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
import shutil
import stat
import subprocess
import sys

ROOT = Path('/home/liftorbit-ci/liftorbit-migration')
COMPILE = ROOT / 'sources/current/ga/ga_workers/compile_legacy_ga.py'
OPS = Path('/usr/local/sbin/liftorbit-ops')
MAX_SOURCE = 1048576
MAX_OUTPUT = 1048576
SAFE_KEY = re.compile(r'PP_[A-Z0-9_]{1,120}\Z')
SAFE_CODE_REF = re.compile(r'(?:PP_|D_|CAP_)[A-Z0-9_]{1,120}\Z')
SAFE_SYMBOL = re.compile(r'[A-Za-z_][A-Za-z0-9_.]{0,100}\Z')
INTERESTING = re.compile(r'joint|ppjb|mixed|batch|genom|split|mini|optimiz', re.I)
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
    'PP_GENERIC_RESTORE_BOOT_V1', 'PP_CAP_BATCH_BOOT_V3',
    'PP_CAP_BATCH_BOOT_V4', 'PP_CAP_BATCH_BOOT_V5',
    'CAP_BATCH_PATCH', 'D_TIMING_INSTALL', 'D_START_GOOD',
    'PP_SETUP_ACTIVE_PATCH_B64',
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
USERNS_FLAGS = {
    'unprivileged_userns_clone': Path('/proc/sys/kernel/unprivileged_userns_clone'),
    'apparmor_restrict_unprivileged_userns': Path('/proc/sys/kernel/apparmor_restrict_unprivileged_userns'),
    'max_user_namespaces': Path('/proc/sys/user/max_user_namespaces'),
}


def error_status(error):
    if isinstance(error, FileNotFoundError):
        return 'missing'
    if isinstance(error, PermissionError):
        return 'denied'
    return 'symlink_refused' if getattr(error, 'errno', None) == errno.ELOOP else 'unreadable'


def numeric_flag(content):
    if not re.fullmatch(rb'[0-9]{1,10}\n?', content):
        return None
    value = int(content)
    return value if 0 <= value <= 2147483647 else None


def inspect_isolation_metadata():
    # Availability is metadata only: neither binary is launched here.
    for name in ('bwrap', 'unshare'):
        try:
            available = int(shutil.which(name) is not None)
            print(f'BATCH_BUILD_CAP binary={name} status=ok available={available}')
        except OSError:
            print(f'BATCH_BUILD_CAP binary={name} status=unavailable')
    # Only these public numeric kernel settings are read; no process/env files.
    for name, path in USERNS_FLAGS.items():
        try:
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, 'rb') as handle:
                value = numeric_flag(handle.read(32))
            if value is None:
                print(f'BATCH_BUILD_USERNS flag={name} status=invalid')
            else:
                print(f'BATCH_BUILD_USERNS flag={name} status=ok value={value}')
        except OSError as error:
            print(f'BATCH_BUILD_USERNS flag={name} status={error_status(error)}')


def rootless_isolation_probe(run=None, lstat=None):
    # One ordinary, ephemeral capability check; no files, code inputs or services.
    run = run or subprocess.run
    lstat = lstat or os.lstat
    command = ['/usr/bin/unshare', '--user', '--map-root-user', '--mount',
               '--propagation', 'private', '--net', '--pid', '--fork', '--', '/bin/true']
    try:
        for path in ('/usr/bin/unshare', '/bin/true'):
            info = lstat(path)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or
                    info.st_mode & (stat.S_ISUID | stat.S_ISGID | 0o022) or not info.st_mode & 0o111):
                return 'error'
        result = run(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.PIPE, timeout=5, check=False,
                     env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
        if result.returncode == 0:
            return 'supported'
        # Captured stderr stays private in memory and is never included in output.
        message = result.stderr.lower() if isinstance(result.stderr, bytes) else b''
        if b'operation not permitted' in message or b'permission denied' in message:
            return 'denied'
        return 'error'
    except subprocess.TimeoutExpired:
        return 'timeout'
    except OSError as error:
        return 'denied' if error.errno in (errno.EACCES, errno.EPERM) else 'error'


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


def embedded_python(value):
    if isinstance(value, bytes):
        try: value = value.decode('ascii')
        except UnicodeError: return None
    if not isinstance(value, str) or not 20 <= len(value) <= MAX_SOURCE:
        return None
    if re.search(r'\b(?:def |class |import |exec\(|compile\()', value):
        return value
    compact = ''.join(value.split())
    if not re.fullmatch(r'[A-Za-z0-9+/]+={0,2}', compact):
        return None
    try:
        decoded = base64.b64decode(compact, validate=True)
        if decoded[:2] == b'\x1f\x8b':
            with gzip.GzipFile(fileobj=io.BytesIO(decoded)) as handle:
                decoded = handle.read(MAX_SOURCE + 1)
        if len(decoded) > MAX_SOURCE:
            return None
        text = decoded.decode('utf-8')
        return text if re.search(r'\b(?:def |class |import |exec\(|compile\()', text) else None
    except (ValueError, UnicodeError, OSError, EOFError):
        return None


def summarize_native_batch_semantics(decoded_source, source_label):
    import ast
    import json
    import re

    targets = frozenset({'_pp_optimize_generic', '_pp_expand_capacity_batches'})
    identifier = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,70}$')
    label = re.compile(r'^[A-Za-z0-9_.:-]{1,100}$')
    technical_keys = frozenset({
        'batch', 'batches', 'batching', 'batch_id', 'batch_count', 'batch_counts',
        'batch_quantity', 'batch_quantities', 'batch_size', 'batch_sizes', 'batch_capacity',
        'batch_unit', 'batch_policy', 'batch_mode', 'batch_plan', 'batch_gene', 'batch_genes',
        'batch_factor', 'batch_factors', 'batch_ratio', 'batch_ratios', 'batch_limits',
        'min_batch_size', 'max_batch_size', 'min_batch_quantity', 'max_batch_quantity',
        'min_batch_count', 'max_batch_count', 'per_order_batch_sizes', 'per_order_batch_counts',
        'minibatch_size', 'minibatch_sizes', 'minibatch_count', 'minibatch_counts',
        'mini_batch_size', 'mini_batch_sizes', 'mini_batch_count', 'mini_batch_counts',
        'split', 'splits', 'split_size', 'split_sizes', 'split_count', 'split_counts',
        'split_quantity', 'split_quantities', 'split_gene', 'split_genes', 'split_factor',
        'split_factors', 'split_ratio', 'split_ratios', 'split_mode', 'split_policy',
        'lot_size', 'lot_sizes', 'lot_count', 'lot_counts', 'min_lot_size', 'max_lot_size',
        'chunk_size', 'chunk_sizes', 'chunk_count', 'chunk_counts',
        'quantity', 'area', 'capacity', 'order_ids', 'order_sequence', 'sequence',
        'best_order', 'best_batches', 'parts', 'partitions', 'genome', 'genes',
        'best_genome', 'best_partition', 'best_partitions', '_batch_sizes', '_batch_plan',
    })
    builtin_names = frozenset({'abs', 'all', 'any', 'bool', 'dict', 'enumerate', 'float', 'int',
        'isinstance', 'len', 'list', 'max', 'min', 'range', 'round', 'set', 'sorted', 'str',
        'sum', 'tuple', 'zip', 'Exception', 'RuntimeError', 'ValueError', 'TypeError'})
    dynamic_names = frozenset({'eval', 'exec', 'compile', '__import__', 'getattr', 'globals', 'locals', 'vars'})
    max_calls = 96
    max_sites = 64
    output = {'version': 'native-batch-semantic-metadata-v1',
              'source_label': source_label if isinstance(source_label, str) and label.fullmatch(source_label) else 'invalid_label',
              'status': 'ok', 'functions': [], 'functions_truncated': False, 'output_truncated': False,
              'scope': 'two_function_ast_metadata_only'}
    if not isinstance(decoded_source, str) or len(decoded_source) > 4 * 1024 * 1024:
        output['status'] = 'unsupported_source_size_or_type'
        return output
    try:
        tree = ast.parse(decoded_source, filename='<owned-native-batch-metadata>')
    except (SyntaxError, ValueError, RecursionError, MemoryError):
        output['status'] = 'unparseable_source'
        return output

    def safe_name(value):
        return value if isinstance(value, str) and identifier.fullmatch(value) else None

    def dotted(node, depth=0):
        if depth > 4:
            return None
        if isinstance(node, ast.Name):
            return safe_name(node.id)
        if isinstance(node, ast.Attribute):
            base, attribute = dotted(node.value, depth + 1), safe_name(node.attr)
            return base + '.' + attribute if base and attribute else None
        return None

    def known_key(node):
        return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value in technical_keys else None

    def shape(node, depth=0):
        if node is None:
            return {'kind': 'absent'}
        if isinstance(node, ast.Name):
            return {'kind': 'name', 'name': safe_name(node.id)}
        if isinstance(node, ast.Constant):
            key = known_key(node)
            if key:
                return {'kind': 'known_technical_key', 'name': key}
            value = node.value
            kind = 'null' if value is None else 'boolean' if isinstance(value, bool) else 'number' if isinstance(value, (int, float, complex)) else 'string' if isinstance(value, str) else 'other'
            return {'kind': kind + '_literal'}
        if isinstance(node, ast.Attribute):
            return {'kind': 'attribute', 'name': dotted(node)}
        if depth >= 2:
            return {'kind': type(node).__name__.lower()}
        if isinstance(node, ast.Subscript):
            return {'kind': 'subscript', 'base': shape(node.value, depth + 1), 'index': shape(node.slice, depth + 1)}
        if isinstance(node, ast.Slice):
            return {'kind': 'slice', 'lower': shape(node.lower, depth + 1), 'upper': shape(node.upper, depth + 1), 'step': shape(node.step, depth + 1)}
        if isinstance(node, (ast.Tuple, ast.List, ast.Set)):
            return {'kind': type(node).__name__.lower(), 'items': [shape(item, depth + 1) for item in node.elts[:4]], 'items_truncated': len(node.elts) > 4}
        if isinstance(node, ast.Dict):
            return {'kind': 'dict', 'known_keys': sorted({known_key(key) for key in node.keys if known_key(key)}), 'unknown_key_count': sum(known_key(key) is None for key in node.keys)}
        if isinstance(node, ast.Call):
            return {'kind': 'call', 'callee': dotted(node.func), 'argument_kinds': [type(argument).__name__.lower() for argument in node.args[:8]]}
        if isinstance(node, ast.Starred):
            return {'kind': 'starred', 'value': shape(node.value, depth + 1)}
        if isinstance(node, ast.BinOp):
            return {'kind': 'binary', 'operator': type(node.op).__name__, 'left': shape(node.left, depth + 1), 'right': shape(node.right, depth + 1)}
        return {'kind': type(node).__name__.lower()}

    all_source_functions = {node.name for node in ast.walk(tree)
                            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and safe_name(node.name)}
    definitions = [node for node in ast.walk(tree)
                   if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in targets]
    output['matching_definition_count'] = len(definitions)
    output['functions_truncated'] = len(definitions) > 8

    for definition in definitions[:8]:
        parameters = list(definition.args.posonlyargs) + list(definition.args.args) + list(definition.args.kwonlyargs)
        if definition.args.vararg:
            parameters.append(definition.args.vararg)
        if definition.args.kwarg:
            parameters.append(definition.args.kwarg)
        result = {'name': definition.name, 'first_line': definition.lineno,
                  'parameters': [argument.arg for argument in parameters if safe_name(argument.arg)][:24],
                  'calls': [], 'call_names': [], 'call_count': 0, 'calls_truncated': False,
                  'decoder_calls': [], 'technical_key_reads': [], 'technical_key_writes': [],
                  'constructed_technical_keys': [], 'dynamic_call_count': 0,
                  'dynamic_call_kinds': [], 'mutation_kinds': [], 'mutation_sites': [],
                  'mutation_sites_truncated': False, 'assignments': [], 'assignments_truncated': False,
                  'other_calls_requiring_review': [], 'local_functions': [],
                  'definition_time_expressions_omitted': bool(definition.decorator_list or definition.args.defaults or definition.args.kw_defaults),
                  'absence_of_batch_search_proven': False}
        calls = {}
        names, reads, writes, constructed, dynamic, mutation_kinds, unresolved = set(), set(), set(), set(), set(), set(), set()
        local_functions = {node.name for node in ast.walk(definition)
                           if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and safe_name(node.name)}
        result['local_functions'] = sorted(local_functions - {definition.name})[:24]

        class Visitor(ast.NodeVisitor):
            def __init__(self):
                self.scope = [definition.name]

            def add_site(self, node, kind, receiver=None):
                mutation_kinds.add(kind)
                if len(result['mutation_sites']) < max_sites:
                    result['mutation_sites'].append({'scope': '.'.join(self.scope), 'line': node.lineno,
                                                     'kind': kind, 'receiver': receiver})
                else:
                    result['mutation_sites_truncated'] = True

            def visit_FunctionDef(self, node):
                self.scope.append(safe_name(node.name) or 'other')
                for statement in node.body:
                    self.visit(statement)
                self.scope.pop()

            visit_AsyncFunctionDef = visit_FunctionDef

            def visit_Call(self, node):
                result['call_count'] += 1
                callee = dotted(node.func)
                if callee:
                    names.add(callee)
                root = callee.split('.', 1)[0] if callee else None
                if not callee or callee in dynamic_names:
                    result['dynamic_call_count'] += 1
                    dynamic.add(callee or type(node.func).__name__.lower() + '_callable')
                resolution = ('builtin' if callee in builtin_names else 'local_function'
                              if callee in local_functions else 'source_function_unanalysed'
                              if callee in all_source_functions else 'external_or_attribute' if callee else 'dynamic')
                if resolution in ('source_function_unanalysed', 'external_or_attribute', 'dynamic'):
                    unresolved.add(callee or '<dynamic>')
                entry = {'scope': '.'.join(self.scope), 'callee': callee, 'line': node.lineno,
                         'resolution_hint': resolution, 'args': [shape(arg) for arg in node.args[:8]],
                         'args_truncated': len(node.args) > 8,
                         'keywords': [{'name': safe_name(item.arg) if item.arg else None, 'shape': shape(item.value)} for item in node.keywords[:8]],
                         'keywords_truncated': len(node.keywords) > 8}
                signature = json.dumps({key: value for key, value in entry.items() if key != 'line'}, sort_keys=True)
                if signature in calls:
                    calls[signature]['occurrences'] += 1
                elif len(calls) < max_calls:
                    calls[signature] = {**entry, 'occurrences': 1}
                else:
                    result['calls_truncated'] = True
                if callee and callee.split('.')[-1] in ('_pp_schedule_sequence', '_pp_schedule_sequence_unbatched', '_pp_expand_capacity_batches'):
                    if len(result['decoder_calls']) < 24:
                        result['decoder_calls'].append(entry)
                if isinstance(node.func, ast.Attribute):
                    method, receiver = node.func.attr, dotted(node.func.value)
                    key = known_key(node.args[0]) if node.args else None
                    if key and method in ('get', 'setdefault', 'pop'):
                        reads.add(key)
                        if method != 'get':
                            writes.add(key)
                    if method == 'update':
                        writes.update(item.arg for item in node.keywords if item.arg in technical_keys)
                        for argument in node.args:
                            if isinstance(argument, ast.Dict):
                                writes.update(known_key(key) for key in argument.keys if known_key(key))
                    if method in ('shuffle', 'sample', 'choice', 'choices'):
                        self.add_site(node, 'random_' + method, receiver)
                    elif method in ('append', 'extend', 'insert', 'pop', 'remove', 'clear', 'update', 'sort', 'reverse'):
                        self.add_site(node, 'container_' + method, receiver)
                self.generic_visit(node)

            def visit_Subscript(self, node):
                key = known_key(node.slice)
                if key:
                    (writes if isinstance(node.ctx, (ast.Store, ast.Del)) else reads).add(key)
                if isinstance(node.ctx, (ast.Store, ast.Del)):
                    self.add_site(node, 'slice_store' if isinstance(node.slice, ast.Slice) else 'subscript_store', dotted(node.value))
                elif isinstance(node.slice, ast.Slice):
                    self.add_site(node, 'slice_read', dotted(node.value))
                self.generic_visit(node)

            def visit_Dict(self, node):
                constructed.update(known_key(key) for key in node.keys if known_key(key))
                self.generic_visit(node)

            def visit_Assign(self, node):
                if len(result['assignments']) < max_sites:
                    result['assignments'].append({'scope': '.'.join(self.scope), 'line': node.lineno,
                        'targets': [shape(target) for target in node.targets[:4]], 'value_shape': shape(node.value)})
                else:
                    result['assignments_truncated'] = True
                if (len(node.targets) == 1 and isinstance(node.targets[0], (ast.Tuple, ast.List))
                        and isinstance(node.value, (ast.Tuple, ast.List))
                        and len(node.targets[0].elts) == len(node.value.elts) == 2):
                    left, right = node.targets[0].elts, node.value.elts
                    if all(isinstance(item, ast.Subscript) for item in left + right):
                        same = dotted(left[0].value)
                        if same and all(dotted(item.value) == same for item in left + right):
                            first = ast.dump(left[0].slice, include_attributes=False) == ast.dump(right[1].slice, include_attributes=False)
                            second = ast.dump(left[1].slice, include_attributes=False) == ast.dump(right[0].slice, include_attributes=False)
                            if first and second:
                                self.add_site(node, 'subscript_swap_same_container', same)
                self.generic_visit(node)

            def visit_AugAssign(self, node):
                self.add_site(node, 'augmented_assignment_' + type(node.op).__name__, dotted(node.target))
                self.generic_visit(node)

            def visit_BinOp(self, node):
                if isinstance(node.op, ast.Add) and (isinstance(node.left, (ast.Subscript, ast.List, ast.Tuple))
                                                    or isinstance(node.right, (ast.Subscript, ast.List, ast.Tuple))):
                    self.add_site(node, 'slice_or_container_concatenation')
                self.generic_visit(node)

        visitor = Visitor()
        try:
            for statement in definition.body:
                visitor.visit(statement)
        except (RecursionError, MemoryError):
            result['analysis_incomplete'] = True
        result.update(calls=list(calls.values()), call_names=sorted(names)[:128],
                      call_names_truncated=len(names) > 128, technical_key_reads=sorted(reads),
                      technical_key_writes=sorted(writes), constructed_technical_keys=sorted(constructed),
                      dynamic_call_kinds=sorted(dynamic), mutation_kinds=sorted(mutation_kinds),
                      other_calls_requiring_review=sorted(unresolved)[:128],
                      other_calls_truncated=len(unresolved) > 128)
        output['functions'].append(result)
    # A caller can safely add two summaries to the existing bounded audit log.
    # Keep all call-name sets where possible; remove detailed examples first.
    while len(json.dumps(output, ensure_ascii=True, separators=(',', ':')).encode()) > 32768:
        output['output_truncated'] = True
        choices = []
        for row in output['functions']:
            for field, flag in (('calls', 'calls_truncated'), ('assignments', 'assignments_truncated'),
                                ('mutation_sites', 'mutation_sites_truncated'), ('decoder_calls', 'decoder_calls_truncated'),
                                ('other_calls_requiring_review', 'other_calls_truncated'), ('call_names', 'call_names_truncated')):
                if row[field]:
                    choices.append((len(json.dumps(row[field])), row, field, flag))
        if choices:
            _, row, field, flag = max(choices, key=lambda item: item[0])
            row[field] = row[field][:len(row[field]) // 2]
            row[flag] = True
        elif output['functions']:
            output['functions'].pop()
            output['functions_truncated'] = True
        else:
            break
    return output

def code_metadata(text, semantic_reports=None, semantic_label=None):
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
        if semantic_reports is not None:
            summary = summarize_native_batch_semantics(source, semantic_label)
            if summary.get('matching_definition_count', 0) > 0:
                semantic_reports.append((fragments, summary))
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
            elif depth < 3 and isinstance(node, ast.Constant) and isinstance(node.value, (str, bytes)) and len(pending) < 24:
                embedded = embedded_python(node.value)
                if embedded is not None and total + sum(len(item[0]) for item in pending) + len(embedded) <= 4 * MAX_SOURCE:
                    pending.append((embedded, depth + 1))
    return fragments, sorted(findings)[:160]


def config_lines(label, config):
    selected = [key for key in config if key in CODE_KEYS or (SAFE_KEY.fullmatch(key) and re.search(r'BATCH|JOINT|SPLIT|MINI|REAL_OPT|OBJECTIVE|GENERIC_RESTORE', key))]
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
            semantic_reports = [] if label == 'ga-worker' and key in ('PP_GENERIC_CORE_B64', 'PP_CAPACITY_BATCHING_PATCH_CODE') else None
            fragments, findings = code_metadata(text, semantic_reports, key)
            yield f'BATCH_BUILD_CODE_AST label={label} key={key} fragments={fragments} symbols={len(findings)}'
            for fragment, summary in semantic_reports or []:
                summary = public_semantic_projection(summary)
                if semantic_report_safe(summary, key):
                    encoded_summary = json.dumps(summary, ensure_ascii=True, separators=(',', ':'))
                    yield f'BATCH_BUILD_SEMANTICS key={key} fragment={fragment} data={encoded_summary}'
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
            if label == 'ga-worker':
                for line in base_source_lines(config):
                    print(line)
        except ValueError:
            print(f'BATCH_BUILD_CONFIG label={label} status=unavailable')
        except OSError as error:
            print(f'BATCH_BUILD_CONFIG label={label} status={error_status(error)}')


def base_source_lines(config):
    count = config.get('PP_RUNTIME_SRC_COUNT', '')
    if not re.fullmatch(r'[0-9]{1,2}', count) or not 1 <= int(count) <= 64:
        yield 'BATCH_BUILD_BASE status=invalid_count'
        return
    chunks = [config.get('PP_RUNTIME_SRC_%02d' % index, '') for index in range(1, int(count) + 1)]
    if sum(map(len, chunks)) > 4 * MAX_SOURCE + 4:
        yield 'BATCH_BUILD_BASE status=too_large'
        return
    if any(not chunk or not re.fullmatch(r'[A-Za-z0-9+/=]+', chunk) for chunk in chunks):
        yield 'BATCH_BUILD_BASE status=invalid_chunks'
        return
    expected = config.get('PP_PY_GA_SOURCE_SHA256', '').lower()
    if not re.fullmatch(r'[0-9a-f]{64}', expected):
        yield 'BATCH_BUILD_BASE status=invalid_hash'
        return
    try:
        source = base64.b64decode(''.join(chunks), validate=True)
    except ValueError:
        yield 'BATCH_BUILD_BASE status=invalid_chunks'
        return
    if not source or len(source) > 3 * MAX_SOURCE:
        yield 'BATCH_BUILD_BASE status=too_large'
        return
    if hashlib.sha256(source).hexdigest() != expected:
        yield 'BATCH_BUILD_BASE status=hash_mismatch'
        return
    yield f'BATCH_BUILD_BASE status=verified bytes={len(source)} sha256={expected}'
    try:
        tree = ast.parse(source.decode('utf-8'), filename='<verified-base-metadata-only>')
    except (SyntaxError, UnicodeError, ValueError, RecursionError):
        yield 'BATCH_BUILD_BASE_AST status=unavailable'
        return
    definitions = [node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and SAFE_SYMBOL.fullmatch(node.name) and INTERESTING.search(node.name)]
    definitions.sort(key=lambda node: (0 if re.search(r'joint|ppjb|genom', node.name, re.I) else 1 if re.search(r'batch|split', node.name, re.I) else 2, node.lineno))
    calls = set()
    for node in definitions[:80]:
        args = node.args.posonlyargs + node.args.args + node.args.kwonlyargs
        if node.args.vararg: args.append(node.args.vararg)
        if node.args.kwarg: args.append(node.args.kwarg)
        params = ','.join(arg.arg for arg in args[:16] if SAFE_SYMBOL.fullmatch(arg.arg)) or '-'
        yield f'BATCH_BUILD_BASE_FUNCTION name={node.name} params={params} line={node.lineno}'
        pending = list(node.body)
        while pending and len(calls) < 160:
            child = pending.pop()
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
                continue
            if isinstance(child, ast.Call):
                name = symbol(child.func)
                if name: calls.add((node.name, name, child.lineno))
            pending.extend(ast.iter_child_nodes(child))
    for caller, callee, line in sorted(calls):
        yield f'BATCH_BUILD_BASE_CALL caller={caller} callee={callee} line={line}'
    aliases = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            value = symbol(node.value)
            for target in node.targets:
                name = symbol(target)
                if name and value and (INTERESTING.search(name) or INTERESTING.search(value)):
                    aliases.add((name, value, node.lineno))
                    if len(aliases) >= 80: break
        if len(aliases) >= 80: break
    for target, source_name, line in sorted(aliases):
        yield f'BATCH_BUILD_BASE_ALIAS target={target} source={source_name} line={line}'
    yield f'BATCH_BUILD_BASE_AST status=ok functions={len(definitions[:80])} calls={len(calls)} aliases={len(aliases)}'


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


def public_semantic_projection(report):
    # Detailed AST shapes stay in memory. Public output contains aggregate sets
    # only: no assignment records, argument expressions, sites or source lines.
    list_fields = ('parameters', 'call_names', 'technical_key_reads', 'technical_key_writes',
                   'constructed_technical_keys', 'dynamic_call_kinds', 'mutation_kinds')
    bool_fields = ('call_names_truncated', 'analysis_incomplete', 'definition_time_expressions_omitted')
    functions = []
    for row in report.get('functions', []):
        projected = {name: row.get(name, []) for name in list_fields}
        projected.update({name: row.get(name, False) for name in bool_fields})
        projected.update(name=row.get('name'), dynamic_call_count=row.get('dynamic_call_count', 0),
                         absence_of_batch_search_proven=False)
        functions.append(projected)
    return {'version': 'native-batch-public-metadata-v1', 'source_label': report.get('source_label'),
            'scope': 'two_function_aggregate_metadata_only', 'status': report.get('status'),
            'matching_definition_count': report.get('matching_definition_count'), 'functions': functions,
            'functions_truncated': report.get('functions_truncated', False),
            'output_truncated': report.get('output_truncated', False)}


def semantic_report_safe(report, source_label):
    root_keys = {'version', 'source_label', 'scope', 'status', 'matching_definition_count',
                 'functions', 'functions_truncated', 'output_truncated'}
    function_lists = {'parameters', 'call_names', 'technical_key_reads', 'technical_key_writes',
                      'constructed_technical_keys', 'dynamic_call_kinds', 'mutation_kinds'}
    function_bools = {'call_names_truncated', 'analysis_incomplete',
                      'definition_time_expressions_omitted', 'absence_of_batch_search_proven'}
    function_keys = function_lists | function_bools | {'name', 'dynamic_call_count'}
    technical_keys = set('batch batches batching batch_id batch_count batch_counts batch_quantity batch_quantities batch_size batch_sizes batch_capacity batch_unit batch_policy batch_mode batch_plan batch_gene batch_genes batch_factor batch_factors batch_ratio batch_ratios batch_limits min_batch_size max_batch_size min_batch_quantity max_batch_quantity min_batch_count max_batch_count per_order_batch_sizes per_order_batch_counts minibatch_size minibatch_sizes minibatch_count minibatch_counts mini_batch_size mini_batch_sizes mini_batch_count mini_batch_counts split splits split_size split_sizes split_count split_counts split_quantity split_quantities split_gene split_genes split_factor split_factors split_ratio split_ratios split_mode split_policy lot_size lot_sizes lot_count lot_counts min_lot_size max_lot_size chunk_size chunk_sizes chunk_count chunk_counts quantity area capacity order_ids order_sequence sequence best_order best_batches parts partitions genome genes best_genome best_partition best_partitions _batch_sizes _batch_plan'.split())
    name_pattern = re.compile(r'[A-Za-z_][A-Za-z0-9_]{0,70}\Z')
    call_pattern = re.compile(r'[A-Za-z_][A-Za-z0-9_]{0,70}(?:\.[A-Za-z_][A-Za-z0-9_]{0,70}){0,4}\Z')
    if (not isinstance(report, dict) or set(report) != root_keys or
            source_label not in ('PP_GENERIC_CORE_B64', 'PP_CAPACITY_BATCHING_PATCH_CODE') or
            report['source_label'] != source_label or report['version'] != 'native-batch-public-metadata-v1' or
            report['scope'] != 'two_function_aggregate_metadata_only' or report['status'] != 'ok' or
            type(report['matching_definition_count']) is not int or not 1 <= report['matching_definition_count'] <= 10000000 or
            not isinstance(report['functions'], list) or not 1 <= len(report['functions']) <= 8 or
            not isinstance(report['functions_truncated'], bool) or not isinstance(report['output_truncated'], bool)):
        return False
    for row in report['functions']:
        if (not isinstance(row, dict) or set(row) != function_keys or
                row['name'] not in ('_pp_optimize_generic', '_pp_expand_capacity_batches') or
                type(row['dynamic_call_count']) is not int or not 0 <= row['dynamic_call_count'] <= 10000000 or
                any(not isinstance(row[key], bool) for key in function_bools) or
                row['absence_of_batch_search_proven'] is not False):
            return False
        for key in function_lists:
            values = row[key]
            pattern = call_pattern if key == 'call_names' else name_pattern
            if (not isinstance(values, list) or len(values) > (24 if key == 'parameters' else 128) or
                    any(not isinstance(value, str) or not pattern.fullmatch(value) for value in values) or
                    len(values) != len(set(values))):
                return False
            if key in ('technical_key_reads', 'technical_key_writes', 'constructed_technical_keys') and not set(values) <= technical_keys:
                return False
    try:
        return len(json.dumps(report, ensure_ascii=True, separators=(',', ':')).encode()) <= 32768
    except (TypeError, ValueError, RecursionError):
        return False


def allowed_line(line):
    if line.startswith('BATCH_BUILD_SEMANTICS '):
        if len(line.encode('utf-8')) > 33000: return False
        match = re.fullmatch(r'BATCH_BUILD_SEMANTICS key=(PP_GENERIC_CORE_B64|PP_CAPACITY_BATCHING_PATCH_CODE) fragment=([0-9]{1,2}) data=(.+)', line)
        if not match or not 1 <= int(match[2]) <= 16: return False
        try:
            return semantic_report_safe(json.loads(match[3]), match[1])
        except (ValueError, RecursionError):
            return False
    labels = r'(?:root|sources|current|ga|app_root|app)'
    configs = r'(?:gateway|ga-worker|auth-app)'
    config_key = r'(?:PP_[A-Z0-9_]{1,120}|CAP_BATCH_PATCH|D_TIMING_INSTALL|D_START_GOOD)'
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
        rf'BATCH_BUILD_CONFIG_KEY label={configs} name={config_key}',
        rf'BATCH_BUILD_CODE label={configs} key={config_key} status=(?:too_large|ok bytes=[0-9]+ sha256=[0-9a-f]{{64}})',
        rf'BATCH_BUILD_CODE_AST label={configs} key={config_key} (?:status=unavailable|fragments=[0-9]+ symbols=[0-9]+)',
        rf'BATCH_BUILD_CODE_SYMBOL label={configs} key={config_key} kind=(?:function|call|binding|ref) name=[A-Za-z_][A-Za-z0-9_.]{{0,100}} detail=[A-Za-z0-9_.,-]{{1,1700}}',
        r'BATCH_BUILD_BASE status=(?:invalid_count|too_large|invalid_chunks|invalid_hash|hash_mismatch|verified bytes=[0-9]+ sha256=[0-9a-f]{64})',
        r'BATCH_BUILD_BASE_FUNCTION name=[A-Za-z_][A-Za-z0-9_.]{0,100} params=[A-Za-z0-9_.,-]{1,1700} line=[0-9]+',
        r'BATCH_BUILD_BASE_CALL caller=[A-Za-z_][A-Za-z0-9_.]{0,100} callee=[A-Za-z_][A-Za-z0-9_.]{0,100} line=[0-9]+',
        r'BATCH_BUILD_BASE_ALIAS target=[A-Za-z_][A-Za-z0-9_.]{0,100} source=[A-Za-z_][A-Za-z0-9_.]{0,100} line=[0-9]+',
        r'BATCH_BUILD_BASE_AST status=(?:unavailable|ok functions=[0-9]+ calls=[0-9]+ aliases=[0-9]+)',
        r'BATCH_BUILD_CAP binary=(?:bwrap|unshare) status=(?:ok available=[01]|unavailable)',
        r'BATCH_BUILD_USERNS flag=(?:unprivileged_userns_clone|apparmor_restrict_unprivileged_userns|max_user_namespaces) status=(?:ok value=[0-9]{1,10}|invalid|missing|denied|symlink_refused|unreadable)',
        r'BATCH_BUILD_USERNS_PROBE status=(?:supported|denied|timeout|error)',
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
        extra_keys = ('CAP_BATCH_PATCH', 'D_TIMING_INSTALL', 'D_START_GOOD', 'PP_GENERIC_RESTORE_BOOT_V1', 'PP_CAP_BATCH_BOOT_V3', 'PP_CAP_BATCH_BOOT_V4', 'PP_CAP_BATCH_BOOT_V5')
        aliases = list(config_lines('gateway', {key: outer for key in extra_keys} | {'D_PRIVATE_SCALAR': sentinel}))
        assert all(allowed_line(line) for line in aliases)
        assert all(any(f'BATCH_BUILD_CODE label=gateway key={key} status=ok ' in line for line in aliases) for key in extra_keys)
        assert any('key=CAP_BATCH_PATCH kind=function name=_ppjb_joint_optimize' in line for line in aliases)
        assert not any('D_PRIVATE_SCALAR' in line or sentinel in line for line in aliases)
        worker_hash = next(line.split('sha256=')[1] for line in lines if line.startswith('BATCH_BUILD_CODE label=gateway key=PP_CAPACITY_BATCHING_PATCH_CODE status=ok '))
        gateway_hash = next(line.split('sha256=')[1] for line in aliases if line.startswith('BATCH_BUILD_CODE label=gateway key=CAP_BATCH_PATCH status=ok '))
        assert worker_hash == gateway_hash
        assert numeric_flag(b'1\n') == 1
        assert numeric_flag(b'6191547\n') == 6191547
        for bad in (b'-1', b'2147483648', b'1\nprivate', sentinel.encode()):
            assert numeric_flag(bad) is None
        assert allowed_line('BATCH_BUILD_CAP binary=bwrap status=ok available=1')
        assert allowed_line('BATCH_BUILD_USERNS flag=max_user_namespaces status=ok value=6191547')
        assert allowed_line('BATCH_BUILD_USERNS flag=unprivileged_userns_clone status=denied')
        assert not allowed_line('BATCH_BUILD_CAP binary=bwrap path=/private/path')
        assert not allowed_line('BATCH_BUILD_USERNS flag=process_environ status=ok value=1')
        private_source = 'def _pp_joint_batch(model, batch_sizes):\n hidden=' + repr(sentinel) + '\n return _pp_optimize_generic(model)\noptimize=_pp_joint_batch\n'
        for encoded in (base64.b64encode(private_source.encode()).decode(), base64.b64encode(gzip.compress(private_source.encode())).decode()):
            installer = 'import base64\npayload=' + repr(encoded) + '\n'
            fragments, findings = code_metadata(installer)
            assert fragments == 2
            assert ('function', '_pp_joint_batch', 'model,batch_sizes') in findings
            assert sentinel not in str(findings) and encoded not in str(findings)
        base = {'PP_RUNTIME_SRC_COUNT': '1', 'PP_RUNTIME_SRC_01': base64.b64encode(private_source.encode()).decode(),
                'PP_PY_GA_SOURCE_SHA256': hashlib.sha256(private_source.encode()).hexdigest()}
        lines = list(base_source_lines(base))
        assert all(allowed_line(line) for line in lines)
        assert any('BATCH_BUILD_BASE_FUNCTION name=_pp_joint_batch params=model,batch_sizes line=1' == line for line in lines)
        assert any('BATCH_BUILD_BASE_CALL caller=_pp_joint_batch callee=_pp_optimize_generic' in line for line in lines)
        assert any('BATCH_BUILD_BASE_ALIAS target=optimize source=_pp_joint_batch' in line for line in lines)
        assert sentinel not in '\n'.join(lines)
        assert list(base_source_lines(base | {'PP_PY_GA_SOURCE_SHA256': '0' * 64})) == ['BATCH_BUILD_BASE status=hash_mismatch']
        assert list(base_source_lines(base | {'PP_RUNTIME_SRC_COUNT': '65'})) == ['BATCH_BUILD_BASE status=invalid_count']
        assert 'PP_SETUP_ACTIVE_PATCH_B64' in CODE_KEYS
        # The private analysis may see expression shapes; the public projection
        # must expose only the approved aggregate metadata, including nested code.
        semantic_source = ('def _pp_optimize_generic(model):\n'
            ' private_argument_expression = model.get("batch_sizes", [])\n'
            ' hidden = ' + repr(sentinel) + '\n'
            ' random.shuffle(private_argument_expression)\n'
            ' private_argument_expression[0], private_argument_expression[1] = private_argument_expression[1], private_argument_expression[0]\n'
            ' return _pp_schedule_sequence(model, private_argument_expression, 987654321)\n')
        detailed = summarize_native_batch_semantics(semantic_source, 'PP_GENERIC_CORE_B64')
        assert 'private_argument_expression' in json.dumps(detailed)
        public = public_semantic_projection(detailed)
        assert semantic_report_safe(public, 'PP_GENERIC_CORE_B64')
        assert not semantic_report_safe(detailed, 'PP_GENERIC_CORE_B64')
        public_text = json.dumps(public, ensure_ascii=True, separators=(',', ':'))
        assert all(secret not in public_text for secret in (sentinel, 'private_argument_expression', '987654321'))
        function = public['functions'][0]
        assert function['technical_key_reads'] == ['batch_sizes']
        assert 'random_shuffle' in function['mutation_kinds']
        assert 'subscript_swap_same_container' in function['mutation_kinds']
        assert '_pp_schedule_sequence' in function['call_names']
        assert function['absence_of_batch_search_proven'] is False
        nested = 'payload = ' + repr(base64.b64encode(gzip.compress(semantic_source.encode())).decode()) + '\n'
        semantic_config = {'PP_GENERIC_CORE_B64': base64.b64encode(nested.encode()).decode()}
        semantic_lines = list(config_lines('ga-worker', semantic_config))
        assert all(allowed_line(line) for line in semantic_lines)
        assert any(line.startswith('BATCH_BUILD_SEMANTICS key=PP_GENERIC_CORE_B64 fragment=2 ') for line in semantic_lines)
        assert all(secret not in '\n'.join(semantic_lines) for secret in (sentinel, 'private_argument_expression', '987654321'))
        assert not any(line.startswith('BATCH_BUILD_SEMANTICS ') for line in config_lines('gateway', semantic_config))
        assert not any(line.startswith('BATCH_BUILD_SEMANTICS ') for line in config_lines('ga-worker', {'PP_CAPACITY_BATCHING_PATCH_CODE': private_source}))
        capacity_source = ('def _pp_expand_capacity_batches(model):\n'
            ' private_record_expression = {"batch_sizes": [1], "quantity": 987654321}\n'
            ' private_record_expression["quantity"] = model["quantity"]\n'
            ' return private_record_expression\n')
        capacity_lines = list(config_lines('ga-worker', {'PP_CAPACITY_BATCHING_PATCH_CODE': capacity_source}))
        assert all(allowed_line(line) for line in capacity_lines)
        capacity_line = next(line for line in capacity_lines if line.startswith('BATCH_BUILD_SEMANTICS '))
        capacity = json.loads(capacity_line.split(' data=', 1)[1])
        assert capacity['functions'][0]['technical_key_writes'] == ['quantity']
        assert 'private_record_expression' not in capacity_line and '987654321' not in capacity_line
        def semantic_line(report, fragment='2'):
            return 'BATCH_BUILD_SEMANTICS key=PP_GENERIC_CORE_B64 fragment=' + fragment + ' data=' + json.dumps(report, ensure_ascii=True, separators=(',', ':'))
        assert allowed_line(semantic_line(public))
        assert not allowed_line(semantic_line(public, '17'))
        assert not allowed_line(semantic_line(public | {'source_label': 'PP_CAPACITY_BATCHING_PATCH_CODE'}))
        for forbidden in ('assignments', 'calls', 'decoder_calls', 'mutation_sites', 'receiver', 'first_line', 'scope', 'args'):
            changed = json.loads(public_text)
            changed['functions'][0][forbidden] = []
            assert not allowed_line(semantic_line(changed))
        changed = json.loads(public_text)
        changed['functions'][0]['technical_key_reads'] = [sentinel]
        assert not allowed_line(semantic_line(changed))
        changed = json.loads(public_text)
        changed['functions'][0]['absence_of_batch_search_proven'] = True
        assert not allowed_line(semantic_line(changed))
        from types import SimpleNamespace
        root_binary = lambda _path: SimpleNamespace(st_mode=stat.S_IFREG | 0o755, st_uid=0)
        calls = []
        def fake_run(command, **options):
            calls.append((command, options))
            return SimpleNamespace(returncode=0, stderr=b'')
        assert rootless_isolation_probe(fake_run, root_binary) == 'supported'
        assert len(calls) == 1
        assert calls[0][0] == ['/usr/bin/unshare', '--user', '--map-root-user', '--mount', '--propagation', 'private', '--net', '--pid', '--fork', '--', '/bin/true']
        assert calls[0][1]['timeout'] == 5
        assert calls[0][1]['env'] == {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'}
        assert calls[0][1]['stderr'] == subprocess.PIPE and calls[0][1]['stdout'] == subprocess.DEVNULL
        denied = lambda *_args, **_kwargs: SimpleNamespace(returncode=1, stderr=b'unshare: Operation not permitted ' + sentinel.encode())
        assert rootless_isolation_probe(denied, root_binary) == 'denied'
        def timed_out(*_args, **_kwargs):
            raise subprocess.TimeoutExpired('fixed-probe', 5, stderr=sentinel.encode())
        assert rootless_isolation_probe(timed_out, root_binary) == 'timeout'
        before_calls = len(calls)
        assert rootless_isolation_probe(fake_run, lambda _path: SimpleNamespace(st_mode=stat.S_IFREG | 0o4755, st_uid=0)) == 'error'
        assert rootless_isolation_probe(fake_run, lambda _path: SimpleNamespace(st_mode=stat.S_IFREG | 0o755, st_uid=1000)) == 'error'
        assert len(calls) == before_calls
        assert allowed_line('BATCH_BUILD_USERNS_PROBE status=denied')
        assert not allowed_line('BATCH_BUILD_USERNS_PROBE status=denied stderr=' + sentinel)
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
    inspect_isolation_metadata()
    # The ordinary user-namespace probe was denied. Do not invoke it again.
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
