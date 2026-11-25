import copy
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cases = load('diagnostic_probe_cases', 'cases.py')
driver = load('diagnostic_probe_driver', 'verify_shift.py')


def plan(later=False):
    offset = 480 if later else 0
    batches, operations = [], []
    for batch, (quantity, start) in enumerate(((30, 0), (185, 60), (185, 245)), 1):
        batches.append({'order': cases.TARGET, 'batch': batch, 'quantity': quantity})
        operations.append({'order': cases.TARGET, 'batch': batch, 'batch_quantity': quantity,
            'operation_id': cases.OPERATION, 'start_min': offset + start, 'end_min': offset + start + quantity,
            'equipment_ids': [cases.MACHINE], 'employee_ids': [cases.EMPLOYEE]})
    return {'ok': True, 'valid': True, 'operations': operations, 'batches': batches,
            'setup_operations': [], 'duration_minutes': offset + 430}


class DriverDiagnosticsTests(unittest.TestCase):
    def test_probe_invariant_failure_identifies_final_result_or_scored_candidate(self):
        for role in ('final_result', 'scored_candidate'):
            with self.subTest(role=role):
                valid, invalid = plan(later=True), plan(later=True)
                invalid['duration_minutes'] = 909
                run = {'result': invalid if role == 'final_result' else valid,
                       'scored': [(None, valid if role == 'final_result' else invalid)]}
                context = {}
                with patch.object(driver, 'observe', return_value=run), self.assertRaises(cases.ShiftCheckError) as raised:
                    driver.window_origin_probe(None, None, cases, context=context)
                detail = driver.failure_detail(raised.exception, 'later_ready', context, cases.ShiftCheckError)
                self.assertEqual(detail['phase'], 'later_ready')
                self.assertEqual(detail['error_code'], 'makespan')
                self.assertEqual(detail['plan_role'], role)
                self.assertEqual(detail['numbers'], {'duration_minutes': 909, 'computed_makespan': 910,
                    'first_start_min': 480, 'active_span': 430, 'origin_minute': 0})
                if role == 'scored_candidate':
                    self.assertEqual(detail['candidate_index'], 0)
                else:
                    self.assertNotIn('candidate_index', detail)

    def test_internal_probe_failure_preserves_completed_main_cases_and_exact_phase(self):
        value = {**dict.fromkeys(driver.CASE_BOOLEAN_FIELDS, True),
            'baseline_duration': 500, 'best_duration': 430, 'target_cut': 30, 'first_cut': 30}
        genome = types.SimpleNamespace(mapping=lambda: {cases.TARGET: (200, 200)})
        previous = {'result': plan(), 'scored': [(genome, {})]}
        for failing_phase in ('later_ready', 'nonzero_origin'):
            report, phase, context = driver.new_report(), ['bootstrap'], {}

            def probe(adapter, joint, check, nonzero_origin=False, context=None, diagnostics=None):
                name = 'nonzero_origin' if nonzero_origin else 'later_ready'
                if name == failing_phase:
                    context.update(plan_role='scored_candidate', candidate_index=7)
                    raise cases.ShiftCheckError('employee_calendar', start_min=119, end_min=149,
                        origin_minute=480, window_start_min=120, window_end_min=150)
                return True, {}

            with self.subTest(phase=failing_phase), patch.object(driver, 'candidate_before', return_value=None), \
                    patch.object(driver, 'observe', return_value=previous), \
                    patch.object(driver, 'run_case', side_effect=lambda *args, **kwargs:
                        (copy.deepcopy(value), {'result': {}}, {}, [])), \
                    patch.object(driver, 'window_origin_probe', side_effect=probe), \
                    self.assertRaises(cases.ShiftCheckError) as raised:
                driver.verify(None, None, '', cases, None, None, report, phase, context)
            self.assertEqual(phase[0], failing_phase)
            self.assertEqual(report['cases'], {name: value for name in driver.CASE_NAMES})
            self.assertFalse(report['all_shift_checks_passed'])
            self.assertEqual(report['internal_windows'], {} if failing_phase == 'later_ready' else {'later_ready': True})
            detail = driver.failure_detail(raised.exception, phase[0], context, cases.ShiftCheckError)
            self.assertEqual(detail['plan_role'], 'scored_candidate')
            self.assertEqual(detail['candidate_index'], 7)

    def test_successful_check_clears_context_and_unknown_errors_never_export_text(self):
        model, pins = cases.fixture('shift_window')
        context = {'plan_role': 'scored_candidate', 'candidate_index': 9}
        driver.check_plan(cases, plan(), model, pins, context=context)
        self.assertEqual(context, {})
        secret = 'PRIVATE_SOURCE_OR_CUSTOMER_VALUE'
        for error in (ValueError(secret), driver.ShiftVerificationError(secret), cases.ShiftCheckError(secret)):
            detail = driver.failure_detail(error, 'nonzero_origin', {}, cases.ShiftCheckError)
            self.assertEqual(detail['error_code'], 'unexpected')
            self.assertNotIn(secret, json.dumps(detail))


if __name__ == '__main__':
    unittest.main()
