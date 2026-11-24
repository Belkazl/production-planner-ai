"""A conservative operation-interleaving decoder for pure unary job shops.

The native decoder still constructs every candidate, including its actual batch
sizes, operation durations and resource assignments. This module only tries
different times for that same complete candidate. Unsupported models, metrics,
contracts, or native validation failures return the original object unchanged.
No imported plan, account state, random seed, or GA counters are used here.
"""
import copy
import math
from collections import OrderedDict
from datetime import datetime, timedelta


EPS = 1e-7
MAX_OPERATIONS = 64
VERSION = "operation-interleave-v1-20261124"
DIAGNOSTIC_KEY = "_PP_OPERATION_INTERLEAVE_DIAGNOSTIC"
DIAGNOSTIC_REASONS = frozenset({
    "objective_not_supported", "manual_pins", "native_hooks_missing", "runtime_contract_unsupported",
    "native_validation_rejected", "unsupported_fields", "unsupported_object", "nonresource_model",
    "unsupported_employees", "unsupported_materials", "unsupported_material", "unsupported_setup_rules", "unsupported_shifts",
    "equipment_missing", "invalid_identity", "nonfinite_number", "nonunary_capacity", "duplicate_process",
    "process_operations_missing", "operation_invalid", "not_one_equipment_requirement", "nonequipment_requirement",
    "nonunit_requirement", "unsupported_consumption", "unsupported_match", "unsupported_order", "unsupported_size",
    "model_changed", "bad_order_sequence", "context_missing", "invalid_native_candidate", "unsupported_setup_operations",
    "unsupported_errors", "unsupported_validation_errors", "unsupported_conflicts", "unsupported_violations",
    "unsupported_changeovers", "nonzero_setup", "incomplete_operations", "operation_array_missing", "duplicate_operations",
    "operation_arrays_disagree", "unsupported_operation", "operation_constraints", "bad_batch", "foreign_order",
    "operation_identity", "nonfixed_duration", "nonunit_batch", "batch_count_mismatch", "unsupported_assignment",
    "inconsistent_resources", "bad_interval", "multiphase_operation", "missing_batches", "incomplete_chain",
    "precedence_violation", "resource_overlap", "non_duration_fitness", "batch_summary_missing", "batch_summary_invalid",
    "batch_summary_nonunit", "unsupported_timestamp", "unknown_wait_metric", "unknown_idle_metric", "unknown_busy_contract",
    "unknown_busy_intervals", "validator_mutated_schedule",
})


class Unsupported(ValueError):
    pass


def _require(condition, reason):
    if not condition:
        raise Unsupported(reason)


def _number(value):
    _require(not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value), "nonfinite_number")
    return float(value)


def _same(a, b):
    return abs(_number(a) - _number(b)) <= EPS


def _keys(value, allowed):
    _require(isinstance(value, dict), "unsupported_object")
    extra = set(value) - set(allowed) - {"__ppid"}
    _require(not extra, "unsupported_fields:" + ",".join(sorted(map(str, extra))[:5]))


def _identifier(value):
    _require(isinstance(value, (str, int)) and not isinstance(value, bool) and str(value), "invalid_identity")
    return str(value)


def _empty(value):
    return value is None or value == [] or value == {}


def _diagnostic(event, **fields):
    # Bounded process-local diagnostics contain no IDs, models, or source text.
    try:
        print("PP_OPERATION_INTERLEAVE", {"event": event, "version": VERSION, **fields}, flush=True)
    except Exception:
        pass


def _model_spec(model):
    _keys(model, ("scheduler_mode", "start", "quantity_unit", "objective", "equipment", "autoclaves", "employees", "materials", "material", "setup_rules", "shifts", "orders", "technical_processes", "name", "description"))
    _require(model.get("scheduler_mode") == "resource", "nonresource_model")
    for key in ("employees", "materials", "material", "setup_rules", "shifts"):
        _require(_empty(model.get(key)), "unsupported_" + key)
    origin = datetime.fromisoformat(str(model["start"]).replace("Z", "+00:00"))
    equipment = model.get("equipment") or model.get("autoclaves") or []
    _require(isinstance(equipment, list) and equipment, "equipment_missing")
    machines = set()
    for machine in equipment:
        _keys(machine, ("id", "name", "kind", "capacity", "capacity_unit", "description"))
        mid = _identifier(machine.get("id"))
        _require(mid not in machines and _same(machine.get("capacity"), 1), "nonunary_capacity")
        machines.add(mid)
    processes = {}
    for process in model.get("technical_processes") or []:
        _keys(process, ("id", "name", "operations", "description"))
        pid = _identifier(process.get("id"))
        _require(pid not in processes, "duplicate_process")
        operations = process.get("operations")
        _require(isinstance(operations, list) and operations, "process_operations_missing")
        spec, sequences = {}, set()
        for operation in operations:
            _keys(operation, ("id", "name", "sequence", "duration_min", "resource_requirements", "description"))
            oid = _identifier(operation.get("id"))
            sequence, duration = _number(operation.get("sequence")), _number(operation.get("duration_min"))
            _require(oid not in spec and sequence not in sequences and sequence > 0 and duration > 0, "operation_invalid")
            requirements = operation.get("resource_requirements")
            _require(isinstance(requirements, list) and len(requirements) == 1, "not_one_equipment_requirement")
            req = requirements[0]
            _keys(req, ("id", "type", "resource_type", "match_mode", "resource_ref", "resource_refs", "quantity", "unit", "consumption_rule", "kind"))
            _require(req.get("resource_type", req.get("type")) == "equipment" and req.get("type", "equipment") == "equipment", "nonequipment_requirement")
            _require(_same(req.get("quantity"), 1), "nonunit_requirement")
            _require(req.get("consumption_rule", "during_operation") == "during_operation", "unsupported_consumption")
            _require(req.get("match_mode", "specific") in ("specific", "any"), "unsupported_match")
            spec[oid] = (sequence, duration)
            sequences.add(sequence)
        processes[pid] = spec
    orders = {}
    for order in model.get("orders") or []:
        _keys(order, ("id", "name", "quantity", "unit", "technical_process_id", "description"))
        oid, pid = _identifier(order.get("id")), _identifier(order.get("technical_process_id"))
        quantity = _number(order.get("quantity"))
        _require(oid not in orders and pid in processes and quantity >= 1 and quantity.is_integer(), "unsupported_order")
        orders[oid] = (int(quantity), processes[pid])
    count = sum(quantity * len(operations) for quantity, operations in orders.values())
    _require(orders and 1 <= count <= MAX_OPERATIONS, "unsupported_size")
    return {"orders": orders, "machines": machines, "count": count, "origin": origin}


def _chain_key(row):
    batch = _number(row.get("batch", 1))
    _require(batch >= 1 and batch.is_integer(), "bad_batch")
    return (_identifier(row.get("order")), int(batch))


def _interval(row):
    start, end = _number(row.get("start_min")), _number(row.get("end_min"))
    _require(start >= 0 and end > start and _same(end - start, row.get("duration_min")), "bad_interval")
    return start, end


def _row_index(rows):
    _require(isinstance(rows, list), "operation_array_missing")
    result = {(_chain_key(row), _identifier(row.get("operation_id"))): row for row in rows}
    _require(len(result) == len(rows), "duplicate_operations")
    return result


def _contract(sim, spec):
    _require(isinstance(sim, dict) and isinstance(sim.get("ctx"), dict), "context_missing")
    _require(sim.get("valid") is not False and not sim.get("partial"), "invalid_native_candidate")
    for key in ("setup_operations", "errors", "validation_errors", "conflicts", "violations"):
        _require(_empty(sim.get(key)), "unsupported_" + key)
    _require(_empty(sim.get("changeovers")) or sim.get("changeovers") == 0, "unsupported_changeovers")
    for key in ("setup_count", "setup_minutes", "setup_operation_count", "setup_duration_total_minutes"):
        _require(_same(sim.get(key, 0), 0), "nonzero_setup")
    rows = sim.get("operations")
    _require(isinstance(rows, list) and len(rows) == spec["count"], "incomplete_operations")
    _require("generic_operations" not in sim or _row_index(sim["generic_operations"]) == _row_index(rows), "operation_arrays_disagree")
    chains, resources, identities = {}, {}, set()
    for row in rows:
        _require(isinstance(row, dict) and not row.get("manual_locked") and not row.get("is_setup") and row.get("phase") != "setup", "unsupported_operation")
        _require(_empty(row.get("employee_ids")) and _empty(row.get("materials")) and _empty(row.get("material_ids")), "operation_constraints")
        key = _chain_key(row)
        oid = _identifier(row.get("operation_id"))
        _require(key[0] in spec["orders"], "foreign_order")
        quantity, expected = spec["orders"][key[0]]
        _require(1 <= key[1] <= quantity and oid in expected and (key, oid) not in identities, "operation_identity")
        sequence, duration = expected[oid]
        _require(_same(row.get("sequence"), sequence) and _same(row.get("duration_min"), duration), "nonfixed_duration")
        for field in ("batch_quantity", "batch_capacity"):
            _require(_same(row.get(field, 1), 1), "nonunit_batch")
        _require(_same(row.get("batch_count", quantity), quantity), "batch_count_mismatch")
        ids = row.get("equipment_ids")
        _require(isinstance(ids, list) and len(ids) == 1 and _identifier(ids[0]) in spec["machines"], "unsupported_assignment")
        for resource in row.get("resources") or []:
            _require(resource.get("resource_type") == "equipment" and _identifier(resource.get("id")) == _identifier(ids[0]), "inconsistent_resources")
        _interval(row)
        for field, anchor in (("process_start_min", "start_min"), ("process_end_min", "end_min"), ("finish_min", "end_min")):
            _require(field not in row or _same(row[field], row[anchor]), "multiphase_operation")
        chains.setdefault(key, []).append(row)
        resources.setdefault(_identifier(ids[0]), []).append(row)
        identities.add((key, oid))
    _require(len(chains) == sum(q for q, _ in spec["orders"].values()), "missing_batches")
    for key, chain in chains.items():
        chain.sort(key=lambda row: row["sequence"])
        _require(len(chain) == len(spec["orders"][key[0]][1]), "incomplete_chain")
        _require(all(a["end_min"] <= b["start_min"] + EPS for a, b in zip(chain, chain[1:])), "precedence_violation")
    for items in resources.values():
        items.sort(key=lambda row: row["start_min"])
        _require(all(a["end_min"] <= b["start_min"] + EPS for a, b in zip(items, items[1:])), "resource_overlap")
    duration = max(row["end_min"] for row in rows)
    _require(_same(sim.get("duration_minutes"), duration) and _same(sim.get("fitness"), duration), "non_duration_fitness")
    batches = sim.get("batches")
    _require(isinstance(batches, list) and len(batches) == len(chains), "batch_summary_missing")
    batch_keys = set()
    for batch in batches:
        key = _chain_key(batch)
        _require(key in chains and key not in batch_keys, "batch_summary_invalid")
        _require(_same(batch.get("quantity", batch.get("area", 1)), 1) and _same(batch.get("capacity", 1), 1), "batch_summary_nonunit")
        batch_keys.add(key)
    return chains, resources


def _slot(calendar, ready, duration):
    at = ready
    for start, end in sorted(calendar):
        if at + duration <= start + EPS:
            break
        if at < end:
            at = end
    return at


def _times(chains, order_ids, mode):
    rank = {str(oid): index for index, oid in enumerate(order_ids)}
    keys = sorted(chains, key=lambda key: (rank[key[0]], key[1]))
    indices = {key: 0 for key in keys}
    ready = {key: 0.0 for key in keys}
    calendars, result = {}, {}
    while len(result) < sum(len(chain) for chain in chains.values()):
        available = [key for key in keys if indices[key] < len(chains[key])]
        if mode == "round_robin":
            selected = available
        else:
            def score(key):
                row = chains[key][indices[key]]
                machine = str(row["equipment_ids"][0])
                at = _slot(calendars.get(machine, []), ready[key], row["duration_min"])
                remaining = sum(op["duration_min"] for op in chains[key][indices[key]:])
                return at, -remaining, rank[key[0]], key[1]
            selected = [min(available, key=score)]
        for key in selected:
            row = chains[key][indices[key]]
            machine, duration = str(row["equipment_ids"][0]), row["duration_min"]
            start = _slot(calendars.get(machine, []), ready[key], duration)
            end = start + duration
            calendars.setdefault(machine, []).append((start, end))
            result[(key, str(row["operation_id"]))] = (start, end)
            ready[key] = end
            indices[key] += 1
    return result


def _stamp(origin, minute, old):
    result = origin + timedelta(minutes=minute)
    if isinstance(old, datetime):
        return result
    _require(isinstance(old, str), "unsupported_timestamp")
    return result.isoformat().replace("+00:00", "Z") if old.endswith("Z") else result.isoformat()


def _metrics(chains, resources, spec, duration):
    busy = sum(row["duration_min"] for chain in chains.values() for row in chain)
    waiting = sum(chain[0]["start_min"] + sum(b["start_min"] - a["end_min"] for a, b in zip(chain, chain[1:])) for chain in chains.values())
    gaps = sum(sum(b["start_min"] - a["end_min"] for a, b in zip(items, items[1:])) for items in resources.values())
    return {"wait": waiting, "idle": duration * len(spec["machines"]) - busy, "gaps": gaps}


def _schedule_signature(sim):
    def rows_signature(rows):
        return tuple((_chain_key(row), row.get("operation_id"), row.get("sequence"), row.get("duration_min"), row.get("start_min"), row.get("end_min"), tuple(row.get("equipment_ids") or []), tuple(row.get("employee_ids") or []), row.get("batch_quantity"), row.get("batch_capacity"), row.get("manual_locked")) for row in rows)
    return (rows_signature(sim["operations"]), rows_signature(sim.get("generic_operations") or []), tuple((_chain_key(batch), batch.get("start_min"), batch.get("end_min")) for batch in sim["batches"]), sim["duration_minutes"], sim["fitness"])


def _retime(sim, spec, chains, resources, times):
    candidate = copy.deepcopy(sim)
    def retime_row(row):
        start, end = times[(_chain_key(row), str(row["operation_id"]))]
        row["start_min"], row["end_min"] = start, end
        for field, value in (("process_start_min", start), ("process_end_min", end), ("finish_min", end), ("_auto_start_min", start), ("_auto_end_min", end)):
            if field in row:
                row[field] = value
        for field, value in (("start", start), ("end", end)):
            if field in row:
                row[field] = _stamp(spec["origin"], value, row[field])
    for row in candidate["operations"]:
        retime_row(row)
    if "generic_operations" in candidate:
        for row in candidate["generic_operations"]:
            retime_row(row)
        candidate["generic_operations"].sort(key=lambda row: (row["start_min"], row["end_min"]))
    batch_rows = {}
    for row in candidate["operations"]:
        batch_rows.setdefault(_chain_key(row), []).append(row)
    for batch in candidate["batches"]:
        rows = batch_rows[_chain_key(batch)]
        batch["start_min"] = min(row["start_min"] for row in rows)
        batch["end_min"] = max(row["end_min"] for row in rows)
        for field, minute in (("start", batch["start_min"]), ("end", batch["end_min"])):
            if field in batch:
                batch[field] = _stamp(spec["origin"], minute, batch[field])
    duration = max(row["end_min"] for row in candidate["operations"])
    candidate["duration_minutes"] = duration
    candidate["fitness"] = duration
    if "finish" in candidate:
        candidate["finish"] = _stamp(spec["origin"], duration, candidate["finish"])
    new_chains, new_resources = _contract(candidate, spec)
    before = _metrics(chains, resources, spec, sim["duration_minutes"])
    after = _metrics(new_chains, new_resources, spec, duration)
    # Recognize existing metric definitions rather than guessing their meaning.
    if "operator_wait_minutes" in candidate:
        value = sim["operator_wait_minutes"]
        if _same(value, before["wait"]):
            candidate["operator_wait_minutes"] = after["wait"]
        else:
            _require(_same(value, 0), "unknown_wait_metric")
            candidate["operator_wait_minutes"] = 0
    if "machine_idle_minutes" in candidate:
        value = sim["machine_idle_minutes"]
        metric = "idle" if _same(value, before["idle"]) else "gaps"
        _require(_same(value, before[metric]), "unknown_idle_metric")
        candidate["machine_idle_minutes"] = max(0.0, after[metric])
    for field in ("resource_busy", "equipment_busy"):
        if field in candidate:
            busy = candidate[field]
            _require(isinstance(busy, dict) and set(map(str, busy)) <= spec["machines"], "unknown_busy_contract")
            for machine, intervals in busy.items():
                _require(isinstance(intervals, list) and all(isinstance(i, (list, tuple)) and len(i) == 2 for i in intervals), "unknown_busy_intervals")
                busy[machine] = [(row["start_min"], row["end_min"]) for row in new_resources.get(str(machine), [])]
    return candidate


def install_operation_interleave(ga, model, objective="duration", pins=None):
    """Install before make_constrained_scheduler; return whether it was installed."""
    original = ga.get("_pp_schedule_sequence")
    validate = ga.get("_pp_validate_generic")
    if getattr(original, "_pp_operation_interleave_version", None) == VERSION and isinstance(ga.get(DIAGNOSTIC_KEY), dict):
        return True
    diagnostic = {"version": VERSION, "eligible": False, "improved_candidates": 0, "fallback_reason": None}
    ga[DIAGNOSTIC_KEY] = diagnostic

    def record_fallback(reason):
        code = str(reason).split(":", 1)[0]
        if code not in DIAGNOSTIC_REASONS:
            code = "runtime_contract_unsupported"
        if diagnostic["fallback_reason"] is None:
            diagnostic["fallback_reason"] = code

    if objective != "duration" or pins or not callable(original) or not callable(validate):
        record_fallback("objective_not_supported" if objective != "duration" else "manual_pins" if pins else "native_hooks_missing")
        return False
    try:
        spec = _model_spec(model)
        model_snapshot = copy.deepcopy(model)
    except (Unsupported, ValueError, TypeError, KeyError, OverflowError) as exc:
        record_fallback(str(exc) if isinstance(exc, Unsupported) else "runtime_contract_unsupported")
        _diagnostic("ineligible", reason=diagnostic["fallback_reason"])
        return False

    diagnostic["eligible"] = True
    dispatch_cache = OrderedDict()
    reported = set()
    _diagnostic("installed", operation_count=spec["count"], machine_count=len(spec["machines"]))

    def interleaved(candidate_model, order_ids):
        # Exceptions from the actual decoder keep their original semantics.
        base = original(candidate_model, order_ids)
        try:
            _require(candidate_model == model_snapshot, "model_changed")
            ids = list(map(str, order_ids))
            _require(len(ids) == len(spec["orders"]) and len(set(ids)) == len(ids) and set(ids) == set(spec["orders"]), "bad_order_sequence")
            chains, resources = _contract(base, spec)
            best = base
            lower_bound = max(max(sum(row["duration_min"] for row in chain) for chain in chains.values()), max(sum(row["duration_min"] for row in items) for items in resources.values()))
            if base["duration_minutes"] <= lower_bound + EPS:
                return base
            assignment = tuple((key, tuple((str(row["operation_id"]), row["duration_min"], str(row["equipment_ids"][0])) for row in chains[key])) for key in sorted(chains))
            for mode in ("round_robin", "frontier"):
                cache_key = (tuple(ids), assignment, mode)
                if cache_key not in dispatch_cache:
                    dispatch_cache[cache_key] = _times(chains, ids, mode)
                    if len(dispatch_cache) > 16:
                        dispatch_cache.popitem(last=False)
                times = dispatch_cache[cache_key]
                candidate = _retime(base, spec, chains, resources, times)
                if candidate["duration_minutes"] >= best["duration_minutes"] - EPS:
                    continue
                checked_rows = _schedule_signature(candidate)
                errors = validate(candidate_model, candidate)
                if errors is not None and not (isinstance(errors, (list, tuple)) and not errors):
                    record_fallback("native_validation_rejected")
                    if "native_rejected" not in reported:
                        reported.add("native_rejected")
                        _diagnostic("native_rejected")
                    continue
                # A native validator must not change the schedule being accepted.
                _require(checked_rows == _schedule_signature(candidate), "validator_mutated_schedule")
                _contract(candidate, spec)
                best = candidate
                if "improved" not in reported:
                    reported.add("improved")
                    _diagnostic("improved", before_minutes=base["duration_minutes"], after_minutes=best["duration_minutes"], native_validated=True)
                if best["duration_minutes"] <= lower_bound + EPS:
                    break
            if best is not base:
                diagnostic["improved_candidates"] += 1
            return best
        except Exception as exc:
            # Fail closed on an unsupported private-runtime contract. Process
            # cancellation (BaseException/termination) is never swallowed.
            record_fallback(str(exc) if isinstance(exc, Unsupported) else "runtime_contract_unsupported")
            if "fallback" not in reported:
                reported.add("fallback")
                _diagnostic("fallback", reason=diagnostic["fallback_reason"])
            return base

    interleaved._pp_operation_interleave_version = VERSION
    ga["_pp_schedule_sequence"] = interleaved
    return True
