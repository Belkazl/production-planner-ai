"""Use the recovered, account-owned Python GA *engine* without launching its
legacy HTTP listener or connecting to its shared PostgreSQL database.

This is an opt-in compatibility adapter, and never imports or executes code sent
by an API client. Source is provided by the service operator as Railway env
references to PP_RUNTIME_SRC_01..NN. It must be verified against a versioned
hash and regression-tested before being enabled in production.
"""
import ast
import base64
import hashlib
import json
import os
import re


class NativeGAError(RuntimeError):
    pass


def _engine_source():
    count = int(os.environ.get('PP_RUNTIME_SRC_COUNT') or 0)
    if count < 1 or count > 64:
        raise NativeGAError('ga_source_count_invalid')
    values = []
    for n in range(1, count + 1):
        value = os.environ.get(f'PP_RUNTIME_SRC_{n:02d}', '')
        if not value or not re.fullmatch(r'[A-Za-z0-9+/=]+', value):
            raise NativeGAError(f'ga_source_chunk_invalid_{n:02d}')
        values.append(value)
    try:
        data = base64.b64decode(''.join(values), validate=True)
        data.decode('utf-8')
    except (ValueError, UnicodeDecodeError) as ex:
        raise NativeGAError('ga_source_decode_failed') from ex
    if len(data) > 3_000_000:
        raise NativeGAError('ga_source_too_large')
    actual = hashlib.sha256(data).hexdigest()
    expected = os.environ.get('PP_PY_GA_SOURCE_SHA256', '').lower()
    if not re.fullmatch('[0-9a-f]{64}', expected) or expected != actual:
        raise NativeGAError('ga_source_hash_mismatch')
    return data.decode('utf-8')


def _engine_namespace():
    tree = ast.parse(_engine_source(), filename='<railway-recovered-ga>')
    # The inherited runtime starts a singleton database and a shared HTTP
    # listener. Neither is permitted inside an account-owned calculation.
    remove_calls = {'_db_init', '_db_selftest'}
    filtered = []
    dropped = set()
    for item in tree.body:
        if isinstance(item, ast.Expr) and isinstance(item.value, ast.Call):
            fn = item.value.func
            if isinstance(fn, ast.Name) and fn.id in remove_calls:
                dropped.add(fn.id)
                continue
        if isinstance(item, ast.If) and isinstance(item.test, ast.Compare):
            test = item.test
            if (isinstance(test.left, ast.Name) and test.left.id == '__name__'
                and any(isinstance(v, ast.Constant) and v.value == '__main__'
                        for v in test.comparators)):
                continue
        filtered.append(item)
    if dropped != remove_calls:
        raise NativeGAError('ga_source_db_boot_shape_changed')
    tree.body = filtered
    ast.fix_missing_locations(tree)
    ns = {'__name__': 'liftorbit_isolated_ga_engine'}
    exec(compile(tree, '<isolated-ga-engine>', 'exec'), ns)
    for required in ('canonicalize_model', 'validate_canonical_model',
                     'model_ready', 'install_model', 'optimize'):
        if not callable(ns.get(required)):
            raise NativeGAError('ga_engine_missing_' + required)
    return ns


def _check_orders(operations, model):
    orders = {str(o['id']) for o in model['orders']}
    if not operations or not isinstance(operations, list):
        raise NativeGAError('ga_plan_missing_operations')
    for op in operations:
        if not isinstance(op, dict):
            raise NativeGAError('ga_plan_invalid_operation')
        ref = op.get('order')
        if ref is not None and str(ref) not in orders:
            raise NativeGAError('ga_plan_contains_foreign_order')


def run(payload, progress):
    if not isinstance(payload, dict) or not isinstance(payload.get('model'), dict):
        raise NativeGAError('ga_account_model_required')
    model = payload['model']
    if not isinstance(model.get('orders'), list) or not model['orders']:
        raise NativeGAError('ga_orders_required')
    opts = payload.get('options') or {}
    if not isinstance(opts, dict):
        raise NativeGAError('ga_options_invalid')
    # These controls are present in some versions of the shared server but not
    # implemented by this extracted *base* source. Never silently ignore them.
    if opts.get('locked_operations') or model.get('locked_operations'):
        raise NativeGAError('manual_operation_locks_not_yet_supported')
    if model.get('materials'):
        raise NativeGAError('material_constraints_need_full_runtime_patch')
    engine = _engine_namespace()
    canonical = engine['canonicalize_model'](model)
    check = engine['validate_canonical_model'](canonical)
    if not check.get('ok') or not engine['model_ready'](canonical):
        raise NativeGAError('ga_account_model_invalid')
    engine['CURRENT_MODEL'] = canonical
    engine['install_model'](canonical)
    gens = max(1, min(int(opts.get('generations', 120)), 15000))
    population = max(2, min(int(opts.get('population', 80)), 1000))
    seed = opts.get('seed', 1729)
    if seed is not None and not isinstance(seed, (int, float)):
        raise NativeGAError('ga_seed_invalid')
    progress({'percent': 1, 'running': True, 'phase': 'initializing'})
    result = engine['optimize'](gens, population, seed, False)
    if not isinstance(result, dict) or not result.get('ok') or result.get('valid') is False:
        raise NativeGAError('ga_plan_invalid')
    ops = result.get('generic_operations') or result.get('operations')
    _check_orders(ops, model)
    progress({'percent': 100, 'running': False, 'phase': 'complete', 'best_preview': result})
    return result