"""Actual native acceptance on invented shift/lunch/setup cases; no user data."""
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
import types


FORMAT = 'shift-aware-minibatch-verification-v1'
BOOLEANS = ('exact_module_installed', 'native_valid', 'independent_valid',
    'quick_budget_unchanged', 'distinct_native_evaluations', 'baseline_retained',
    'caller_inputs_unchanged', 'window_cut_30', 'lunch_break_improves', 'setup_cut_25',
    'continuation_incumbent_first', 'all_shift_checks_passed')
CASE_NAMES = ('shift_window', 'lunch_break', 'setup_reservation', 'overnight')
CASE_BOOLEAN_FIELDS = ('native_valid', 'independent_valid', 'quick_budget_unchanged',
    'distinct_native_evaluations', 'baseline_first', 'baseline_retained',
    'target_cut_evaluated', 'improved', 'caller_inputs_unchanged')
CASE_NUMBER_FIELDS = ('baseline_duration', 'best_duration', 'target_cut', 'first_cut')
COUNT_FIELDS = ('evaluated', 'decoder_evaluations', 'unique_evaluations', 'cache_reuses',
    'observed_decoder_calls', 'observed_distinct_genomes', 'shift_seed_proposals', 'shift_seed_evaluations')
ERROR_TYPES = frozenset({'ShiftVerificationError', 'ShiftCheckError', 'FullGAError',
    'JointContractError', 'InfeasibleCandidate', 'PinConstraintError', 'ContinuationError',
    'ValueError', 'TypeError', 'KeyError', 'RuntimeError', 'AssertionError', 'OverflowError',
    'JSONDecodeError', 'FileNotFoundError', 'ImportError', 'AttributeError'})
ERROR_CODES = frozenset({'module_source', 'compiler_hash', 'compiler_keys', 'native_hooks',
    'synthetic_plan', 'diagnostic_counts', 'observer_contract', 'output_size', 'unexpected'})


class ShiftVerificationError(ValueError):
    pass


def need(condition, code):
    if not condition:
        raise ShiftVerificationError(code)


def load_file(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def new_report():
    return {'format': FORMAT, **dict.fromkeys(BOOLEANS, False),
        'production_writes': False, 'unique_evaluations_complete': False,
        'counts': dict.fromkeys(COUNT_FIELDS, 0),
        'cases': {name: {**dict.fromkeys(CASE_BOOLEAN_FIELDS, False),
            **dict.fromkeys(CASE_NUMBER_FIELDS, 0)} for name in CASE_NAMES}}


def observe(adapter, joint, model, options):
    """Observe real decoder and post-validation scoring; return native objects."""
    factory, installer = adapter._namespace, adapter.install_joint_minibatch_search
    original_score = joint._score
    before_model, before_options = copy.deepcopy(model), copy.deepcopy(options)
    decoded, scored, observation_errors = [], [], []
    holder = {}

    def namespace():
        ga = factory()
        native_decode = ga.get('_pp_schedule_sequence')
        need(callable(native_decode) and callable(ga.get('_pp_obj_key')), 'native_hooks')
        holder['ga'] = ga

        def active():
            state = ga.get(joint.STATE_KEY)
            return isinstance(state, dict) and state.get('evaluating') is True

        @functools.wraps(native_decode)
        def decode(*args, **kwargs):
            result = native_decode(*args, **kwargs)
            if active():
                try:
                    need(len(decoded) < 64, 'observer_contract')
                    ordered = args[1] if len(args) > 1 else kwargs.get('order_ids')
                    holder['sequence'] = tuple(map(str, ordered))
                    decoded.append(joint._batch_signature(result, holder['sequence']))
                except Exception:
                    observation_errors.append(True)
            return result

        ga['_pp_schedule_sequence'] = decode
        return ga

    @functools.wraps(original_score)
    def scored_candidate(ga, sim, objective):
        result = original_score(ga, sim, objective)
        try:
            need(ga is holder.get('ga') and len(scored) < 64 and holder.get('sequence') is not None,
                 'observer_contract')
            scored.append((joint._batch_signature(sim, holder['sequence']), copy.deepcopy(sim)))
        except Exception:
            observation_errors.append(True)
        return result

    adapter._namespace = namespace
    adapter.install_joint_minibatch_search = joint.install_joint_minibatch_search
    joint._score = scored_candidate
    try:
        result = adapter.run({'model': model, 'options': options}, lambda event: None)
    finally:
        adapter._namespace, adapter.install_joint_minibatch_search = factory, installer
        joint._score = original_score
    need(isinstance(result, dict) and decoded and scored and not observation_errors, 'observer_contract')
    diagnostic = result.get('joint_minibatch')
    need(isinstance(diagnostic, dict), 'diagnostic_counts')
    counts = {}
    for key in COUNT_FIELDS:
        if key.startswith('observed_'):
            continue
        value = diagnostic.get(key, 0) if key.startswith('shift_seed_') else diagnostic.get(key)
        need(type(value) is int and 0 <= value <= 1000, 'diagnostic_counts')
        counts[key] = value
    counts.update(observed_decoder_calls=len(decoded), observed_distinct_genomes=len(set(decoded)))
    complete = diagnostic.get('unique_evaluations_complete') is True
    quick = result.get('generations') == 3 and result.get('population') == 6 and counts['evaluated'] == 18
    distinct = (quick and complete and counts['decoder_evaluations'] == 18
        and counts['unique_evaluations'] == 18 and counts['cache_reuses'] == 0
        and len(decoded) == 18 and len(set(decoded)) == 18)
    return {'result': result, 'decoded': decoded, 'scored': scored, 'counts': counts,
        'complete': complete, 'quick': quick, 'distinct': distinct,
        'caller_unchanged': model == before_model and options == before_options,
        'namespace': holder['ga']}


def expected_default(joint, model):
    sequence = tuple(row['id'] for row in model['orders'])
    return joint.Genome(sequence, tuple((row['id'], joint._greedy(row['quantity'], (200,), True))
                                       for row in model['orders']))


def run_case(adapter, joint, cases, name):
    model, pins = cases.fixture(name)
    options = {'generations': 3, 'population': 6, 'seed': 1729, 'objective': 'duration'}
    if pins:
        options['locked_operations'] = copy.deepcopy(pins)
    run = observe(adapter, joint, model, options)
    result = run['result']
    facts = cases.check(result, model, pins)
    for _, sim in run['scored']:
        cases.check(sim, model, pins, raw=True)
    target = 25 if name == 'setup_reservation' else 30
    baseline = cases.number(run['scored'][0][1].get('duration_minutes'))
    final = cases.number(result.get('duration_minutes'))
    value = {'native_valid': result.get('ok') is True and result.get('valid') is True,
        'independent_valid': facts['independent_valid'] is True,
        'quick_budget_unchanged': run['quick'], 'distinct_native_evaluations': run['distinct'],
        'baseline_first': run['decoded'][0] == expected_default(joint, model)
            and run['scored'][0][0] == run['decoded'][0],
        'baseline_retained': final <= baseline + cases.EPS,
        'target_cut_evaluated': (run['counts']['shift_seed_proposals'] > 0
            and run['counts']['shift_seed_evaluations'] > 0
            and any(abs(genome.mapping()[cases.TARGET][0] - target) < cases.EPS for genome, _ in run['scored'])),
        'improved': final < baseline - cases.EPS,
        'caller_inputs_unchanged': run['caller_unchanged'],
        'baseline_duration': baseline, 'best_duration': final,
        'target_cut': target, 'first_cut': facts['first_cut']}
    return value, run, model, pins


def candidate_before(source):
    module = types.ModuleType('ga_workers.shift_previous_joint')
    module.__package__ = 'ga_workers'
    sys.modules[module.__name__] = module
    exec(compile(source, '<public-previous-joint-module>', 'exec'), module.__dict__)
    return module


def window_origin_probe(adapter, joint, cases, nonzero_origin=False):
    model, _ = cases.fixture('shift_window')
    if nonzero_origin:
        model['start'] = '2026-11-25T08:00:00'
        model['shifts'] = {'day': [['10:00', '10:30'], ['11:00', '19:00']]}
        opening, target = 120, 550
    else:
        model['shifts'] = {'day': [['08:00', '08:30'], ['09:00', '17:00']]}
        opening, target = 480, 910
    run = observe(adapter, joint, model,
        {'generations': 3, 'population': 6, 'seed': 1729, 'objective': 'duration'})
    facts = cases.check(run['result'], model)
    for _, sim in run['scored']:
        cases.check(sim, model, raw=True)
    first = run['scored'][0][1]
    ga, windows = run['namespace'], first['ctx']['emp_windows']
    native_window = ga['_pp_in_window']
    valid = (not native_window(windows, cases.EMPLOYEE, 0, 1)
        and native_window(windows, cases.EMPLOYEE, opening, 30)
        and not native_window(windows, cases.EMPLOYEE, opening, 31)
        and run['counts']['shift_seed_proposals'] > 0 and run['counts']['shift_seed_evaluations'] > 0
        and any(abs(genome.mapping()[cases.TARGET][0] - 30) < cases.EPS for genome, _ in run['scored'])
        and abs(facts['duration_minutes'] - target) < cases.EPS)
    return valid, run


def verify(adapter, joint, previous_source, cases, diversity_verify, regression_checker, report, phase):
    phase[0] = 'previous_quick'
    previous = candidate_before(previous_source)
    model, _ = cases.fixture('shift_window')
    previous_run = observe(adapter, previous, model,
        {'generations': 3, 'population': 6, 'seed': 1729, 'objective': 'duration'})
    previous_facts = cases.check(previous_run['result'], model)
    report['previous_quick'] = {'duration': previous_facts['duration_minutes'],
        'target_cut_evaluated': any(abs(genome.mapping()[cases.TARGET][0] - 30) < cases.EPS
                                  for genome, _ in previous_run['scored'])}
    runs, first_result = [], None
    for name in CASE_NAMES:
        phase[0] = name
        value, run, model, pins = run_case(adapter, joint, cases, name)
        report['cases'][name] = value
        runs.append(run)
        if name == 'shift_window':
            first_result = run['result']
    phase[0] = 'shift_window'
    later_ready_valid, later_ready_run = window_origin_probe(adapter, joint, cases)
    offset_valid, offset_run = window_origin_probe(adapter, joint, cases, nonzero_origin=True)
    runs.extend([later_ready_run, offset_run])
    report['internal_windows'] = {'later_ready': later_ready_valid, 'nonzero_origin': offset_valid}
    phase[0] = 'continuation'
    model, pins = cases.fixture('shift_window')
    expected = joint._batch_signature(first_result, tuple(first_result['order_sequence']))
    continuing = observe(adapter, joint, model, {'generations': 3, 'population': 6, 'seed': 1730,
        'objective': 'duration', 'continue': True, 'resume_state': copy.deepcopy(first_result['resume_state'])})
    continued_facts = cases.check(continuing['result'], model, pins)
    for _, sim in continuing['scored']:
        cases.check(sim, model, pins, raw=True)
    runs.append(continuing)
    report['continuation_incumbent_first'] = (continuing['decoded'][0] == expected
        and continuing['scored'][0][0] == expected
        and continuing['result'].get('continued') is True
        and continued_facts['duration_minutes'] <= first_result['duration_minutes'] + cases.EPS)
    # Invoke the frozen behavioral verifier without changing its exact-08a3
    # CLI guard. This script has already pinned the new installed source.
    diversity = diversity_verify(adapter, joint, regression_checker, exact_module_installed=True)
    diversity_pass = diversity.get('all_diversity_checks_passed') is True
    report['native_valid'] = diversity_pass and all(value['native_valid'] for value in report['cases'].values())
    report['independent_valid'] = diversity_pass and all(value['independent_valid'] for value in report['cases'].values())
    report['quick_budget_unchanged'] = diversity_pass and all(run['quick'] for run in runs)
    report['distinct_native_evaluations'] = diversity_pass and all(run['distinct'] for run in runs)
    report['baseline_retained'] = diversity_pass and all(value['baseline_retained'] for value in report['cases'].values())
    report['caller_inputs_unchanged'] = diversity_pass and all(run['caller_unchanged'] for run in runs)
    report['unique_evaluations_complete'] = diversity.get('unique_evaluations_complete') is True and all(run['complete'] for run in runs)
    report['window_cut_30'] = (report['cases']['shift_window']['target_cut_evaluated']
        and abs(report['cases']['shift_window']['best_duration'] - 430) < cases.EPS
        and report['cases']['overnight']['target_cut_evaluated']
        and abs(report['cases']['overnight']['best_duration'] - 1810) < cases.EPS
        and later_ready_valid and offset_valid
        and previous_facts['duration_minutes'] > 430 + cases.EPS
        and not report['previous_quick']['target_cut_evaluated'])
    report['lunch_break_improves'] = (report['cases']['lunch_break']['target_cut_evaluated']
        and abs(report['cases']['lunch_break']['best_duration'] - 950) < cases.EPS)
    report['setup_cut_25'] = (report['cases']['setup_reservation']['target_cut_evaluated']
        and abs(report['cases']['setup_reservation']['best_duration'] - 495) < cases.EPS)
    for key in COUNT_FIELDS:
        report['counts'][key] = sum(run['counts'][key] for run in runs)
        need(0 <= report['counts'][key] <= 1000, 'diagnostic_counts')
    report['all_shift_checks_passed'] = (all(report[key] is True for key in BOOLEANS[:-1])
        and report['unique_evaluations_complete'] is True
        and all(value[key] is True for value in report['cases'].values() for key in CASE_BOOLEAN_FIELDS))
    if not report['all_shift_checks_passed']:
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
    report, phase = new_report(), ['bootstrap']
    try:
        with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            here = Path(__file__).resolve().parent
            patcher = load_file('shift_gate_patch', here / 'patch.py')
            previous_patch = load_file('shift_gate_previous_patch', here.parent / 'joint-search-diversity-20261125/patch.py')
            previous_source = previous_patch.patch((here.parent / 'joint-minibatch-search-20261124/joint_minibatch.py').read_text())
            need(patcher.digest(previous_source) == patcher.BASE_SHA256, 'module_source')
            actual_path = args.package_root / 'ga_workers/joint_minibatch.py'
            actual_source = actual_path.read_text()
            expected_source = patcher.patch(previous_source)
            need(patcher.patch(actual_source) == actual_source and actual_source == expected_source, 'module_source')
            report['exact_module_installed'] = True
            contract = load_file('shift_code_contract', args.contract_helper)
            selected = contract.select_code_fields(json.loads(args.code_inputs.read_text()))
            compiler = (args.package_root / 'ga_workers/compile_legacy_ga.py').read_bytes()
            need(hashlib.sha256(compiler).hexdigest() == contract.COMPILE_SHA, 'compiler_hash')
            need(contract.compiler_keys(compiler) == contract.CODE_KEYS, 'compiler_keys')
            os.environ.clear()
            os.environ.update({'PATH': '/usr/local/bin:/usr/bin:/bin', 'LC_ALL': 'C.UTF-8',
                               'PYTHONDONTWRITEBYTECODE': '1', **selected})
            sys.dont_write_bytecode = True
            sys.path.insert(0, str(args.package_root))
            from ga_workers import compile_legacy_ga, full_runtime_adapter, joint_minibatch
            phase[0] = 'compile'
            compile_legacy_ga.build()
            cases = load_file('shift_gate_cases', here / 'cases.py')
            diversity = load_file('shift_gate_diversity_verifier', here.parent / 'joint-search-diversity-20261125/verify_diversity.py')
            regression = load_file('shift_gate_existing_checker', args.contract_helper.parent / 'regression_cases.py')
            report = verify(full_runtime_adapter, joint_minibatch, previous_source, cases,
                            diversity.verify, regression.check_production, report, phase)
            need(actual_path.read_text() == actual_source, 'module_source')
    except Exception as error:
        report['all_shift_checks_passed'] = False
        report['failure'] = {'phase': phase[0],
            'error_type': type(error).__name__ if type(error).__name__ in ERROR_TYPES else 'Exception',
            'error_code': str(error) if type(error) is ShiftVerificationError and str(error) in ERROR_CODES else 'unexpected'}
    try:
        write_report(args.report, report)
    except Exception:
        return 1
    return 0 if report['all_shift_checks_passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
