"""Bounded observation of the existing native batching implementation.

This module does not search, change a model, repair a plan, or replace a native
candidate. Metadata is returned only in the owning account's result. It never
prints source, constants other than filtered technical identifier names,
defaults, environment values, model identifiers, or model text.
"""
import copy
import hashlib
import json
import math
import re
import types
from datetime import datetime


VERSION = "batch-size-diagnostics-v1-20261124"
KEY = "_PP_BATCH_SIZE_DIAGNOSTICS"
MAX_FUNCTIONS = 56
MAX_REFERENCES = 20
MAX_SAMPLES = 16
MAX_ROWS = 10000
MAX_BATCHES = 4096
IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,70}$")
# Identifier shape alone cannot distinguish a technical key from an arbitrary
# private literal. Constants therefore use an explicit public vocabulary;
# function/parameter/binding names remain discoverable through code metadata.
TECHNICAL_BATCH_KEYS = frozenset({
    "batch", "batches", "batching", "batch_id", "batch_count", "batch_counts",
    "batch_quantity", "batch_quantities", "batch_size", "batch_sizes", "batch_capacity",
    "batch_unit", "batch_policy", "batch_mode", "batch_plan", "batch_gene", "batch_genes",
    "batch_factor", "batch_factors", "batch_ratio", "batch_ratios", "batch_limits",
    "min_batch_size", "max_batch_size", "min_batch_quantity", "max_batch_quantity",
    "min_batch_count", "max_batch_count", "per_order_batch_sizes", "per_order_batch_counts",
    "minibatch_size", "minibatch_sizes", "minibatch_count", "minibatch_counts",
    "mini_batch_size", "mini_batch_sizes", "mini_batch_count", "mini_batch_counts",
    "split", "splits", "split_size", "split_sizes", "split_count", "split_counts",
    "split_quantity", "split_quantities", "split_gene", "split_genes", "split_factor",
    "split_factors", "split_ratio", "split_ratios", "split_mode", "split_policy",
    "lot_size", "lot_sizes", "lot_count", "lot_counts", "min_lot_size", "max_lot_size",
    "chunk_size", "chunk_sizes", "chunk_count", "chunk_counts",
})
RELEVANT = re.compile(r"batch|capacity|split|lot|chunk|mutat|cross|genom|chromos|repair|material|staff", re.I)
ANCHORS = (
    "optimize", "_pp_optimize_generic", "_pp_schedule_sequence",
    "_pp_setup_generic_apply", "_pp_validate_generic", "validate_plan_v2",
    "canonicalize_model", "install_model", "_pp_progress_preview",
    "_pp_progress_candidate",
)


def _identifier(value):
    return isinstance(value, str) and IDENTIFIER.fullmatch(value) is not None


def _function(value):
    return isinstance(value, (types.FunctionType, types.BuiltinFunctionType))


def _kind(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, (tuple, list)):
        return "array"
    return "other"


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def _function_metadata(binding, fn, namespace):
    code = getattr(fn, "__code__", None)
    implementation = getattr(fn, "__name__", None)
    aliases = sorted(name for name, value in namespace.items()
                     if value is fn and _identifier(name))
    result = {
        "binding": binding, "kind": "python" if code is not None else "builtin",
        "implementation": implementation if _identifier(implementation) else None,
        "aliases": aliases[:8], "aliases_truncated": len(aliases) > 8,
        "parameters": [], "references": [], "closure_functions": [],
        "batch_parameter_names": [],
    }
    if code is None:
        return result
    result["first_line"] = code.co_firstlineno
    positionals = list(code.co_varnames[:code.co_argcount])
    keywords = list(code.co_varnames[code.co_argcount:code.co_argcount + code.co_kwonlyargcount])
    parameters = [{"name": name, "kind": "positional_only" if i < code.co_posonlyargcount else "positional"}
                  for i, name in enumerate(positionals) if _identifier(name)]
    parameters += [{"name": name, "kind": "keyword_only"} for name in keywords if _identifier(name)]
    cursor = code.co_argcount + code.co_kwonlyargcount
    for flag, kind in ((4, "varargs"), (8, "varkw")):
        if code.co_flags & flag:
            name = code.co_varnames[cursor]
            cursor += 1
            if _identifier(name):
                parameters.append({"name": name, "kind": kind})
    result["parameters"] = parameters[:24]
    result["parameters_truncated"] = len(parameters) > 24
    references = sorted({name for name in code.co_names if _identifier(name)
                         and _function(namespace.get(name))})
    result["references"] = [{"binding": name,
                              "implementation": getattr(namespace[name], "__name__", None)
                              if _identifier(getattr(namespace[name], "__name__", None)) else None}
                             for name in references[:MAX_REFERENCES]]
    result["references_truncated"] = len(references) > MAX_REFERENCES
    # Identifier names only: never export arbitrary strings, nested code, numeric
    # constants, source fragments, defaults, or the contents of closed-over data.
    technical_names = sorted({value for value in code.co_consts
                              if isinstance(value, str) and value in TECHNICAL_BATCH_KEYS})
    result["batch_parameter_names"] = technical_names[:24]
    result["batch_parameter_names_truncated"] = len(technical_names) > 24
    closures = []
    for name, cell in zip(code.co_freevars, fn.__closure__ or ()):
        if not _identifier(name):
            continue
        try:
            value = cell.cell_contents
        except ValueError:
            continue
        if not _function(value):
            continue
        impl = getattr(value, "__name__", None)
        if _identifier(impl):
            closures.append({"variable": name, "implementation": impl,
                             "bindings": sorted(k for k, v in namespace.items()
                                                if v is value and _identifier(k))[:8]})
    result["closure_functions"] = closures[:8]
    result["closure_functions_truncated"] = len(closures) > 8
    return result


def _native_functions(namespace):
    roots = [name for name in ANCHORS if _function(namespace.get(name))]
    roots += sorted(name for name, value in namespace.items()
                    if name not in roots and _identifier(name)
                    and RELEVANT.search(name) and _function(value))
    queue = [(name, namespace[name], 0) for name in roots]
    seen = set()
    functions = []
    while queue and len(functions) < MAX_FUNCTIONS:
        name, fn, depth = queue.pop(0)
        if name in seen:
            continue
        seen.add(name)
        if not _function(fn):
            continue
        metadata = _function_metadata(name, fn, namespace)
        metadata["closure_depth"] = depth
        functions.append(metadata)
        for ref in metadata["references"]:
            if ref["binding"] not in seen:
                queue.append((ref["binding"], namespace[ref["binding"]], 0))
        # Our operation-interleave observer (and native wrappers) may keep the
        # actual decoder only in a callable closure. Inspect function metadata,
        # never any closed-over model/credential/string/object values.
        if depth < 3 and isinstance(fn, types.FunctionType):
            descendants = []
            for variable, cell in zip(fn.__code__.co_freevars, fn.__closure__ or ()):
                if not _identifier(variable):
                    continue
                try:
                    target = cell.cell_contents
                except ValueError:
                    continue
                if _function(target) and _identifier(getattr(target, "__name__", None)):
                    descendants.append((name + ".closure." + variable, target, depth + 1))
            queue[0:0] = descendants[:8]
    return {"functions": functions, "functions_truncated": bool(queue),
            "matching_function_count": len(roots)}


def _date(value):
    if not isinstance(value, str):
        raise ValueError("unsupported_date")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def material_prefix_summary(model, sim):
    """Independent stock prefix check; diagnostic only, not a full validator."""
    try:
        if not isinstance(model, dict) or not isinstance(sim, dict):
            raise ValueError("unsupported_shape")
        rows = sim.get("operations") or sim.get("generic_operations")
        materials = model.get("materials") or []
        if not isinstance(rows, list) or not isinstance(materials, list) or len(rows) > MAX_ROWS or len(materials) > 256:
            raise ValueError("unsupported_shape")
        start = _date(model.get("start")) if materials else None
        events = {}
        stocks = {}
        for material in materials:
            if not isinstance(material, dict) or material.get("id") is None:
                raise ValueError("unsupported_material")
            mid = str(material["id"])
            stock = _number(material.get("initial_stock", 0))
            if mid in events or stock is None or stock < 0:
                raise ValueError("unsupported_material")
            stocks[mid] = stock
            events[mid] = []
            deliveries = material.get("deliveries") or []
            if not isinstance(deliveries, list) or len(deliveries) > 4096:
                raise ValueError("unsupported_deliveries")
            for delivery in deliveries:
                if not isinstance(delivery, dict):
                    raise ValueError("unsupported_delivery")
                quantity = _number(delivery.get("quantity"))
                at = (_date(delivery.get("at")) - start).total_seconds() / 60
                if quantity is None or quantity < 0 or not math.isfinite(at):
                    raise ValueError("unsupported_delivery")
                events[mid].append((at, 0, quantity))
        material_rows = 0
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError("unsupported_operation")
            uses = row.get("materials") or []
            if not isinstance(uses, list) or len(uses) > 256:
                raise ValueError("unsupported_usage")
            if uses:
                material_rows += 1
            for usage in uses:
                if not isinstance(usage, dict):
                    raise ValueError("unsupported_usage")
                mid = str(usage.get("id"))
                quantity, at = _number(usage.get("quantity")), _number(row.get("start_min"))
                if mid not in events or quantity is None or at is None or quantity < 0 or at < 0:
                    raise ValueError("unsupported_usage")
                events[mid].append((at, 1, -quantity))
        invalid = 0
        for mid, timeline in events.items():
            stock = stocks[mid]
            for _, _, change in sorted(timeline):
                stock += change
                if stock < -1e-6:
                    invalid += 1
                    break
        return {"status": "invalid" if invalid else "valid", "reason": "stock_prefix_negative" if invalid else None,
                "checked_materials": len(events), "material_rows": material_rows,
                "negative_stock_material_count": invalid}
    except (ValueError, TypeError, KeyError, OverflowError) as exc:
        allowed = {"unsupported_shape", "unsupported_date", "unsupported_material", "unsupported_deliveries",
                   "unsupported_delivery", "unsupported_operation", "unsupported_usage"}
        reason = str(exc) if str(exc) in allowed else "unsupported_shape"
        return {"status": "unsupported", "reason": reason}


def _input_key(model):
    if not isinstance(model, dict) or not isinstance(model.get("orders"), list):
        return None
    if len(model["orders"]) > MAX_BATCHES:
        return None
    fields = ("batch_quantity", "batch_size", "batch_count", "min_batch_size", "max_batch_size")
    rows = []
    for order in model["orders"]:
        if not isinstance(order, dict) or order.get("id") is None:
            return None
        rows.append((str(order["id"]), tuple((name, _number(order.get(name))) for name in fields if name in order)))
    return hashlib.sha256(json.dumps(sorted(rows), separators=(",", ":")).encode()).hexdigest()


def _schedule_sample(sim):
    summary = {"result_kind": _kind(sim)}
    if not isinstance(sim, dict):
        return summary, None, None
    rows = sim.get("operations") or sim.get("generic_operations")
    batches = sim.get("batches")
    summary.update({"operation_count": len(rows) if isinstance(rows, list) else None,
                    "batch_count": len(batches) if isinstance(batches, list) else None,
                    "duration_minutes": _number(sim.get("duration_minutes"))})
    if not isinstance(batches, list) or len(batches) > MAX_BATCHES:
        return summary, None, None
    partitions = {}
    for batch in batches:
        if not isinstance(batch, dict) or batch.get("order") is None:
            return summary, None, None
        quantity = _number(batch.get("quantity", batch.get("area")))
        if quantity is None or quantity <= 0:
            return summary, None, None
        partitions.setdefault(str(batch["order"]), []).append(quantity)
    quantities = [quantity for values in partitions.values() for quantity in values]
    summary.update({"minimum_batch_quantity": min(quantities, default=None),
                    "maximum_batch_quantity": max(quantities, default=None),
                    "distinct_batch_quantities": len(set(quantities)), "partition_order_count": len(partitions)})
    sizes = sorted((order, sorted(values)) for order, values in partitions.items())
    counts = sorted((order, len(values)) for order, values in partitions.items())
    digest = lambda value: hashlib.sha256(json.dumps(value, separators=(",", ":")).encode()).hexdigest()
    return summary, digest(sizes), digest(counts)


def install_batch_size_diagnostics(ga, model):
    original = ga.get("_pp_schedule_sequence")
    if getattr(original, "_pp_batch_size_diagnostics_version", None) == VERSION and isinstance(ga.get(KEY), dict):
        return False
    metadata = _native_functions(ga)
    diagnostic = {"version": VERSION, "mode": "diagnostic_only", **metadata,
                  "scheduler_hook_present": callable(original), "scheduler_sample_limit": MAX_SAMPLES,
                  "scheduler_calls_observed": 0, "scheduler_samples": [],
                  "distinct_input_batch_vectors": 0, "input_batch_fields_changed_from_model": False,
                  "distinct_partition_vectors": 0, "distinct_count_vectors": 0,
                  "first_raw_material_prefix": None, "final_plan": None}
    ga[KEY] = diagnostic
    if not callable(original):
        return False
    baseline_input = _input_key(model)
    input_keys, partitions, count_keys = set(), set(), set()

    def observed(*args, **kwargs):
        # The original exception and return object preserve native semantics.
        result = original(*args, **kwargs)
        if diagnostic["scheduler_calls_observed"] >= MAX_SAMPLES:
            return result
        diagnostic["scheduler_calls_observed"] += 1
        try:
            candidate_model = args[0] if args else kwargs.get("candidate_model", kwargs.get("model"))
            order_ids = args[1] if len(args) > 1 else kwargs.get("order_ids")
            sample, partition_key, count_key = _schedule_sample(result)
            sample["input_model_kind"] = _kind(candidate_model)
            sample["sequence_kind"] = _kind(order_ids)
            if isinstance(order_ids, (tuple, list)):
                sample["sequence_length"] = len(order_ids)
                sample["sequence_element_kinds"] = sorted({_kind(value) for value in order_ids[:MAX_BATCHES]})
            input_key = _input_key(candidate_model)
            if input_key is not None:
                input_keys.add(input_key)
                diagnostic["input_batch_fields_changed_from_model"] |= baseline_input is not None and input_key != baseline_input
            if partition_key is not None:
                partitions.add(partition_key)
            if count_key is not None:
                count_keys.add(count_key)
            diagnostic["distinct_input_batch_vectors"] = len(input_keys)
            diagnostic["distinct_partition_vectors"] = len(partitions)
            diagnostic["distinct_count_vectors"] = len(count_keys)
            diagnostic["scheduler_samples"].append(sample)
            if diagnostic["first_raw_material_prefix"] is None:
                diagnostic["first_raw_material_prefix"] = material_prefix_summary(candidate_model, result)
        except Exception:
            # Observation must never alter successful native calculation.
            diagnostic["observation_error"] = "unsupported_native_contract"
        return result

    observed._pp_batch_size_diagnostics_version = VERSION
    ga["_pp_schedule_sequence"] = observed
    return True


def finalize_batch_size_diagnostics(ga, result, model):
    diagnostic = ga.get(KEY)
    if not isinstance(diagnostic, dict):
        return None
    snapshot = copy.deepcopy(diagnostic)
    summary, _, _ = _schedule_sample(result)
    summary["material_prefix"] = material_prefix_summary(model, result)
    snapshot["final_plan"] = summary
    return snapshot
