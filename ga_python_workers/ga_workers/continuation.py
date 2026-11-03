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