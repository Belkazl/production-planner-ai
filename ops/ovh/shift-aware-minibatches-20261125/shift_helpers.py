# Inserted verbatim into the exact public joint module by patch.py.
# These are search proposals, never a scheduler, repair, or feasibility proof.
SHIFT_AWARE_VERSION = 'shift-aware-minibatches-v1-20261125'
MAX_SHIFT_SEEDS = 2
MAX_SHIFT_ROWS = 4096
MAX_SHIFT_PROBED_ROWS = 64
MAX_SHIFT_EXTRA_PARTS = 2
MAX_SHIFT_BOUNDARY_STEPS = 64
MAX_SHIFT_STARTS = 64
MAX_SHIFT_HINT_DAYS = 14
MAX_SHIFT_WINDOW_PROBES = 1024


class _ShiftProbeLimit(Exception):
    pass


def _shift_finite(value):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value))


def _shift_ids(row, field):
    values = row.get(field)
    if not isinstance(values, (list, tuple)):
        return ()
    return tuple(str(value) for value in values)


def _shift_setup(row):
    return row.get('is_setup') is True or str(row.get('phase') or row.get('type') or '').lower() == 'setup'


def _shift_start_hints(model, context, phases, ready, latest):
    """Known HH:MM starts are hints only; native calendars decide every fit."""
    from datetime import datetime
    result = {float(ready)}
    try:
        origin = datetime.fromisoformat(model['start'])
        native_origin = context.get('start')
        if isinstance(native_origin, str):
            native_origin = datetime.fromisoformat(native_origin)
        if not isinstance(native_origin, datetime) or native_origin != origin:
            return sorted(result)
        shifts = model.get('shifts')
        if not isinstance(shifts, dict):
            return sorted(result)
        employees = {str(row['id']): row for row in model.get('employees') or []}
        minute = origin.hour * 60 + origin.minute + origin.second / 60 + origin.microsecond / 60000000
        first_day = max(0, math.floor((ready + minute) / 1440) - 1)
        last_day = min(first_day + MAX_SHIFT_HINT_DAYS, math.floor((latest + minute) / 1440) + 1)
        for identifiers, offset in phases:
            for identifier in identifiers:
                employee = employees.get(identifier)
                name = employee.get('shift') if isinstance(employee, dict) else None
                intervals = shifts.get(name) if isinstance(name, str) else None
                if not isinstance(intervals, list) or len(intervals) > 32:
                    continue
                for interval in intervals:
                    if not isinstance(interval, (list, tuple)) or len(interval) != 2:
                        continue
                    value = interval[0]
                    if (not isinstance(value, str) or len(value) != 5 or value[2] != ':'
                            or not value[:2].isdigit() or not value[3:].isdigit()):
                        continue
                    hour, minutes = int(value[:2]), int(value[3:])
                    if hour > 23 or minutes > 59:
                        continue
                    for day in range(first_day, last_day + 1):
                        candidate = day * 1440 + hour * 60 + minutes - minute - offset
                        if ready <= candidate < latest:
                            result.add(candidate)
        return sorted(result)[:MAX_SHIFT_STARTS]
    except (KeyError, TypeError, ValueError, OverflowError):
        return sorted(result)


def _shift_window_cut(window_test, windows, staff, phases, begin, per_unit, size, discrete):
    """Ask the existing predicate about quantities; calendar storage is opaque."""
    offset = 0.0
    for employees, duration in phases:
        if not all(window_test(windows, identifier, begin + offset, duration)
                   for identifier in sorted(employees)):
            return None
        offset += duration

    def fits(quantity):
        return all(window_test(windows, identifier, begin + offset, quantity * per_unit)
                   for identifier in sorted(staff))

    # A full-size job already fitting at the same resource-ready instant is
    # not a shift-boundary opportunity. Material/other delays remain native.
    if fits(size):
        return None
    if discrete:
        low, high = 1, int(size) - 1
        if high < low or not fits(low):
            return None
        for _ in range(MAX_SHIFT_BOUNDARY_STEPS):
            if low >= high:
                return float(low)
            middle = (low + high + 1) // 2
            if fits(middle):
                low = middle
            else:
                high = middle - 1
        return None
    low, high = 0.0, float(size)
    for _ in range(MAX_SHIFT_BOUNDARY_STEPS):
        middle = (low + high) / 2
        if middle == low or middle == high:
            break
        if fits(middle):
            low = middle
        else:
            high = middle
    return low if low > 0 and fits(low) else None


def _shift_partition(genome, specs, frozen, oid, batch, quantity):
    """Keep the prefix, then balance the remaining amount within native caps."""
    spec = specs[oid]
    previous = genome.mapping()
    prefix = list(previous[oid][:batch - 1])
    remainder = spec.quantity - math.fsum(prefix + [quantity])
    if remainder <= EPS * max(1.0, spec.quantity):
        return None
    count = max(1, math.ceil(remainder / spec.maximum - EPS))
    if spec.discrete:
        if not float(remainder).is_integer() or count > int(remainder):
            return None
        quotient, extra = divmod(int(remainder), count)
        tail = [float(quotient + (index < extra)) for index in range(count)]
    else:
        tail = [remainder / count] * count
        tail[-1] = remainder - math.fsum(tail[:-1])
    changed = tuple(prefix + [quantity] + tail)
    if len(changed) > len(previous[oid]) + MAX_SHIFT_EXTRA_PARTS:
        return None
    mapping = dict(previous)
    mapping[oid] = changed
    candidate = validate_genome(Genome(genome.sequence,
        tuple((key, mapping[key]) for key in genome.sequence)), specs, frozen)
    return candidate if candidate != genome else None


def _shift_seed_candidates(ga, model, specs, genome, sim, frozen=None):
    """Propose small linear batches for gaps in an already checked native plan.

    The native row must agree with the selected machine's throughput profile.
    Fixed or unsupported duration formulas never acquire a fabricated linear
    duration. Calendars and preceding setup reservations come from this same
    native simulation. The resulting gene is still evaluated by the complete
    native decoder, setup handling, constraint checker, and objective function.
    """
    result = []
    try:
        rows = sim.get('operations')
        detached = sim.get('setup_operations') or []
        context = sim.get('ctx')
        native_window_test = ga.get('_pp_in_window')
        if (not isinstance(rows, list) or not 0 < len(rows) <= MAX_SHIFT_ROWS
                or not isinstance(detached, list) or len(rows) + len(detached) > MAX_SHIFT_ROWS
                or not isinstance(context, dict) or not callable(native_window_test)):
            return []
        windows = context.get('emp_windows')
        if windows is None:
            return []
        probes = 0

        def window_test(*args):
            nonlocal probes
            if probes >= MAX_SHIFT_WINDOW_PROBES:
                raise _ShiftProbeLimit()
            probes += 1
            return native_window_test(*args)

        production, setups, footprints = [], [], set()
        for row in rows + detached:
            if (not isinstance(row, dict) or not _shift_finite(row.get('start_min'))
                    or not _shift_finite(row.get('end_min'))
                    or row['end_min'] <= row['start_min']):
                return []
            if row in detached or _shift_setup(row):
                key = (row['start_min'], row['end_min'],
                       tuple(sorted(_shift_ids(row, 'equipment_ids'))),
                       tuple(sorted(_shift_ids(row, 'employee_ids'))))
                if key not in footprints:
                    footprints.add(key)
                    setups.append(row)
            else:
                production.append(row)
        equipment = {str(row['id']): row for row in model.get('equipment') or model.get('autoclaves') or []}
        orders = {str(row['id']): row for row in model.get('orders') or []}
        known = {genome}
        quantities = genome.mapping()
        # A bounded hint pass runs once, after the first feasible incumbent.
        for row in sorted(production, key=lambda item: (item['start_min'], item['end_min']))[:MAX_SHIFT_PROBED_ROWS]:
            oid, batch = str(row.get('order')), row.get('batch', 1)
            machines = _shift_ids(row, 'equipment_ids')
            staff = set(_shift_ids(row, 'employee_ids'))
            if (oid not in specs or frozen and oid in frozen or not staff or len(machines) != 1
                    or not _shift_finite(batch) or int(batch) != batch
                    or not 1 <= batch <= len(quantities[oid])):
                continue
            batch = int(batch)
            machine = equipment.get(machines[0])
            profile = machine.get('timing_profile') if isinstance(machine, dict) else None
            rate = profile.get('throughput_per_hour') if isinstance(profile, dict) else None
            if (not isinstance(profile, dict) or profile.get('timing_mode') != 'throughput'
                    or not _shift_finite(rate) or rate <= 0):
                continue
            order_unit = _unit(ga['_pp_batch_order_unit'](orders[oid]))
            machine_unit = _unit(ga['_pp_batch_unit'](machine.get('capacity_unit')))
            if not order_unit or order_unit != machine_unit:
                continue
            size = quantities[oid][batch - 1]
            per_unit = 60.0 / float(rate)
            duration = row['end_min'] - row['start_min']
            if abs(duration - size * per_unit) > EPS * max(1.0, duration):
                continue
            machine_ids = set(machines)
            start = float(row['start_min'])

            def shares(value, employees=staff):
                return (bool(machine_ids.intersection(_shift_ids(value, 'equipment_ids')))
                        or bool(employees.intersection(_shift_ids(value, 'employee_ids'))))

            before = [value for value in production if value is not row and value['end_min'] <= start + EPS
                      and (shares(value) or str(value.get('order')) == oid and value.get('batch', 1) == batch)]
            ready = max([0.0] + [float(value['end_min']) for value in before])
            preceding = [value for value in setups if shares(value)
                         and value['start_min'] >= ready - EPS and value['end_min'] <= start + EPS]
            if any(not set(_shift_ids(value, 'equipment_ids')).issubset(machine_ids) for value in preceding):
                continue
            all_staff = staff | {identifier for value in preceding for identifier in _shift_ids(value, 'employee_ids')}
            ready = max([ready] + [float(value['end_min']) for value in production
                        if value is not row and value['end_min'] <= start + EPS and shares(value, all_staff)])
            phases = [(set(_shift_ids(value, 'employee_ids')), value['end_min'] - value['start_min'])
                      for value in sorted(preceding, key=lambda value: value['start_min'])]
            setup_minutes = math.fsum(value['end_min'] - value['start_min'] for value in preceding)
            if ready + setup_minutes >= start:
                continue
            offsets, offset = [], 0.0
            for employees, duration in phases:
                offsets.append((employees, offset))
                offset += duration
            offsets.append((staff, offset))
            for begin in _shift_start_hints(model, context, offsets, ready, start - setup_minutes):
                cut = _shift_window_cut(window_test, windows, staff, phases, begin,
                                        per_unit, size, specs[oid].discrete)
                if cut is None or cut <= 0 or cut >= size:
                    continue
                candidate = _shift_partition(genome, specs, frozen, oid, batch, cut)
                if candidate is not None and candidate not in known:
                    known.add(candidate)
                    result.append(candidate)
                    if len(result) >= MAX_SHIFT_SEEDS:
                        return result
        return result
    except _ShiftProbeLimit:
        return result
    except (JointContractError, KeyError, TypeError, ValueError, OverflowError):
        # An unsupported proposal contract changes no native evaluation or
        # constraints. The actual-native gate requires a successful witness.
        return []
