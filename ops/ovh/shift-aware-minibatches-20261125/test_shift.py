import ast
import copy
from datetime import datetime
import importlib.util
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch as mock_patch


HERE = Path(__file__).resolve().parent
OPS = HERE.parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


patcher = load('shift_test_patch', HERE / 'patch.py')
diversity = load('shift_test_diversity_patch', OPS / 'joint-search-diversity-20261125/patch.py')
BEFORE = diversity.patch((OPS / 'joint-minibatch-search-20261124/joint_minibatch.py').read_text())
AFTER = patcher.patch(BEFORE)


def compiled(name, source):
    module = types.ModuleType(name)
    module.__file__ = str(HERE / 'public-synthetic-module.py')
    sys.modules[name] = module
    exec(compile(source, '<public-shift-test-module>', 'exec'), module.__dict__)
    return module


old = compiled('shift_previous_joint', BEFORE)
joint = compiled('joint_minibatch', AFTER)
legacy = load('shift_existing_joint_tests', OPS / 'joint-minibatch-search-20261124/test_joint.py')
cases = load('shift_public_cases', HERE / 'cases.py')


class OpaqueWindows:
    def __init__(self, values):
        self.values = values


def predicate(windows, identifier, start, duration):
    if not isinstance(windows, OpaqueWindows):
        raise TypeError('synthetic_native_calendar_contract')
    return any(start >= low and start + duration <= high + 1e-10
               for low, high in windows.values.get(identifier, []))


def installed(name, module=joint, do_install=True):
    model, pins = cases.fixture(name)
    legacy.joint = module
    ga = legacy.namespace(model)
    original = ga['_pp_schedule_sequence']
    windows = OpaqueWindows({cases.EMPLOYEE: cases.intervals(model)})
    calls, observed = [], []

    def window_test(*args):
        calls.append(True)
        return predicate(*args)

    def schedule(ctx, order, op, earliest):
        ctx['emp_windows'] = windows
        ctx['start'] = datetime.fromisoformat(model['start'])
        ctx.setdefault('setups', [])
        color = order.get('parameters', {}).get('color')
        setup = 5 if model['setup_rules'] and ctx.get('last_color') == 'A' and color == 'B' else 0
        quantity = order['quantity']
        ready = max(earliest, ctx['busy'][cases.MACHINE])
        for low, high in windows.values[cases.EMPLOYEE]:
            start = max(low, ready)
            if start + setup + quantity <= high:
                if setup:
                    ctx['setups'].append({'is_setup': True, 'phase': 'setup', 'operation_id': '__setup__',
                        'equipment_ids': [cases.MACHINE], 'employee_ids': [cases.EMPLOYEE],
                        'start_min': start, 'end_min': start + setup})
                start += setup
                ctx['busy'][cases.MACHINE] = start + quantity
                ctx['last_color'] = color
                return start, start + quantity, [cases.EMPLOYEE], [cases.MACHINE], []
        raise module.InfeasibleCandidate('synthetic_native_calendar_exhausted')

    def decoded(candidate_model, order_ids):
        result = original(candidate_model, order_ids)
        result['setup_operations'] = copy.deepcopy(result['ctx']['setups'])
        result['setup_count'] = len(result['setup_operations'])
        result['setup_minutes'] = sum(row['end_min'] - row['start_min'] for row in result['setup_operations'])
        for row in result['operations']:
            row['operation_id'] = cases.OPERATION
            if row['order'] == cases.PRIOR:
                row['manual_locked'] = True
        observed.append(module._batch_signature(result, tuple(order_ids)))
        return result

    ga['_pp_in_window'] = window_test
    ga['_pp_schedule_operation'] = schedule
    ga['_pp_schedule_sequence'] = decoded
    if do_install:
        module.install_joint_minibatch_search(ga, model, pins=pins, source=legacy.EXPANSION,
            verify_constraints=lambda source, sim, locks, namespace: cases.check(sim, source, locks, raw=True))
    return ga, model, pins, observed, calls


def helper_case(size=200, quantity=400, rate=60, unit='шт.', windows=None, start=60, setup=None, shifts=None):
    model, _ = cases.fixture('shift_window')
    model['orders'][0].update(quantity=quantity, unit=unit)
    model['quantity_unit'] = unit
    model['equipment'][0].update(capacity=size, capacity_unit=unit,
        timing_profile={'timing_mode': 'throughput', 'throughput_per_hour': rate})
    if shifts is not None:
        model['shifts'] = shifts
    values = windows or {cases.EMPLOYEE: [(0, 30), (60, 10000)]}
    for identifier in values:
        if identifier != cases.EMPLOYEE:
            model['employees'].append({'id': identifier, 'shift': identifier})
    window = OpaqueWindows(values)
    ga = {'_pp_in_window': predicate, '_pp_batch_order_unit': lambda order: order['unit'],
          '_pp_batch_unit': lambda value: value}
    discrete = joint._unit(unit) in {'шт', 'pcs'}
    spec = joint.OrderSpec(cases.TARGET, quantity, size, discrete, (size,))
    partitions = joint._greedy(quantity, (size,), discrete)
    genome = joint.Genome((cases.TARGET,), ((cases.TARGET, partitions),))
    row = {'order': cases.TARGET, 'batch': 1, 'batch_quantity': partitions[0],
        'equipment_ids': [cases.MACHINE], 'employee_ids': [cases.EMPLOYEE],
        'start_min': start, 'end_min': start + partitions[0] * 60 / rate}
    sim = {'operations': [row], 'setup_operations': setup or [],
           'ctx': {'emp_windows': window, 'start': datetime.fromisoformat(model['start'])}}
    return ga, model, {cases.TARGET: spec}, genome, sim


class ShiftTests(unittest.TestCase):
    def test_exact_base_and_idempotence_with_native_contract_unchanged(self):
        self.assertEqual(patcher.digest(BEFORE), patcher.BASE_SHA256)
        self.assertEqual(patcher.patch(AFTER), AFTER)
        for text in (BEFORE + '\n', AFTER + '\n', AFTER.replace('MAX_SHIFT_SEEDS = 2', 'MAX_SHIFT_SEEDS = 3')):
            with self.assertRaises(ValueError):
                patcher.patch(text)
        before = {node.name: ast.dump(node, include_attributes=False) for node in ast.parse(BEFORE).body
                  if isinstance(node, (ast.FunctionDef, ast.ClassDef))}
        after = {node.name: ast.dump(node, include_attributes=False) for node in ast.parse(AFTER).body
                 if isinstance(node, (ast.FunctionDef, ast.ClassDef))}
        for name in before:
            if name != 'install_joint_minibatch_search':
                self.assertEqual(after[name], before[name], name)

    def test_quick_old_misses_exact_thirty_and_new_uses_native_eighteen_slots(self):
        ga, model, pins, observed, _ = installed('shift_window', old)
        previous = ga['optimize'](3, 6, 1729)
        self.assertGreater(previous['duration_minutes'], 430)
        self.assertFalse(any(genome.mapping()[cases.TARGET][0] == 30 for genome in observed))
        ga, model, pins, observed, calls = installed('shift_window')
        original = copy.deepcopy(model)
        result = ga['optimize'](3, 6, 1729)
        cases.check(result, model, pins)
        self.assertEqual(result['duration_minutes'], 430)
        self.assertEqual(joint._batch_signature(result, (cases.TARGET,)).mapping()[cases.TARGET], (30, 185, 185))
        self.assertEqual(observed[0].mapping()[cases.TARGET], (200, 200))
        self.assertEqual((len(observed), len(set(observed)), result['generations'], result['population']), (18, 18, 3, 6))
        self.assertEqual(result['joint_minibatch']['shift_seed_evaluations'], 1)
        self.assertLessEqual(len(calls), joint.MAX_SHIFT_WINDOW_PROBES)
        self.assertEqual(model, original)

    def test_lunch_setup_and_exact_overnight_oracles_keep_pinned_prefix(self):
        for name, cut, finish in (('lunch_break', 30, 950), ('setup_reservation', 25, 495), ('overnight', 30, 1810)):
            with self.subTest(case=name):
                ga, model, pins, observed, _ = installed(name)
                result = ga['optimize'](3, 6, 1729)
                facts = cases.check(result, model, pins)
                self.assertEqual(facts['first_cut'], cut)
                self.assertEqual(facts['duration_minutes'], finish)
                expected = observed[0].mapping()[cases.PRIOR]
                self.assertTrue(all(genome.mapping()[cases.PRIOR] == expected for genome in observed))
                self.assertEqual((len(observed), len(set(observed))), (18, 18))

    def test_continuation_incumbent_is_the_first_real_decoder_input(self):
        ga, model, pins, observed, _ = installed('shift_window')
        first = ga['optimize'](3, 6, 1729)
        incumbent = joint._batch_signature(first, (cases.TARGET,))
        ga, _, _, observed, _ = installed('shift_window')
        ga[joint.STATE_KEY]['load_incumbent'](incumbent.json())
        result = ga['optimize'](3, 6, 1730, True)
        self.assertEqual(observed[0], incumbent)
        self.assertLessEqual(result['duration_minutes'], first['duration_minutes'])

    def test_window_hint_promotes_an_existing_unevaluated_late_seed(self):
        ga, _, _, observed, _ = installed('shift_window')
        specs = {cases.TARGET: joint.OrderSpec(cases.TARGET, 400, 200, True, (200,))}
        seeds = joint.seed_genomes(specs)
        target = joint.Genome((cases.TARGET,), ((cases.TARGET, (30.0, 185.0, 185.0)),))
        with mock_patch.object(joint, 'seed_genomes', return_value=seeds + [target]):
            result = ga['optimize'](3, 6, 1729)
        self.assertEqual(observed[1], target)
        self.assertEqual((len(observed), len(set(observed))), (18, 18))
        self.assertGreater(result['joint_minibatch']['shift_seed_evaluations'], 0)

    def test_actual_verifier_observes_once_and_restores_adapter_and_score(self):
        verifier = load('shift_test_native_verifier', HERE / 'verify_shift.py')
        adapter = types.SimpleNamespace()
        adapter._namespace = lambda: installed('shift_window', do_install=False)[0]
        adapter.install_joint_minibatch_search = joint.install_joint_minibatch_search

        def run(payload, progress):
            ga = adapter._namespace()
            adapter.install_joint_minibatch_search(ga, payload['model'], source=legacy.EXPANSION,
                verify_constraints=lambda model, sim, pins, ns: cases.check(sim, model, pins, raw=True))
            options = payload['options']
            return ga['optimize'](options['generations'], options['population'], options['seed'])

        adapter.run = run
        namespace, score = adapter._namespace, joint._score
        result, observed, _, _ = verifier.run_case(adapter, joint, cases, 'shift_window')
        self.assertTrue(all(result[key] is True for key in verifier.CASE_BOOLEAN_FIELDS))
        self.assertEqual(observed['counts']['observed_decoder_calls'], 18)
        self.assertEqual(len(observed['scored']), 18)
        self.assertIs(adapter._namespace, namespace)
        self.assertIs(joint._score, score)

    def test_continuous_square_metres_allow_half_unit_without_minimum_one(self):
        args = helper_case(size=2, quantity=4, rate=6, unit='м²', start=60,
            windows={cases.EMPLOYEE: [(0, 5), (60, 1000)]})
        choices = joint._shift_seed_candidates(*args)
        self.assertTrue(choices)
        sizes = choices[0].mapping()[cases.TARGET]
        self.assertAlmostEqual(sizes[0], .5, places=8)
        self.assertAlmostEqual(sum(sizes), 4)
        self.assertTrue(all(0 < value <= 2 for value in sizes))
        self.assertEqual(joint._unit('м²'), 'м²')

    def test_native_ready_at_later_shift_and_common_employee_start(self):
        args = helper_case(size=300, quantity=600, start=780,
            windows={cases.EMPLOYEE: [(480, 720), (780, 1260)]},
            shifts={'day': [['08:00', '12:00'], ['13:00', '21:00']]})
        self.assertEqual(joint._shift_seed_candidates(*args)[0].mapping()[cases.TARGET][0], 240)
        args = helper_case(size=100, quantity=200, start=120,
            windows={cases.EMPLOYEE: [(0, 60), (120, 240)], 'SECOND': [(30, 60), (120, 240)]},
            shifts={'day': [['00:00', '01:00'], ['02:00', '04:00']],
                    'SECOND': [['00:30', '01:00'], ['02:00', '04:00']]})
        args[4]['operations'][0]['employee_ids'].append('SECOND')
        self.assertEqual(joint._shift_seed_candidates(*args)[0].mapping()[cases.TARGET][0], 30)

    def test_setup_and_production_use_their_own_native_staff_phases(self):
        setup = [{'is_setup': True, 'equipment_ids': [cases.MACHINE], 'employee_ids': ['SETTER'],
                  'start_min': 100, 'end_min': 120}]
        args = helper_case(size=100, quantity=200, start=120, setup=setup,
            windows={cases.EMPLOYEE: [(0, 60), (120, 240)], 'SETTER': [(0, 20), (100, 120)]},
            shifts={'day': [['00:00', '01:00'], ['02:00', '04:00']],
                    'SETTER': [['00:00', '00:20'], ['01:40', '02:00']]})
        self.assertEqual(joint._shift_seed_candidates(*args)[0].mapping()[cases.TARGET][0], 40)

    def test_independent_calendar_check_uses_nonzero_origin_and_rejects_bad_window(self):
        model, _ = cases.fixture('shift_window')
        model['start'] = '2026-11-25T08:00:00'
        model['shifts'] = {'day': [['10:00', '10:30'], ['11:00', '19:00']]}
        rows, batches = [], []
        for batch, (quantity, start) in enumerate(((30, 120), (185, 180), (185, 365)), 1):
            rows.append({'order': cases.TARGET, 'batch': batch, 'batch_quantity': quantity,
                'operation_id': cases.OPERATION, 'start_min': start, 'end_min': start + quantity,
                'equipment_ids': [cases.MACHINE], 'employee_ids': [cases.EMPLOYEE]})
            batches.append({'order': cases.TARGET, 'batch': batch, 'quantity': quantity})
        plan = {'ok': True, 'valid': True, 'operations': rows, 'batches': batches,
                'setup_operations': [], 'duration_minutes': 550}
        self.assertEqual(cases.check(plan, model)['duration_minutes'], 550)
        wrong = copy.deepcopy(plan)
        wrong['operations'][0].update(start_min=119, end_min=149)
        with self.assertRaises(cases.ShiftCheckError):
            cases.check(wrong, model)

    def test_fixed_duration_unknown_origin_and_pins_do_not_get_invented_hints(self):
        args = helper_case()
        args[1]['equipment'][0]['timing_profile'] = {'timing_mode': 'fixed', 'duration_min': 200}
        self.assertEqual(joint._shift_seed_candidates(*args), [])
        args = helper_case()
        self.assertEqual(joint._shift_seed_candidates(*args, frozen={cases.TARGET: (200, 200)}), [])
        args = helper_case(size=300, quantity=600, start=780,
            windows={cases.EMPLOYEE: [(480, 720), (780, 1260)]},
            shifts={'day': [['08:00', '12:00'], ['13:00', '21:00']]})
        args[4]['ctx'].pop('start')
        self.assertEqual(joint._shift_seed_candidates(*args), [])

    @unittest.skipUnless(os.environ.get('LIFTORBIT_SHIFT_AWARE_FIXTURE'), 'optional staged actual-source module')
    def test_staged_actual_module_is_exact_candidate(self):
        source = Path(os.environ['LIFTORBIT_SHIFT_AWARE_FIXTURE']).read_text()
        self.assertEqual(patcher.patch(source), source)
        self.assertEqual(source, AFTER)


def load_tests(loader, tests, pattern):
    legacy.joint = joint
    tests.addTests(loader.loadTestsFromModule(legacy))
    return tests


if __name__ == '__main__':
    unittest.main()
