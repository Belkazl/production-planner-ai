#!/usr/bin/env python3
"""LiftOrbit OVH GA: validate live scores and preserve a verified best at time limit.

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
            return None
        model_ids=[str(x.get('id')) for x in model.get('orders') or []]
        if len(model_ids)!=len(set(model_ids)) or not model_ids:
            return None
        schedule_ids={str(x.get('order')) for x in rows}
        if schedule_ids!=set(model_ids):
            return None
    except (ValueError, TypeError, KeyError, IndexError, PinConstraintError, OverflowError):
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
           'verified_checkpoint':None,'candidate_checked_at':0.0,'best_checked_at':0.0}
    class _GASoftTimeLimit(Exception):
        pass
    original_step=ga.get('_pp_progress_step')
    soft_seconds=max(3,int(os.getenv('PP_PY_GA_TIMEOUT_S','600'))-12)
    soft_deadline=time.monotonic()+soft_seconds
    if callable(original_step):
        def bounded_progress_step(*args,**kwargs):
            # The existing worker timeout remains an absolute hard limit.
            # Only abort cooperatively if a real fully validated checkpoint is
            # available; otherwise the original bounded-failure path applies.
            if time.monotonic()>=soft_deadline and state.get('verified_checkpoint'):
                raise _GASoftTimeLimit()
            return original_step(*args,**kwargs)
        ga['_pp_progress_step']=bounded_progress_step''',"state_and_budget")

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
        try:
            state['result']=ga['optimize'](gens,population,seed,continuing,objective)
        except _GASoftTimeLimit:
            checkpoint=state.get('verified_checkpoint')
            if not checkpoint:
                state['exception']=FullGAError('ga_time_budget_exhausted_without_valid_plan')
            else:
                result=copy.deepcopy(checkpoint)
                result['optimization_time_limit_reached']=True
                result['optimization_completed_early']=True
                result['optimization_termination_reason']='time_budget'
                state['result']=result
        except BaseException as exc:state['exception']=exc''',"soft_completion")
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
