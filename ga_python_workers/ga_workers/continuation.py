"""Portable per-model GA continuation: only a verified order seed, no global state.

The authenticated backend may persist this small state with the owner account.
A new OS worker reconstructs its own GA population from this incumbent order;
it never trusts or returns a prior result without recomputing and validating it.
"""
import hashlib
import json
import math


class ContinuationError(ValueError):
    pass


def fingerprint(value):
    try:
        serial = json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',', ':'),allow_nan=False)
    except (TypeError, ValueError) as ex:
        raise ContinuationError('continuation_state_not_serializable') from ex
    return hashlib.sha256(serial.encode('utf-8')).hexdigest()


def _order_ids(model):
    return [str(x.get('id')) for x in model.get('orders') or []]


def load_resume_plan(plan, model, objective, pins, ga):
    """Seed a fresh isolated GA process from a trusted current/saved plan.

    The plan is not trusted as a schedule. Only its order sequence and counters
    are used; the current model and constraints are always recomputed.
    Legacy/stale sequences are filtered to current orders and any new current
    orders are appended deterministically.
    """
    if not isinstance(plan,dict):
        raise ContinuationError('continuation_seed_missing_or_invalid')
    ids = _order_ids(model)
    if not ids or len(ids) != len(set(ids)):
        raise ContinuationError('continuation_model_orders_invalid')
    sequence = plan.get('order_sequence')
    if not isinstance(sequence,list) or not sequence:
        rows = plan.get('generic_operations') or plan.get('operations') or []
        if isinstance(rows,list):
            rows = sorted((x for x in rows if isinstance(x,dict) and
                           x.get('order') is not None and not x.get('is_setup') and
                           str(x.get('phase') or '').lower() != 'setup'),
                          key=lambda x: (float(x.get('start_min') or 0), float(x.get('end_min') or 0)))
            sequence = [x.get('order') for x in rows]
    if not isinstance(sequence,list):
        raise ContinuationError('continuation_seed_order_sequence_invalid')
    allowed=set(ids); normalized=[]; seen=set()
    for value in sequence:
        item=str(value)
        if item in allowed and item not in seen:
            normalized.append(item);seen.add(item)
    exact=(len(normalized)==len(ids) and set(normalized)==allowed)
    for item in ids:
        if item not in seen:
            normalized.append(item);seen.add(item)
    if len(normalized) != len(ids) or set(normalized) != allowed:
        raise ContinuationError('continuation_seed_foreign_orders')
    runs=plan.get('optimization_run',0)
    trials=plan.get('total_generations',0)
    try:
        runs=max(1,int(runs or 1));trials=max(0,int(trials or 0))
    except (TypeError,ValueError,OverflowError) as ex:
        raise ContinuationError('continuation_seed_counters_invalid') from ex
    if runs > 1_000_000 or trials > 100_000_000:
        raise ContinuationError('continuation_seed_counters_invalid')
    best=plan.get('duration_minutes')
    if not isinstance(best,(int,float)) or isinstance(best,bool) or not math.isfinite(best) or best < 0:
        best=1_000_000_000.0
    if not exact:
        # A stale saved plan may omit newly added orders. It is still useful as
        # an ordering hint, but its historical score must not constrain the new model.
        best=1_000_000_000.0
    cache=ga.get('_PP_GENERIC_STATE')
    if not isinstance(cache,dict):
        raise ContinuationError('continuation_not_supported_by_engine')
    cache.update(best_order=normalized,best_duration=float(best),run=runs,total_trials=trials)
    return normalized


def load_resume_state(state, model, objective, pins, ga):
    if not isinstance(state,dict) or state.get('version') != 1:
        raise ContinuationError('continuation_state_missing_or_invalid')
    if state.get('model_hash') != fingerprint(model):
        raise ContinuationError('continuation_model_changed')
    if state.get('pin_hash') != fingerprint(pins or []):
        raise ContinuationError('continuation_manual_locks_changed')
    if state.get('objective') != objective:
        raise ContinuationError('continuation_objective_changed')
    ids = _order_ids(model)
    sequence = state.get('order_sequence')
    if not isinstance(sequence,list) or len(sequence) != len(ids) or len(ids) != len(set(ids)):
        raise ContinuationError('continuation_order_sequence_invalid')
    normalized = [str(x) for x in sequence]
    if len(normalized) != len(set(normalized)) or set(normalized) != set(ids):
        raise ContinuationError('continuation_foreign_orders')
    runs = state.get('completed_runs',0)
    trials = state.get('total_trials',0)
    if isinstance(runs,bool) or not isinstance(runs,int) or not 1 <= runs <= 1_000_000:
        raise ContinuationError('continuation_run_count_invalid')
    if isinstance(trials,bool) or not isinstance(trials,int) or not 0 <= trials <= 100_000_000:
        raise ContinuationError('continuation_trials_invalid')
    best = state.get('best_duration_minutes')
    if not isinstance(best,(int,float)) or isinstance(best,bool) or not math.isfinite(best) or best < 0:
        raise ContinuationError('continuation_score_invalid')
    cache = ga.get('_PP_GENERIC_STATE')
    if not isinstance(cache,dict):
        raise ContinuationError('continuation_not_supported_by_engine')
    # The sequence is only a seed; the real GA must recompute a fresh valid
    # schedule with the current model and constraints in this OS process.
    cache.update(best_order=normalized,best_duration=float(best),run=runs,total_trials=trials)
    return normalized


def export_resume_state(result, model, objective, pins):
    if not isinstance(result,dict) or result.get('valid') is not True:
        raise ContinuationError('continuation_result_not_valid')
    sequence = result.get('order_sequence')
    ids = _order_ids(model)
    if not isinstance(sequence,list) or sorted(map(str,sequence)) != sorted(ids):
        raise ContinuationError('continuation_result_order_invalid')
    return {'version':1,'model_hash':fingerprint(model),
            'pin_hash':fingerprint(pins or []),'objective':objective,
            'order_sequence':list(sequence),
            'completed_runs':int(result.get('optimization_run') or 1),
            'total_trials':int(result.get('total_generations') or 0),
            'best_duration_minutes':float(result['duration_minutes'])}