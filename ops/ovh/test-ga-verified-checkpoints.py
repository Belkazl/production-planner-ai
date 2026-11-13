"""Test only independently validated read-only GA previews on synthetic 12-order models."""
import copy,math,runpy
from ga_workers.constraints import _verify
from ga_workers.full_runtime_adapter import _live_scheduler_preview
state=runpy.run_path("../../ops/ops/ovh/probe-ga-shifts.py")
ga,model,raw=state['ga'],state['m'],state['sim']
before=[(x['start_min'],x['end_min']) for x in raw['operations']+raw.get('setup_operations',[])]
best=_live_scheduler_preview(raw,model,'duration',ga,[],checkpoint=True)
assert isinstance(best,dict) and best.get('valid') is True,'no independently validated checkpoint'
assert best.get('_pp_verified_checkpoint_v1') is True,'missing trusted verified checkpoint marker'
assert isinstance(best.get('resume_state'),dict),'must preserve portable continuation'
assert best.get('staff_shift_repaired') is True,'test must exercise shift-aware branch'
assert len(best.get('operations') or [])==len(raw['operations'])
all_rows=best['operations']+(best.get('setup_operations') or [])
assert abs(float(best['duration_minutes'])-max(float(r['end_min']) for r in all_rows))<1e-4
assert before==[(x['start_min'],x['end_min']) for x in raw['operations']+raw.get('setup_operations',[])], 'changed native optimizer input'
print('SHIFT_CHECKPOINT_CONFIRMED',
      'ops',len(best['operations']),'setup',len(best.get('setup_operations') or []),
      'time',round(best['duration_minutes']),flush=True)
locked=copy.deepcopy(raw);locked['operations'][0]['manual_locked']=True
assert _live_scheduler_preview(locked,model,'duration',ga,[],checkpoint=True) is None, 'changed manually locked row'
print('SHIFT_CHECKPOINT_MANUAL_LOCK_FENCED',flush=True)
missing=copy.deepcopy(raw);missing['ctx']['emp_windows']={}
assert _live_scheduler_preview(missing,model,'duration',ga,[],checkpoint=True) is None
print('SHIFT_CHECKPOINT_MISSING_SHIFT_REJECTED',flush=True)
large_model=copy.deepcopy(state['model'])
for order in large_model['orders']:order['quantity']=7200
for material in large_model['materials']:material['initial_stock']=1000000000
big=ga['canonicalize_model'](large_model)
ga['install_model'](big)
sim=ga['_pp_schedule_sequence'](big,[str(o['id']) for o in big['orders']])
sim=ga['_pp_setup_generic_apply'](big,sim)
preview=_live_scheduler_preview(sim,big,'duration',ga,[],checkpoint=True)
if preview is None:
    print('SHIFT_CHECKPOINT_LARGE_REJECT',
          'ops',len(sim.get('operations') or []),
          'duration',round(float(sim.get('duration_minutes') or 0)),flush=True)
    raise AssertionError('large_schedule_no_verified_checkpoint')
assert preview.get('valid') is True and preview.get('_pp_verified_checkpoint_v1') is True
assert isinstance(preview.get('resume_state'),dict)
assert preview.get('duration_minutes')>=0
assert len(preview.get('operations') or [])>=800
print('SHIFT_CHECKPOINT_LARGE_PASS',
      'ops',len(preview.get('operations') or []),
      'setup',len(preview.get('setup_operations') or []),
      'duration',round(preview['duration_minutes']),
      'adjusted',preview.get('staff_shift_repaired',False),flush=True)
