"""Invented small models and independent checks for the native release gate."""
import math


class RegressionError(Exception):
    pass


def finite(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise RegressionError('regression_numeric_contract')
    return float(value)


def operation(oid, sequence, duration, kind):
    return {'id': oid, 'name': oid, 'sequence': sequence, 'duration_min': duration,
        'resource_requirements': [{'resource_type': 'equipment', 'match_mode': 'any',
            'resource_ref': 'kind:' + kind, 'quantity': 1, 'unit': 'шт.', 'consumption_rule': 'during_operation'}]}


def base_model():
    return {'scheduler_mode': 'resource', 'quantity_unit': 'шт.', 'start': '2026-11-24T08:00:00',
            'employees': [], 'materials': [], 'setup_rules': [], 'shifts': {}, 'constraints': []}


def cutlets_model():
    model = base_model()
    # Match the established pure-operation contract. Empty unknown constraint
    # fields intentionally disable the conservative interleave adapter.
    model.pop('constraints')
    model['equipment'] = [{'id': 'PAN_SLOT_' + str(i), 'name': 'Synthetic pan slot ' + str(i),
        'kind': 'synthetic_pan', 'capacity': 1, 'capacity_unit': 'шт.'} for i in (1, 2)]
    model['orders'] = [{'id': 'CUTLET_' + str(i), 'quantity': 1, 'unit': 'шт.',
                        'technical_process_id': 'CUTLET_PROCESS'} for i in (1, 2, 3)]
    model['technical_processes'] = [{'id': 'CUTLET_PROCESS', 'name': 'Synthetic two-sided operation',
        'operations': [operation('SIDE_A', 1, 1, 'synthetic_pan'), operation('SIDE_B', 2, 1, 'synthetic_pan')]}]
    return model


def multistage_model():
    model = base_model()
    model['equipment'] = [
        {'id': 'STAGE1_A', 'name': 'Synthetic first stage A', 'kind': 'synthetic_stage1', 'capacity': 5, 'capacity_unit': 'шт.'},
        {'id': 'STAGE1_B', 'name': 'Synthetic first stage B', 'kind': 'synthetic_stage1', 'capacity': 3, 'capacity_unit': 'шт.'},
        {'id': 'STAGE2_A', 'name': 'Synthetic second stage A', 'kind': 'synthetic_stage2', 'capacity': 6, 'capacity_unit': 'шт.'},
        {'id': 'STAGE2_B', 'name': 'Synthetic second stage B', 'kind': 'synthetic_stage2', 'capacity': 3, 'capacity_unit': 'шт.'},
    ]
    model['orders'] = [{'id': 'MULTI_ORDER_A', 'quantity': 12, 'unit': 'шт.', 'technical_process_id': 'MULTI_PROCESS'},
                       {'id': 'MULTI_ORDER_B', 'quantity': 9, 'unit': 'шт.', 'technical_process_id': 'MULTI_PROCESS'}]
    model['technical_processes'] = [{'id': 'MULTI_PROCESS', 'name': 'Invented two-stage process',
        'operations': [operation('STEP_1', 1, 2, 'synthetic_stage1'), operation('STEP_2', 2, 4, 'synthetic_stage2')]}]
    return model


def staff_setup_model():
    """Same schema as public worker test_full_runtime.sample; invented data."""
    model = base_model()
    # Midnight makes wall-clock shift minutes and plan-relative minutes agree;
    # this fixture must test shift repair, not infer a native time-origin rule.
    model['start'] = '2026-11-24T00:00:00'
    model['equipment'] = [{'id': 'SHIFT_MACHINE', 'name': 'Synthetic staff station',
        'kind': 'workstation', 'capacity': 10, 'capacity_unit': 'шт.'}]
    model['employees'] = [{'id': 'SHIFT_EMP', 'name': 'Synthetic operator', 'role': 'operator', 'shift': 'day'}]
    model['shifts'] = {'day': [['08:00', '08:20'], ['08:40', '09:40']]}
    model['orders'] = [{'id': 'SHIFT_ORDER_' + color, 'quantity': 1, 'unit': 'шт.',
        'technical_process_id': 'SHIFT_PROCESS', 'parameters': {'color': color}} for color in ('A', 'B')]
    requirements = [{'resource_type': kind, 'match_mode': 'specific', 'resource_ref': rid,
        'resource_refs': [rid], 'quantity': 1} for kind, rid in (('equipment', 'SHIFT_MACHINE'), ('employee', 'SHIFT_EMP'))]
    model['technical_processes'] = [{'id': 'SHIFT_PROCESS', 'name': 'Synthetic setup and shift', 'operations': [
        {'id': 'SHIFT_WORK', 'name': 'Synthetic press', 'sequence': 1, 'duration_min': 10,
         'setup_parameter': 'color', 'resource_requirements': requirements}]}]
    model['setup_rules'] = [{'id': 'SHIFT_SETUP_' + first + second, 'setup_parameter': 'color', 'equipment_ref': '*',
        'from_state': first, 'to_state': second, 'duration_min': 15} for first, second in (('A', 'B'), ('B', 'A'))]
    return model


def check_staff_setup(plan, model):
    if not isinstance(plan, dict) or plan.get('valid') is not True or plan.get('partial') is True:
        raise RegressionError('staff_setup_native_invalid')
    rows = plan.get('generic_operations')
    if not isinstance(rows, list):
        rows = plan.get('operations') or []
    separate = plan.get('setup_operations') or []
    if (not isinstance(rows, list) or not isinstance(separate, list)
            or any(not isinstance(row, dict) for row in rows + separate)):
        raise RegressionError('staff_setup_row_shape')
    embedded = [row for row in rows if row.get('is_setup') or row.get('phase') == 'setup']
    production = [row for row in rows if not row.get('is_setup') and row.get('phase') != 'setup']
    # The current adapter exports production in generic_operations and native
    # setups separately. Older formatters also include the setup rows in the
    # generic array. Verify duplicate representations instead of counting them
    # twice or overlooking a separate setup.
    if embedded and separate:
        def signature(row):
            return (row.get('order'), finite(row.get('start_min')), finite(row.get('end_min')),
                    tuple(row.get('equipment_ids') or []), tuple(row.get('employee_ids') or []))
        if sorted(map(signature, embedded), key=repr) != sorted(map(signature, separate), key=repr):
            raise RegressionError('staff_setup_arrays_disagree')
    setup = separate or embedded
    rows = production + setup
    if len(setup) != 1 or len(production) != 2:
        raise RegressionError('staff_setup_operation_coverage')
    wanted = {order['id'] for order in model['orders']}
    if {row.get('order') for row in production} != wanted:
        raise RegressionError('staff_setup_order_coverage')
    batches = plan.get('batches')
    if not isinstance(batches, list) or len(batches) != 2 or {row.get('order') for row in batches} != wanted:
        raise RegressionError('staff_setup_batch_coverage')
    if any(abs(finite(row.get('quantity', row.get('area'))) - 1) > 1e-7 for row in batches):
        raise RegressionError('staff_setup_quantity')
    busy = {'SHIFT_MACHINE': [], 'SHIFT_EMP': []}
    for row in rows:
        start, end = finite(row.get('start_min')), finite(row.get('end_min'))
        is_setup = row in setup
        expected = 15 if is_setup else 10
        if start < 0 or abs(end - start - expected) > 1e-7 or row.get('materials'):
            raise RegressionError('staff_setup_duration_or_material')
        if row.get('equipment_ids') != ['SHIFT_MACHINE']:
            raise RegressionError('staff_setup_equipment')
        staff = row.get('employee_ids') or []
        if any(rid != 'SHIFT_EMP' for rid in staff) or (not is_setup and staff != ['SHIFT_EMP']):
            raise RegressionError('staff_setup_employee')
        if not is_setup and (row.get('operation_id') != 'SHIFT_WORK' or abs(finite(row.get('batch_quantity')) - 1) > 1e-7):
            raise RegressionError('staff_setup_production_quantity')
        for rid in ['SHIFT_MACHINE'] + staff:
            busy[rid].append((start, end))
        if staff:
            day = math.floor(start / 1440)
            if not any(start >= day * 1440 + low - 1e-7 and end <= day * 1440 + high + 1e-7
                       for low, high in ((480, 500), (520, 580))):
                raise RegressionError('staff_setup_shift_violation')
    for events in busy.values():
        events.sort()
        if any(first[1] > second[0] + 1e-7 for first, second in zip(events, events[1:])):
            raise RegressionError('staff_setup_resource_overlap')
    ordered = sorted(production, key=lambda row: row['start_min'])
    if (setup[0]['start_min'] < ordered[0]['end_min'] - 1e-7
            or setup[0]['end_min'] > ordered[1]['start_min'] + 1e-7):
        raise RegressionError('staff_setup_transition_position')
    duration = max(row['end_min'] for row in rows)
    if abs(finite(plan.get('duration_minutes')) - duration) > 1e-7:
        raise RegressionError('staff_setup_duration_metric')
    if plan.get('setup_count') != 1 or abs(finite(plan.get('setup_minutes')) - 15) > 1e-7:
        raise RegressionError('staff_setup_setup_metric')
    return {'native_valid': True, 'independent_valid': True, 'duration_minutes': duration,
            'production_count': 2, 'setup_count': 1, 'setup_minutes': 15, 'total_quantity': 2,
            'staff_windows_resources_and_setup_verified': True,
            'staff_shift_repaired': plan.get('staff_shift_repaired') is True}


def check_production(plan, model, target=None):
    if not isinstance(plan, dict) or plan.get('valid') is not True or plan.get('partial') is True:
        raise RegressionError('regression_native_invalid')
    orders = {str(row['id']): row for row in model['orders']}
    equipment = {str(row['id']): row for row in model['equipment']}
    processes = {str(row['id']): row for row in model['technical_processes']}
    batches = plan.get('batches')
    rows = plan.get('generic_operations') or plan.get('operations')
    if not isinstance(batches, list) or not isinstance(rows, list) or not batches or len(rows) > 2048:
        raise RegressionError('regression_plan_shape')
    quantities, totals, counts = {}, dict.fromkeys(orders, 0.0), dict.fromkeys(orders, 0)
    for row in batches:
        oid, batch = str(row.get('order')), row.get('batch')
        if oid not in orders or type(batch) is not int or batch < 1 or (oid, batch) in quantities:
            raise RegressionError('regression_batch_identity')
        quantity = finite(row.get('quantity', row.get('area')))
        if quantity <= 0 or abs(quantity - round(quantity)) > 1e-7:
            raise RegressionError('regression_piece_quantity')
        quantities[(oid, batch)] = quantity
        totals[oid] += quantity
        counts[oid] += 1
    for oid, order in orders.items():
        if abs(totals[oid] - finite(order['quantity'])) > 1e-7:
            raise RegressionError('regression_total_quantity')
    chains, busy = {}, {key: [] for key in equipment}
    for row in rows:
        if not isinstance(row, dict) or row.get('is_setup') or row.get('phase') == 'setup':
            raise RegressionError('regression_unexpected_setup')
        oid, batch = str(row.get('order')), row.get('batch')
        if (oid, batch) not in quantities:
            raise RegressionError('regression_foreign_operation')
        ops = processes[orders[oid]['technical_process_id']]['operations']
        op = next((item for item in ops if item['id'] == row.get('operation_id')), None)
        if op is None or row.get('employee_ids') or row.get('materials'):
            raise RegressionError('regression_operation_resources')
        opid = str(op['id'])
        chain = chains.setdefault((oid, batch), {})
        if opid in chain:
            raise RegressionError('regression_duplicate_operation')
        quantity = finite(row.get('batch_quantity'))
        ids = row.get('equipment_ids')
        if not isinstance(ids, list) or len(ids) != 1 or ids[0] not in equipment:
            raise RegressionError('regression_equipment_identity')
        eq = equipment[ids[0]]
        kind = op['resource_requirements'][0]['resource_ref'].split(':', 1)[1]
        if eq['kind'] != kind or quantity > finite(eq['capacity']) + 1e-7 or abs(quantity - quantities[(oid, batch)]) > 1e-7:
            raise RegressionError('regression_equipment_capacity_or_quantity')
        start, end = finite(row.get('start_min')), finite(row.get('end_min'))
        if start < 0 or abs(end - start - finite(op['duration_min'])) > 1e-7:
            raise RegressionError('regression_operation_duration')
        chain[opid] = (start, end)
        busy[ids[0]].append((start, end))
    for key, quantity in quantities.items():
        oid, _ = key
        ops = sorted(processes[orders[oid]['technical_process_id']]['operations'], key=lambda item: item['sequence'])
        chain = chains.get(key, {})
        if set(chain) != {str(op['id']) for op in ops}:
            raise RegressionError('regression_stage_coverage')
        for first, second in zip(ops, ops[1:]):
            if chain[first['id']][1] > chain[second['id']][0] + 1e-7:
                raise RegressionError('regression_precedence')
    for intervals in busy.values():
        intervals.sort()
        if any(first[1] > second[0] + 1e-7 for first, second in zip(intervals, intervals[1:])):
            raise RegressionError('regression_resource_overlap')
    duration = max(end for intervals in busy.values() for _, end in intervals)
    if abs(duration - finite(plan.get('duration_minutes'))) > 1e-7:
        raise RegressionError('regression_duration_metric')
    if target is not None and abs(duration - target) > 1e-7:
        raise RegressionError('regression_target_duration')
    result = {'independent_valid': True, 'native_valid': True, 'duration_minutes': duration,
              'operation_count': len(rows), 'batch_count': len(batches), 'order_count': len(orders),
              'total_quantity': sum(totals.values()), 'batch_counts_by_order': counts,
              'capacity_quantity_precedence_and_coverage_verified': True}
    if target is not None:
        result.update(target_duration_minutes=target, reached_target=True)
    return result
