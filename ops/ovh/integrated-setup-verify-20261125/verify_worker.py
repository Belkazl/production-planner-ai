"""Run the installed native worker in the already isolated, code-only container.

This is a test driver, not an optimizer or a production patch. Private native
stdout remains in the runner's private capture. Only fixed-schema evidence is
written to the report; exported plans contain this module's invented inputs.
"""
import argparse
import copy
import functools
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cases import CheckError, check, model, need, number, rows, schedule_digest

PLAN_FIELDS = frozenset({
    'ok', 'valid', 'partial', 'start', 'finish', 'operations', 'generic_operations', 'setup_operations', 'batches',
    'duration_minutes', 'operator_wait_minutes', 'machine_idle_minutes', 'batch_count', 'operation_count',
    'setup_count', 'setup_operation_count', 'setup_minutes', 'objective', 'history_best', 'resume_state', 'order_sequence',
    'joint_minibatch', 'staff_shift_repaired', 'optimization_run', 'total_generations', 'generations', 'population',
    'seed', 'continued', 'runtime_ms', 'locked_operations_applied', 'algorithm', 'core_version',
    '_pp_verified_checkpoint_v1', '_pp_checkpoint_objective', '_pp_checkpoint_model_hash',
})
BOOLEANS = ('native_setups_in_fitness', 'candidate_resource_reservations', 'material_shift_case_valid',
            'pinned_case_valid', 'zero_setup_case_valid', 'all_native_checks_passed')
ERROR_TYPES = frozenset({'CheckError', 'FullGAError', 'JointContractError', 'InfeasibleCandidate',
    'PinConstraintError', 'ContinuationError', 'ValueError', 'TypeError', 'KeyError', 'RuntimeError',
    'AssertionError', 'OverflowError', 'JSONDecodeError', 'FileNotFoundError', 'ImportError', 'AttributeError'})


def failure(error, phase):
    result = {'valid': False, 'phase': phase,
              'error_type': type(error).__name__ if type(error).__name__ in ERROR_TYPES else 'Exception'}
    if type(error) is CheckError:
        result['error_code'] = str(error)
    causes = []
    seen = {id(error)}
    current = error.__cause__
    while current is not None and len(causes) < 4 and id(current) not in seen:
        seen.add(id(current))
        causes.append(type(current).__name__ if type(current).__name__ in ERROR_TYPES else 'Exception')
        current = current.__cause__
    if causes:
        result['cause_types'] = causes
    return result


def private_json(path, value):
    encoded = json.dumps(value, ensure_ascii=True, separators=(',', ':'), allow_nan=False).encode()
    need(len(encoded) <= 4 * 1024 * 1024, 'output_size')
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(encoded)


def public_plan(plan):
    result = {key: copy.deepcopy(value) for key, value in plan.items() if key in PLAN_FIELDS}
    # Reject non-JSON native objects instead of exposing their repr/source.
    json.dumps(result, allow_nan=False)
    return result


def observed(adapter, name, source_model, options, pins=()):
    factory = adapter._namespace
    evidence = {'score_calls': 0, 'score_failures': [], 'score_durations': [], 'score_setup_counts': [],
                'published_count': 0, 'published_failures': [], 'live_published_count': 0}
    checkpoint_rows, identities = [], set()
    objective = options.get('objective') or 'duration'

    def namespace():
        ga = factory()
        original = ga['_pp_obj_key']

        @functools.wraps(original)
        def objective_key(sim, goal):
            answer = original(sim, goal)
            joint = ga.get('_PP_JOINT_BATCH_STATE')
            if isinstance(joint, dict) and joint.get('evaluating') is True:
                evidence['score_calls'] += 1
                try:
                    checked = check(sim, source_model, pins, raw=True)
                    if objective == 'duration':
                        need(isinstance(answer, (tuple, list)) and answer
                             and abs(number(answer[0]) - checked['duration_minutes']) < 1e-5, 'fitness_omits_setup_time')
                    for field, value in (('score_durations', checked['duration_minutes']),
                                         ('score_setup_counts', checked['setup_count'])):
                        if value not in evidence[field] and len(evidence[field]) < 32:
                            evidence[field].append(value)
                except Exception as error:
                    evidence['score_failures'].append(str(error) if type(error) is CheckError else type(error).__name__)
                    evidence['score_failures'] = evidence['score_failures'][:8]
            return answer

        ga['_pp_obj_key'] = objective_key
        return ga

    def progress(data):
        if not isinstance(data, dict):
            return
        for kind in ('best_preview', 'candidate_preview'):
            plan = data.get(kind)
            if not isinstance(plan, dict):
                continue
            evidence['published_count'] += 1
            try:
                check(plan, source_model, pins)
                state = plan.get('resume_state')
                if isinstance(state, dict):
                    need((state.get('objective') or 'duration') == objective, 'checkpoint_objective')
                digest = schedule_digest(plan)
                identity = (kind, digest, bool(data.get('running')))
                if data.get('running') is True:
                    evidence['live_published_count'] += 1
                if identity not in identities and len(checkpoint_rows) < 12:
                    identities.add(identity)
                    checkpoint_rows.append({'kind': kind, 'running': data.get('running') is True,
                                            'plan': public_plan(plan)})
            except Exception as error:
                evidence['published_failures'].append(str(error) if type(error) is CheckError else type(error).__name__)
                evidence['published_failures'] = evidence['published_failures'][:8]

    saved_model, saved_options = copy.deepcopy(source_model), copy.deepcopy(options)
    adapter._namespace = namespace
    try:
        final = adapter.run({'model': source_model, 'options': options}, progress)
    finally:
        adapter._namespace = factory
    need(source_model == saved_model and options == saved_options, 'caller_mutated')
    checked = check(final, source_model, pins)
    state = final.get('resume_state')
    need(isinstance(state, dict) and state.get('version') == 2, 'native_resume_missing')
    need((state.get('objective') or 'duration') == objective, 'final_resume_objective')
    need(abs(number(state['best_duration_minutes']) - checked['duration_minutes']) < 1e-5, 'final_resume_duration')
    if final.get('objective') is not None:
        need(final['objective'] == objective, 'final_objective')
    evidence.update(checked)
    evidence['objective'] = objective
    evidence['valid'] = bool(evidence['score_calls'] and not evidence['score_failures']
                             and evidence['published_count'] and not evidence['published_failures'])
    fixture = {'name': name, 'model': copy.deepcopy(source_model), 'options': copy.deepcopy(options),
               'final': public_plan(final), 'checkpoints': checkpoint_rows, 'pins': copy.deepcopy(list(pins))}
    return fixture, evidence


def verify(adapter):
    fixtures, cases = [], {}
    options = {'generations': 8, 'population': 12, 'seed': 1741, 'objective': 'duration'}
    for name, source_model, opts in (
            ('setup_sequence', model(), options),
            ('delayed_material_shift', model(delayed=True), dict(options, seed=1742)),
            ('zero_setups', model(zero=True), dict(options, seed=1743, objective='idle'))):
        try:
            fixture, result = observed(adapter, name, source_model, opts)
            fixtures.append(fixture); cases[name] = result
        except Exception as error:
            cases[name] = failure(error, 'native_case')
    delayed = next((item for item in fixtures if item['name'] == 'delayed_material_shift'), None)
    try:
        need(delayed is not None, 'pinned_source_missing')
        production, _ = rows(delayed['final'])
        selected = max(production, key=lambda row: number(row['end_min']))
        pin = {key: copy.deepcopy(selected[key]) for key in
               ('order', 'operation_id', 'batch', 'batch_quantity', 'start_min', 'end_min', 'equipment_ids', 'employee_ids')}
        opts = dict(options, seed=1744, **{'continue': True, 'locked_operations': [pin],
                    'resume_state': copy.deepcopy(delayed['final']['resume_state'])})
        fixture, result = observed(adapter, 'pinned_native', model(delayed=True), opts, [pin])
        fixtures.append(fixture); cases['pinned_native'] = result
    except Exception as error:
        cases['pinned_native'] = failure(error, 'native_pin_case')
    sequence = cases['setup_sequence']
    proof = (sequence['valid'] and abs(sequence.get('duration_minutes', 0) - 45) < 1e-5
             and sequence.get('setup_count') == 1 and {1, 2}.issubset(sequence.get('score_setup_counts', []))
             and all(any(abs(value - target) < 1e-5 for value in sequence.get('score_durations', [])) for target in (45, 60)))
    report = {'format': 'integrated-setup-worker-v1', 'schema': 'integrated-setup-worker-v1', 'cases': cases, 'fixture_count': len(fixtures),
        'native_setups_in_fitness': bool(proof),
        'candidate_resource_reservations': all(case['valid'] for case in cases.values()),
        'material_shift_case_valid': cases['delayed_material_shift']['valid'],
        'pinned_case_valid': cases['pinned_native']['valid'],
        'zero_setup_case_valid': cases['zero_setups']['valid'] and cases['zero_setups'].get('setup_count') == 0,
        'production_writes': False}
    report['all_native_checks_passed'] = all(report[key] is True for key in BOOLEANS[:-1])
    return {'schema': 'integrated-setup-fixtures-v1', 'cases': fixtures}, report


def main():
    parser = argparse.ArgumentParser()
    for field in ('package-root', 'code-inputs', 'fixtures', 'report', 'contract-helper'):
        parser.add_argument('--' + field, required=True, type=Path)
    args = parser.parse_args()
    report = {'format': 'integrated-setup-worker-v1', 'schema': 'integrated-setup-worker-v1', **dict.fromkeys(BOOLEANS, False), 'production_writes': False}
    try:
        spec = importlib.util.spec_from_file_location('integrated_code_contract', args.contract_helper)
        contract = importlib.util.module_from_spec(spec); spec.loader.exec_module(contract)
        selected = contract.select_code_fields(json.loads(args.code_inputs.read_text()))
        compiler = args.package_root / 'ga_workers/compile_legacy_ga.py'
        need(hashlib.sha256(compiler.read_bytes()).hexdigest() == contract.COMPILE_SHA, 'compiler_hash')
        need(contract.compiler_keys(compiler.read_bytes()) == contract.CODE_KEYS, 'compiler_keys')
        os.environ.clear()
        os.environ.update({'PATH': '/usr/local/bin:/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1', 'LC_ALL': 'C.UTF-8', **selected})
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(args.package_root))
        from ga_workers import compile_legacy_ga, full_runtime_adapter
        compile_legacy_ga.build()
        fixtures, report = verify(full_runtime_adapter)
        private_json(args.fixtures, fixtures)
    except Exception as error:
        report['failure'] = failure(error, 'bootstrap_or_output')
    private_json(args.report, report)
    return 0 if report['all_native_checks_passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
