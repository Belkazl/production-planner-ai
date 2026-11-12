#!/usr/bin/env python3
"""Repair the source-verified per-account GA preview hooks in the pinned worker.

The private GA owns the original candidate/best decisions. This patch only
normalizes the real scheduling result at those existing callback points.
Never starts a parallel scheduler or writes accepted/saved plans.
"""
import pathlib,sys
root=pathlib.Path(sys.argv[1]).resolve()
if not str(root).endswith('/ga_python_workers'):raise SystemExit('PREVIEW_REPAIR_EXPECTS_GA_WORKTREE')
adapter=root/'ga_workers'/'full_runtime_adapter.py'
src=adapter.read_text()
def once(a,b,label):
 global src
 if src.count(a)!=1:raise SystemExit('PREVIEW_GA_ANCHOR_'+label+'_'+str(src.count(a)))
 src=src.replace(a,b)
helper='''def _live_scheduler_preview(sim, model, objective):
    """Build only a temporary read-only view from a genuine GA schedule.

    Never serialize ctx, GA private state, or any other account's model.
    This is called only from the optimizer's candidate/best event itself.
    """
    if not isinstance(sim,dict):return None
    rows=sim.get('operations')
    if not isinstance(rows,list) or not rows:return None
    fields=('operations','batches','changeovers','duration_minutes',
            'machine_idle_minutes','operator_wait_minutes','batch_count',
            'setup_count','setup_minutes','operation_count')
    plan={k:copy.deepcopy(sim[k]) for k in fields if k in sim}
    if not isinstance(plan.get('duration_minutes'),(int,float)):return None
    if not (0<=plan['duration_minutes']<100000000):return None
    plan.update({'ok':True,'valid':True,'partial':False,
                 'objective':objective,'start':model.get('start'),
                 'generic_operations':plan['operations']})
    try:_assert_owned(plan,model)
    except FullGAError:return None
    return plan


'''
once('def run(payload,progress):\n',helper+'def run(payload,progress):\n','add_verified_candidate_view')
once("    state={'candidate_preview':None,'candidate_seq':0}",
     "    state={'candidate_preview':None,'candidate_seq':0,'best_preview':None,'best_seq':0}",
     'state_preview_versions')
once('''                live=_preview_plan(raw,normalized)
                if live is not None:
                    state['candidate_preview']=live
                    state['candidate_seq']=int(state.get('candidate_seq') or 0)+1''',
'''                live=_preview_plan(raw,normalized) or _live_scheduler_preview(sim_arg,normalized,objective_arg)
                if live is not None:
                    state['candidate_preview']=live
                    state['candidate_seq']=int(state.get('candidate_seq') or 0)+1''',
'candidate_from_real_scheduler')
original='''        ga['_pp_progress_candidate']=captured_progress_candidate
    def compute():'''
replacement='''        ga['_pp_progress_candidate']=captured_progress_candidate
    original_progress_best=ga.get('_pp_progress_best')
    if callable(original_progress_best):
        def captured_progress_best(model_arg,sim_arg,objective_arg):
            out=original_progress_best(model_arg,sim_arg,objective_arg)
            try:
                raw=(ga.get('_PP_PLAN_PROGRESS') or {}).get('best_preview')
                live=_preview_plan(raw,normalized) or _live_scheduler_preview(sim_arg,normalized,objective_arg)
                if live is not None:
                    state['best_preview']=live
                    state['best_seq']=int(state.get('best_seq') or 0)+1
            except Exception:pass
            return out
        ga['_pp_progress_best']=captured_progress_best
    def compute():'''
once(original,replacement,'best_from_real_optimizer_event')
once("            best=_preview_plan(snap.get('best_preview'),normalized)",
     "            best=_preview_plan(snap.get('best_preview'),normalized) or state.get('best_preview')",
     'read_best_verified_plan')
if 'candidate_due' not in src or 'PP_GA_CANDIDATE_EMIT' not in src:raise SystemExit('PREVIEW_WORKER_EXPECTED_VERSION_MISSING')
adapter.write_text(src)
manager=(root/'ga_workers'/'manager.py').read_text()
if 'job.candidate_preview = data["candidate_preview"]' not in manager:
 raise SystemExit('PREVIEW_MANAGER_CANDIDATE_PERSISTENCE_MISSING')
print('GA_OFFICIAL_CANDIDATE_AND_BEST_EVENT_PREVIEW_BRIDGE_READY',flush=True)
