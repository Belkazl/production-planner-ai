"""Host-local code-input selection. No serializer, transport, or stdout API.

Private native code remains on its existing OVH host. Only the host-local
verification process consumes the selected code-only values.
"""
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import stat


ROOT = Path('/home/liftorbit-ci/liftorbit-migration')
CONFIG = ROOT / 'production/current/ga-worker.json'
PACKAGE = ROOT / 'sources/current/ga/ga_workers'
COMPILE_SHA = 'a4e03f395317c275b3acbb59acf054fde3730b02dbddfeee485de20d540494b7'
CODE_KEYS = frozenset({
    'PP_GENERIC_CORE_B64', 'PP_REGEX_FIX_B64', 'PP_CAPACITY_GANTT_PATCH_B64',
    'PP_PARTIAL_MATERIAL_PATCH_B64', 'PP_PARSE_RESOURCE_REPAIR_B64',
    'PP_CLIENT_PROJECT_REPAIR_B64', 'PP_FREEZE_HOTFIX_B64',
    'PP_TECH_PROCESS_PATCH_B64', 'PP_ORDER_PROCESS_LINK_B64',
    'PP_REMOVE_LEGACY_DURATION_B64', 'PP_TIMING_PROFILE_V1_INSTALL',
    'PP_CAPACITY_BATCHING_PATCH_CODE', 'PP_CURRENT_FEATURES_PATCH_V1',
    'PP_GENERIC_GANTT_UI_B64', 'PP_SAVED_PLAN_RESUME_PATCH_CODE',
    'PP_SETUP_FINAL_PATCH_B64', 'PP_CAP_BATCH_BOOT_V2', 'PP_RESTORE_ETALON_BOOT_V1',
    'PP_START_CMD_GOOD',
})
HASH_KEYS = frozenset({'PP_PY_GA_SOURCE_SHA256', 'PP_PY_GA_ASSEMBLED_SHA256'})
MAX_BYTES = 32 * 1024 * 1024
PY_NAME = re.compile(r'[A-Za-z_][A-Za-z0-9_]*\.py\Z')


class InputContractError(Exception):
    pass


def read_owned(path, root=ROOT, maximum=MAX_BYTES):
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(root.resolve(strict=True)):
        raise InputContractError('outside_project')
    descriptor = os.open(resolved, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid not in (os.getuid(), 0):
            raise InputContractError('file_owner_or_kind')
        if info.st_size > maximum:
            raise InputContractError('file_too_large')
        data = handle.read(maximum + 1)
        if len(data) != info.st_size or len(data) > maximum:
            raise InputContractError('file_changed_or_too_large')
    return data


def select_code_fields(raw):
    if not isinstance(raw, dict) or any(not isinstance(key, str) or not isinstance(value, str)
                                        for key, value in raw.items()):
        raise InputContractError('config_not_flat_string_map')
    count_text = raw.get('PP_RUNTIME_SRC_COUNT', '')
    if not re.fullmatch(r'[0-9]{1,2}', count_text):
        raise InputContractError('source_count_invalid')
    count = int(count_text)
    if not 1 <= count <= 64:
        raise InputContractError('source_count_invalid')
    wanted = set(CODE_KEYS) | {'PP_RUNTIME_SRC_COUNT', 'PP_PY_GA_SOURCE_SHA256'}
    wanted.update('PP_RUNTIME_SRC_%02d' % index for index in range(1, count + 1))
    if raw.get('PP_PY_GA_ASSEMBLED_SHA256'):
        wanted.add('PP_PY_GA_ASSEMBLED_SHA256')
    selected = {}
    for name in sorted(wanted):
        value = raw.get(name, '')
        if not value or value.startswith('${{'):
            raise InputContractError('code_field_missing_or_unresolved')
        if name in HASH_KEYS and not re.fullmatch(r'[a-fA-F0-9]{64}', value):
            raise InputContractError('source_hash_invalid')
        if re.fullmatch(r'PP_RUNTIME_SRC_[0-9]{2}', name) and not re.fullmatch(r'[A-Za-z0-9+/=]+', value):
            raise InputContractError('source_chunk_invalid')
        selected[name] = value
    if len(json.dumps(selected).encode()) > MAX_BYTES:
        raise InputContractError('selected_inputs_too_large')
    return selected


def compiler_keys(source):
    tree = ast.parse(source)
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'DATA_KEYS'
                                               for target in node.targets):
            value = ast.literal_eval(node.value)
            if isinstance(value, list) and all(isinstance(item, str) for item in value):
                return set(value)
    raise InputContractError('compiler_keys_missing')


def load_owned_inputs(config=CONFIG, package=PACKAGE, root=ROOT):
    compiler = read_owned(package / 'compile_legacy_ga.py', root)
    if hashlib.sha256(compiler).hexdigest() != COMPILE_SHA or compiler_keys(compiler) != CODE_KEYS:
        raise InputContractError('compiler_contract_changed')
    selected = select_code_fields(json.loads(read_owned(config, root)))
    resolved_package = package.resolve(strict=True)
    if not resolved_package.is_relative_to(root.resolve(strict=True)):
        raise InputContractError('package_outside_project')
    names = sorted(path.name for path in resolved_package.iterdir() if PY_NAME.fullmatch(path.name))
    if not 5 <= len(names) <= 64:
        raise InputContractError('package_file_count')
    required = {'__init__.py', 'compile_legacy_ga.py', 'full_runtime_adapter.py', 'constraints.py', 'continuation.py',
                'batch_size_diagnostics.py'}
    if not required.issubset(names):
        raise InputContractError('package_required_module_missing')
    files = {}
    for name in names:
        path = resolved_package / name
        if path.is_symlink():
            raise InputContractError('package_symlink_refused')
        files['ga_workers/' + name] = read_owned(path, root, 4 * 1024 * 1024)
    if sum(map(len, files.values())) > MAX_BYTES:
        raise InputContractError('package_too_large')
    manifest = {'format': 'host-local-native-code-inputs-v1', 'compiler_sha256': COMPILE_SHA,
                'code_field_names': sorted(selected),
                'source_hashes': {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
    return selected, manifest, files
