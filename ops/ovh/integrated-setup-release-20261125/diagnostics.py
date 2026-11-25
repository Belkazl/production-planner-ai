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
