"""Conservative, verified operation pinning for the isolated full-GA worker.

The legacy GA has no reliable lock-aware batch scheduler. We operate on a
proven feasible schedule, move only forward in time, and reject any candidate
that violates a lock or a resource/material/shift/precedence constraint.
No account data is stored in this module or shared between OS processes.
"""
import copy
import math


class PinConstraintError(ValueError):
    pass


def _number(value, name):
    if isinstance(value, bool):
        raise PinConstraintError('pin_non_numeric_' + name)
    try:
        n = float(value)
    except (TypeError, ValueError):
        raise PinConstraintError('pin_non_numeric_' + name) from None
    if not math.isfinite(n):
        raise PinConstraintError('pin_non_finite_' + name)
    return n


def _sid(value):
    return str(value) if value is not None else ''


def _rows(sim):
    return (sim.get('operations') or []), (sim.get('setup_operations') or [])


def _target(rows, pin):
    oid, opid = _sid(pin.get('order')), _sid(pin.get('operation_id'))
    name = _sid(pin.get('operation_name'))
    if not oid or not (opid or name):
        raise PinConstraintError('pin_identity_required')
    found = [r for r in rows if _sid(r.get('order')) == oid and
             (_sid(r.get('operation_id')) == opid if opid else _sid(r.get('operation_name')) == name)]
    if pin.get('batch') is not None:
        batch = int(_number(pin.get('batch'), 'batch'))
        found = [r for r in found if int(_number(r.get('batch', 1), 'row_batch')) == batch]
    if len(found) != 1:
        raise PinConstraintError('pin_row_not_unique_or_missing')
    return found[0]


def _validate_pin_list(pins, model):
    if not isinstance(pins, list) or not pins or len(pins) > 500:
        raise PinConstraintError('pin_list_invalid')
    model_orders = {_sid(o.get('id')) for o in model.get('orders') or []}
    keys = set()
    clean = []
    for pin in pins:
        if not isinstance(pin, dict):
            raise PinConstraintError('pin_not_object')
        x = copy.deepcopy(pin)
        if _sid(x.get('order')) not in model_orders:
            raise PinConstraintError('pin_order_not_owned')
        start = _number(x.get('start_min'), 'start_min')
        end = _number(x.get('end_min'), 'end_min')
        if start < 0 or end <= start or end > 120 * 1440:
            raise PinConstraintError('pin_time_invalid')
        x['start_min'], x['end_min'] = start, end
        if x.get('batch') is not None:
            batch = _number(x['batch'], 'batch')
            if batch < 1 or int(batch) != batch:
                raise PinConstraintError('pin_batch_invalid')
            x['batch'] = int(batch)
        signature = (_sid(x.get('order')), _sid(x.get('operation_id')) or _sid(x.get('operation_name')), x.get('batch'))
        if signature in keys:
            raise PinConstraintError('pin_duplicate')
        keys.add(signature)
        for k in ('employee_ids', 'equipment_ids'):
            if k in x and not isinstance(x[k], list):
                raise PinConstraintError('pin_resource_format')
            if k in x and len(x[k]) != len(set(map(_sid, x[k]))):
                raise PinConstraintError('pin_duplicate_resource')
        clean.append(x)
    return clean


def _positive_interval(row):
    s = _number(row.get('start_min'), 'row_start')
    e = _number(row.get('end_min'), 'row_end')
    if e <= s or s < -1e-8:
        raise PinConstraintError('schedule_bad_interval')
    return s, e


def _verify(model, sim, pins, ga):
    rows, setups = _rows(sim)
    if not rows:
        raise PinConstraintError('schedule_no_operations')
    all_rows = rows + setups
    equipment = {_sid(e.get('id')) for e in (model.get('equipment') or model.get('autoclaves') or [])}
    staff = {_sid(x.get('id')) for x in (model.get('employees') or [])}
    busy = {}
    for r in all_rows:
        start, end = _positive_interval(r)
        for k, allowed in (('equipment_ids', equipment), ('employee_ids', staff)):
            for val in r.get(k) or []:
                rid = _sid(val)
                if rid not in allowed:
                    raise PinConstraintError('schedule_unknown_resource')
                busy.setdefault((k, rid), []).append((start, end))
                if k == 'employee_ids':
                    if not ga['_pp_in_window'](sim['ctx']['emp_windows'], rid, start, end-start):
                        raise PinConstraintError('schedule_staff_shift_invalid')
    for slots in busy.values():
        slots.sort()
        if any(a[1] > b[0]+1e-7 for a,b in zip(slots, slots[1:])):
            raise PinConstraintError('schedule_resource_overlap')
    for pin in pins:
        row = _target(rows, pin)
        start, end = _positive_interval(row)
        if abs(start-pin['start_min']) > 1e-6 or abs(end-pin['end_min']) > 1e-6:
            raise PinConstraintError('pin_moved')
        for k in ('employee_ids', 'equipment_ids'):
            if k in pin and sorted(map(_sid, pin[k])) != sorted(map(_sid, row.get(k) or [])):
                raise PinConstraintError('pin_resource_changed')
        if not row.get('manual_locked'):
            raise PinConstraintError('pin_not_marked')
    # Materials are consumed at operation start; deliveries at the same instant
    # are available, as in the original _pp_material_ok scheduler.
    mats = ga['_pp_materials'](model)
    mat_by_id = {_sid(m['id']):m for m in mats}
    events = {mid:[] for mid in mat_by_id}
    for row in rows:
        start = _number(row.get('start_min'), 'material_time')
        for m in row.get('materials') or []:
            if not isinstance(m, dict):
                raise PinConstraintError('material_row_invalid')
            mid = _sid(m.get('id'))
            q = _number(m.get('quantity',0), 'material_quantity')
            if mid not in events or q < 0:
                raise PinConstraintError('schedule_unknown_material')
            events[mid].append((start, q))
    for mid, usage in events.items():
        m = mat_by_id[mid]
        stock = _number(m.get('initial_stock',0), 'initial_stock')
        deliveries = ga['_pp_delivery_minutes'](m, sim['ctx']['start'])
        delivery_events = sorted((float(t),float(q)) for t,q in deliveries)
        timeline = [(t,0,-q) for t,q in delivery_events]
        timeline += [(t,1,q) for t,q in usage]
        timeline.sort()
        for _,kind,q in timeline:
            if kind == 0:stock -= q
            else:stock -= q
            if stock < -1e-6:
                raise PinConstraintError('schedule_material_shortage')
    errors = ga['_pp_validate_generic'](model,sim)
    if errors:
        raise PinConstraintError('schedule_legacy_validation_failed')
    return True


def apply_pins(sim, pins, model, ga):
    """Shift a feasible candidate forward; never infer or modify a lock's resources.

    This intentionally rejects pins requiring a non-monotonic reordering of
    operations. Other GA order candidates may still satisfy the same pins.
    """
    rows, setups = _rows(sim)
    if not sim.get('ctx'):
        raise PinConstraintError('schedule_context_missing')
    clean = _validate_pin_list(pins, model)
    targets = [(_target(rows,p),p) for p in clean]
    targets.sort(key=lambda pair:float(pair[0]['start_min']))
    for row,pin in targets:
        cur_start, cur_end = _positive_interval(row)
        if 'employee_ids' in pin and sorted(map(_sid,pin['employee_ids'])) != sorted(map(_sid,row.get('employee_ids') or [])):
            raise PinConstraintError('pin_employee_assignment_differs')
        if 'equipment_ids' in pin and sorted(map(_sid,pin['equipment_ids'])) != sorted(map(_sid,row.get('equipment_ids') or [])):
            raise PinConstraintError('pin_equipment_assignment_differs')
        if abs((cur_end-cur_start)-(pin['end_min']-pin['start_min'])) > 1e-6:
            raise PinConstraintError('pin_duration_differs')
        delta = pin['start_min'] - cur_start
        if delta < -1e-7:
            raise PinConstraintError('pin_requires_earlier_schedule')
        if delta > 1e-7:
            for other in rows+setups:
                if float(other.get('start_min',0)) >= cur_start-1e-7:
                    for key in ('start_min','end_min','finish_min','process_start_min','process_end_min'):
                        if other.get(key) is not None:
                            other[key] = round(float(other[key])+delta,6)
        row['manual_locked'] = True
        if pin.get('manual_updated_at') is not None:row['manual_updated_at'] = pin['manual_updated_at']
        row['_auto_start_min'] = float(row.get('_auto_start_min',cur_start))
        row['_auto_end_min'] = float(row.get('_auto_end_min',cur_end))
    for batch in sim.get('batches') or []:
        batch_rows = [r for r in rows if _sid(r.get('order')) == _sid(batch.get('order')) and
                      int(r.get('batch',1)) == int(batch.get('batch',1))]
        if batch_rows:
            batch['start_min'] = min(float(r['start_min']) for r in batch_rows)
            batch['end_min'] = max(float(r['end_min']) for r in batch_rows)
    makespan = max(float(r['end_min']) for r in rows+setups)
    sim['duration_minutes'] = makespan
    sim['fitness'] = makespan
    equipment_count = len((model.get('equipment') or model.get('autoclaves') or []))
    total_machine_time = sum(float(r['end_min'])-float(r['start_min']) for r in rows+setups for _ in (r.get('equipment_ids') or []))
    sim['machine_idle_minutes'] = max(0, makespan*equipment_count-total_machine_time)
    _verify(model,sim,clean,ga)
    return sim


def make_constrained_scheduler(ga, pins, model):
    # Validate before starting the expensive optimizer; each account invokes
    # this in its own isolated child process.
    clean = _validate_pin_list(pins,model)
    original = ga['_pp_schedule_sequence']
    def constrained(candidate_model, order_ids):
        sim = original(candidate_model,order_ids)
        return apply_pins(sim,clean,candidate_model,ga)
    ga['_pp_schedule_sequence'] = constrained
    return clean