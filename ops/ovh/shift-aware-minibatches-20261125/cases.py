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


class ShiftCheckError(ValueError):
    pass


def need(condition, code='synthetic_plan'):
    if not condition:
        raise ShiftCheckError(code)


def number(value):
    need(type(value) in (int, float) and math.isfinite(value))
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
    need(isinstance(plan, dict) and plan.get('valid') is not False and plan.get('partial') is not True)
    if not raw:
        need(plan.get('valid') is True and plan.get('ok') is True)
    native = plan.get('operations')
    detached = plan.get('setup_operations') or []
    need(isinstance(native, list) and isinstance(detached, list) and 0 < len(native) <= 128)
    need(all(isinstance(row, dict) for row in native + detached))
    production = [row for row in native if not is_setup(row)]
    setups = {}
    for row in [item for item in native if is_setup(item)] + detached:
        key = (number(row.get('start_min')), number(row.get('end_min')),
               tuple(row.get('equipment_ids') or []), tuple(row.get('employee_ids') or []))
        setups[key] = row
    batches = plan.get('batches')
    need(isinstance(batches, list) and 0 < len(batches) <= 128)
    by_order = {row['id']: row for row in model['orders']}
    quantities, totals = {}, collections.defaultdict(float)
    for row in batches:
        key = (row.get('order'), row.get('batch', 1))
        quantity = number(row.get('quantity', row.get('area')))
        need(key[0] in by_order and type(key[1]) is int and key[1] >= 1 and key not in quantities)
        need(1 <= quantity <= 200 and quantity.is_integer())
        quantities[key] = quantity
        totals[key[0]] += quantity
    need(all(abs(totals[key] - row['quantity']) < EPS for key, row in by_order.items()))
    need(len(production) == len(batches))
    busy = collections.defaultdict(list)
    calendar = intervals(model)
    observed = set()
    for row in production:
        key = (row.get('order'), row.get('batch', 1))
        need(key in quantities and key not in observed)
        observed.add(key)
        start, end = number(row.get('start_min')), number(row.get('end_min'))
        need(row.get('operation_id') == OPERATION and abs(number(row.get('batch_quantity')) - quantities[key]) < EPS)
        need(row.get('equipment_ids') == [MACHINE] and row.get('employee_ids') == [EMPLOYEE])
        need(abs(end - start - quantities[key]) < EPS and not row.get('materials'))
    expected_setup = 5 if model['setup_rules'] else 0
    need(len(setups) == (1 if expected_setup else 0))
    for row in setups.values():
        need(abs(number(row.get('end_min')) - number(row.get('start_min')) - expected_setup) < EPS)
        need(row.get('equipment_ids') == [MACHINE])
        need(set(row.get('employee_ids') or []).issubset({EMPLOYEE}))
    for row in production + list(setups.values()):
        start, end = number(row.get('start_min')), number(row.get('end_min'))
        need(start >= 0 and end > start)
        for field, allowed in (('equipment_ids', {MACHINE}), ('employee_ids', {EMPLOYEE})):
            for identifier in row.get(field) or []:
                need(identifier in allowed)
                busy[(field, identifier)].append((start, end))
                if field == 'employee_ids':
                    need(any(start >= low - EPS and end <= high + EPS for low, high in calendar))
    for values in busy.values():
        values.sort()
        need(all(left[1] <= right[0] + EPS for left, right in zip(values, values[1:])))
    for pin in pins:
        found = [row for row in production if row.get('order') == pin['order'] and row.get('batch') == pin['batch']]
        need(len(found) == 1)
        row = found[0]
        need(row.get('manual_locked') is True)
        for field in ('start_min', 'end_min', 'batch_quantity'):
            need(abs(number(row.get(field)) - pin[field]) < EPS)
        for field in ('equipment_ids', 'employee_ids'):
            need(row.get(field) == pin[field])
    if expected_setup:
        last_prior = max(row['end_min'] for row in production if row['order'] == PRIOR)
        first_target = min(row['start_min'] for row in production if row['order'] == TARGET)
        row = next(iter(setups.values()))
        need(row['start_min'] >= last_prior - EPS and row['end_min'] <= first_target + EPS)
    makespan = max(number(row['end_min']) for row in production + list(setups.values()))
    need(abs(number(plan.get('duration_minutes')) - makespan) < EPS)
    if 'setup_count' in plan:
        need(plan['setup_count'] == len(setups))
    if 'setup_minutes' in plan:
        need(abs(number(plan['setup_minutes']) - expected_setup) < EPS)
    return {'native_valid': True, 'independent_valid': True,
            'duration_minutes': makespan, 'first_cut': quantities[(TARGET, 1)]}
