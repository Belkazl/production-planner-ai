# Candidate generation only. All resulting partitions are evaluated by the
# native scheduler, constraints and objective, never accepted by this probe.
GAP_CHAIN_VERSION = 'shift-gap-chain-v1-20261125'
MAX_GAP_CHAIN_TARGETS = 48
MAX_GAP_CHAIN_PROBES = 8192
MAX_GAP_CHAIN_SEEDS = 2


def _gap_chain_candidates(ga, model, specs, genome, sim, frozen=None, seen=()):
    """Explore the upstream chain to fill a downstream idle window.

    Unlike a row-local probe, the predecessor's original completion is not
    treated as immutable when the same physical batch becomes smaller.
    Keep all external machine/staff reservations, including setup rows, fixed
    for this conservative hint; only the native decoder can accept a plan.
    """
    from bisect import bisect_right
    found = []
    try:
        rows = sim.get('operations')
        detached = sim.get('setup_operations') or []
        context = sim.get('ctx')
        predicate = ga.get('_pp_in_window')
        if (not isinstance(rows, list) or not isinstance(detached, list)
                or not 0 < len(rows) + len(detached) <= MAX_SHIFT_ROWS
                or not isinstance(context, dict) or not callable(predicate)
                or context.get('emp_windows') is None):
            return []
        windows = context['emp_windows']
        probes = 0
        def check(*args):
            nonlocal probes
            if probes >= MAX_GAP_CHAIN_PROBES:
                raise _ShiftProbeLimit()
            probes += 1
            return predicate(*args)

        production, busy, chains = [], {}, {}
        def resources(row):
            return tuple((field, rid) for field in ('equipment_ids', 'employee_ids')
                         for rid in _shift_ids(row, field))
        def identity(row):
            return (str(row.get('order')), row.get('batch', 1))
        for row, is_detached in [(r, False) for r in rows] + [(r, True) for r in detached]:
            if (not isinstance(row, dict) or not _shift_finite(row.get('start_min'))
                    or not _shift_finite(row.get('end_min')) or row['end_min'] <= row['start_min']):
                return []
            setup = is_detached or _shift_setup(row)
            key = None if setup else identity(row)
            for resource in resources(row):
                busy.setdefault(resource, []).append((float(row['end_min']), key))
            if not setup:
                production.append(row)
                chains.setdefault(key, []).append(row)
        for key, intervals in busy.items():
            intervals.sort(key=lambda pair: pair[0])
            busy[key] = ([end for end, _ in intervals], intervals)
        for chain in chains.values():
            chain.sort(key=lambda row: (row['start_min'], row['end_min']))
        def external_floor(row, key):
            floor = 0.0
            for resource in resources(row):
                ends, intervals = busy[resource]
                index = bisect_right(ends, float(row['start_min']) + EPS) - 1
                while index >= 0 and intervals[index][1] == key:
                    index -= 1
                if index >= 0:
                    floor = max(floor, intervals[index][0])
            return floor

        equipment = {str(row['id']): row for row in model.get('equipment') or model.get('autoclaves') or []}
        orders = {str(row['id']): row for row in model.get('orders') or []}
        partitions = genome.mapping()
        early_rows = {id(row) for row in sorted(production, key=lambda r: (r['start_min'], r['end_min']))[:MAX_SHIFT_PROBED_ROWS]}
        targets = []
        for key, chain in chains.items():
            oid, batch = key
            if (oid not in specs or frozen and oid in frozen or type(batch) not in (int, float)
                    or int(batch) != batch or not 1 <= int(batch) <= len(partitions[oid])):
                continue
            batch = int(batch)
            size = partitions[oid][batch - 1]
            if specs[oid].discrete and size < 2:
                continue
            phases = []
            has_staff = False
            has_linear = False
            for row in chain:
                start, end = float(row['start_min']), float(row['end_min'])
                staff = _shift_ids(row, 'employee_ids')
                machines = _shift_ids(row, 'equipment_ids')
                duration = end - start
                linear = False
                if len(machines) == 1:
                    machine = equipment.get(machines[0], {})
                    profile = machine.get('timing_profile')
                    rate = profile.get('throughput_per_hour') if isinstance(profile, dict) else None
                    if (isinstance(profile, dict) and profile.get('timing_mode') == 'throughput'
                            and _shift_finite(rate) and rate > 0):
                        order_unit = _unit(ga['_pp_batch_order_unit'](orders[oid]))
                        machine_unit = _unit(ga['_pp_batch_unit'](machine.get('capacity_unit')))
                        linear = bool(order_unit and order_unit == machine_unit
                                      and abs(duration - size * 60.0 / rate) <= EPS * max(1, duration))
                # An unknown/fixed duration is not scaled. The real decoder
                # still computes every operation, including those upstream.
                floor = external_floor(row, key)
                phases.append((floor, start, end, staff, duration, linear))
                has_staff = has_staff or bool(staff)
                has_linear = has_linear or linear
                # Keep the original fast probe for simple early one-stage
                # opportunities. Scan all later rows, not just the first 64.
                if (not has_staff or not has_linear or start <= floor + EPS
                        or len(phases) == 1 and id(row) in early_rows):
                    continue
                targets.append((min(start - floor, duration), len(phases), start,
                                oid, batch, size, tuple(phases)))

        # Highest potential useful processing time first, and examine
        # downstream gaps even if many unrelated rows precede them.
        targets.sort(key=lambda item: (-item[0], -item[1], item[2], item[3], item[4]))
        known = set(seen) | {_diversity_key(genome)}
        for _, _, deadline, oid, batch, size, phases in targets[:MAX_GAP_CHAIN_TARGETS]:
            spec = specs[oid]
            def fits(q):
                previous_end = 0.0
                for index, (floor, start, end, staff, duration, linear) in enumerate(phases):
                    d = duration * q / size if linear else duration
                    ready = max(previous_end, floor)
                    limit = deadline if index == len(phases) - 1 else min(end, deadline)
                    if d <= 0 or ready + d > limit + EPS:
                        return False
                    starts = _shift_start_hints(model, context, [(staff, 0)], ready, limit)
                    placed = False
                    for begin in starts:
                        if begin + d > limit + EPS:
                            continue
                        if all(check(windows, rid, begin, d) for rid in staff):
                            previous_end = begin + d
                            placed = True
                            break
                    if not placed:
                        return False
                return True
            if fits(size):
                continue
            if spec.discrete:
                low, high = 1, int(size) - 1
                if high < low or not fits(low):
                    continue
                while low < high:
                    middle = (low + high + 1) // 2
                    if fits(middle):
                        low = middle
                    else:
                        high = middle - 1
                cut = float(low)
            else:
                low, high = 0.0, float(size)
                for _ in range(40):
                    middle = (low + high) / 2
                    if fits(middle):
                        low = middle
                    else:
                        high = middle
                cut = low
            if cut <= 0 or cut >= size:
                continue
            try:
                candidate = _shift_partition(genome, specs, frozen, oid, batch, cut)
            except JointContractError:
                continue
            if candidate is not None:
                key = _diversity_key(candidate)
                if key not in known:
                    known.add(key)
                    found.append(candidate)
                    if len(found) >= MAX_GAP_CHAIN_SEEDS:
                        return found
        return found
    except _ShiftProbeLimit:
        return found
    except (JointContractError, KeyError, TypeError, ValueError, OverflowError):
        return found

