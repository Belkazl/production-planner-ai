"""Authorized ephemeral, network-isolated tests of the existing native optimizer."""
import argparse
import ast
import copy
import hashlib
import inspect
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import tarfile
import time
import uuid

# The child uses -I. Only this reviewed public helper directory is added here;
# the separately verified native package is added inside child_verification.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from native_input_contract import COMPILE_SHA, MAX_BYTES, PY_NAME, InputContractError, compiler_keys, CODE_KEYS, select_code_fields


EPS = 1e-5
IDENTIFIER = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,70}$')
STATE_NAME = re.compile(r'^_PP_.*(?:STATE|BATCH|JOINT|SPLIT|MINI|GENOME)', re.I)
STATE_FIELDS = frozenset({'best', 'best_order', 'best_duration', 'run', 'total_trials', 'best_genome', 'genome',
    'best_individual', 'individual', 'best_partition', 'best_partitions', 'partition', 'partitions', 'best_batches',
    'batch_sizes', 'batch_counts', 'batch_plan', 'best_batch_plan', 'best_split', 'best_splits', 'splits', 'split',
    'population', 'fitness', 'best_fitness', 'model_hash', 'model_key', 'objective', 'version', 'seed'})


class VerificationError(Exception):
    pass


def witness_model(material=False):
    model = {
        'scheduler_mode': 'resource', 'quantity_unit': 'шт.', 'start': '2026-11-24T08:00:00',
        'equipment': [{'id': 'BIG', 'name': 'Synthetic capacity ten', 'kind': 'test_work', 'capacity': 10,
                       'capacity_unit': 'шт.', 'timing_profile': {'timing_mode': 'fixed', 'duration_min': 10}},
                      {'id': 'SMALL', 'name': 'Synthetic capacity five', 'kind': 'test_work', 'capacity': 5,
                       'capacity_unit': 'шт.', 'timing_profile': {'timing_mode': 'fixed', 'duration_min': 10}}],
        'employees': [], 'materials': [], 'setup_rules': [], 'shifts': {}, 'constraints': [],
        'orders': [{'id': 'SYNTHETIC_ORDER', 'quantity': 30, 'unit': 'шт.', 'technical_process_id': 'SYNTHETIC_PROCESS'}],
        'technical_processes': [{'id': 'SYNTHETIC_PROCESS', 'name': 'Synthetic mixed minibatch witness',
            'operations': [{'id': 'WORK', 'name': 'Fixed ten minute operation', 'sequence': 1, 'duration_min': 10,
                'resource_requirements': [{'resource_type': 'equipment', 'match_mode': 'any',
                    'resource_ref': 'kind:test_work', 'resource_refs': ['kind:test_work'],
                    'quantity': 1, 'unit': 'шт.', 'consumption_rule': 'during_operation'}]}]}],
    }
    if material:
        model['materials'] = [{'id': 'SYNTHETIC_MATERIAL', 'name': 'Synthetic input', 'unit': 'шт.',
            'initial_stock': 15, 'deliveries': [{'at': '2026-11-24T08:15:00', 'quantity': 15}]}]
        model['technical_processes'][0]['operations'][0]['resource_requirements'].append({
            'resource_type': 'material', 'match_mode': 'specific', 'resource_ref': 'SYNTHETIC_MATERIAL',
            'resource_refs': ['SYNTHETIC_MATERIAL'], 'quantity': 1, 'unit': 'шт.', 'consumption_rule': 'per_unit'})
    return model


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise VerificationError('nonfinite_numeric_contract')
    return float(value)


def partition(plan):
    batches = plan.get('batches') if isinstance(plan, dict) else None
    if not isinstance(batches, list) or not 1 <= len(batches) <= 256:
        raise VerificationError('batch_array_contract')
    values = []
    for batch in batches:
        if not isinstance(batch, dict) or str(batch.get('order')) != 'SYNTHETIC_ORDER':
            raise VerificationError('batch_order_contract')
        values.append(number(batch.get('quantity', batch.get('area'))))
    return tuple(sorted(round(value, 8) for value in values))


def check_witness(plan, model, diagnostics):
    if not isinstance(plan, dict) or plan.get('valid') is not True or plan.get('partial') is True:
        raise VerificationError('native_plan_not_valid')
    sizes = partition(plan)
    if abs(sum(sizes) - 30) > EPS or any(value <= 0 or value > 10 + EPS for value in sizes):
        raise VerificationError('batch_quantity_or_capacity')
    rows = plan.get('generic_operations') or plan.get('operations')
    if not isinstance(rows, list):
        raise VerificationError('operation_array_contract')
    production = [row for row in rows if not row.get('is_setup') and str(row.get('phase', '')).lower() != 'setup']
    if len(production) != len(sizes):
        raise VerificationError('operation_coverage')
    capacities = {'BIG': 10, 'SMALL': 5}
    intervals = {key: [] for key in capacities}
    quantities = []
    for row in production:
        if str(row.get('order')) != 'SYNTHETIC_ORDER' or row.get('operation_id') != 'WORK':
            raise VerificationError('foreign_operation')
        equipment = row.get('equipment_ids')
        if not isinstance(equipment, list) or len(equipment) != 1 or equipment[0] not in capacities:
            raise VerificationError('equipment_contract')
        quantity = number(row.get('batch_quantity'))
        start, end = number(row.get('start_min')), number(row.get('end_min'))
        if start < -EPS or abs(end - start - 10) > EPS or quantity <= 0 or quantity > capacities[equipment[0]] + EPS:
            raise VerificationError('native_duration_or_capacity')
        quantities.append(round(quantity, 8))
        intervals[equipment[0]].append((start, end))
        uses = row.get('materials') or []
        if model['materials']:
            material_uses = [use for use in uses if use.get('id') == 'SYNTHETIC_MATERIAL']
            if len(material_uses) != 1 or abs(number(material_uses[0].get('quantity')) - quantity) > EPS:
                raise VerificationError('material_consumption_amount')
        elif uses:
            raise VerificationError('unexpected_material_consumption')
    if tuple(sorted(quantities)) != sizes:
        raise VerificationError('batch_operation_quantities_disagree')
    for events in intervals.values():
        events.sort()
        if any(next_start < end - EPS for (_, end), (next_start, _) in zip(events, events[1:])):
            raise VerificationError('equipment_overlap')
    makespan = max(end for events in intervals.values() for _, end in events)
    if abs(number(plan.get('duration_minutes')) - makespan) > EPS:
        raise VerificationError('makespan_disagrees')
    ledger = diagnostics.material_prefix_summary(model, plan)
    if ledger.get('status') != 'valid':
        raise VerificationError('material_stock_prefix')
    expected = 25 if model['materials'] else 20
    return {'native_valid': True, 'independent_valid': True, 'duration_minutes': makespan,
            'optimal_lower_bound_minutes': expected, 'reached_lower_bound': abs(makespan - expected) <= EPS,
            'batch_count': len(sizes), 'batch_sizes': list(sizes), 'mixed_sizes': len(set(sizes)) > 1,
            'material_prefix': ledger}


def state_metadata(namespace):
    result = []
    for name in sorted(namespace):
        if not IDENTIFIER.fullmatch(name) or not STATE_NAME.search(name):
            continue
        value = namespace[name]
        if callable(value):
            continue
        kind = 'object' if isinstance(value, dict) else 'array' if isinstance(value, (list, tuple)) else 'scalar'
        row = {'binding': name, 'kind': kind}
        if isinstance(value, dict):
            row['known_fields'] = sorted(key for key in value if isinstance(key, str) and key in STATE_FIELDS)
            row['other_field_count'] = len(value) - len(row['known_fields'])
        result.append(row)
        if len(result) >= 40:
            break
    return result


def failure_metadata(error):
    result = {'error_type': type(error).__name__}
    if isinstance(error, VerificationError):
        result['error_code'] = str(error)
    return result


def contract_shape(value, depth=0):
    kind = ('object' if isinstance(value, dict) else 'tuple' if isinstance(value, tuple)
            else 'array' if isinstance(value, list) else 'boolean' if isinstance(value, bool)
            else 'number' if isinstance(value, (int, float)) else 'string' if isinstance(value, str)
            else 'null' if value is None else 'other')
    result = {'kind': kind}
    if isinstance(value, dict):
        keys = sorted(key for key in value if isinstance(key, str) and IDENTIFIER.fullmatch(key))
        result.update(keys=keys[:40], keys_truncated=len(keys) > 40, entry_count=len(value))
    elif isinstance(value, (list, tuple)):
        result['length'] = len(value)
        if depth < 2:
            result['items'] = [contract_shape(item, depth + 1) for item in value[:8]]
            result['items_truncated'] = len(value) > 8
    return result


def synthetic_numeric_fields(value):
    fields = ('area', 'quantity', 'batch_quantity', 'batch_capacity', 'capacity', 'capacity_m2',
              'batch', 'batch_id', 'start_min', 'end_min', 'duration_min', 'duration_minutes')
    return {key: value[key] for key in fields if key in value and not isinstance(value[key], bool)
            and isinstance(value[key], (int, float)) and math.isfinite(value[key]) and abs(value[key]) <= 1e9}


def synthetic_model_summary(model, allow_expanded=False):
    result = {'contract': contract_shape(model), 'equipment': [], 'orders': [], 'other_orders': 0}
    if not isinstance(model, dict):
        return result
    for equipment in (model.get('equipment') or [])[:16]:
        if not isinstance(equipment, dict) or equipment.get('id') not in ('BIG', 'SMALL'):
            continue
        row = {'id': equipment['id'], **synthetic_numeric_fields(equipment), 'contract': contract_shape(equipment)}
        for key in ('unit', 'capacity_unit'):
            if equipment.get(key) in ('шт.', 'шт', 'pcs', 'items', 'item', 'm2', 'м²'):
                row[key] = equipment[key]
        timing = equipment.get('timing_profile')
        if isinstance(timing, dict):
            row['timing_profile'] = synthetic_numeric_fields(timing)
            if timing.get('timing_mode') in ('fixed', 'throughput'):
                row['timing_profile']['timing_mode'] = timing['timing_mode']
        result['equipment'].append(row)
    for index, order in enumerate((model.get('orders') or [])[:32]):
        oid = order.get('id') if isinstance(order, dict) else None
        owned = oid == 'SYNTHETIC_ORDER' or (allow_expanded and isinstance(oid, str)
            and re.fullmatch(r'SYNTHETIC_ORDER[A-Za-z0-9_:#.\-~]{0,80}', oid))
        if not owned:
            result['other_orders'] += 1
            continue
        row = {'alias': 'original' if oid == 'SYNTHETIC_ORDER' else 'expanded_' + str(index + 1),
               **synthetic_numeric_fields(order), 'contract': contract_shape(order)}
        for key in ('unit', 'quantity_unit', 'batch_unit'):
            if order.get(key) in ('шт.', 'шт', 'pcs', 'items', 'item', 'm2', 'м²'):
                row[key] = order[key]
        result['orders'].append(row)
    return result


def synthetic_schedule_summary(plan):
    result = {'contract': contract_shape(plan), 'operations': [], 'batches': [], 'omitted_rows': 0}
    if not isinstance(plan, dict):
        return result
    result.update(synthetic_numeric_fields(plan))
    result['native_valid'] = plan.get('valid') is True
    for row in (plan.get('generic_operations') or plan.get('operations') or [])[:64]:
        if not isinstance(row, dict) or row.get('order') != 'SYNTHETIC_ORDER' or row.get('operation_id') != 'WORK':
            result['omitted_rows'] += 1
            continue
        record = {**synthetic_numeric_fields(row), 'contract': contract_shape(row)}
        ids = row.get('equipment_ids') or []
        record['equipment_ids'] = [rid for rid in ids if rid in ('BIG', 'SMALL')]
        record['other_equipment_count'] = len(ids) - len(record['equipment_ids'])
        result['operations'].append(record)
    for row in (plan.get('batches') or [])[:64]:
        if isinstance(row, dict) and row.get('order') == 'SYNTHETIC_ORDER':
            result['batches'].append(synthetic_numeric_fields(row))
    return result


def synthetic_native_contract(ga, diagnostics, model):
    result = {'functions': []}
    names = ('_pp_batch_equipment_fits', '_pp_order_batch_capacity', '_pp_expand_capacity_batches',
             '_pp_eligible_equipment', '_pp_schedule_operation', '_pp_schedule_sequence',
             '_pp_schedule_sequence_unbatched', '_pp_ctx', '_pp_obj_key', '_pp_progress_preview', '_pp_setup_generic_apply')
    for name in names:
        if callable(ga.get(name)):
            result['functions'].append(diagnostics._function_metadata(name, ga[name], ga))
    normalized = ga['canonicalize_model'](copy.deepcopy(model))
    result['normalized_model'] = synthetic_model_summary(normalized)
    result['native_ready'] = bool(ga['model_ready'](normalized))
    order = next((row for row in normalized.get('orders', []) if row.get('id') == 'SYNTHETIC_ORDER'), None)
    if order is None:
        return result
    capacity = ga.get('_pp_order_batch_capacity')
    if callable(capacity):
        try:
            value = capacity(copy.deepcopy(normalized), copy.deepcopy(order))
            result['order_capacity'] = number(value)
        except Exception as error:
            result['order_capacity_error'] = failure_metadata(error)
    fits = ga.get('_pp_batch_equipment_fits')
    result['equipment_fit_probes'] = []
    if callable(fits):
        for quantity in (5, 10):
            candidate = copy.deepcopy(order)
            candidate['quantity'] = quantity
            candidate['area'] = quantity
            for equipment in normalized.get('equipment', []):
                if equipment.get('id') not in ('BIG', 'SMALL'):
                    continue
                row = {'quantity': quantity, 'area': quantity, 'equipment': equipment['id']}
                try:
                    fit = fits(copy.deepcopy(candidate), copy.deepcopy(equipment))
                    row['result'] = fit if isinstance(fit, bool) else contract_shape(fit)
                except Exception as error:
                    row['error'] = failure_metadata(error)
                result['equipment_fit_probes'].append(row)
    expand = ga.get('_pp_expand_capacity_batches')
    if callable(expand):
        try:
            expanded = expand(copy.deepcopy(normalized), ['SYNTHETIC_ORDER'], [])
            result['expansion'] = {'contract': contract_shape(expanded), 'model_items': []}
            parts = list(expanded) if isinstance(expanded, (list, tuple)) else [expanded]
            aliases = {'SYNTHETIC_ORDER': 'original'}
            for item in parts[:8]:
                if isinstance(item, dict) and isinstance(item.get('orders'), list):
                    result['expansion']['model_items'].append(synthetic_model_summary(item, True))
                    for index, expanded_order in enumerate(item['orders'][:32]):
                        oid = expanded_order.get('id') if isinstance(expanded_order, dict) else None
                        if isinstance(oid, str) and re.fullmatch(r'SYNTHETIC_ORDER[A-Za-z0-9_:#.\-~]{0,80}', oid):
                            aliases[oid] = 'original' if oid == 'SYNTHETIC_ORDER' else 'expanded_' + str(index + 1)
            relations = []
            for index, item in enumerate(parts[:8]):
                if isinstance(item, list) and all(isinstance(value, str) for value in item):
                    relations.append({'item_index': index, 'sequence': [aliases.get(value, 'other') for value in item[:32]]})
                elif isinstance(item, dict) and item and all(key in aliases for key in item):
                    rows = []
                    for key, value in list(item.items())[:32]:
                        row = {'key_alias': aliases[key], 'value_contract': contract_shape(value)}
                        if isinstance(value, str):
                            row['value_alias'] = aliases.get(value, 'other')
                        elif isinstance(value, dict):
                            row['numbers'] = synthetic_numeric_fields(value)
                            row['identity_fields'] = {name: aliases[val] for name, val in value.items()
                                if isinstance(name, str) and IDENTIFIER.fullmatch(name) and isinstance(val, str) and val in aliases}
                        rows.append(row)
                    relations.append({'item_index': index, 'mapping': rows})
            result['expansion']['relations'] = relations
        except Exception as error:
            result['expansion_error'] = failure_metadata(error)
    return result


def adapter_continuation_metadata(source):
    tree = ast.parse(source)
    calls = []
    for function in tree.body:
        if not isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for node in ast.walk(function):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ('load_resume_state', 'export_resume_state'):
                calls.append({'function': function.name, 'callee': node.func.id,
                    'arguments': [value.id if isinstance(value, ast.Name) else type(value).__name__.lower() for value in node.args],
                    'keywords': [item.arg for item in node.keywords if item.arg]})
    compact = ''.join(source.split())
    return {'calls': calls[:16], 'calls_truncated': len(calls) > 16,
        'has_native_state_opts_anchor': "native_state=opts.get('resume_state')" in compact or 'native_state=opts.get("resume_state")' in compact,
        'has_version_one_guard': any(isinstance(node, ast.Compare) and any(isinstance(op, ast.NotEq) for op in node.ops)
            and any(isinstance(value, ast.Constant) and value.value == 1 for value in node.comparators)
            and isinstance(node.left, ast.Call) and isinstance(node.left.func, ast.Attribute) and node.left.func.attr == 'get'
            and node.left.args and isinstance(node.left.args[0], ast.Constant) and node.left.args[0].value == 'version'
            for node in ast.walk(tree))}


def expansion_ast_metadata(source):
    result = []
    for function in ast.walk(ast.parse(source)):
        if not isinstance(function, ast.FunctionDef) or function.name != '_pp_expand_capacity_batches':
            continue
        row = {'function': function.name, 'enumerate_arguments': [], 'capacity_arguments': [], 'return_shapes': []}
        for node in ast.walk(function):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                if node.func.id in ('enumerate', '_pp_order_batch_capacity'):
                    values = [arg.id if isinstance(arg, ast.Name) and IDENTIFIER.fullmatch(arg.id)
                              else type(arg).__name__.lower() for arg in node.args]
                    row['enumerate_arguments' if node.func.id == 'enumerate' else 'capacity_arguments'].append(values)
            elif isinstance(node, ast.Return):
                row['return_shapes'].append({'kind': type(node.value).__name__.lower(),
                    'arity': len(node.value.elts) if isinstance(node.value, (ast.Tuple, ast.List)) else None})
        result.append({key: value[:16] if isinstance(value, list) else value for key, value in row.items()})
    return result[:8]


def synthetic_call_value(value, depth=0):
    result = {'contract': contract_shape(value)}
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and abs(value) <= 1e9:
        result['number'] = value
    elif isinstance(value, bool):
        result['boolean'] = value
    elif isinstance(value, dict):
        oid = value.get('id', value.get('order'))
        if oid in ('BIG', 'SMALL'):
            result.update(id=oid, numbers=synthetic_numeric_fields(value))
        elif isinstance(oid, str) and re.fullmatch(r'SYNTHETIC_ORDER[A-Za-z0-9_:#.\-~]{0,80}', oid):
            result.update(order_alias='original' if oid == 'SYNTHETIC_ORDER' else 'expanded',
                          numbers=synthetic_numeric_fields(value))
            if value.get('equipment_ids') is not None:
                result['equipment_ids'] = [key for key in value['equipment_ids'] if key in ('BIG', 'SMALL')]
    elif isinstance(value, (list, tuple)) and depth < 2:
        result['items'] = [synthetic_call_value(item, depth + 1) for item in value[:8]]
    return result


def observed_run(adapter, diagnostics, model, options):
    factory = adapter._namespace
    state = {'decoder_calls': 0, 'partition_observation_errors': 0, 'distinct_partition_vectors': set(),
             'partition_vectors_truncated': False, 'batch_counts': set(), 'partitions': [],
             'native_raw_valid': 0, 'native_raw_invalid': 0, 'native_raw_validator_errors': 0,
             'first_raw_material_prefix': None, 'first_raw_schedule': None, 'before_optimize_state': None,
             'sampled_hook_calls': {}, 'generic_optimizer_return': None}
    holder = {}

    def make_namespace():
        ga = factory()
        holder['namespace'] = ga
        holder['functions'] = diagnostics._native_functions(ga)
        original = ga.get('_pp_schedule_sequence')
        validate = ga.get('_pp_validate_generic')
        native_optimize = ga.get('optimize')
        if not callable(original) or not callable(native_optimize):
            raise VerificationError('native_hooks_missing')

        def observe_hook(name, function):
            samples = state['sampled_hook_calls'].setdefault(name, [])
            def observed_hook(*args, **kwargs):
                returned = function(*args, **kwargs)
                if len(samples) < 8:
                    try:
                        bound = inspect.signature(function).bind_partial(*args, **kwargs)
                        samples.append({'arguments': {key: synthetic_call_value(value) for key, value in bound.arguments.items()
                            if IDENTIFIER.fullmatch(key)}, 'returned': synthetic_call_value(returned)})
                    except Exception as error:
                        samples.append({'observation_error': failure_metadata(error)})
                if name == '_pp_optimize_generic' and state['generic_optimizer_return'] is None:
                    try:
                        state['generic_optimizer_return'] = synthetic_schedule_summary(returned)
                    except Exception as error:
                        state['generic_optimizer_return'] = {'observation_error': failure_metadata(error)}
                return returned
            return observed_hook

        for hook in ('_pp_eligible_equipment', '_pp_schedule_operation', '_pp_obj_key', '_pp_progress_preview', '_pp_optimize_generic'):
            if callable(ga.get(hook)):
                ga[hook] = observe_hook(hook, ga[hook])

        def observed(*args, **kwargs):
            result = original(*args, **kwargs)
            state['decoder_calls'] += 1
            # Observe the entire small native run; retain at most 64 vectors.
            try:
                if state['first_raw_schedule'] is None:
                    state['first_raw_schedule'] = synthetic_schedule_summary(result)
                values = partition(result)
                digest = hashlib.sha256(json.dumps(values).encode()).hexdigest()
                state['batch_counts'].add(len(values))
                if digest not in state['distinct_partition_vectors']:
                    if len(state['distinct_partition_vectors']) < 64:
                        state['distinct_partition_vectors'].add(digest)
                        state['partitions'].append(list(values))
                    else:
                        state['partition_vectors_truncated'] = True
                candidate_model = args[0] if args else kwargs.get('candidate_model', kwargs.get('model'))
                if state['first_raw_material_prefix'] is None:
                    state['first_raw_material_prefix'] = diagnostics.material_prefix_summary(candidate_model, result)
                if callable(validate):
                    try:
                        errors = validate(candidate_model, copy.deepcopy(result))
                        state['native_raw_invalid' if errors else 'native_raw_valid'] += 1
                    except Exception:
                        state['native_raw_validator_errors'] += 1
            except Exception:
                state['partition_observation_errors'] += 1
            return result

        def optimize(*args, **kwargs):
            state['before_optimize_state'] = state_metadata(ga)
            return native_optimize(*args, **kwargs)

        ga['_pp_schedule_sequence'] = observed
        ga['optimize'] = optimize
        return ga

    adapter._namespace = make_namespace
    model_before = copy.deepcopy(model)
    result = None
    native_error = None
    try:
        result = adapter.run({'model': model, 'options': options}, lambda _progress: None)
    except Exception as error:
        native_error = failure_metadata(error)
    finally:
        adapter._namespace = factory
    if model != model_before:
        native_error = failure_metadata(VerificationError('caller_model_mutated'))
    report = {key: value for key, value in state.items() if key not in ('distinct_partition_vectors', 'batch_counts')}
    report['distinct_partition_vectors'] = len(state['distinct_partition_vectors'])
    report['observed_batch_counts'] = sorted(state['batch_counts'])
    report['after_optimize_state'] = state_metadata(holder.get('namespace', {}))
    report['functions'] = holder.get('functions', {})
    report['functions_after_run'] = diagnostics._native_functions(holder.get('namespace', {}))
    report['final_schedule'] = synthetic_schedule_summary(result)
    if native_error is not None:
        report['result'] = {'independent_valid': False, 'reached_lower_bound': False, 'native_error': native_error}
    else:
        try:
            report['result'] = check_witness(result, model, diagnostics)
        except Exception as error:
            report['result'] = {'independent_valid': False, 'reached_lower_bound': False, **failure_metadata(error)}
    resume = result.get('resume_state') if isinstance(result, dict) else None
    report['resume_field_names'] = sorted(key for key in (resume or {})
                                         if isinstance(key, str) and IDENTIFIER.fullmatch(key))[:64]
    return result, report


def native_baseline(adapter, diagnostics, model, namespace=None):
    ga = namespace if namespace is not None else adapter._namespace()
    normalized = ga['canonicalize_model'](copy.deepcopy(model))
    if not ga['model_ready'](normalized):
        raise VerificationError('synthetic_model_not_native_ready')
    ga['CURRENT_MODEL'] = normalized
    ga['install_model'](normalized)
    sim = ga['_pp_schedule_sequence'](normalized, [order['id'] for order in normalized['orders']])
    errors = ga['_pp_validate_generic'](normalized, copy.deepcopy(sim))
    sizes = partition(sim)
    return {'kind': 'original_native_default_decoder', 'duration_minutes': number(sim['duration_minutes']),
            'batch_count': len(sizes), 'batch_sizes': list(sizes), 'native_validation_passed': not bool(errors),
            'raw_schedule': synthetic_schedule_summary(sim),
            'material_prefix': diagnostics.material_prefix_summary(normalized, sim),
            'capacity_max_reference_minutes': 30, 'mixed_optimal_lower_bound_minutes': 20}


def run_witness_cases(adapter, diagnostics, report, native_namespace):
    options = {'generations': 24, 'population': 24, 'seed': 1729, 'objective': 'duration'}
    plain_model = witness_model()
    try:
        report['synthetic_contract'] = synthetic_native_contract(native_namespace, diagnostics, plain_model)
    except Exception as error:
        report['synthetic_contract'] = failure_metadata(error)
    report['phase'] = 'native_plain_witness'
    try:
        report['baseline'] = native_baseline(adapter, diagnostics, plain_model, native_namespace)
    except Exception as error:
        report['baseline'] = failure_metadata(error)
    first, plain = observed_run(adapter, diagnostics, plain_model, options)
    report['cases']['plain'] = plain
    report['phase'] = 'native_material_witness'
    _, material = observed_run(adapter, diagnostics, witness_model(True), options)
    report['cases']['material_delivery'] = material
    report['phase'] = 'native_fresh_namespace_continuation'
    resume = first.get('resume_state') if isinstance(first, dict) else None
    if isinstance(resume, dict):
        continued, continuation = observed_run(adapter, diagnostics, plain_model,
            {'generations': 3, 'population': 6, 'seed': 1730, 'objective': 'duration', 'continue': True,
             'resume_state': copy.deepcopy(resume)})
        try:
            continuation['result']['not_worse_than_first'] = number(continued['duration_minutes']) <= number(first['duration_minutes']) + EPS
            continuation['prior_partition_observed'] = list(partition(first)) in continuation['partitions']
        except Exception as error:
            continuation['comparison_error'] = failure_metadata(error)
            continuation['result']['not_worse_than_first'] = False
    else:
        continuation = {'result': {'independent_valid': False, 'reached_lower_bound': False,
            'not_worse_than_first': False, 'error_code': 'native_resume_state_missing'}}
    report['cases']['continue_fresh_namespace'] = continuation
    # Lower-bound rediscovery is not proof of native-genome persistence. The
    # bridge and first-loaded-candidate contract are separate acceptance gates.
    report['phase'] = 'complete'
    passed = all(case['result'].get('independent_valid') is True and case['result'].get('reached_lower_bound') is True
                 for case in report['cases'].values())
    passed = passed and continuation['result']['not_worse_than_first']
    report['status'] = 'native_witness_pass' if passed else 'native_minibatch_regression'
    return report


def compiled_function_metadata(source):
    tree = ast.parse(source, filename='<owned-native-compiled-metadata>')
    names = re.compile(r'batch|joint|ppjb|split|mini', re.I)
    found = []
    count = 0
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) or not IDENTIFIER.fullmatch(node.name) or not names.search(node.name):
            continue
        count += 1
        if len(found) >= 80:
            continue
        arguments = list(node.args.posonlyargs) + list(node.args.args) + list(node.args.kwonlyargs)
        if node.args.vararg is not None:
            arguments.append(node.args.vararg)
        if node.args.kwarg is not None:
            arguments.append(node.args.kwarg)
        parameters = [argument.arg for argument in arguments if IDENTIFIER.fullmatch(argument.arg)]
        found.append({'name': node.name, 'parameters': parameters[:24], 'first_line': node.lineno,
                      'parameters_truncated': len(parameters) > 24})
    return {'functions': found, 'matching_function_count': count, 'functions_truncated': count > len(found)}


def child_verification(root, report_path, input_path=Path('/input/code-inputs.json')):
    report = {'format': 'native-minibatch-verification-v1', 'status': 'started', 'phase': 'imports', 'cases': {}}
    try:
        selected = select_code_fields(json.loads(input_path.read_text()))
        os.environ.update(selected)
        import resource
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_FSIZE, (16 * 1024 * 1024, 16 * 1024 * 1024))
        sys.path.insert(0, str(root))
        from ga_workers import compile_legacy_ga as compiler
        from ga_workers import full_runtime_adapter as adapter
        from ga_workers import batch_size_diagnostics as diagnostics
        report['adapter_continuation_contract'] = adapter_continuation_metadata((root / 'ga_workers/full_runtime_adapter.py').read_text())
        report['phase'] = 'native_build'
        compiler.build()
        compiled = Path('/tmp/production_planner.py').read_bytes()
        report['compiled_sha256'] = hashlib.sha256(compiled).hexdigest()
        report['phase'] = 'compiled_binding_metadata'
        report['compiled_functions'] = compiled_function_metadata(compiled)
        report['capacity_expansion_ast_contract'] = expansion_ast_metadata(compiled)
        native_namespace = adapter._namespace()
        report['namespace_functions_before_baseline'] = diagnostics._native_functions(native_namespace)
        report['namespace_state_before_baseline'] = state_metadata(native_namespace)
        run_witness_cases(adapter, diagnostics, report, native_namespace)
    except BaseException as error:
        # No traceback, native exception text, source line, or private value is exported.
        report['status'] = 'failed'
        report['error_type'] = type(error).__name__
        if isinstance(error, VerificationError):
            report['error_code'] = str(error)
    report_path.write_text(json.dumps(report, ensure_ascii=False, separators=(',', ':')))
    os.chmod(report_path, 0o600)
    return 0 if report['status'] == 'native_witness_pass' else 1


def unpack_private_bundle(bundle_path, root):
    """Validate a bounded regular-file-only bundle before writing private files."""
    info = bundle_path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
            or info.st_mode & 0o077 or info.st_size > 72 * 1024 * 1024):
        raise VerificationError('private_bundle_file_contract')
    members = {}
    total = 0
    with tarfile.open(bundle_path, mode='r:') as archive:
        for member in archive:
            name = member.name
            package_name = name.split('/', 1)[1] if name.startswith('ga_workers/') else ''
            if (name not in ('code-inputs.json', 'manifest.json')
                    and not (name == 'ga_workers/' + package_name and PY_NAME.fullmatch(package_name))):
                raise VerificationError('bundle_member_path_refused')
            if not member.isfile() or member.issym() or member.islnk() or name in members:
                raise VerificationError('bundle_member_kind_or_duplicate')
            limit = MAX_BYTES if name == 'code-inputs.json' else 65536 if name == 'manifest.json' else 4 * 1024 * 1024
            if not 0 <= member.size <= limit or len(members) >= 66:
                raise VerificationError('bundle_member_size_or_count')
            total += member.size
            if total > MAX_BYTES * 2 + 65536:
                raise VerificationError('bundle_total_too_large')
            handle = archive.extractfile(member)
            if handle is None:
                raise VerificationError('bundle_member_unreadable')
            data = handle.read(member.size + 1)
            if len(data) != member.size:
                raise VerificationError('bundle_member_size_mismatch')
            members[name] = data
    if not {'manifest.json', 'code-inputs.json', 'ga_workers/compile_legacy_ga.py',
            'ga_workers/full_runtime_adapter.py', 'ga_workers/constraints.py',
            'ga_workers/continuation.py', 'ga_workers/batch_size_diagnostics.py',
            'ga_workers/__init__.py'}.issubset(members):
        raise VerificationError('bundle_required_file_missing')
    manifest = json.loads(members['manifest.json'])
    raw_fields = json.loads(members['code-inputs.json'])
    fields = select_code_fields(raw_fields)
    if raw_fields != fields:
        raise VerificationError('bundle_extra_input_field')
    expected_manifest_keys = {'format', 'compiler_sha256', 'code_field_names', 'source_hashes', 'code_inputs_sha256'}
    if (not isinstance(manifest, dict) or set(manifest) != expected_manifest_keys
            or manifest['format'] != 'ephemeral-native-code-inputs-v1'
            or manifest['compiler_sha256'] != COMPILE_SHA
            or manifest['code_field_names'] != sorted(fields)
            or manifest['code_inputs_sha256'] != hashlib.sha256(members['code-inputs.json']).hexdigest()):
        raise VerificationError('bundle_manifest_contract')
    package_names = {name for name in members if name.startswith('ga_workers/')}
    hashes = manifest['source_hashes']
    if not isinstance(hashes, dict) or set(hashes) != package_names:
        raise VerificationError('bundle_source_manifest_contract')
    if any(hashes[name] != hashlib.sha256(members[name]).hexdigest() for name in package_names):
        raise VerificationError('bundle_source_hash_mismatch')
    compiler = members['ga_workers/compile_legacy_ga.py']
    if hashlib.sha256(compiler).hexdigest() != COMPILE_SHA or compiler_keys(compiler) != CODE_KEYS:
        raise VerificationError('bundle_compiler_contract_changed')
    (root / 'ga_workers').mkdir(mode=0o700)
    for name, data in members.items():
        with open(root / name, 'xb') as handle:
            os.chmod(root / name, 0o600)
            handle.write(data)
    return fields, manifest


def docker_command(binary, image_id, root, harness, container_name):
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', image_id):
        raise VerificationError('runner_image_id_invalid')
    if not re.fullmatch(r'pp-native-verify-[a-f0-9]{32}', container_name):
        raise VerificationError('runner_container_name_invalid')
    command = [binary, 'run', '--rm', '--name', container_name,
               '--network=none', '--read-only', '--cap-drop=ALL',
               '--security-opt=no-new-privileges', '--pids-limit=128',
               '--memory=1g', '--cpus=2', '--user', str(os.getuid()) + ':' + str(os.getgid()),
               '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m', '--workdir=/tmp',
               '--env', 'PATH=/usr/local/bin:/usr/bin:/bin', '--env', 'LANG=C.UTF-8',
               '--env', 'PYTHONDONTWRITEBYTECODE=1', '--env', 'PYTHONUNBUFFERED=1']
    for host, target, readonly in ((root / 'ga_workers', '/native/ga_workers', True),
                                  (root / 'code-inputs.json', '/input/code-inputs.json', True),
                                  (harness, '/verify', True), (root / 'report', '/report', False)):
        if ',' in str(host):
            raise VerificationError('runner_mount_path_invalid')
        command += ['--mount', 'type=bind,source=' + str(host) + ',target=' + target + (',readonly' if readonly else '')]
    return command + [image_id, 'python3', '-I', '/verify/verify_native.py', '--child', '/native',
                      '--report', '/report/safe-report.json']


def public_report(value):
    # Function names and safe synthetic values suffice; source positions stay private.
    if isinstance(value, dict):
        return {key: public_report(item) for key, item in value.items() if key not in ('first_line', 'line')}
    if isinstance(value, list):
        return [public_report(item) for item in value]
    return value


def run_ephemeral(bundle_path, image_id, timeout=360):
    if os.geteuid() == 0:
        raise VerificationError('ordinary_runner_user_required')
    binary = shutil.which('docker')
    if binary is None:
        raise VerificationError('runner_container_runtime_unavailable')
    if not 30 <= timeout <= 600:
        raise VerificationError('runner_timeout_invalid')
    previous_mask = os.umask(0o077)
    try:
        with tempfile.TemporaryDirectory(prefix='pp-native-batching-private-') as scratch:
            root = Path(scratch)
            os.chmod(root, 0o700)
            fields, manifest = unpack_private_bundle(bundle_path, root)
            output = root / 'report'
            output.mkdir(mode=0o700)
            report_path = output / 'safe-report.json'
            harness = Path(__file__).resolve().parent
            container_name = 'pp-native-verify-' + uuid.uuid4().hex
            command = docker_command(binary, image_id, root, harness, container_name)
            process = None
            environment = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8'}
            try:
                with open(root / 'private-native-output.log', 'xb') as captured:
                    os.chmod(root / 'private-native-output.log', 0o600)
                    process = subprocess.Popen(command, env=environment,
                        stdin=subprocess.DEVNULL, stdout=captured, stderr=subprocess.STDOUT,
                        start_new_session=True, cwd=root)
                    try:
                        process.wait(timeout=timeout)
                    except subprocess.TimeoutExpired:
                        raise VerificationError('native_verification_timeout')
            finally:
                # The daemon owns the container, so killing only the client is insufficient.
                # This operates exclusively on the fresh GitHub runner's named test container.
                try:
                    subprocess.run([binary, 'rm', '--force', container_name], env=environment,
                                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, timeout=15, check=False)
                finally:
                    if process is not None and process.poll() is None:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=10)
            if (not report_path.is_file() or report_path.is_symlink()
                    or report_path.stat().st_size > 1024 * 1024):
                raise VerificationError('safe_report_missing_or_too_large')
            report = public_report(json.loads(report_path.read_text()))
            report['provenance'] = {'compiler_sha256': manifest['compiler_sha256'],
                'adapter_sha256': manifest['source_hashes'].get('ga_workers/full_runtime_adapter.py'),
                'code_fields_count': len(fields), 'native_code_changed': False,
                'production_writes': False, 'ephemeral_private_test_authorized': True,
                'isolation': {'method': 'ephemeral_runner_container', 'network': 'none',
                              'read_only_root': True, 'private_tmpfs': True, 'image_id': image_id}}
            print('NATIVE_BATCHING_VERIFICATION ' + json.dumps(report, ensure_ascii=False, separators=(',', ':')))
            return process.returncode
    finally:
        os.umask(previous_mask)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle', type=Path)
    parser.add_argument('--image-id')
    parser.add_argument('--child', type=Path)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--timeout', type=int, default=360)
    args = parser.parse_args()
    if args.child:
        raise SystemExit(child_verification(args.child, args.report))
    try:
        if not args.bundle or not args.image_id:
            raise VerificationError('explicit_private_bundle_and_image_required')
        def interrupted(_signum, _frame):
            raise KeyboardInterrupt()
        signal.signal(signal.SIGTERM, interrupted)
        raise SystemExit(run_ephemeral(args.bundle, args.image_id, timeout=args.timeout))
    except KeyboardInterrupt:
        print('NATIVE_BATCHING_VERIFICATION_CANCELLED')
        raise SystemExit(130)
    except Exception as error:
        code = str(error) if isinstance(error, (VerificationError, InputContractError)) else type(error).__name__
        print('NATIVE_BATCHING_VERIFICATION_BLOCKED ' + code)
        raise SystemExit(1)
