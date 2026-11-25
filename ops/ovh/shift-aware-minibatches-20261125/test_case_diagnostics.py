"""Invariant diagnostics on invented plans; no native runtime or private inputs."""
import copy
import importlib.util
from pathlib import Path
import unittest


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('shift_invariant_cases', HERE / 'cases.py')
cases = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cases)


def operation(order, batch, quantity, start, locked=False):
    return {'order': order, 'batch': batch, 'batch_quantity': quantity,
        'operation_id': cases.OPERATION, 'start_min': start, 'end_min': start + quantity,
        'equipment_ids': [cases.MACHINE], 'employee_ids': [cases.EMPLOYEE],
        **({'manual_locked': True} if locked else {})}


def plan_for(rows, setups=()):
    return {'ok': True, 'valid': True, 'operations': rows,
        'batches': [{'order': row['order'], 'batch': row['batch'], 'quantity': row['batch_quantity']}
                    for row in rows],
        'setup_operations': list(setups),
        'duration_minutes': max(row['end_min'] for row in rows + list(setups)),
        'setup_count': len(setups),
        'setup_minutes': sum(row['end_min'] - row['start_min'] for row in setups)}


def nonzero_fixture():
    model, pins = cases.fixture('shift_window')
    model['start'] = '2026-11-25T08:00:00'
    model['shifts'] = {'day': [['10:00', '10:30'], ['11:00', '19:00']]}
    rows = [operation(cases.TARGET, index, quantity, start)
            for index, (quantity, start) in enumerate(((30, 120), (185, 180), (185, 365)), 1)]
    return plan_for(rows), model, pins


def setup_fixture():
    model, pins = cases.fixture('setup_reservation')
    rows = [operation(cases.PRIOR, 1, 30, 0, locked=True)]
    rows += [operation(cases.TARGET, index, quantity, start)
             for index, (quantity, start) in enumerate(((25, 35), (200, 120), (175, 320)), 1)]
    setups = [{'is_setup': True, 'phase': 'setup', 'operation_id': '__setup__',
        'start_min': 30, 'end_min': 35,
        'equipment_ids': [cases.MACHINE], 'employee_ids': [cases.EMPLOYEE]}]
    return plan_for(rows, setups), model, pins


class InvariantDiagnosticTests(unittest.TestCase):
    def assert_code(self, code, plan, model, pins=(), **options):
        with self.assertRaises(cases.ShiftCheckError) as raised:
            cases.check(plan, model, pins, **options)
        self.assertEqual(raised.exception.code, code)
        self.assertEqual(str(raised.exception), code)
        self.assertIn(code, cases.CHECK_CODES)
        return raised.exception

    def test_invented_reference_plans_pass_before_mutation(self):
        for build, expected in ((nonzero_fixture, 550), (setup_fixture, 495)):
            with self.subTest(fixture=build.__name__):
                plan, model, pins = build()
                facts = cases.check(plan, model, pins)
                self.assertIs(facts['native_valid'], True)
                self.assertIs(facts['independent_valid'], True)
                self.assertEqual(facts['duration_minutes'], expected)
                self.assertEqual(cases.check(plan, model, pins, raw=True), facts)

    def test_plan_shape_rejections_have_a_fixed_code(self):
        plan, model, pins = nonzero_fixture()
        for bad in (None, {}, dict(plan, partial=True), dict(plan, valid=False),
                    dict(plan, operations='PRIVATE_SENTINEL'), dict(plan, batches=[])):
            with self.subTest(kind=type(bad).__name__):
                self.assert_code('plan_shape', bad, model, pins)

    def test_batch_identity_totals_and_quantities_remain_separate(self):
        plan, model, pins = nonzero_fixture()
        duplicate = copy.deepcopy(plan)
        duplicate['batches'][1]['batch'] = 1
        self.assert_code('batch_identity', duplicate, model, pins)
        missing_quantity = copy.deepcopy(plan)
        missing_quantity['batches'][0]['quantity'] = 29
        self.assert_code('batch_totals', missing_quantity, model, pins)
        noninteger = copy.deepcopy(plan)
        noninteger['batches'][0]['quantity'] = 30.5
        self.assert_code('quantities', noninteger, model, pins)
        wrong_operation_quantity = copy.deepcopy(plan)
        wrong_operation_quantity['operations'][0]['batch_quantity'] = 29
        self.assert_code('quantities', wrong_operation_quantity, model, pins)

    def test_operation_identity_duration_bounds_resources_and_materials(self):
        plan, model, pins = nonzero_fixture()
        changes = (
            ('operation_identity', {'operation_id': 'INVENTED_UNKNOWN_OPERATION'}),
            ('operation_duration', {'end_min': 149}),
            ('operation_bounds', {'start_min': -1, 'end_min': 29}),
            ('resources', {'equipment_ids': ['INVENTED_UNKNOWN_MACHINE']}),
            ('materials', {'materials': ['INVENTED_UNEXPECTED_MATERIAL']}),
        )
        for code, fields in changes:
            with self.subTest(code=code):
                changed = copy.deepcopy(plan)
                changed['operations'][0].update(fields)
                self.assert_code(code, changed, model, pins)

    def test_employee_calendar_uses_relative_origin_and_emits_bounded_numbers(self):
        plan, model, pins = nonzero_fixture()
        plan['operations'][0].update(start_min=119, end_min=149)
        error = self.assert_code('employee_calendar', plan, model, pins)
        self.assertEqual(error.numbers, {'start_min': 119, 'end_min': 149, 'origin_minute': 480,
                                        'window_start_min': 120, 'window_end_min': 150})

    def test_overlap_is_rejected_after_individual_calendar_checks(self):
        plan, model, pins = nonzero_fixture()
        plan['operations'][2].update(start_min=364, end_min=549)
        self.assert_code('overlap', plan, model, pins)

    def test_pinned_lock_and_exact_timing_are_still_required(self):
        plan, model, pins = setup_fixture()
        unlocked = copy.deepcopy(plan)
        del unlocked['operations'][0]['manual_locked']
        self.assert_code('pins', unlocked, model, pins)
        wrong_pin = copy.deepcopy(pins)
        wrong_pin[0]['end_min'] += 1
        self.assert_code('pins', plan, model, wrong_pin)

    def test_setup_count_duration_and_order_remain_mandatory(self):
        plan, model, pins = setup_fixture()
        no_setup = copy.deepcopy(plan)
        no_setup['setup_operations'] = []
        self.assert_code('setup_count', no_setup, model, pins)
        wrong_duration = copy.deepcopy(plan)
        wrong_duration['setup_operations'][0]['end_min'] = 34
        self.assert_code('setup_duration', wrong_duration, model, pins)
        late_setup = copy.deepcopy(plan)
        late_setup['setup_operations'][0].update(start_min=500, end_min=505)
        self.assert_code('setup_order', late_setup, model, pins)
        self.assert_code('setup_count', dict(plan, setup_count=2), model, pins)
        self.assert_code('setup_duration', dict(plan, setup_minutes=4), model, pins)

    def test_makespan_reports_the_origin_and_span_without_changing_the_assertion(self):
        plan, model, pins = nonzero_fixture()
        plan['duration_minutes'] = 549
        error = self.assert_code('makespan', plan, model, pins)
        self.assertEqual(error.numbers, {'duration_minutes': 549, 'computed_makespan': 550,
                                        'first_start_min': 120, 'active_span': 430, 'origin_minute': 480})

    def test_unknown_codes_and_nonfinite_numbers_cannot_become_error_text(self):
        sentinel = 'PRIVATE_CODE_INPUT_SENTINEL'
        with self.assertRaises(cases.ShiftCheckError) as raised:
            cases.need(False, sentinel)
        self.assertEqual(raised.exception.code, 'unexpected')
        self.assertEqual(str(raised.exception), 'unexpected')
        self.assertNotIn(sentinel, str(raised.exception))
        for value in (True, float('nan'), float('inf'), sentinel):
            with self.subTest(kind=type(value).__name__), self.assertRaises(cases.ShiftCheckError) as raised:
                cases.number(value, 'quantities')
            self.assertEqual(raised.exception.code, 'quantities')
            self.assertEqual(str(raised.exception), 'quantities')


if __name__ == '__main__':
    unittest.main()
