"""Reconstruct bounded synthetic test evidence; never return arbitrary strings."""
import ast
import json
import math
from pathlib import Path
import re

NATIVE_ELEVEN_CASES = (
    'plain', 'material_delivery', 'continue_fresh_namespace', 'cutlets_regression',
    'multi_order_stages', 'pinned_quantity_identity', 'pinned_continue', 'stop_continue',
    'selected_partition_hint', 'selected_nondefault_partition_hint', 'staff_shift_setup',
)
CASES = frozenset((*NATIVE_ELEVEN_CASES, 'setup_sequence', 'delayed_material_shift', 'pinned_native', 'zero_setups'))
CLASSES = frozenset({'CheckError', 'FullGAError', 'JointContractError', 'InfeasibleCandidate',
    'PinConstraintError', 'ContinuationError', 'ValueError', 'TypeError', 'KeyError', 'RuntimeError',
    'AssertionError', 'OverflowError', 'JSONDecodeError', 'FileNotFoundError', 'ImportError',
    'AttributeError', 'VerificationError', 'GateError', 'Error', 'Exception'})
PHASES = frozenset({'native_case', 'native_pin_case', 'bootstrap_or_output', 'app_case', 'pipeline',
    'public_plan', 'aps_progress', 'aps_plan', 'stop', 'selected_ui', 'worker_result', 'preview', 'final',
    'running', 'completed_progress', 'synchronous_plan', 'scoped_stop', 'bootstrap'})
NUMBERS = frozenset({'production_count', 'setup_count', 'duration_minutes', 'setup_minutes', 'score_calls',
    'candidate_count', 'preview_count', 'published_count', 'changed_operation_count', 'decoder_calls'})
BOOLEANS = frozenset({'valid', 'independent_valid', 'reached_lower_bound', 'all_published_previews_feasible'})
ARRAY_NUMBERS = frozenset({'score_durations', 'score_setup_counts'})
ARRAY_CODES = frozenset({'score_failures', 'published_failures'})
BUILD_TEST_NAMES = (
    'disabled follows existing upstream including request options',
    'ten real upstream requests route account models to distinct jobs',
    'worker cannot replace schedule with foreign orders',
    'stop one job without stopping other sessions',
    'down worker fails closed without fallback to shared Python GA',
    'unrelated model route still uses the original authenticated API',
    'manual operation locks are passed through to original GA unchanged',
    'progress remains account-scoped while legacy GA is running',
    'state is written and a fresh Bun bridge restores the completed plan',
    'persistence failure fails closed and cancels the remote worker',
    'state store cannot point at a public database or accept weak internal secrets',
)
CANONICAL_ERRORS = frozenset({'interval', 'setup_kind', 'setup_interval', 'duration', 'conflicting_row', 'duplicate_row', 'unknown'})
ROUTE_ERRORS = frozenset({'unknown', 'native_schedule_contract_invalid', 'authentication_or_model_unavailable',
    'account_model_not_ready', 'ga_state_unavailable', 'invalid_ga_options', 'ga_options_too_large',
    'optimization_running_stop_first', 'ga_worker_unavailable', 'account_model_changed_during_run',
    'account_model_changed_since_run', 'account_plan_mismatch', 'optimization_stopped', 'ga_worker_timeout',
    'ga_worker_interrupted', 'job_mismatch', 'invalid_job_id', 'optimization_not_running', 'worker_cancel_failed',
    'continuation_seed_missing_or_invalid', 'ga_worker_failed', 'ga_worker_timed_out'})
PROBE_FAILURE_CODES = frozenset({'source_path', 'source_file', 'source_changed', 'canonical_source_mismatch',
    'canonical_instrumentation_contract', 'upstream_export_contract', 'temporary_copy', 'runner_unavailable',
    'runner_timeout', 'runner_output_limit', 'runner_failed', 'telemetry_contract', 'telemetry_size',
    'test_source_changed', 'unexpected'})
BUILD_CHAIN_CHECKS = (
    'all_checks_passed', 'original_inputs_unchanged', 'build_bridge_passed',
    'feature_stop_passed', 'bundle_passed', 'native_bypass_preserved',
    'abort_signal_preserved', 'stop_guards_preserved',
)
BUILD_CHAIN_PHASES = frozenset({'input', 'build_bridge', 'feature_stop', 'generated_contract', 'bundle', 'source_integrity'})
BUILD_CHAIN_FAILURES = frozenset({'source_path', 'source_file', 'source_changed', 'copy_integrity',
    'runner_unavailable', 'runner_timeout', 'runner_output_limit', 'build_bridge_failed',
    'feature_stop_failed', 'bundle_failed', 'generated_file', 'native_bypass_count',
    'abort_signal_missing', 'stop_guards_missing', 'unexpected'})


def bounded_int(value, minimum, maximum):
    return type(value) is int and minimum <= value <= maximum


def safe_build_chain(value):
    """Only fixed build-stage labels and booleans; never a generated source/log."""
    if (not isinstance(value, dict) or value.get('format') != 'integrated-setup-build-chain-v1'
            or any(type(value.get(key)) is not bool for key in BUILD_CHAIN_CHECKS)):
        return None
    phase, code = value.get('failure_phase'), value.get('failure_code')
    result = {'format': 'integrated-setup-build-chain-v1', **{key: value[key] for key in BUILD_CHAIN_CHECKS}}
    result['failure_phase'] = phase if isinstance(phase, str) and phase in BUILD_CHAIN_PHASES else None
    result['failure_code'] = code if isinstance(code, str) and code in BUILD_CHAIN_FAILURES else None
    return result


def safe_build_tests(value):
    if not isinstance(value, dict):
        return None
    names = value.get('failed_tests', [])
    pairs = value.get('http_assertions', [])
    if not isinstance(names, list) or len(names) > 32 or not isinstance(pairs, list) or len(pairs) > 16:
        return None
    return {'failed_tests': [name for name in BUILD_TEST_NAMES if name in names],
            'unknown_failed_test_count': value.get('unknown_failed_test_count') if bounded_int(value.get('unknown_failed_test_count'), 0, 1000) else 0,
            'http_assertions': [{'expected': row['expected'], 'actual': row['actual']} for row in pairs
                if isinstance(row, dict) and bounded_int(row.get('expected'), 100, 599) and bounded_int(row.get('actual'), 100, 599)]}


def build_test_metadata(text):
    """Whitelist public test names and explicitly labelled HTTP-status assertions."""
    text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text[:262144])
    failed, unknown = set(), 0
    for match in re.finditer(r'^\s*(?:\(fail\)|[✗✖×]|not ok [0-9]+\s*-?)\s+([^\r\n]{1,1000})$', text, re.MULTILINE):
        tail = match.group(1).strip()
        if tail == 'failing tests:':
            continue
        name = next((name for name in BUILD_TEST_NAMES if tail == name or re.fullmatch(re.escape(name) + r'\s+[\[(][0-9.]+\s*(?:ms|s)[\])]', tail)), None)
        if name is None:
            unknown += 1
        else:
            failed.add(name)
    pairs = []
    for match in re.finditer(r'\b(?:Expected|expected)\s*:\s*([1-5][0-9]{2})(?![0-9.])', text):
        block = text[max(0, match.start() - 768):min(len(text), match.end() + 768)]
        # Counts or arbitrary numeric assertions are not reported as statuses.
        if not re.search(r'\.status\b|\bstatus(?:_code|Code)?\b', block):
            continue
        actuals = list(re.finditer(r'\b(?:Received|Actual|actual)\s*:\s*([1-5][0-9]{2})(?![0-9.])', block))
        if actuals:
            relative = match.start() - max(0, match.start() - 768)
            actual = min(actuals, key=lambda row: abs(row.start() - relative))
            if abs(actual.start() - relative) > 256:
                continue
            pair = {'expected': int(match.group(1)), 'actual': int(actual.group(1))}
            if pair not in pairs:
                pairs.append(pair)
    return safe_build_tests({'failed_tests': list(failed), 'unknown_failed_test_count': min(1000, unknown), 'http_assertions': pairs[:16]})


def safe_build_probe(value):
    """No source, exception text, URLs, IDs, model fields or unknown labels."""
    if (not isinstance(value, dict) or value.get('format') != 'integrated-setup-build-diagnostic-v1'
            or type(value.get('diagnostic_completed')) is not bool or type(value.get('original_app_unchanged')) is not bool):
        return None
    result = {key: value[key] for key in ('format', 'diagnostic_completed', 'original_app_unchanged')}
    failure = value.get('failure_code')
    result['failure_code'] = failure if isinstance(failure, str) and failure in PROBE_FAILURE_CODES else None
    result['test_exit_code'] = value.get('test_exit_code') if bounded_int(value.get('test_exit_code'), 0, 255) else None
    result.update(safe_build_tests(value) or {'failed_tests': [], 'unknown_failed_test_count': 0, 'http_assertions': []})
    rejects = value.get('canonical_rejections', [])
    errors = value.get('canonical_errors', [])
    routes = value.get('route_summaries', [])
    result['canonical_rejections'] = [{'site': row['site'], 'count': row['count']} for row in rejects[:64]
        if isinstance(row, dict) and bounded_int(row.get('site'), 1, 20) and bounded_int(row.get('count'), 1, 1000000)] if isinstance(rejects, list) else []
    result['canonical_errors'] = [{'code': row['code'], 'count': row['count']} for row in errors[:16]
        if isinstance(row, dict) and isinstance(row.get('code'), str) and row['code'] in CANONICAL_ERRORS and bounded_int(row.get('count'), 1, 1000000)] if isinstance(errors, list) else []
    result['route_summaries'] = []
    for row in routes[:32] if isinstance(routes, list) else []:
        if (not isinstance(row, dict) or not {'kind','route','status','error','has_result','result_valid','result_operations','has_best','best_valid','best_operations','count'}.issubset(row)
                or not isinstance(row['kind'], str) or row['kind'] not in {'fetch', 'cancel'}
                or not isinstance(row['route'], str) or row['route'] not in {'plan', 'progress', 'model', 'other'}
                or (row.get('status') is not None and not bounded_int(row['status'], 100, 599))
                or (row.get('error') is not None and (not isinstance(row['error'], str) or row['error'] not in ROUTE_ERRORS))
                or any(type(row.get(key)) is not bool for key in ('has_result', 'result_valid', 'has_best', 'best_valid'))
                or any(not bounded_int(row.get(key), 0, 100000) for key in ('result_operations', 'best_operations'))
                or not bounded_int(row.get('count'), 1, 1000000)):
            continue
        result['route_summaries'].append({key: row[key] for key in ('kind', 'route', 'status', 'error', 'has_result', 'result_valid',
            'result_operations', 'has_best', 'best_valid', 'best_operations', 'count')})
    for key in ('log_truncated', 'events_truncated'):
        if type(value.get(key)) is bool:
            result[key] = value[key]
    return result


def public_source_labels(public_root):
    """Read only the explicit public literal registry; never execute its JS."""
    path = Path(public_root) / 'integrated-setup-result-20261125/patch.mjs'
    if not path.is_file() or path.is_symlink() or path.stat().st_size > 262144:
        return set()
    found = re.findall(r'export const INTEGRATED_SETUP_SOURCE_LABELS\s*=\s*Object\.freeze\(\s*(\[[^\[\]]{1,20000}\])\s*\)', path.read_text())
    if len(found) != 1:
        return set()
    try:
        labels = ast.literal_eval(found[0])
    except (SyntaxError, ValueError):
        return set()
    if (not isinstance(labels, list) or not 1 <= len(labels) <= 128
            or any(not isinstance(label, str) or not re.fullmatch(r'(?:upstream|aps|ui)_[a-z0-9_]{1,90}', label) for label in labels)
            or len(set(labels)) != len(labels)):
        return set()
    return set(labels)


def safe_anchor_counts(value, public_root):
    labels = public_source_labels(public_root)
    if not isinstance(value, list) or len(value) > 26:
        return []
    return [{key: item[key] for key in ('label', 'expected', 'count')} for item in value
            if isinstance(item, dict) and item.get('label') in labels
            and type(item.get('expected')) is int and 0 <= item['expected'] <= 100000
            and type(item.get('count')) is int and 0 <= item['count'] <= 100000]


def public_error_codes(public_root):
    literals = set()
    for directory, filename in (('integrated-setup-result-20261125', 'patch.mjs'),
                                ('integrated-setup-result-20261125', 'build-fixtures.mjs'),
                                ('integrated-setup-preview-20261125', 'patch.mjs')):
        path = Path(public_root) / directory / filename
        if path.is_file() and not path.is_symlink() and path.stat().st_size <= 262144:
            literals.update(re.findall(r'[\"\']([A-Za-z][A-Za-z0-9_]{0,99})[\"\']', path.read_text()))
    exact = {word for word in literals if word.startswith('INTEGRATED_')}
    derived = {prefix + label for prefix in exact if prefix.endswith('_') for label in literals
               if re.fullmatch('[a-z][a-z0-9_]{0,70}', label)}
    return exact | derived | {'INTEGRATED_SETUP_SOURCE_DRIFT_' + label for label in public_source_labels(public_root)}


def public_codes(public_root):
    """Only literals already present in the reviewed public assertion helpers."""
    codes = set()
    root = Path(public_root) / 'integrated-setup-verify-20261125'
    for name in ('cases.py', 'verify_worker.py', 'verify_app.mjs'):
        path = root / name
        if not path.is_file() or path.is_symlink() or path.stat().st_size > 512000:
            continue
        text = path.read_text()
        if name.endswith('.py'):
            for node in ast.walk(ast.parse(text)):
                if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                        and node.func.id in {'need', 'CheckError'}):
                    for value in node.args:
                        if isinstance(value, ast.Constant) and isinstance(value.value, str) and re.fullmatch('[a-z][a-z0-9_]{0,90}', value.value):
                            codes.add(value.value)
        else:
            codes.update(re.findall(r'[\"\']([a-z][a-z0-9_]{0,90})[\"\']', text))
    return codes


def finite(value):
    return type(value) in (int, float) and math.isfinite(value) and abs(value) <= 10**9


def summarize_value(value, codes):
    if not isinstance(value, dict):
        return {}
    result = {}
    for key in BOOLEANS:
        if type(value.get(key)) is bool:
            result[key] = value[key]
    for key in NUMBERS:
        if finite(value.get(key)):
            result[key] = value[key]
    if value.get('phase') in PHASES:
        result['phase'] = value['phase']
    if value.get('error_type') in CLASSES:
        result['error_type'] = value['error_type']
    if isinstance(value.get('error_code'), str) and value['error_code'] in codes:
        result['error_code'] = value['error_code']
    if isinstance(value.get('cause_types'), list):
        result['cause_types'] = [name for name in value['cause_types'][:4] if isinstance(name, str) and name in CLASSES]
    for key in ARRAY_NUMBERS:
        if isinstance(value.get(key), list):
            result[key] = [number for number in value[key][:16] if finite(number)]
    for key in ARRAY_CODES:
        if isinstance(value.get(key), list):
            result[key] = [code for code in value[key][:8] if isinstance(code, str) and (code in codes or code in CLASSES)]
    if isinstance(value.get('result'), dict):
        result['result'] = summarize_value({key: child for key, child in value['result'].items() if key != 'result'}, codes)
    return result


def summarize_report(path, public_root):
    try:
        path = Path(path)
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024:
            return None
        value = json.loads(path.read_bytes())
        if not isinstance(value, dict):
            return None
        codes = public_codes(public_root)
        result = {}
        if isinstance(value.get('cases'), dict):
            result['cases'] = {name: summarize_value(case, codes) for name, case in value['cases'].items() if name in CASES}
        if isinstance(value.get('failure'), dict):
            result['failure'] = summarize_value(value['failure'], codes)
        return result
    except (OSError, ValueError, TypeError, RecursionError):
        return None
