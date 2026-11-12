#!/usr/bin/env python3
"""Bounded, per-process propagation of REAL intermediate GA schedules.

Never starts a parallel optimizer, changes optimization decisions, or exposes a
plan from a different account. Hooks only the GA engine's existing 'candidate'
and 'best' notification calls. Production-app persistence is untouched.
"""
import pathlib,sys
root=pathlib.Path(sys.argv[1]).resolve()
if not str(root).endswith('/ga_python_workers'):raise SystemExit('PREVIEW_REPAIR_EXPECTS_GA_WORKTREE')
adapter=root/'ga_workers'/'full_runtime_adapter.py'
manager=root/'ga_workers'/'manager.py'
s=adapter.read_text()
anchor="    state={}\n    def compute():"
fragment='''    # Publish actual schedules observed at the engine's existing accepted-best
    # and tested-candidate hook points. The GA still owns all decisions.
    preview_lock=threading.Lock()
    live_previews={'best':None,'candidate':None,'best_version':0,'candidate_version':0}
    last_capture={'best':0.0,'candidate':0.0}
    def _capture_schedule(kind,sim,objective):
        if not isinstance(sim,dict):return
        now_tick=time.monotonic()
        if now_tick-last_capture[kind]<1.75:return
        rows=sim.get('operations')
        if not isinstance(rows,list) or not rows:return
        metric=sim.get('duration_minutes')
        if not isinstance(metric,(int,float)) or not (0<=metric<1e10):return
        fields=('operations','batches','changeovers','duration_minutes',
                'machine_idle_minutes','operator_wait_minutes','batch_count',
                'setup_count','setup_minutes','operation_count')
        plan={k:copy.deepcopy(sim[k]) for k in fields if k in sim}
        plan.update({'ok':True,'valid':True,'partial':False,
                     'start':normalized.get('start'),'objective':objective,
                     'generic_operations':plan['operations']})
        # Never expose unscheduled or foreign operations in a preview.
        try:_assert_owned(plan,normalized)
        except Exception:return
        with preview_lock:
            live_previews[kind]=plan
            live_previews[kind+'_version']+=1
            last_capture[kind]=now_tick
    def _wrap_progress_hook(name,kind):
        original_hook=ga.get(name)
        if not callable(original_hook):raise FullGAError('ga_progress_hook_unavailable')
        def report(model,sim,objective):
            value=original_hook(model,sim,objective)
            try:_capture_schedule(kind,sim,objective)
            except Exception:pass
            return value
        ga[name]=report
    _wrap_progress_hook('_pp_progress_best','best')
    _wrap_progress_hook('_pp_progress_candidate','candidate')
    last_sent_versions=(-1,-1)
    state={}
    def compute():'''
if s.count(anchor)!=1:raise SystemExit('PREVIEW_ADAPTER_STATE_ANCHOR_CHANGED')
s=s.replace(anchor,fragment)
original='''            best=snap.get('best_preview')
            if (pct,last[1] if best is not None else 0)!=last:
                # Preserve the preview contract without reporting data from
                # another account; all inputs here belong to this one process.
                preview={'percent':min(99,max(1,pct)),'phase':snap.get('phase','optimizing'),'running':True}
                if isinstance(best,dict) and best.get('operations'):
                    preview['best_preview']=best
                progress(preview)
                last=(pct,1 if best is not None else 0)'''
updated='''            best=snap.get('best_preview')
            with preview_lock:
                versions=(live_previews['best_version'],live_previews['candidate_version'])
                changed=versions!=last_sent_versions
                observed_best=copy.deepcopy(live_previews['best']) if changed else None
                observed_candidate=copy.deepcopy(live_previews['candidate']) if changed else None
            if pct!=last[0] or changed or (best is not None and last[1]==0):
                # The per-account process reports only actual schedules.
                preview={'percent':min(99,max(1,pct)),'phase':snap.get('phase','optimizing'),'running':True}
                if changed and observed_best is not None:preview['best_preview']=observed_best
                elif isinstance(best,dict) and best.get('operations'):preview['best_preview']=best
                if changed and observed_candidate is not None:preview['candidate_preview']=observed_candidate
                progress(preview)
                last=(pct,1 if best is not None or observed_best is not None else 0)
                last_sent_versions=versions'''
if s.count(original)!=1:raise SystemExit('PREVIEW_ADAPTER_POLL_ANCHOR_CHANGED')
s=s.replace(original,updated)
adapter.write_text(s)
m=manager.read_text()
rep=[
('    best_preview: Optional[dict] = field(default=None, repr=False)\n',
 '    best_preview: Optional[dict] = field(default=None, repr=False)\n    candidate_preview: Optional[dict] = field(default=None, repr=False)\n'),
('"error": job.error, "best_preview": job.best_preview,',
 '"error": job.error, "best_preview": job.best_preview, "candidate_preview": job.candidate_preview,'),
('''                            if isinstance(data.get("best_preview"), dict):
                                job.best_preview = data["best_preview"]''',
 '''                            if isinstance(data.get("best_preview"), dict):
                                job.best_preview = data["best_preview"]
                            if isinstance(data.get("candidate_preview"), dict):
                                job.candidate_preview = data["candidate_preview"]''')
]
for old,new in rep:
 if m.count(old)!=1:raise SystemExit('PREVIEW_MANAGER_ANCHOR_CHANGED')
 m=m.replace(old,new)
manager.write_text(m)
print('GA_REAL_INTERMEDIATE_BEST_AND_CANDIDATE_PATCH_READY',flush=True)
