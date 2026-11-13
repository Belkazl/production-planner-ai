#!/usr/bin/env python3
"""OVH GA: create only independently verified shift-safe deadline checkpoints.

Post-process a copy of the native scheduler's candidate solely for an optional
checkpoint; the live GA fitness, mutation/selection and accepted plan are never
modified. A result is published ONLY when the original strict independent
validator confirms employee shifts, equipment, precedence, materials, pins.
"""
import pathlib
import sys

root=pathlib.Path(sys.argv[1]).resolve()
if not str(root).endswith("/ga_python_workers"):
    raise SystemExit("GA_SHIFT_CHECKPOINT_EXPECTS_PINNED_GA_WORKTREE")
file=root/"ga_workers"/"full_runtime_adapter.py"
source=file.read_text()

def once(old,new,label):
    global source
    count=source.count(old)
    if count!=1:
        raise SystemExit("GA_SHIFT_CHECKPOINT_ANCHOR_"+label+"_"+str(count))
    source=source.replace(old,new)

helper='''def _pp_shift_safe_checkpoint(sim,model,ga):
    """Retiming is read-only relative to the real GA and account model.

    Preserve original resource and operation order; move only forward into
    the configured working shift. The full independent validator rejects any
    remaining problem, including material or batch-order violations.
    """
    if not isinstance(sim,dict) or not isinstance(sim.get('ctx'),dict):
        return None
    original=sim.get('operations') or []
    setup=sim.get('setup_operations') or []
    if not isinstance(original,list) or not original or not isinstance(setup,list):
        return None
    if len(original)+len(setup)>20000:
        return None
    if any(x.get('manual_locked') for x in original+setup):
        return None
    try:
        retimed=copy.deepcopy(sim)
        windows=retimed['ctx'].get('emp_windows')
        if not isinstance(windows,dict):
            return None
        production=retimed.get('operations') or []
        setups=retimed.get('setup_operations') or []
        timeline=sorted(production+setups,
                        key=lambda x:(float(x.get('start_min') or 0),
                                      0 if x.get('is_setup') else 1))
        occupied={}
        precedes={}
        changed=0
        for row in timeline:
            start=float(row['start_min'])
            end=float(row['end_min'])
            duration=end-start
            if not math.isfinite(duration) or duration<=0:
                return None
            resources=[('eq',str(x)) for x in row.get('equipment_ids') or []]
            staff=[str(x) for x in row.get('employee_ids') or []]
            resources.extend(('employee',x) for x in staff)
            batch=(str(row.get('order')),str(row.get('batch_id') or
                   row.get('batch') or 1))
            at=max([start,precedes.get(batch,0.0)]+
                   [occupied.get(r,0.0) for r in resources])
            if staff:
                intervals=windows.get(staff[0])
                if not isinstance(intervals,list):
                    return None
                found=False
                for lo,hi in intervals:
                    candidate=max(at,float(lo))
                    if (candidate+duration<=float(hi)+1e-7 and
                        all(ga['_pp_in_window'](windows,emp,candidate,duration)
                            for emp in staff)):
                        at=candidate
                        found=True
                        break
                if not found:
                    return None
            if not math.isfinite(at) or at>end+120*1440:
                return None
            delta=at-start
            if delta>1e-7:
                for key in ('start_min','end_min','finish_min','process_start_min',
                            'process_end_min','setup_start_min','setup_end_min',
                            'load_start_min','load_end_min'):
                    if row.get(key) is not None:
                        row[key]=round(float(row[key])+delta,6)
                changed+=1
            precedes[batch]=max(precedes.get(batch,0.0),float(row['end_min']))
            for key in resources:
                occupied[key]=max(occupied.get(key,0.0),float(row['end_min']))
        by_batch={}
        for row in production:
            key=(str(row.get('order')),str(row.get('batch_id') or
                 row.get('batch') or 1))
            if key not in by_batch:by_batch[key]=[float(row['start_min']),float(row['end_min'])]
            else:
                by_batch[key][0]=min(by_batch[key][0],float(row['start_min']))
                by_batch[key][1]=max(by_batch[key][1],float(row['end_min']))
        for batch in retimed.get('batches') or []:
            key=(str(batch.get('order')),str(batch.get('batch_id') or
                 batch.get('batch') or 1))
            if key in by_batch:
                batch['start_min'],batch['end_min']=by_batch[key]
        retimed['duration_minutes']=max(float(r['end_min']) for r in timeline)
        count=len(model.get('equipment') or model.get('autoclaves') or [])
        occupied_total=sum(float(r['end_min'])-float(r['start_min'])
                           for r in timeline for _ in r.get('equipment_ids') or [])
        retimed['machine_idle_minutes']=max(0.0,retimed['duration_minutes']*count-
                                            occupied_total)
        if changed:
            retimed['_pp_staff_retimed_rows']=changed
        return retimed
    except (ValueError,TypeError,KeyError,IndexError,OverflowError):
        return None


'''
once("def _live_scheduler_preview(sim, model, objective, ga, pins, checkpoint=False):\n",
     helper+"def _live_scheduler_preview(sim, model, objective, ga, pins, checkpoint=False):\n",
     "insert_staff_shift_retime")
once("    try:\n        _verify(model,sim,pins,ga)\n        stated=float(sim['duration_minutes'])",
'''    try:
        try:
            _verify(model,sim,pins,ga)
        except PinConstraintError as problem:
            if str(problem)!='schedule_staff_shift_invalid' or pins:
                raise
            repaired=_pp_shift_safe_checkpoint(sim,model,ga)
            if repaired is None:
                raise
            # Validation is authoritative, not the private retimer.
            _verify(model,repaired,pins,ga)
            sim=repaired
            rows=sim.get('operations') or []
            setups=sim.get('setup_operations') or []
        stated=float(sim['duration_minutes'])''',
     "repair_strict_shift_error_only")
once("    plan.update({'ok':True,'valid':True,'partial':False,",
'''    if sim.get('_pp_staff_retimed_rows'):
        plan['staff_shift_repaired']=True
    plan.update({'ok':True,'valid':True,'partial':False,''',
     "signal_shift_adjusted_preview")
file.write_text(source)
print("GA_SHIFT_SAFE_VERIFIED_CHECKPOINT_PATCH_READY",flush=True)
