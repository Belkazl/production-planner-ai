"""Public invented models and independent checks; never customer fixtures."""
import collections
import datetime
import hashlib
import json
import math

EPS = 1e-5


class CheckError(ValueError):
    pass


def need(ok, code):
    if not ok:
        raise CheckError(code)


def number(value):
    need(not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value), 'numeric_contract')
    return float(value)


def model(delayed=False, zero=False):
    req = [{'resource_type': 'equipment', 'match_mode': 'specific', 'resource_ref': 'SYNTHETIC_MACHINE',
            'resource_refs': ['SYNTHETIC_MACHINE'], 'quantity': 1, 'unit': 'шт.'}]
    result = {'scheduler_mode': 'resource', 'quantity_unit': 'шт.', 'start': '2026-11-25T00:00:00',
        'equipment': [{'id': 'SYNTHETIC_MACHINE', 'name': 'Synthetic machine', 'kind': 'workstation',
                       'capacity': 1, 'capacity_unit': 'шт.',
                       'timing_profile': {'timing_mode': 'fixed', 'duration_min': 10}}],
        'orders': [{'id': oid, 'quantity': 1, 'unit': 'шт.', 'technical_process_id': 'SYNTHETIC_PROCESS',
                    'parameters': {'color': color}} for oid, color in (
                        ('SYNTHETIC_A1', 'A'), ('SYNTHETIC_B', 'A' if zero else 'B'), ('SYNTHETIC_A2', 'A'))],
        'employees': [], 'materials': [], 'shifts': {}, 'constraints': [],
        'setup_rules': [{'id': 'SYNTHETIC_SETUP_' + a + b, 'setup_parameter': 'color', 'equipment_ref': '*',
                         'from_state': a, 'to_state': b, 'duration_min': 15} for a, b in (('A', 'B'), ('B', 'A'))],
        'technical_processes': [{'id': 'SYNTHETIC_PROCESS', 'name': 'Synthetic setup process', 'operations': [
            {'id': 'SYNTHETIC_WORK', 'name': 'Synthetic work', 'sequence': 1, 'duration_min': 10,
             'setup_parameter': 'color', 'resource_requirements': req}]}]}
    if delayed:
        result['employees'] = [{'id': 'SYNTHETIC_EMPLOYEE', 'name': 'Synthetic employee', 'role': 'operator', 'shift': 'day'}]
        result['shifts'] = {'day': [['00:00', '00:25'], ['00:40', '04:00']]}
        result['materials'] = [{'id': 'SYNTHETIC_MATERIAL', 'name': 'Synthetic material', 'unit': 'шт.',
                                'initial_stock': 2, 'deliveries': [{'at': '2026-11-25T01:20:00', 'quantity': 1}]}]
        req.extend([
            {'resource_type': 'employee', 'match_mode': 'specific', 'resource_ref': 'SYNTHETIC_EMPLOYEE',
             'resource_refs': ['SYNTHETIC_EMPLOYEE'], 'quantity': 1},
            {'resource_type': 'material', 'match_mode': 'specific', 'resource_ref': 'SYNTHETIC_MATERIAL',
             'resource_refs': ['SYNTHETIC_MATERIAL'], 'quantity': 1, 'consumption_rule': 'per_unit', 'unit': 'шт.'}])
    return result


def is_setup(row):
    return row.get('is_setup') is True or str(row.get('phase') or row.get('type') or '').lower() == 'setup'


def row_key(row, setup=False):
    """Protect scheduling facts; allow harmless presentation labels to differ."""
    return (bool(setup or is_setup(row)), str(row.get('order')), str(row.get('operation_id')),
            row.get('batch'), row.get('batch_quantity'), number(row['start_min']), number(row['end_min']),
            tuple(sorted(map(str, row.get('equipment_ids') or []))),
            tuple(sorted(map(str, row.get('employee_ids') or []))),
            tuple(sorted((str(m.get('id')), number(m.get('quantity', 0))) for m in row.get('materials') or [])),
            row.get('manual_locked') is True)


def rows(plan):
    native, generic, detached = (plan.get(k) or [] for k in ('operations', 'generic_operations', 'setup_operations'))
    need(all(isinstance(a, list) and all(isinstance(x, dict) for x in a) for a in (native, generic, detached)), 'row_arrays')
    primary = native or generic
    production = [x for x in primary if not is_setup(x)]
    if native and generic:
        need(sorted((row_key(x) for x in native if not is_setup(x)), key=repr)
             == sorted((row_key(x) for x in generic if not is_setup(x)), key=repr), 'production_arrays_disagree')
    setups = {}
    for array in (native, generic, detached):
        seen = set()
        for row in array:
            if array is not detached and not is_setup(row):
                continue
            key = row_key(row, True)
            need(key not in seen, 'duplicate_setup_in_array')
            seen.add(key)
            setups[key] = row
    need(production, 'production_missing')
    return production, list(setups.values())


def schedule_digest(plan):
    production, setups = rows(plan)
    projection = sorted([row_key(row) for row in production] + [row_key(row, True) for row in setups], key=repr)
    return hashlib.sha256(json.dumps(projection, separators=(',', ':'), ensure_ascii=True).encode()).hexdigest()


def check(plan, source_model, pins=(), raw=False):
    need(isinstance(plan, dict) and plan.get('valid') is not False and plan.get('partial') is not True, 'plan_invalid')
    if not raw:
        need(plan.get('valid') is True, 'plan_not_verified')
    production, setups = rows(plan)
    orders = {str(x['id']): x for x in source_model['orders']}
    need(len(production) == 3 and {str(x.get('order')) for x in production} == set(orders), 'production_coverage')
    equipment = {str(x['id']): x for x in source_model['equipment']}
    staff = {str(x['id']): x for x in source_model['employees']}
    expected_staff = sorted(staff)
    busy = collections.defaultdict(list)
    origin = datetime.datetime.fromisoformat(source_model['start'])
    consumption = []
    for row in production:
        need(row.get('operation_id') == 'SYNTHETIC_WORK' and number(row.get('batch_quantity')) == 1, 'quantity_or_operation')
        need(row.get('batch') == 1, 'batch_identity')
        need(sorted(row.get('employee_ids') or []) == expected_staff, 'employee_assignment')
        material = row.get('materials') or []
        if source_model['materials']:
            need(len(material) == 1 and material[0].get('id') == 'SYNTHETIC_MATERIAL'
                 and number(material[0].get('quantity')) == 1, 'material_quantity')
            consumption.append((number(row['start_min']), 1, -1.0))
        else:
            need(not material, 'unexpected_material')
    for row in production + setups:
        start, end = number(row.get('start_min')), number(row.get('end_min'))
        need(start >= 0 and end > start, 'interval')
        need(abs(end - start - (15 if row in setups else 10)) < EPS, 'duration')
        need(row.get('equipment_ids') == ['SYNTHETIC_MACHINE'], 'equipment_assignment')
        for key, owned in (('equipment_ids', equipment), ('employee_ids', staff)):
            for rid in row.get(key) or []:
                need(str(rid) in owned, 'foreign_resource')
                busy[(key, str(rid))].append((start, end))
                if key == 'employee_ids':
                    day = math.floor(start / 1440)
                    need(any(start >= day * 1440 + a - EPS and end <= day * 1440 + b + EPS
                             for a, b in ((0, 25), (40, 240))), 'staff_shift')
    for intervals in busy.values():
        intervals.sort()
        need(all(a[1] <= b[0] + EPS for a, b in zip(intervals, intervals[1:])), 'resource_overlap')
    ordered = sorted(production, key=lambda row: number(row['start_min']))
    matched = set()
    for first, second in zip(ordered, ordered[1:]):
        before = orders[str(first['order'])]['parameters']['color']
        after = orders[str(second['order'])]['parameters']['color']
        if before == after:
            continue
        fits = [i for i, row in enumerate(setups) if number(row['start_min']) >= number(first['end_min']) - EPS
                and number(row['end_min']) <= number(second['start_min']) + EPS]
        need(len(fits) == 1 and fits[0] not in matched, 'required_setup_reservation')
        matched.add(fits[0])
    need(len(matched) == len(setups), 'extra_setup')
    if source_model['materials']:
        material = source_model['materials'][0]
        stock = number(material['initial_stock'])
        events = list(consumption)
        for delivery in material['deliveries']:
            minute = (datetime.datetime.fromisoformat(delivery['at']) - origin).total_seconds() / 60
            events.append((minute, 0, number(delivery['quantity'])))
        for _, _, delta in sorted(events):
            stock += delta
            need(stock >= -EPS, 'material_prefix')
    makespan = max(number(row['end_min']) for row in production + setups)
    need(abs(number(plan.get('duration_minutes')) - makespan) < EPS, 'makespan_metric')
    for field in ('setup_count', 'setup_operation_count'):
        if field in plan:
            need(number(plan[field]) == len(setups), 'setup_count_metric')
    if 'setup_minutes' in plan:
        need(abs(number(plan['setup_minutes']) - 15 * len(setups)) < EPS, 'setup_minutes_metric')
    for pin in pins:
        matches = [r for r in production if str(r['order']) == str(pin['order'])
                   and r['operation_id'] == pin['operation_id'] and r['batch'] == pin['batch']]
        need(len(matches) == 1, 'pin_identity')
        selected = matches[0]
        for field in ('start_min', 'end_min', 'batch_quantity'):
            need(abs(number(selected[field]) - number(pin[field])) < EPS, 'pin_value')
        for field in ('equipment_ids', 'employee_ids'):
            need(sorted(selected.get(field) or []) == sorted(pin.get(field) or []), 'pin_resource')
        need(selected.get('manual_locked') is True, 'pin_marker')
    return {'valid': True, 'production_count': 3, 'setup_count': len(setups),
            'duration_minutes': makespan, 'setup_minutes': len(setups) * 15,
            'quantity': 3, 'schedule_sha256': schedule_digest(plan)}
