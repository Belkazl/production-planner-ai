"""Full safe failure-report path using only invented checker exceptions and reports."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import contract
import container_gate
import verify


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SHIFT = HERE.parent / 'shift-aware-minibatches-20261125'
cases = load('shift_failure_diagnostic_cases', SHIFT / 'cases.py')
shift_verify = load('shift_failure_diagnostic_verifier', SHIFT / 'verify_shift.py')
SENTINEL = 'PRIVATE_MODEL_SOURCE_EXCEPTION_SENTINEL'


def completed_cases():
    return {name: {**dict.fromkeys(contract.SHIFT_CASE_CHECKS, True),
        'baseline_duration': 500, 'best_duration': 470,
        'target_cut': 25 if name == 'setup_reservation' else 30,
        'first_cut': 25 if name == 'setup_reservation' else 30}
        for name in contract.SHIFT_CASES}


def failed_report(detail):
    report = shift_verify.new_report()
    report.update(exact_module_installed=True, cases=completed_cases(), failure=detail,
                  internal_windows={'later_ready': True, 'nonzero_origin': False})
    return report


def failure_roundtrip(report, tamper_after_gate=None):
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        # Deliberately permit nonfinite values in an injected input report;
        # both downstream boundaries must remove them before public output.
        (root / 'shift-report.json').write_text(json.dumps(report))
        with patch.object(container_gate, 'OUT', root):
            container_gate.failure('native_shift_aware')
        path = root / 'failure-report.json'
        first = json.loads(path.read_bytes())
        if tamper_after_gate is not None:
            changed = copy.deepcopy(first)
            tamper_after_gate(changed)
            path.write_text(json.dumps(changed))
        final = verify.safe_failure(path)
    return first, final


class FailureDiagnosticTests(unittest.TestCase):
    def test_phase_code_context_numbers_and_completed_cases_survive_every_hop(self):
        examples = (
            ('later_ready', 'employee_calendar', {'plan_role': 'final_result'},
             {'start_min': 479, 'end_min': 509, 'origin_minute': 0,
              'window_start_min': 480, 'window_end_min': 510}),
            ('nonzero_origin', 'makespan', {'plan_role': 'scored_candidate', 'candidate_index': 63},
             {'duration_minutes': 430, 'computed_makespan': 550, 'first_start_min': 120,
              'active_span': 430, 'origin_minute': 480}),
        )
        for phase, code, context, numbers in examples:
            with self.subTest(phase=phase):
                error = cases.ShiftCheckError(code, **numbers)
                detail = shift_verify.failure_detail(error, phase, context, cases.ShiftCheckError)
                expected = {'phase': phase, 'error_type': 'ShiftCheckError', 'error_code': code,
                            **context, 'numbers': numbers}
                self.assertEqual(detail, expected)
                first, final = failure_roundtrip(failed_report(detail))
                self.assertEqual(first['native_detail'], expected)
                self.assertEqual(final['native_detail'], expected)
                self.assertEqual(final['case_results'], completed_cases())
                self.assertEqual(set(final['case_results']), set(contract.SHIFT_CASES))
                self.assertEqual(final['probe_results'], {'later_ready': True, 'nonzero_origin': False})
                self.assertEqual(final['failed_cases'], [])
                self.assertIn('all_shift_checks_passed', final['failed_checks'])

    def test_each_boundary_strips_unknown_text_and_invalid_numbers_independently(self):
        invalid = {'start_min': float('nan'), 'end_min': -1, 'origin_minute': True,
            'duration_minutes': 1000001, 'active_span': float('inf'),
            'quantity': SENTINEL, 'PRIVATE_NUMBER_KEY': 123}
        numbers = {'computed_makespan': 1000000, **invalid}
        error = cases.ShiftCheckError('makespan', **numbers)
        self.assertEqual(error.numbers, {'computed_makespan': 1000000})
        # Reintroduce unsafe values after the checker, then verify the producer
        # also enforces its own output allowlist.
        error.numbers.update(invalid)
        detail = shift_verify.failure_detail(error, 'nonzero_origin',
            {'plan_role': 'scored_candidate', 'candidate_index': 0, 'model': SENTINEL}, cases.ShiftCheckError)
        self.assertEqual(detail['numbers'], {'computed_makespan': 1000000})
        detail.update(message=SENTINEL, source=SENTINEL, error_type=SENTINEL)
        detail['numbers'].update(invalid)
        report = failed_report(detail)
        report['private_model'] = SENTINEL
        report['cases']['shift_window']['source'] = SENTINEL

        def tamper(value):
            value['private_source'] = SENTINEL
            value['native_detail'].update(message=SENTINEL, error_type=SENTINEL)
            value['native_detail']['numbers'].update(invalid)

        first, final = failure_roundtrip(report, tamper)
        for value in (first, final):
            self.assertEqual(value['native_detail']['numbers'], {'computed_makespan': 1000000})
            self.assertEqual(value['native_detail']['error_type'], 'Exception')
            encoded = json.dumps(value, allow_nan=False)
            self.assertNotIn(SENTINEL, encoded)
            self.assertNotIn('PRIVATE_NUMBER_KEY', encoded)
            self.assertNotIn('private_source', value)

    def test_unknown_phases_codes_roles_and_unbounded_indices_are_not_exported(self):
        error = cases.ShiftCheckError('makespan', computed_makespan=550)
        detail = shift_verify.failure_detail(error, 'nonzero_origin',
            {'plan_role': 'scored_candidate', 'candidate_index': 17}, cases.ShiftCheckError)
        for field in ('phase', 'error_code'):
            with self.subTest(field=field):
                bad = dict(detail, **{field: SENTINEL})
                first, final = failure_roundtrip(failed_report(bad))
                self.assertNotIn('native_detail', first)
                self.assertNotIn('native_detail', final)
                _, final = failure_roundtrip(failed_report(detail),
                    lambda value: value.update(native_detail=bad))
                self.assertNotIn('native_detail', final)
                self.assertNotIn(SENTINEL, json.dumps(final))
        for index in (-1, 64, 1000000000, True, 0.5, SENTINEL):
            with self.subTest(index_type=type(index).__name__, index=index):
                bad = dict(detail, candidate_index=index)
                first, final = failure_roundtrip(failed_report(bad))
                for value in (first, final):
                    self.assertNotIn('plan_role', value['native_detail'])
                    self.assertNotIn('candidate_index', value['native_detail'])
                produced = shift_verify.failure_detail(error, 'nonzero_origin',
                    {'plan_role': 'scored_candidate', 'candidate_index': index}, cases.ShiftCheckError)
                self.assertNotIn('plan_role', produced)
                self.assertNotIn('candidate_index', produced)
        error.code = SENTINEL
        produced = shift_verify.failure_detail(error, SENTINEL, {'plan_role': SENTINEL}, cases.ShiftCheckError)
        self.assertEqual(produced['phase'], 'bootstrap')
        self.assertEqual(produced['error_code'], 'unexpected')
        self.assertNotIn('plan_role', produced)
        self.assertNotIn(SENTINEL, json.dumps(produced))

    def test_partial_case_and_probe_evidence_is_preserved_only_with_fixed_types(self):
        detail = shift_verify.failure_detail(cases.ShiftCheckError('employee_calendar'),
            'nonzero_origin', {'plan_role': 'final_result'}, cases.ShiftCheckError)
        report = failed_report(detail)
        report['internal_windows'] = {'later_ready': True, SENTINEL: True}
        first, final = failure_roundtrip(report)
        self.assertEqual(final['case_results'], completed_cases())
        self.assertEqual(final['probe_results'], {'later_ready': True})
        for bad in (float('nan'), -1, 1000001, True, SENTINEL):
            with self.subTest(kind=type(bad).__name__):
                changed = copy.deepcopy(report)
                changed['cases']['shift_window']['baseline_duration'] = bad
                changed['cases']['lunch_break']['native_valid'] = SENTINEL
                changed['cases']['setup_reservation']['source'] = SENTINEL
                changed['cases'][SENTINEL] = completed_cases()['overnight']
                changed['internal_windows']['nonzero_origin'] = 1
                first, final = failure_roundtrip(changed)
                for value in (first, final):
                    self.assertEqual(set(value['case_results']), {'setup_reservation', 'overnight'})
                    self.assertEqual(value['case_results']['setup_reservation'], completed_cases()['setup_reservation'])
                    self.assertEqual(value['probe_results'], {'later_ready': True})
                    self.assertNotIn(SENTINEL, json.dumps(value, allow_nan=False))

    def test_producer_consumer_allowlists_match_and_exception_messages_never_escape(self):
        self.assertEqual(set(shift_verify.FAILURE_PHASES), set(contract.SHIFT_FAILURE_PHASES))
        self.assertEqual(shift_verify.ERROR_CODES, set(contract.SHIFT_FAILURE_CODES))
        self.assertTrue(cases.CHECK_CODES.issubset(shift_verify.ERROR_CODES))
        self.assertEqual(cases.NUMBER_KEYS, shift_verify.ERROR_NUMBER_KEYS)
        self.assertEqual(cases.NUMBER_KEYS, set(contract.SHIFT_FAILURE_NUMBER_KEYS))
        self.assertEqual(set(shift_verify.CASE_NAMES), set(contract.SHIFT_CASES))
        self.assertEqual(set(shift_verify.CASE_BOOLEAN_FIELDS), set(contract.SHIFT_CASE_CHECKS))
        self.assertEqual(set(shift_verify.CASE_NUMBER_FIELDS), set(contract.SHIFT_CASE_NUMBERS))
        hidden_type = type(SENTINEL, (Exception,), {})
        for error, expected_type in ((ValueError(SENTINEL), 'ValueError'), (hidden_type(SENTINEL), 'Exception')):
            with self.subTest(error_type=expected_type):
                detail = shift_verify.failure_detail(error, 'later_ready', {}, cases.ShiftCheckError)
                self.assertEqual(detail, {'phase': 'later_ready', 'error_type': expected_type, 'error_code': 'unexpected'})
                _, final = failure_roundtrip(failed_report(detail))
                self.assertNotIn(SENTINEL, json.dumps(final))


if __name__ == '__main__':
    unittest.main()
