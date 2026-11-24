"""Small, fingerprint-bound continuation for the native joint batch incumbent.

Schedules, runtime contexts and callbacks never enter the portable state.  The
native hook imports a seed only; every score is recomputed in the fresh worker.
Legacy v1 order-only continuation remains available through the existing loader.
"""
import copy
import json
import math

from .continuation import (
    ContinuationError,
    fingerprint,
    load_resume_state as _load_v1,
    export_resume_state as _export_v1,
)


JOINT_SCHEMA = "joint-minibatch-v1-20261124"
STATE_KEY = "_PP_JOINT_BATCH_STATE"
MAX_BYTES = 64 * 1024
MAX_ORDERS = 256
MAX_PARTS = 1024
MAX_ORDER_PARTS = 128
BASE_KEYS = frozenset({"version", "model_hash", "pin_hash", "objective", "order_sequence",
    "completed_runs", "total_trials", "best_duration_minutes"})
STATE_KEYS = BASE_KEYS | {"joint_schema", "batch_genome"}


def _bounded_json(value):
    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False,
                             separators=(",", ":"))
    except (TypeError, ValueError, OverflowError, RecursionError) as error:
        raise ContinuationError("continuation_joint_state_not_json") from error
    if len(encoded.encode("utf-8")) > MAX_BYTES:
        raise ContinuationError("continuation_joint_state_too_large")
    return json.loads(encoded)


def _positive_number(value):
    try:
        return (isinstance(value, (int, float)) and not isinstance(value, bool)
                and math.isfinite(value) and value > 0)
    except (TypeError, OverflowError):
        return False


def _validated_genome(genome, model, order_sequence):
    if not isinstance(genome, dict) or set(genome) != {"version", "order_sequence", "partitions"}:
        raise ContinuationError("continuation_joint_genome_invalid")
    if type(genome["version"]) is not int or genome["version"] != 1:
        raise ContinuationError("continuation_joint_genome_version")
    orders = model.get("orders") or []
    ids = [str(order.get("id")) for order in orders]
    if not 1 <= len(ids) <= MAX_ORDERS or len(set(ids)) != len(ids):
        raise ContinuationError("continuation_joint_model_orders")
    sequence = genome["order_sequence"]
    if (not isinstance(sequence, list) or not all(isinstance(item, str) for item in sequence)
            or sequence != list(map(str, order_sequence)) or len(sequence) != len(ids)
            or len(set(sequence)) != len(ids) or set(sequence) != set(ids)):
        raise ContinuationError("continuation_joint_order_sequence")
    partitions = genome["partitions"]
    if not isinstance(partitions, list) or len(partitions) != len(ids):
        raise ContinuationError("continuation_joint_partition_orders")
    quantities = {str(order.get("id")): order.get("quantity") for order in orders}
    count = 0
    for order_id, row in zip(sequence, partitions):
        if (not isinstance(row, dict) or set(row) != {"order_id", "sizes"}
                or row["order_id"] != order_id):
            raise ContinuationError("continuation_joint_partition_identity")
        sizes = row["sizes"]
        if (not isinstance(sizes, list) or not 1 <= len(sizes) <= MAX_ORDER_PARTS
                or not all(_positive_number(size) for size in sizes)):
            raise ContinuationError("continuation_joint_partition_sizes")
        count += len(sizes)
        if count > MAX_PARTS:
            raise ContinuationError("continuation_joint_partition_limit")
        quantity = quantities[order_id]
        if not _positive_number(quantity):
            raise ContinuationError("continuation_joint_order_quantity")
        if abs(math.fsum(sizes) - quantity) > 1e-7 * max(1.0, quantity):
            raise ContinuationError("continuation_joint_quantity_changed")
    # Native load applies its additional unit precision, capacity and frozen-pin
    # checks. Never sort sizes: their order is part of the candidate identity.
    return _bounded_json(genome)


def _hooks(ga):
    state = ga.get(STATE_KEY) if isinstance(ga, dict) else None
    if not isinstance(state, dict) or state.get("version") != JOINT_SCHEMA:
        return None
    if not callable(state.get("load_incumbent")) or not callable(state.get("export_incumbent")):
        return None
    return state


def _load_joint_state(state, model, objective, pins, ga):
    if not isinstance(state, dict) or type(state.get("version")) is not int:
        raise ContinuationError("continuation_state_missing_or_invalid")
    if state["version"] == 1:
        return _load_v1(state, model, objective, pins, ga)
    if state["version"] != 2 or set(state) != STATE_KEYS or state.get("joint_schema") != JOINT_SCHEMA:
        raise ContinuationError("continuation_joint_state_schema")
    state = _bounded_json(state)
    # Delegate the ORIGINAL hashes, objective, order IDs, counters and score to
    # the existing authoritative validator, using a detached validation cache.
    # A rejected state cannot change either real GA cache or the native seed.
    legacy = {key: copy.deepcopy(state[key]) for key in BASE_KEYS}
    legacy["version"] = 1
    shadow = {"_PP_GENERIC_STATE": {}}
    sequence = _load_v1(legacy, model, objective, pins, shadow)
    genome = _validated_genome(state["batch_genome"], model, sequence)
    cache = ga.get("_PP_GENERIC_STATE") if isinstance(ga, dict) else None
    if not isinstance(cache, dict):
        raise ContinuationError("continuation_not_supported_by_engine")
    hooks = _hooks(ga)
    if hooks is None:
        raise ContinuationError("continuation_joint_engine_unavailable")
    try:
        # Contract: this hook validates all native/frozen-pin constraints before
        # its single seed write. It must not retain a rejected partial seed.
        hooks["load_incumbent"](copy.deepcopy(genome))
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        raise ContinuationError("continuation_joint_seed_rejected") from error
    restored = shadow["_PP_GENERIC_STATE"]
    restored["best_duration"] = 1_000_000_000.0
    cache.update(restored)
    return sequence


def load_joint_resume_state(state, model, objective, pins, ga, resume_plan=None):
    try:
        return _load_joint_state(state, model, objective, pins, ga)
    except ContinuationError as original_error:
        if resume_plan is None:
            raise
        sequence = resume_plan.get("order_sequence") if isinstance(resume_plan, dict) else None
        ids = [str(order.get("id")) for order in model.get("orders") or []]
        if (not isinstance(sequence, list) or not ids or len(sequence) != len(ids)
                or len(ids) != len(set(ids)) or any(not isinstance(item, (str, int)) or isinstance(item, bool) for item in sequence)
                or len(set(map(str, sequence))) != len(ids) or set(map(str, sequence)) != set(ids)):
            raise ContinuationError("continuation_order_seed_missing_or_invalid") from original_error
        # An independent ordering hint is safe across schema/pin changes. It
        # receives NO batch genes, previous fitness or prior native state.
        portable = {"version": 1, "model_hash": fingerprint(model),
                    "pin_hash": fingerprint(pins or []), "objective": objective,
                    "order_sequence": list(map(str, sequence)), "completed_runs": 1,
                    "total_trials": 0, "best_duration_minutes": 1_000_000_000.0}
        return _load_v1(portable, model, objective, pins, ga)


def export_joint_resume_state(result, model, objective, pins, ga=None):
    if not isinstance(result, dict) or result.get("valid") is not True or result.get("partial") is True:
        raise ContinuationError("continuation_result_not_valid")
    legacy = _export_v1(result, model, objective, pins)
    hooks = _hooks(ga)
    if hooks is None:
        return legacy
    try:
        # The hook matches THIS selected final result, not the last candidate
        # evaluated. A restored earlier checkpoint may have another genome.
        genome = hooks["export_incumbent"](result)
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        raise ContinuationError("continuation_joint_export_rejected") from error
    if genome is None:
        return legacy
    genome = _validated_genome(genome, model, legacy["order_sequence"])
    state = dict(legacy, version=2, joint_schema=JOINT_SCHEMA, batch_genome=genome)
    return _bounded_json(state)
