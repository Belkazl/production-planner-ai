import copy
import unittest

from cases import CheckError, check, model, schedule_digest
from verify_worker import failure, public_plan


def plan(delayed=False, zero=False):
    staff = ['SYNTHETIC_EMPLOYEE'] if delayed else []
    timings = [('SYNTHETIC_A1', 0, 10), ('SYNTHETIC_A2', 10, 20),
               ('SYNTHETIC_B', 20 if zero else 95 if delayed else 35, 30 if zero else 105 if delayed else 45)]
    production = [{'order': oid, 'operation_id': 'SYNTHETIC_WORK', 'batch': 1, 'batch_quantity': 1,
        'sequence': 1, 'start_min': start, 'end_min': end, 'duration_min': 10,
        'equipment_ids': ['SYNTHETIC_MACHINE'], 'employee_ids': list(staff),
        'materials': [{'id': 'SYNTHETIC_MATERIAL', 'quantity': 1}] if delayed else []}
        for oid, start, end in timings]
    setups = [] if zero else [{'order': 'SYNTHETIC_B', 'operation_id': 'SYNTHETIC_SETUP_AB', 'batch': 1,
        'batch_quantity': 1, 'start_min': 80 if delayed else 20, 'end_min': 95 if delayed else 35,
        'equipment_ids': ['SYNTHETIC_MACHINE'], 'employee_ids': [], 'materials': []}]
    return {'valid': True, 'operations': production, 'setup_operations': setups, 'duration_minutes': timings[-1][2],
            'setup_count': len(setups), 'setup_minutes': len(setups) * 15, 'order_sequence': [x[0] for x in timings]}


class IndependentChecks(unittest.TestCase):
    def test_setup_is_reserved_and_in_makespan(self):
        value = plan()
        checked = check(value, model())
        self.assertEqual(checked['duration_minutes'], 45)
        self.assertEqual(checked['setup_count'], 1)
        missing = copy.deepcopy(value); missing['setup_operations'] = []
        with self.assertRaisesRegex(CheckError, 'required_setup_reservation'):
            check(missing, model())
        shortened = copy.deepcopy(value); shortened['duration_minutes'] = 30
        with self.assertRaisesRegex(CheckError, 'makespan_metric'):
            check(shortened, model())

    def test_delayed_material_is_independent_of_resource_fit(self):
        self.assertTrue(check(plan(delayed=True), model(delayed=True))['valid'])
        bad = plan(delayed=True)
        bad['setup_operations'][0].update(start_min=40, end_min=55)
        bad['operations'][-1].update(start_min=55, end_min=65)
        bad['duration_minutes'] = 65
        with self.assertRaisesRegex(CheckError, 'material_prefix'):
            check(bad, model(delayed=True))

    def test_finite_shift_and_pin_times_are_not_relaxed(self):
        bad = plan(delayed=True)
        bad['setup_operations'][0].update(start_min=20, end_min=35)
        bad['operations'][-1].update(start_min=35, end_min=45)
        bad['duration_minutes'] = 45
        with self.assertRaisesRegex(CheckError, 'staff_shift'):
            check(bad, model(delayed=True))
        value = plan(delayed=True); value['operations'][-1]['manual_locked'] = True
        pin = copy.deepcopy(value['operations'][-1])
        self.assertTrue(check(value, model(delayed=True), [pin])['valid'])
        pin['start_min'] += 1
        with self.assertRaisesRegex(CheckError, 'pin_value'):
            check(value, model(delayed=True), [pin])

    def test_zero_setup_is_legitimate_even_with_setup_rules(self):
        self.assertTrue(model(zero=True)['setup_rules'])
        self.assertEqual(check(plan(zero=True), model(zero=True))['setup_count'], 0)

    def test_separate_and_embedded_same_setup_have_same_schedule(self):
        value = plan(); digest = schedule_digest(value)
        value['generic_operations'] = copy.deepcopy(value['operations']) + [dict(value['setup_operations'][0], is_setup=True)]
        self.assertEqual(schedule_digest(value), digest)
        self.assertTrue(check(value, model())['valid'])
        value['setup_operations'].append(copy.deepcopy(value['setup_operations'][0]))
        with self.assertRaisesRegex(CheckError, 'duplicate_setup_in_array'):
            check(value, model())

    def test_report_does_not_export_native_exception_values(self):
        error = RuntimeError('PRIVATE_RUNTIME_STRING'); error.__cause__ = ValueError('PRIVATE_VALUE')
        data = failure(error, 'native_case')
        self.assertEqual(data['cause_types'], ['ValueError'])
        self.assertNotIn('PRIVATE', str(data))
        value = plan(); value['ctx'] = {'secret': 'PRIVATE_CTX'}
        self.assertNotIn('ctx', public_plan(value))
        self.assertEqual(public_plan(value)['order_sequence'], value['order_sequence'])


if __name__ == '__main__':
    unittest.main()
