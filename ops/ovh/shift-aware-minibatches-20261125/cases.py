"""Small invented cases using the existing public native model/pin schema."""
import collections
from datetime import datetime
import math


CASE_NAMES = ('shift_window', 'lunch_break', 'setup_reservation', 'overnight')
MACHINE = 'SYNTHETIC_SHIFT_MACHINE'
EMPLOYEE = 'SYNTHETIC_SHIFT_EMPLOYEE'
PROCESS = 'SYNTHETIC_SHIFT_PROCESS'
OPERATION = 'SYNTHETIC_SHIFT_WORK'
PRIOR = 'SYNTHETIC_PRIOR'
TARGET = 'SYNTHETIC_TARGET'
EPS = 1e-5
CHECK_CODES = frozenset({'synthetic_plan', 'plan_shape', 'batch_identity', 'batch_totals',
    'quantities', 'operation_identity', 'operation_duration', 'operation_bounds', 'resources',
    'materials', 'employee_calendar', 'overlap', 'pins', 'setup_count', 'setup_duration',
    'setup_order', 'makespan', 'unexpected'})
NUMBER_KEYS = frozenset({'start_min', 'end_min', 'origin_minute', 'window_start_min', 'window_end_min',
    'duration_minutes', 'computed_makespan', 'first_start_min', 'active_span',
    'quantity', 'expected_quantity', 'expected_duration', 'observed_duration',
    'expected_setup', 'setup_count', 'expected_setup_count'})


def safe_numbers(values):
    return {key: value for key, value in values.items() if key in NUMBER_KEYS
            and type(value) in (int, float) and 0 <= value <= 1000000 and math.isfinite(value)}


class ShiftCheckError(ValueError):
    def __init__(self, code='synthetic_plan', **numbers):
        self.code = code if isinstance(code, str) and code in CHECK_CODES else 'unexpected'
        self.numbers = safe_numbers(numbers)
        super().__init__(self.code)


def need(condition, code='synthetic_plan', **numbers):
    if not condition:
        raise ShiftCheckError(code, **numbers)


def number(value, code='synthetic_plan'):
    need(type(value) in (int, float) and math.isfinite(value), code)
    return float(value)


def fixture(name):
    need(name in CASE_NAMES)
    windows, prior, target, offset, setup = {
        'shift_window': ([['00:00', '00:30'], ['01:00', '09:00']], 0, 400, 0, 0),
        'lunch_break': ([['08:00', '12:00'], ['13:00', '17:00']], 210, 200, 480, 0),
        'setup_reservation': ([['00:00', '01:00'], ['02:00', '10:00']], 30, 400, 0, 5),
        'overnight': ([['00:00', '08:00']], 450, 400, 0, 0),
    }[name]
    model = {'scheduler_mode': 'resource', 'quantity_unit': 'шт.',
        'start': '2026-11-25T00:00:00', 'materials': [], 'constraints': [],
        'equipment': [{'id': MACHINE, 'name': 'Invented linear machine', 'kind': 'workstation',
            'capacity': 200, 'capacity_unit': 'шт.',
            'timing_profile': {'timing_mode': 'throughput', 'throughput_per_hour': 60}}],
        'employees': [{'id': EMPLOYEE, 'name': 'Invented operator', 'role': 'operator', 'shift': 'day'}],
        'shifts': {'day': windows}, 'orders': [], 'setup_rules': [],
        'technical_processes': [{'id': PROCESS, 'name': 'Invented linear process', 'operations': [
            {'id': OPERATION, 'name': 'Invented linear work', 'sequence': 1, 'duration_min': 1,
             'setup_parameter': 'color', 'resource_requirements': [
                {'resource_type': kind, 'match_mode': 'specific', 'resource_ref': identifier,
                 'resource_refs': [identifier], 'quantity': 1}
                for kind, identifier in (('equipment', MACHINE), ('employee', EMPLOYEE))]}]}]}
    for oid, quantity, color in ((PRIOR, prior, 'A'), (TARGET, target, 'B' if setup else 'A')):
        if quantity:
            model['orders'].append({'id': oid, 'quantity': quantity, 'unit': 'шт.',
                'technical_process_id': PROCESS, 'parameters': {'color': color}})
    if setup:
        model['setup_rules'] = [{'id': 'SYNTHETIC_SHIFT_SETUP', 'setup_parameter': 'color',
            'equipment_ref': '*', 'from_state': 'A', 'to_state': 'B', 'duration_min': setup}]
    pins, remaining, batch, start = [], prior, 1, offset
    while remaining:
        quantity = min(200, remaining)
        pins.append({'order': PRIOR, 'operation_id': OPERATION, 'batch': batch,
            'batch_quantity': quantity, 'start_min': start, 'end_min': start + quantity,
            'equipment_ids': [MACHINE], 'employee_ids': [EMPLOYEE]})
        remaining -= quantity
        start += quantity
        batch += 1
    return model, pins


def minute(value):
    hour, minutes = value.split(':')
    return int(hour) * 60 + int(minutes)


def intervals(model, days=8):
    origin = datetime.fromisoformat(model['start'])
    offset = origin.hour * 60 + origin.minute + origin.second / 60 + origin.microsecond / 60000000
    return [(day * 1440 + minute(low) - offset, day * 1440 + minute(high) - offset)
            for day in range(days) for low, high in model['shifts']['day']]


def is_setup(row):
    return row.get('is_setup') is True or str(row.get('phase') or row.get('type') or '').lower() == 'setup'


def check(plan, model, pins=(), raw=False):
    need(isinstance(plan, dict) and plan.get('valid') is not False and plan.get('partial') is not True, 'plan_shape')
    if not raw:
        need(plan.get('valid') is True and plan.get('ok') is True, 'plan_shape')
    native = plan.get('operations')
    detached = plan.get('setup_operations') or []
    need(isinstance(native, list) and isinstance(detached, list) and 0 < len(native) <= 128, 'plan_shape')
    need(all(isinstance(row, dict) for row in native + detached), 'plan_shape')
    production = [row for row in native if not is_setup(row)]
    setups = {}
    for row in [item for item in native if is_setup(item)] + detached:
        key = (number(row.get('start_min'), 'setup_duration'), number(row.get('end_min'), 'setup_duration'),
               tuple(row.get('equipment_ids') or []), tuple(row.get('employee_ids') or []))
        setups[key] = row
    batches = plan.get('batches')
    need(isinstance(batches, list) and 0 < len(batches) <= 128, 'plan_shape')
    by_order = {row['id']: row for row in model['orders']}
    quantities, totals = {}, collections.defaultdict(float)
    for row in batches:
        need(isinstance(row, dict), 'plan_shape')
        key = (row.get('order'), row.get('batch', 1))
        quantity = number(row.get('quantity', row.get('area')), 'quantities')
        need(key[0] in by_order and type(key[1]) is int and key[1] >= 1 and key not in quantities, 'batch_identity')
        need(1 <= quantity <= 200 and quantity.is_integer(), 'quantities', quantity=quantity)
        quantities[key] = quantity
        totals[key[0]] += quantity
    need(all(abs(totals[key] - row['quantity']) < EPS for key, row in by_order.items()), 'batch_totals')
    need(len(production) == len(batches), 'batch_identity')
    busy = collections.defaultdict(list)
    calendar = intervals(model)
    origin = datetime.fromisoformat(model['start'])
    origin_minute = origin.hour * 60 + origin.minute + origin.second / 60 + origin.microsecond / 60000000
    observed = set()
    for row in production:
        key = (row.get('order'), row.get('batch', 1))
        need(key in quantities and key not in observed, 'batch_identity')
        observed.add(key)
        start, end = number(row.get('start_min'), 'operation_duration'), number(row.get('end_min'), 'operation_duration')
        need(row.get('operation_id') == OPERATION, 'operation_identity')
        quantity = number(row.get('batch_quantity'), 'quantities')
        need(abs(quantity - quantities[key]) < EPS, 'quantities', quantity=quantity, expected_quantity=quantities[key])
        need(row.get('equipment_ids') == [MACHINE] and row.get('employee_ids') == [EMPLOYEE], 'resources')
        need(abs(end - start - quantities[key]) < EPS, 'operation_duration',
             start_min=start, end_min=end, observed_duration=end - start, expected_duration=quantities[key])
        need(not row.get('materials'), 'materials')
    expected_setup = 5 if model['setup_rules'] else 0
    need(len(setups) == (1 if expected_setup else 0), 'setup_count',
         setup_count=len(setups), expected_setup_count=1 if expected_setup else 0)
    for row in setups.values():
        start, end = number(row.get('start_min'), 'setup_duration'), number(row.get('end_min'), 'setup_duration')
        need(abs(end - start - expected_setup) < EPS, 'setup_duration',
             start_min=start, end_min=end, observed_duration=end - start, expected_setup=expected_setup)
        need(row.get('equipment_ids') == [MACHINE], 'resources')
        need(set(row.get('employee_ids') or []).issubset({EMPLOYEE}), 'resources')
    for row in production + list(setups.values()):
        start, end = number(row.get('start_min'), 'operation_bounds'), number(row.get('end_min'), 'operation_bounds')
        need(start >= 0 and end > start, 'operation_bounds', start_min=start, end_min=end)
        for field, allowed in (('equipment_ids', {MACHINE}), ('employee_ids', {EMPLOYEE})):
            for identifier in row.get(field) or []:
                need(identifier in allowed, 'resources')
                busy[(field, identifier)].append((start, end))
                if field == 'employee_ids':
                    nearest = min(calendar, key=lambda window: max(window[0] - start, start - window[1], 0),
                                  default=(None, None))
                    need(any(start >= low - EPS and end <= high + EPS for low, high in calendar), 'employee_calendar',
                         start_min=start, end_min=end, origin_minute=origin_minute,
                         window_start_min=nearest[0], window_end_min=nearest[1])
    for values in busy.values():
        values.sort()
        need(all(left[1] <= right[0] + EPS for left, right in zip(values, values[1:])), 'overlap')
    for pin in pins:
        found = [row for row in production if row.get('order') == pin['order'] and row.get('batch') == pin['batch']]
        need(len(found) == 1, 'pins')
        row = found[0]
        need(row.get('manual_locked') is True, 'pins')
        for field in ('start_min', 'end_min', 'batch_quantity'):
            need(abs(number(row.get(field), 'pins') - pin[field]) < EPS, 'pins')
        for field in ('equipment_ids', 'employee_ids'):
            need(row.get(field) == pin[field], 'pins')
    if expected_setup:
        last_prior = max(row['end_min'] for row in production if row['order'] == PRIOR)
        first_target = min(row['start_min'] for row in production if row['order'] == TARGET)
        row = next(iter(setups.values()))
        need(row['start_min'] >= last_prior - EPS and row['end_min'] <= first_target + EPS, 'setup_order')
    makespan = max(number(row['end_min'], 'makespan') for row in production + list(setups.values()))
    first_start = min(number(row['start_min'], 'makespan') for row in production + list(setups.values()))
    duration = number(plan.get('duration_minutes'), 'makespan')
    need(abs(duration - makespan) < EPS, 'makespan', duration_minutes=duration,
         computed_makespan=makespan, first_start_min=first_start, active_span=makespan - first_start,
         origin_minute=origin_minute)
    if 'setup_count' in plan:
        need(plan['setup_count'] == len(setups), 'setup_count',
             setup_count=plan['setup_count'], expected_setup_count=len(setups))
    if 'setup_minutes' in plan:
        need(abs(number(plan['setup_minutes'], 'setup_duration') - expected_setup) < EPS, 'setup_duration',
             observed_duration=plan['setup_minutes'], expected_setup=expected_setup)
    return {'native_valid': True, 'independent_valid': True,
            'duration_minutes': makespan, 'first_cut': quantities[(TARGET, 1)]}
