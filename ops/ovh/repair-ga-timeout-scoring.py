#!/usr/bin/env python3
"""LiftOrbit OVH GA: validate live scores and preserve a verified best at hard time limit.

Apply after repair-ga-live-previews.py to a pinned, isolated GA worker source
tree. Only the adapter and manager change; no GA fitness or selection logic
is modified and no account/database state is ever reset.
"""
import pathlib
import sys

root=pathlib.Path(sys.argv[1]).resolve()
if not str(root).endswith("/ga_python_workers"):
    raise SystemExit("GA_SCORE_GUARD_PINNED_WORKTREE_REQUIRED")
adapter=root/"ga_workers"/"full_runtime_adapter.py"
manager=root/"ga_workers"/"manager.py"
src=adapter.read_text()
msrc=manager.read_text()

def replace_unique(old,new,label,target="adapter"):
    global src,msrc
    original=src if target=="adapter" else msrc
    count=original.count(old)
    if count!=1:
        raise SystemExit("GA_SCORE_GUARD_ANCHOR_"+label+"_"+str(count))
    if target=="adapter":src=src.replace(old,new)
    else:msrc=msrc.replace(old,new)

replace_unique("import re\nimport threading\nimport time",
               "import re\nimport threading\nimport time\nimport math",
               "imports")
replace_unique("from .constraints import make_constrained_scheduler, PinConstraintError",
               "from .constraints import make_constrained_scheduler, PinConstraintError, _verify",
               "full_constraint_validation")

start=src.find("def _live_scheduler_preview(sim, model, objective):\n")
end=src.find("\ndef run(payload,progress):",start)
if start<0 or end<start or src.count("def _live_scheduler_preview(sim, model, objective):")!=1:
    raise SystemExit("GA_SCORE_GUARD_PREVIEW_HELPER_CHANGED")
helper='''def _live_scheduler_preview(sim, model, objective, ga, pins, checkpoint=False):
    """Only report schedules independently checked against all GA constraints.

    A simulator snapshot has no 'valid' field. The previous compatibility bridge
    set valid=True unconditionally, which could show optimistic but unusable
    completion times. _verify checks shifts, personnel, machine overlap,
    materials, manual locks and the engine's generic validation.
    """
    if not isinstance(sim,dict) or not isinstance(sim.get('ctx'),dict):
        return None
    rows=sim.get('operations')
    setups=sim.get('setup_operations') or []
    if not isinstance(rows,list) or not rows or not isinstance(setups,list):
        return None
    try:
        _verify(model,sim,pins,ga)
        stated=float(sim['duration_minutes'])
        actual=max(float(r['end_min']) for r in rows+setups)
        if not math.isfinite(stated) or stated<0 or abs(stated-actual)>1e-4:
            seen=getattr(_live_scheduler_preview,"_bad_score",0)
            if seen<3:
                print("GA_PREVIEW_SCORE_MISMATCH",round(stated,3),round(actual,3),flush=True)
                _live_scheduler_preview._bad_score=seen+1
            return None
        model_ids=[str(x.get('id')) for x in model.get('orders') or []]
        if len(model_ids)!=len(set(model_ids)) or not model_ids:
            return None
        schedule_ids={str(x.get('order')) for x in rows}
        if schedule_ids!=set(model_ids):
            return None
    except (ValueError, TypeError, KeyError, IndexError, PinConstraintError, OverflowError) as exc:
        observed=getattr(_live_scheduler_preview,"_rejected",0)
        if observed<5:
            # Fixed safe error code only. Do not log any model or plan content.
            detail=str(exc)
            detail=detail if detail and len(detail)<90 and all(c.islower() or c.isdigit() or c=="_" for c in detail) else type(exc).__name__
            print("GA_PREVIEW_STRICT_REJECTION",detail,flush=True)
            _live_scheduler_preview._rejected=observed+1
        return None
    fields=('operations','batches','changeovers','duration_minutes',
            'machine_idle_minutes','operator_wait_minutes','batch_count',
            'setup_count','setup_minutes','operation_count','setup_operations')
    plan={k:copy.deepcopy(sim[k]) for k in fields if k in sim}
    plan.update({'ok':True,'valid':True,'partial':False,
                 'objective':objective,'start':model.get('start'),
                 'generic_operations':plan['operations']})
    try:_assert_owned(plan,model)
    except FullGAError:return None
    if checkpoint:
        cache=ga.get('_PP_GENERIC_STATE') or {}
        stored=cache.get('best_order')
        if isinstance(stored,list) and len(stored)==len(model_ids) and set(map(str,stored))==set(model_ids):
            seq=list(map(str,stored))
        else:
            seq=[];seen=set()
            for row in sorted(rows,key=lambda x:(float(x.get('start_min') or 0),
                                                 float(x.get('end_min') or 0))):
                oid=str(row.get('order'))
                if oid not in seen:seq.append(oid);seen.add(oid)
        if len(seq)!=len(model_ids) or set(seq)!=set(model_ids):
            return plan
        plan['order_sequence']=seq
        try:
            runs=int(cache.get('run') or 1)
            trials=int(cache.get('total_trials') or 0)
            plan['optimization_run']=max(1,min(1000000,runs))
            plan['total_generations']=max(0,min(100000000,trials))
            plan['resume_state']=export_resume_state(plan,model,objective,pins)
            # Trusted only inside this account's worker process and supervisor.
            plan['_pp_verified_checkpoint_v1']=True
        except (ContinuationError, ValueError, TypeError):
            pass
    return plan


'''
src=src[:start]+helper+src[end:]

replace_unique("    state={'candidate_preview':None,'candidate_seq':0,'best_preview':None,'best_seq':0}",
'''    state={'candidate_preview':None,'candidate_seq':0,'best_preview':None,'best_seq':0,
           'verified_checkpoint':None,'candidate_checked_at':0.0,'best_checked_at':0.0}''',"verified_state_without_unreliable_cooperative_timeout")

replace_unique('''                live=_preview_plan(raw,normalized) or _live_scheduler_preview(sim_arg,normalized,objective_arg)
                if live is not None:
                    state['candidate_preview']=live
                    state['candidate_seq']=int(state.get('candidate_seq') or 0)+1''',
'''                now_check=time.monotonic()
                if now_check-state['candidate_checked_at']>=1.8:
                    state['candidate_checked_at']=now_check
                    live=_live_scheduler_preview(sim_arg,normalized,objective_arg,ga,pins)
                    if live is not None:
                        state['candidate_preview']=live
                        state['candidate_seq']=int(state.get('candidate_seq') or 0)+1''',
"candidate_strict_only")

replace_unique('''                live=_preview_plan(raw,normalized) or _live_scheduler_preview(sim_arg,normalized,objective_arg)
                if live is not None:
                    state['best_preview']=live
                    state['best_seq']=int(state.get('best_seq') or 0)+1''',
'''                now_check=time.monotonic()
                if now_check-state['best_checked_at']>=1.5 or not state.get('verified_checkpoint'):
                    state['best_checked_at']=now_check
                    live=_live_scheduler_preview(sim_arg,normalized,objective_arg,ga,pins,checkpoint=True)
                    if live is not None:
                        old=state.get('verified_checkpoint')
                        # Best found must not become worse for the duration objective.
                        if (old is None or objective_arg!='duration' or
                            float(live['duration_minutes'])<=float(old['duration_minutes'])+1e-8):
                            state['best_preview']=live
                            state['best_seq']=int(state.get('best_seq') or 0)+1
                            if live.get('_pp_verified_checkpoint_v1'):
                                state['verified_checkpoint']=live''',
"best_strict_checkpoint")

replace_unique('''    def compute():
        try:state['result']=ga['optimize'](gens,population,seed,continuing,objective)
        except BaseException as exc:state['exception']=exc''',
'''    def compute():
        try:state['result']=ga['optimize'](gens,population,seed,continuing,objective)
        except BaseException as exc:state['exception']=exc''',"unchanged_private_ga_compute")
replace_unique("    original_progress_candidate=ga.get('_pp_progress_candidate')",
'''    # Build a feasible incumbent using the same official GA scheduler, before
    # the stochastic search. The native engine's tentative best/candidates may
    # violate shifts on large jobs; never promote those to 'valid'. This
    # deterministic baseline is independently verified and belongs only to the
    # current worker's account/model. It does not modify GA selection.
    if ga['_pp_generic_declared'](normalized):
        try:
            order_ids=[str(o.get('id')) for o in normalized.get('orders') or []]
            cache=ga.get('_PP_GENERIC_STATE') or {}
            hint=cache.get('best_order')
            if not isinstance(hint,list) or set(map(str,hint))!=set(order_ids) or len(hint)!=len(order_ids):
                hint=order_ids
            initial=ga['_pp_schedule_sequence'](normalized,hint)
            initial=ga['_pp_setup_generic_apply'](normalized,initial)
            checked=_live_scheduler_preview(initial,normalized,objective,ga,pins,checkpoint=True)
            if isinstance(checked,dict) and checked.get('_pp_verified_checkpoint_v1'):
                # Only the successfully verified plan is eligible for the
                # supervisor's time-limit recovery path.
                state['best_preview']=checked
                state['verified_checkpoint']=checked
                state['best_seq']=1
                print('GA_FEASIBLE_INITIAL_INCUMBENT_READY',flush=True)
        except (ValueError, TypeError, KeyError, PinConstraintError, FullGAError, OverflowError):
            print('GA_INITIAL_INCUMBENT_NOT_VERIFIED',flush=True)
    original_progress_candidate=ga.get('_pp_progress_candidate')''',"feasible_starting_incumbent")
replace_unique("    progress({'percent':1,'phase':'starting','running':True})",
'''    initial_progress={'percent':1,'phase':'starting','running':True}
    if state.get('best_preview') is not None:
        initial_progress['best_preview']=state['best_preview']
    progress(initial_progress)''',"publish_verified_baseline_before_search")

replace_unique("            best=_preview_plan(snap.get('best_preview'),normalized) or state.get('best_preview')",
               "            best=state.get('best_preview')",
               "published_best_requires_validation")
replace_unique("            candidate=state.get('candidate_preview') or _preview_plan(snap.get('candidate_preview'),normalized)",
               "            candidate=state.get('candidate_preview')",
               "published_candidate_requires_validation")

replace_unique('''    result=state.get('result')
    if not isinstance(result,dict) or not result.get('ok') or result.get('valid') is not True:
        raise FullGAError('ga_no_valid_solution')
    _assert_owned(result,normalized)''',
'''    result=state.get('result')
    if not isinstance(result,dict) or not result.get('ok') or result.get('valid') is not True:
        raise FullGAError('ga_no_valid_solution')
    # A completed GA may legally use a different batching order, but a strict
    # independently verified earlier best of shorter duration is preferable
    # for Shortest duration. Never replace with an unverified candidate.
    best_checkpoint=state.get('verified_checkpoint')
    if (objective=='duration' and best_checkpoint and
        float(best_checkpoint['duration_minutes'])+1e-6<float(result.get('duration_minutes',float('inf')))):
        result=copy.deepcopy(best_checkpoint)
        result['optimization_prior_best_restored']=True
    _assert_owned(result,normalized)''',"never_discard_verified_best")

replace_unique("    result['locked_operations_applied']=len(pins)",
'''    result.pop('_pp_verified_checkpoint_v1',None)
    result['locked_operations_applied']=len(pins)''',"strip_private_marker")

# Hard timeout fallback if a single candidate generation fails to yield
# control before the soft deadline. Only a checkpoint verified in the worker
# (including a portable resume state) is eligible to be returned as a result.
m_old='''                if time.monotonic() > deadline:
                    with self.cv:
                        if job.state == "running" and not job.stop_requested:
                            disposition = "timed_out"
                            terminal_error = "worker_timeout"
                    self._terminate(proc)
                    break'''
m_new='''                if time.monotonic() > deadline:
                    with self.cv:
                        if job.state == "running" and not job.stop_requested:
                            prior=job.best_preview
                            verified=(isinstance(prior,dict) and
                                      prior.get('_pp_verified_checkpoint_v1') is True and
                                      prior.get('valid') is True and
                                      isinstance(prior.get('resume_state'),dict) and
                                      bool(prior.get('operations')))
                            if verified:
                                checkpoint=prior.copy()
                                checkpoint.pop('_pp_verified_checkpoint_v1',None)
                                checkpoint['optimization_time_limit_reached']=True
                                checkpoint['optimization_completed_early']=True
                                checkpoint['optimization_termination_reason']='worker_time_budget'
                                checkpoint['optimization_percent_at_limit']=job.progress
                                job.result=checkpoint
                                disposition="completed"
                            else:
                                disposition="timed_out"
                                terminal_error="worker_timeout"
                    self._terminate(proc)
                    break'''
replace_unique(m_old,m_new,"supervisor_checkpoint_salvage",target="manager")

adapter.write_text(src)
manager.write_text(msrc)
print('GA_VALIDATED_BEST_NEVER_REGRESSES_AND_TIMEOUT_CHECKPOINT_RECOVERY_READY',flush=True)
