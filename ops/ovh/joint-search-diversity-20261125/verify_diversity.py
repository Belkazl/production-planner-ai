"""Observe the real installed worker on an invented, bounded Quick case only."""
import argparse
import contextlib
import copy
import functools
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import sys


FORMAT = 'joint-search-diversity-verification-v1'
BOOLEANS = ('exact_module_installed', 'native_valid', 'independent_valid',
    'quick_budget_unchanged', 'distinct_native_evaluations', 'partition_seed_diversity',
    'count_seed_diversity', 'seed_growth_bounded', 'baseline_retained',
    'caller_inputs_unchanged', 'all_diversity_checks_passed')
COUNT_FIELDS = ('evaluated', 'decoder_evaluations', 'unique_evaluations', 'cache_reuses',
    'observed_decoder_calls', 'observed_distinct_genomes', 'observed_distinct_partitions',
    'observed_distinct_counts')
ERROR_TYPES = frozenset({'DiversityCheckError', 'FullGAError', 'JointContractError',
    'InfeasibleCandidate', 'PinConstraintError', 'ContinuationError', 'ValueError',
    'TypeError', 'KeyError', 'RuntimeError', 'AssertionError', 'OverflowError',
    'JSONDecodeError', 'FileNotFoundError', 'ImportError', 'AttributeError'})
ERROR_CODES = frozenset({'module_source', 'compiler_hash', 'compiler_keys',
    'native_hooks', 'synthetic_plan', 'diagnostic_counts', 'observer_contract',
    'output_size', 'unexpected'})


class DiversityCheckError(ValueError):
    pass


def need(condition, code):
    if not condition:
        raise DiversityCheckError(code)


def load_file(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def new_report():
    return {'format': FORMAT, **dict.fromkeys(BOOLEANS, False),
            'unique_evaluations_complete': False, 'production_writes': False,
            'counts': dict.fromkeys(COUNT_FIELDS, 0)}


def synthetic_model():
    kind, process = 'synthetic_diversity_machine', 'SYNTHETIC_DIVERSITY_PROCESS'
    return {'scheduler_mode': 'resource', 'quantity_unit': 'шт.',
        'start': '2026-11-25T00:00:00', 'employees': [], 'materials': [],
        'setup_rules': [], 'shifts': {}, 'constraints': [],
        'equipment': [{'id': 'SYNTHETIC_MACHINE_' + str(i), 'name': 'Invented test machine',
                       'kind': kind, 'capacity': 6, 'capacity_unit': 'шт.'} for i in range(2)],
        'orders': [{'id': 'SYNTHETIC_ORDER_' + str(i), 'quantity': 12, 'unit': 'шт.',
                    'technical_process_id': process} for i in range(6)],
        'technical_processes': [{'id': process, 'name': 'Invented test process', 'operations': [
            {'id': 'SYNTHETIC_STEP', 'name': 'Invented test step', 'sequence': 1,
             'duration_min': 2, 'resource_requirements': [{'resource_type': 'equipment',
                'match_mode': 'any', 'resource_ref': 'kind:' + kind, 'quantity': 1,
                'unit': 'шт.', 'consumption_rule': 'during_operation'}]}]}]}


def verify(adapter, joint, checker, exact_module_installed):
    report = new_report()
    report['exact_module_installed'] = exact_module_installed is True
    model = synthetic_model()
    options = {'generations': 3, 'population': 6, 'seed': 1729, 'objective': 'duration'}
    original_model, original_options = copy.deepcopy(model), copy.deepcopy(options)
    factory = adapter._namespace
    observations, observation_errors, baseline_durations = [], [], []

    def namespace():
        ga = factory()
        original = ga.get('_pp_schedule_sequence')
        need(callable(original), 'native_hooks')

        @functools.wraps(original)
        def observed(*args, **kwargs):
            returned = original(*args, **kwargs)
            state = ga.get(joint.STATE_KEY)
            if isinstance(state, dict) and state.get('evaluating') is True:
                try:
                    need(len(observations) < 64, 'observer_contract')
                    sequence = args[1] if len(args) > 1 else kwargs.get('order_ids')
                    genome = joint._batch_signature(returned, tuple(map(str, sequence)))
                    observations.append(genome)
                    value = returned.get('duration_minutes')
                    if not baseline_durations and type(value) in (int, float) and math.isfinite(value):
                        baseline_durations.append(float(value))
                except Exception:
                    observation_errors.append(True)
                    del observation_errors[8:]
            # Observe the native object without changing its rows, arguments,
            # resources, objective, validation, or any native setup handling.
            return returned

        ga['_pp_schedule_sequence'] = observed
        return ga

    adapter._namespace = namespace
    try:
        result = adapter.run({'model': model, 'options': options}, lambda progress: None)
    finally:
        adapter._namespace = factory
    need(isinstance(result, dict), 'synthetic_plan')
    report['native_valid'] = result.get('ok') is True and result.get('valid') is True
    try:
        checked = checker(result, model)
        report['independent_valid'] = checked.get('independent_valid') is True
    except Exception:
        report['independent_valid'] = False
    report['caller_inputs_unchanged'] = model == original_model and options == original_options
    diagnostic = result.get('joint_minibatch')
    need(isinstance(diagnostic, dict), 'diagnostic_counts')
    for key in COUNT_FIELDS[:4]:
        value = diagnostic.get(key)
        need(type(value) is int and 0 <= value <= 1000, 'diagnostic_counts')
        report['counts'][key] = value
    report['unique_evaluations_complete'] = diagnostic.get('unique_evaluations_complete') is True
    ordered_keys = {joint._diversity_key(genome) for genome in observations}
    partitions = {tuple(sorted(genome.partitions)) for genome in observations}
    counts = {tuple(sorted((oid, len(values)) for oid, values in genome.partitions)) for genome in observations}
    report['counts'].update(observed_decoder_calls=len(observations),
        observed_distinct_genomes=len(ordered_keys), observed_distinct_partitions=len(partitions),
        observed_distinct_counts=len(counts))
    report['quick_budget_unchanged'] = (result.get('generations') == 3
        and result.get('population') == 6 and diagnostic['evaluated'] == 18)
    report['distinct_native_evaluations'] = (not observation_errors and len(observations) == 18
        and len(ordered_keys) == 18 and diagnostic['decoder_evaluations'] == 18
        and diagnostic['unique_evaluations'] == 18 and diagnostic['cache_reuses'] == 0
        and report['unique_evaluations_complete'])
    specs = {str(order['id']): joint.OrderSpec(str(order['id']), 12, 6, True, (6,))
             for order in model['orders']}
    seeds = joint.seed_genomes(specs)
    first_keys = {joint._diversity_key(genome) for genome in observations[:6]}
    seed_keys = {joint._diversity_key(genome) for genome in seeds}
    report['partition_seed_diversity'] = len(seeds) >= 4 and len(seed_keys) == len(seeds) and seed_keys <= first_keys
    seed_counts = {sum(len(values) for _, values in seed.partitions) for seed in seeds}
    report['count_seed_diversity'] = {12, 13, 14} <= seed_counts
    baseline = seeds[0].mapping()
    report['seed_growth_bounded'] = all(
        sum(len(values) for _, values in seed.partitions) <= 14
        and sum(seed.mapping()[oid] != baseline[oid] for oid in specs) <= 1 for seed in seeds)
    final_duration = result.get('duration_minutes')
    report['baseline_retained'] = bool(baseline_durations and observations
        and observations[0] == seeds[0] and type(final_duration) in (int, float)
        and math.isfinite(final_duration) and final_duration <= baseline_durations[0] + 1e-7)
    report['all_diversity_checks_passed'] = all(report[key] is True for key in BOOLEANS[:-1])
    if not report['all_diversity_checks_passed']:
        report['failed_checks'] = [key for key in BOOLEANS[:-1] if report[key] is not True]
    return report


def write_report(path, report):
    encoded = json.dumps(report, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
    need(len(encoded) <= 16384, 'output_size')
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(encoded)


def main():
    parser = argparse.ArgumentParser()
    for name in ('package-root', 'code-inputs', 'contract-helper', 'report'):
        parser.add_argument('--' + name, required=True, type=Path)
    args = parser.parse_args()
    report, phase = new_report(), 'bootstrap'
    try:
        # This program has no customer-input option. Only the exact captured
        # code fields enter the environment; all models above are invented.
        with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            here = Path(__file__).resolve().parent
            patcher = load_file('diversity_gate_patch', here / 'patch.py')
            actual_source = (args.package_root / 'ga_workers/joint_minibatch.py').read_text()
            expected_source = patcher.patch((here.parent / 'joint-minibatch-search-20261124/joint_minibatch.py').read_text())
            need(patcher.patch(actual_source) == actual_source and actual_source == expected_source, 'module_source')
            contract = load_file('diversity_code_contract', args.contract_helper)
            selected = contract.select_code_fields(json.loads(args.code_inputs.read_text()))
            compiler_path = args.package_root / 'ga_workers/compile_legacy_ga.py'
            compiler_source = compiler_path.read_bytes()
            need(hashlib.sha256(compiler_source).hexdigest() == contract.COMPILE_SHA, 'compiler_hash')
            need(contract.compiler_keys(compiler_source) == contract.CODE_KEYS, 'compiler_keys')
            os.environ.clear()
            os.environ.update({'PATH': '/usr/local/bin:/usr/bin:/bin', 'LC_ALL': 'C.UTF-8',
                               'PYTHONDONTWRITEBYTECODE': '1', **selected})
            sys.dont_write_bytecode = True
            sys.path.insert(0, str(args.package_root))
            from ga_workers import compile_legacy_ga, full_runtime_adapter, joint_minibatch
            phase = 'compile'
            compile_legacy_ga.build()
            regression = load_file('diversity_existing_checker',
                args.contract_helper.parent / 'regression_cases.py')
            phase = 'actual_quick'
            report = verify(full_runtime_adapter, joint_minibatch,
                            regression.check_production, exact_module_installed=True)
    except Exception as error:
        report['failure'] = {'phase': phase,
            'error_type': type(error).__name__ if type(error).__name__ in ERROR_TYPES else 'Exception',
            'error_code': str(error) if type(error) is DiversityCheckError and str(error) in ERROR_CODES else 'unexpected'}
    try:
        write_report(args.report, report)
    except Exception:
        return 1
    return 0 if report['all_diversity_checks_passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
