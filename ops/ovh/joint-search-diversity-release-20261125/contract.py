"""Exact provenance and unchanged-source contracts for one native module."""
import hashlib
import json
from pathlib import Path
import re
import tarfile

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
OPS = REPO / 'ops/ovh'
TARGET = 'ga_workers/joint_minibatch.py'
SHA = re.compile(r'[0-9a-f]{64}\Z')
COMMIT = re.compile(r'[0-9a-f]{40}\Z')
PY_NAME = re.compile(r'ga_workers/[A-Za-z_][A-Za-z0-9_]*\.py\Z')
COMPILE_SHA = 'a4e03f395317c275b3acbb59acf054fde3730b02dbddfeee485de20d540494b7'
APP_FILES = (
    'python-ga-upstream.mjs', 'baselines/2026-10-10/aps-setup-bridge/index.ts',
    'restart-optimizer-ui.js', 'Dockerfile', 'build-bridge.ts', 'tenant-model-build.ts',
    'ga-worker-build.ts', 'python-ga-upstream-build.ts', 'tests/python-ga-upstream.test.mjs',
    'tests/python-ga-state.test.mjs', 'ga-python-state-store.mjs', 'feature-stop.ts', 'stop-ui.js',
)
PROTECTED_FILES = ('auth-runtime.js',)
WORKER_CHECKS = ('native_setups_in_fitness', 'candidate_resource_reservations',
                 'material_shift_case_valid', 'pinned_case_valid', 'zero_setup_case_valid',
                 'all_native_checks_passed')
DIVERSITY_CHECKS = ('exact_module_installed', 'native_valid', 'independent_valid',
    'quick_budget_unchanged', 'distinct_native_evaluations', 'partition_seed_diversity',
    'count_seed_diversity', 'seed_growth_bounded', 'baseline_retained', 'caller_inputs_unchanged',
    'all_diversity_checks_passed')
DIVERSITY_COUNTS = ('evaluated', 'decoder_evaluations', 'unique_evaluations', 'cache_reuses',
    'observed_decoder_calls', 'observed_distinct_genomes', 'observed_distinct_partitions', 'observed_distinct_counts')
DIVERSITY_FAILURE_PHASES = ('bootstrap', 'compile', 'actual_quick')
DIVERSITY_FAILURE_CODES = ('module_source', 'compiler_hash', 'compiler_keys', 'native_hooks',
    'synthetic_plan', 'diagnostic_counts', 'observer_contract', 'output_size', 'unexpected')
NATIVE_ELEVEN_CASES = ('plain', 'material_delivery', 'continue_fresh_namespace', 'cutlets_regression',
    'multi_order_stages', 'pinned_quantity_identity', 'pinned_continue', 'stop_continue',
    'selected_partition_hint', 'selected_nondefault_partition_hint', 'staff_shift_setup')
INTEGRATED_CASES = ('setup_sequence', 'delayed_material_shift', 'pinned_native', 'zero_setups')
PRESENTATION_CHECKS = ('resource_synthetic_passed', 'zoom_synthetic_passed', 'synthetic_runtime_passed',
    'exact_append_actual_source_passed', 'ui_syntax_passed', 'actual_build_tests_passed', 'all_presentation_checks_passed')
BUILD_CHAIN_CHECKS = ('all_checks_passed', 'original_inputs_unchanged', 'build_bridge_passed',
    'feature_stop_passed', 'bundle_passed', 'native_bypass_preserved', 'abort_signal_preserved', 'stop_guards_preserved')
FIELDS = ('app_hashes', 'protected_hashes', 'worker_before', 'worker_after',
          'code_inputs_sha256', 'runtime_image', 'public_sources')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path, maximum=131072):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= maximum:
        raise ValueError('json_bound')
    return json.loads(path.read_bytes())


def hashes(value, names=None, workers=False):
    if (not isinstance(value, dict) or not value
            or names is not None and set(value) != set(names)
            or any(not isinstance(item, str) or not SHA.fullmatch(item) for item in value.values())
            or workers and (not 5 <= len(value) <= 64 or any(not PY_NAME.fullmatch(name) for name in value))):
        raise ValueError('hash_manifest')
    return value


def validate_baseline(value):
    required = {'format', 'ready', 'presentation_candidate', 'presentation_verification_run_id',
                'presentation_deployed_commit', 'app_hashes', 'protected_hashes', 'worker_hashes', 'code_inputs_sha256'}
    if (not isinstance(value, dict) or value.get('ready') is not True or set(value) != required
            or value.get('format') != 'joint-search-diversity-baseline-v1'):
        raise ValueError('baseline_not_ready')
    for key in ('presentation_candidate', 'presentation_deployed_commit'):
        if not isinstance(value[key], str) or not COMMIT.fullmatch(value[key]):
            raise ValueError('baseline_provenance')
    if type(value['presentation_verification_run_id']) is not int or not 0 < value['presentation_verification_run_id'] < 10**16:
        raise ValueError('baseline_provenance')
    hashes(value['app_hashes'], APP_FILES); hashes(value['protected_hashes'], PROTECTED_FILES)
    hashes(value['worker_hashes'], workers=True)
    if (not {TARGET, 'ga_workers/full_runtime_adapter.py', 'ga_workers/joint_continuation.py'}.issubset(value['worker_hashes'])
            or value['worker_hashes'].get('ga_workers/compile_legacy_ga.py') != COMPILE_SHA
            or not isinstance(value['code_inputs_sha256'], str) or not SHA.fullmatch(value['code_inputs_sha256'])):
        raise ValueError('baseline_native_contract')
    return value


def baseline():
    return validate_baseline(read_json(HERE / 'baseline.json'))


def baseline_from_presentation(report, candidate, run_id, deployed):
    # This helper consumes a successful presentation receipt explicitly supplied
    # by the release owner; it never guesses the current production version.
    if (not isinstance(report, dict) or report.get('format') != 'presentation-acceptance-v1'
            or report.get('status') != 'presentation_pass' or report.get('release_gate_complete') is not True
            or report.get('production_writes') is not False):
        raise ValueError('presentation_acceptance_incomplete')
    for key, expected in (('presentation_checks', PRESENTATION_CHECKS), ('build_chain_checks', BUILD_CHAIN_CHECKS)):
        if (not isinstance(report.get(key), dict) or set(report[key]) != set(expected)
                or any(item is not True for item in report[key].values())):
            raise ValueError('presentation_acceptance_incomplete')
    return validate_baseline({'format': 'joint-search-diversity-baseline-v1', 'ready': True,
        'presentation_candidate': candidate, 'presentation_verification_run_id': run_id,
        'presentation_deployed_commit': deployed, 'app_hashes': report['app_after'],
        'protected_hashes': report['protected_hashes'], 'worker_hashes': report['worker_hashes'],
        'code_inputs_sha256': report['code_inputs_sha256']})


def public_hashes():
    paths = set()
    for directory in ('joint-search-diversity-release-20261125', 'joint-search-diversity-20261125'):
        for path in (OPS / directory).rglob('*'):
            if path.is_file() and path.name != 'release.json' and (path.suffix in {'.py', '.sh', '.json'} or path.name == 'Dockerfile.verify'):
                if path.is_symlink():
                    raise ValueError('public_source_path')
                paths.add(path.relative_to(REPO).as_posix())
    paths.update({
        '.github/workflows/liftorbit-joint-search-diversity-verify-20261125.yml',
        '.github/workflows/liftorbit-joint-search-diversity-release-20261125.yml',
        'ops/ovh/native-batching-verify-20261124/native_input_contract.py',
        'ops/ovh/native-batching-verify-20261124/verify_native.py',
        'ops/ovh/native-batching-verify-20261124/regression_cases.py',
        'ops/ovh/integrated-setup-verify-20261125/verify_worker.py',
        'ops/ovh/integrated-setup-verify-20261125/cases.py',
        'ops/ovh/joint-minibatch-search-20261124/joint_minibatch.py',
        'ops/ovh/joint-minibatch-search-20261124/test_joint.py',
    })
    return {name: digest((REPO / name).read_bytes()) for name in sorted(paths)}


def native_bundle(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= 72 * 1024 * 1024:
        raise ValueError('native_bundle_bound')
    files, total = {}, 0
    with tarfile.open(path, 'r:') as archive:
        for member in archive:
            limit = 32 * 1024 * 1024 if member.name == 'code-inputs.json' else 4 * 1024 * 1024
            if (not (member.name in {'manifest.json', 'code-inputs.json'} or PY_NAME.fullmatch(member.name))
                    or member.name in files or not member.isfile() or member.type != tarfile.REGTYPE
                    or member.linkname or member.pax_headers or not 0 < member.size <= limit):
                raise ValueError('native_bundle_member')
            reader = archive.extractfile(member)
            if reader is None:
                raise ValueError('native_bundle_member')
            with reader:
                data = reader.read(limit + 1)
            if len(data) != member.size:
                raise ValueError('native_bundle_member')
            files[member.name] = data; total += len(data)
            if len(files) > 66 or total > 72 * 1024 * 1024:
                raise ValueError('native_bundle_bound')
    if not {'manifest.json', 'code-inputs.json', TARGET, 'ga_workers/compile_legacy_ga.py',
            'ga_workers/full_runtime_adapter.py', 'ga_workers/joint_continuation.py'}.issubset(files):
        raise ValueError('native_bundle_files')
    manifest = json.loads(files['manifest.json'])
    workers = hashes({name: digest(data) for name, data in files.items() if name.startswith('ga_workers/')}, workers=True)
    code_hash = digest(files['code-inputs.json'])
    if (not isinstance(manifest, dict) or manifest.get('format') != 'ephemeral-native-code-inputs-v1'
            or manifest.get('source_hashes') != workers or manifest.get('code_inputs_sha256') != code_hash
            or manifest.get('compiler_sha256') != COMPILE_SHA or workers.get('ga_workers/compile_legacy_ga.py') != COMPILE_SHA):
        raise ValueError('native_bundle_manifest')
    return files, workers, code_hash


def validate_worker_change(before, after):
    hashes(before, workers=True); hashes(after, before)
    if {name for name in before if before[name] != after[name]} != {TARGET}:
        raise ValueError('single_native_module_contract')


def validate_container_report(value):
    if (not isinstance(value, dict) or value.get('format') != 'joint-search-diversity-container-v1'
            or value.get('all_checks_passed') is not True or value.get('native_eleven_verified') is not True
            or value.get('native_case_count') != 11 or type(value.get('native_case_count')) is not int
            or value.get('integrated_case_count') != 4 or type(value.get('integrated_case_count')) is not int
            or value.get('diversity_verified') is not True or value.get('unique_evaluations_complete') is not True):
        raise ValueError('container_acceptance_incomplete')
    for field, expected in (('worker_checks', WORKER_CHECKS), ('diversity_checks', DIVERSITY_CHECKS)):
        checks = value.get(field)
        if not isinstance(checks, dict) or set(checks) != set(expected) or any(item is not True for item in checks.values()):
            raise ValueError('container_acceptance_checks')
    counts = value.get('diversity_counts')
    if (not isinstance(counts, dict) or set(counts) != set(DIVERSITY_COUNTS)
            or any(type(item) is not int or not 0 <= item <= 1000 for item in counts.values())):
        raise ValueError('container_acceptance_counts')
    return value
