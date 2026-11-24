import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import regression_cases as cases
import verify_native as verification
from test_harness import example_plan


def cutlets_plan():
    assignments = [('CUTLET_1', 'SIDE_A', 0, 'PAN_SLOT_1'), ('CUTLET_2', 'SIDE_A', 0, 'PAN_SLOT_2'),
                   ('CUTLET_1', 'SIDE_B', 1, 'PAN_SLOT_1'), ('CUTLET_3', 'SIDE_A', 1, 'PAN_SLOT_2'),
                   ('CUTLET_2', 'SIDE_B', 2, 'PAN_SLOT_1'), ('CUTLET_3', 'SIDE_B', 2, 'PAN_SLOT_2')]
    rows = [{'order': oid, 'operation_id': op, 'batch': 1, 'batch_quantity': 1, 'start_min': start,
             'end_min': start + 1, 'equipment_ids': [eid]} for oid, op, start, eid in assignments]
    return {'valid': True, 'duration_minutes': 3, 'operations': rows,
            'batches': [{'order': 'CUTLET_' + str(i), 'batch': 1, 'quantity': 1} for i in (1, 2, 3)]}


def multistage_plan():
    rows, batches = [], []
    first_available = second_available = 0
    for oid, quantities in (('MULTI_ORDER_A', [5, 5, 2]), ('MULTI_ORDER_B', [5, 4])):
        for index, quantity in enumerate(quantities, 1):
            start = first_available
            rows.append({'order': oid, 'batch': index, 'batch_quantity': quantity, 'operation_id': 'STEP_1',
                'equipment_ids': ['STAGE1_A'], 'start_min': start, 'end_min': start + 2})
            first_available += 2
            start = max(second_available, first_available)
            rows.append({'order': oid, 'batch': index, 'batch_quantity': quantity, 'operation_id': 'STEP_2',
                'equipment_ids': ['STAGE2_A'], 'start_min': start, 'end_min': start + 4})
            second_available = start + 4
            batches.append({'order': oid, 'batch': index, 'quantity': quantity})
    return {'valid': True, 'duration_minutes': second_available, 'operations': rows, 'batches': batches}


def staff_plan():
    first = {'order': 'SHIFT_ORDER_A', 'batch': 1, 'batch_quantity': 1, 'operation_id': 'SHIFT_WORK',
             'start_min': 480, 'end_min': 490, 'equipment_ids': ['SHIFT_MACHINE'], 'employee_ids': ['SHIFT_EMP']}
    second = {**first, 'order': 'SHIFT_ORDER_B', 'start_min': 535, 'end_min': 545}
    setup = {'order': 'SHIFT_ORDER_B', 'phase': 'setup', 'start_min': 520, 'end_min': 535,
             'equipment_ids': ['SHIFT_MACHINE'], 'employee_ids': ['SHIFT_EMP']}
    return {'valid': True, 'duration_minutes': 545, 'setup_count': 1, 'setup_minutes': 15,
            'staff_shift_repaired': True, 'generic_operations': [first, setup, second],
            'batches': [{'order': 'SHIFT_ORDER_A', 'batch': 1, 'quantity': 1},
                        {'order': 'SHIFT_ORDER_B', 'batch': 1, 'quantity': 1}]}


class ReleaseCaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parents[1] / 'batch-size-search-20261124/batch_size_diagnostics.py'
        spec = importlib.util.spec_from_file_location('release_diagnostics_test', path)
        cls.diagnostics = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.diagnostics)

    def test_cutlets_true_three_minute_conservation_and_precedence(self):
        self.assertNotIn('constraints', cases.cutlets_model())
        result = cases.check_production(cutlets_plan(), cases.cutlets_model(), 3)
        self.assertEqual(result['operation_count'], 6)
        self.assertEqual(result['total_quantity'], 3)
        bad = cutlets_plan(); bad['operations'][4]['start_min'] = 0; bad['operations'][4]['end_min'] = 1
        with self.assertRaisesRegex(cases.RegressionError, 'regression_precedence'):
            cases.check_production(bad, cases.cutlets_model(), 3)

    def test_cutlets_preview_requires_feasibility_but_final_requires_three(self):
        final = cutlets_plan()
        intermediate = copy.deepcopy(final)
        intermediate['operations'][-1].update(start_min=3, end_min=4)
        intermediate['duration_minutes'] = 4
        adapter = types.SimpleNamespace()
        def factory():
            return {'_pp_schedule_sequence': lambda model, sequence: intermediate,
                    'optimize': lambda: final}
        def run(payload, progress):
            adapter._namespace()['optimize']()
            progress({'running': True, 'best_preview': intermediate})
            return final
        adapter._namespace, adapter.run = factory, run
        final_checker = lambda plan, model, unused: cases.check_production(plan, model, 3)
        preview_checker = lambda plan, model, unused: cases.check_production(plan, model)
        _, report = verification.observed_run(adapter, self.diagnostics, cases.cutlets_model(), {},
            checker=final_checker, preview_checker=preview_checker)
        self.assertTrue(report['all_published_previews_feasible'])
        self.assertTrue(report['result']['reached_target'])
        with self.assertRaisesRegex(cases.RegressionError, 'regression_target_duration'):
            final_checker(intermediate, cases.cutlets_model(), None)

    def test_multistage_checker_enforces_every_stage_capacity_and_quantity(self):
        result = cases.check_production(multistage_plan(), cases.multistage_model())
        self.assertEqual(result['order_count'], 2)
        self.assertEqual(result['operation_count'], 10)
        self.assertEqual(result['total_quantity'], 21)
        for mutate in (lambda plan: plan['operations'].pop(),
                       lambda plan: plan['operations'][0].update(equipment_ids=['STAGE1_B']),
                       lambda plan: plan['batches'][0].update(quantity=4),
                       lambda plan: plan['batches'][0].update(quantity=4.5)):
            plan = multistage_plan(); mutate(plan)
            with self.assertRaises(cases.RegressionError):
                cases.check_production(plan, cases.multistage_model())

    def test_every_published_preview_and_fractional_candidate_are_checked(self):
        model = verification.witness_model()
        fractional = example_plan()
        fractional['batches'][0]['quantity'] = 9.5
        fractional['batches'][1]['quantity'] = 5.5
        final = example_plan()
        adapter = types.SimpleNamespace()
        def factory():
            namespace = {}
            namespace['_pp_schedule_sequence'] = lambda candidate, sequence: fractional
            def optimize():
                namespace['_pp_schedule_sequence'](model, ['SYNTHETIC_ORDER'])
                return final
            namespace['optimize'] = optimize
            return namespace
        def run(payload, progress):
            plan = adapter._namespace()['optimize']()
            progress({'running': True, 'percent': 50, 'best_preview': fractional})
            progress({'running': False, 'percent': 100, 'best_preview': plan})
            return plan
        adapter._namespace, adapter.run = factory, run
        _, result = verification.observed_run(adapter, self.diagnostics, model, {})
        self.assertEqual(result['nonintegral_piece_candidate_count'], 1)
        self.assertEqual(result['published_previews_seen'], 2)
        self.assertEqual(result['published_preview_failures'], 1)
        self.assertFalse(result['all_published_previews_feasible'])
        self.assertTrue(result['result']['independent_valid'])

    def test_stop_terminates_on_actual_live_mixed_v2_checkpoint(self):
        plan = example_plan()
        genome = {'version': 1, 'order_sequence': ['SYNTHETIC_ORDER'], 'partitions': [
            {'order_id': 'SYNTHETIC_ORDER', 'sizes': [10, 5, 10, 5]}]}
        plan['order_sequence'] = ['SYNTHETIC_ORDER']
        for index, batch in enumerate(plan['batches'], 1):
            batch['batch'] = index
        plan['resume_state'] = {'version': 2, 'order_sequence': ['SYNTHETIC_ORDER'], 'batch_genome': genome}
        adapter = types.ModuleType('ga_workers.full_runtime_adapter')
        adapter.run = lambda payload, progress: progress({'running': True, 'percent': 42, 'best_preview': plan})
        package = types.ModuleType('ga_workers'); package.__path__ = []
        package.full_runtime_adapter = adapter; package.batch_size_diagnostics = self.diagnostics
        modules = {'ga_workers': package, 'ga_workers.full_runtime_adapter': adapter,
                   'ga_workers.batch_size_diagnostics': self.diagnostics}
        with tempfile.TemporaryDirectory() as temporary, patch.dict(sys.modules, modules), \
             patch.object(verification.os, '_exit', side_effect=SystemExit(0)) as stop:
            output = Path(temporary) / 'checkpoint.json'
            with self.assertRaises(SystemExit):
                verification.stop_checkpoint_child(Path(temporary), output)
            result = json.loads(output.read_text())
            stop.assert_called_once_with(0)
        self.assertEqual(result['status'], 'stopped_at_live_checkpoint')
        self.assertEqual(result['resume_state'], plan['resume_state'])
        self.assertEqual(result['statistics']['preview_failures'], 0)
        self.assertEqual(result['statistics']['v2_checkpoints'], 1)

    def test_multiorder_checkpoint_requires_exact_plan_order_and_partition(self):
        model, plan = cases.multistage_model(), multistage_plan()
        plan['order_sequence'] = ['MULTI_ORDER_A', 'MULTI_ORDER_B']
        gene = {'version': 1, 'order_sequence': list(plan['order_sequence']), 'partitions': [
            {'order_id': 'MULTI_ORDER_A', 'sizes': [5, 5, 2]}, {'order_id': 'MULTI_ORDER_B', 'sizes': [5, 4]}]}
        plan['resume_state'] = {'version': 2, 'order_sequence': list(plan['order_sequence']), 'batch_genome': gene}
        self.assertTrue(verification.checkpoint_genome_matches_plan(plan, model))
        wrong_sizes = copy.deepcopy(plan)
        wrong_sizes['resume_state']['batch_genome']['partitions'][0]['sizes'] = [5, 2, 5]
        self.assertFalse(verification.checkpoint_genome_matches_plan(wrong_sizes, model))
        cached_order = copy.deepcopy(plan)
        cached_order['resume_state']['order_sequence'].reverse()
        cached_order['resume_state']['batch_genome']['order_sequence'].reverse()
        cached_order['resume_state']['batch_genome']['partitions'].reverse()
        self.assertFalse(verification.checkpoint_genome_matches_plan(cached_order, model))

    def test_finite_staff_shift_setup_case_catches_raw_shift_failure(self):
        result = cases.check_staff_setup(staff_plan(), cases.staff_setup_model())
        self.assertTrue(result['staff_windows_resources_and_setup_verified'])
        self.assertTrue(result['staff_shift_repaired'])
        self.assertEqual(result['setup_minutes'], 15)
        invalid = staff_plan()
        invalid['generic_operations'][1].update(start_min=490, end_min=505)
        invalid['generic_operations'][2].update(start_min=505, end_min=515)
        invalid['duration_minutes'] = 515
        with self.assertRaisesRegex(cases.RegressionError, 'staff_setup_shift_violation'):
            cases.check_staff_setup(invalid, cases.staff_setup_model())
        for mutate in (lambda plan: plan['generic_operations'][1].update(end_min=534),
                       lambda plan: plan['generic_operations'][0].update(batch_quantity=2),
                       lambda plan: plan['generic_operations'][0].update(employee_ids=[])):
            invalid = staff_plan(); mutate(invalid)
            with self.assertRaises(cases.RegressionError):
                cases.check_staff_setup(invalid, cases.staff_setup_model())

    def test_staff_setup_separate_and_duplicate_arrays_keep_all_constraints(self):
        plan = staff_plan()
        setup = plan['generic_operations'].pop(1)
        plan['setup_operations'] = [copy.deepcopy(setup)]
        self.assertTrue(cases.check_staff_setup(plan, cases.staff_setup_model())['independent_valid'])
        plan['generic_operations'].insert(1, copy.deepcopy(setup))
        self.assertTrue(cases.check_staff_setup(plan, cases.staff_setup_model())['independent_valid'])
        mismatch = copy.deepcopy(plan)
        mismatch['setup_operations'][0]['start_min'] += 1
        with self.assertRaisesRegex(cases.RegressionError, 'staff_setup_arrays_disagree'):
            cases.check_staff_setup(mismatch, cases.staff_setup_model())
        duplicate = copy.deepcopy(plan)
        duplicate['setup_operations'].append(copy.deepcopy(setup))
        with self.assertRaises(cases.RegressionError):
            cases.check_staff_setup(duplicate, cases.staff_setup_model())

    def test_native_error_chain_exports_only_types_and_known_public_code(self):
        inner = RuntimeError('private-native-source-fragment')
        outer = RuntimeError('private-native-error-value'); outer.__cause__ = inner
        data = verification.failure_metadata(outer)
        self.assertEqual(data, {'error_type': 'RuntimeError', 'causes': [{'error_type': 'RuntimeError'}]})
        self.assertNotIn('private-', json.dumps(data))


if __name__ == '__main__':
    unittest.main()
