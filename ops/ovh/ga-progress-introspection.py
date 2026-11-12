"""Emit only safe counts/types of GA internal scheduling hooks in disposable OVH.
Never show proprietary source, inputs, credentials, job IDs or actual plans.
"""
import inspect,collections
from ga_workers.full_runtime_adapter import _namespace

def req(tp,rid):
 return {'resource_type':tp,'resource_ref':rid,'resource_refs':[rid],'match_mode':'specific','quantity':1}
model={
 'scheduler_mode':'resource','start':'2026-11-11T08:00:00',
 'equipment':[{'id':'QA_EQ','name':'QA Press','kind':'workstation','capacity':10,'capacity_unit':'pcs'}],
 'employees':[{'id':'QA_EMP','name':'QA Operator','shift':'day'}],
 'shifts':{'day':[['08:00','12:00'],['13:00','17:00']]},
 'orders':[{'id':x,'quantity':5,'unit':'pcs','technical_process_id':'TP','parameters':{'color':x}} for x in ['OA','OB','OC']],
 'technical_processes':[{'id':'TP','name':'Press','operations':[{'id':'OP','name':'Press','sequence':1,'duration_min':30,
   'resource_requirements':[req('equipment','QA_EQ'),req('employee','QA_EMP')]}]}],
 'setup_rules':[],'materials':[]
}
ga=_namespace()
print('SAFE_GA_PREVIEW_HOOKS',','.join(x+':'+str(callable(ga.get(x))) for x in [
 '_pp_schedule_sequence','_pp_optimize_generic','_pp_progress_snapshot','optimize','validate_plan_v2','_pp_setup_generic_apply']),flush=True)
for name in ('_pp_schedule_sequence','_pp_progress_snapshot','_pp_optimize_generic','_pp_setup_generic_apply','validate_plan_v2'):
 fn=ga.get(name)
 if callable(fn):
  try:
   sig=inspect.signature(fn)
   print('SAFE_GA_HOOK_SIGNATURE',name,','.join(sig.parameters.keys()),flush=True)
  except Exception:pass
normalized=ga['canonicalize_model'](model)
ga['CURRENT_MODEL']=normalized
ga['install_model'](normalized)
stats=collections.Counter()
def register(name):
 old=ga.get(name)
 if not callable(old):return
 def wrapped(*args,**kwargs):
  stats[name+'_calls']+=1
  result=old(*args,**kwargs)
  stats[name+'_return_'+type(result).__name__]+=1
  if isinstance(result,dict):
   if name+'_first_keys' not in stats:
    stats[name+'_first_keys']=','.join(sorted(str(k) for k in result.keys())[:55])
    stats[name+'_first_ops_count']=len(result.get('operations') or [])
    stats[name+'_first_op_keys']=','.join(sorted(str(k) for k in (result.get('operations') or [{}])[0].keys())[:40]) if result.get('operations') else ''
   stats[name+'_dict_ops_'+str(bool(result.get('operations')))]+=1
   stats[name+'_dict_generic_'+str(bool(result.get('generic_operations')))]+=1
   stats[name+'_dict_valid_'+str(result.get('valid'))]+=1
  if isinstance(result,tuple):
   stats[name+'_tuple_len_'+str(len(result))]+=1
   for i,part in enumerate(result[:3]):
    stats[name+'_part_'+str(i)+'_'+type(part).__name__]+=1
    if isinstance(part,dict):
     stats[name+'_part_'+str(i)+'_ops_'+str(bool(part.get('operations')))]+=1
  return result
 ga[name]=wrapped
for name in ('_pp_schedule_sequence','_pp_setup_generic_apply','validate_plan_v2'):
 register(name)
try:
 result=ga['optimize'](6,6,4,False,'duration')
 print('SAFE_GA_RUN_VALID',bool(isinstance(result,dict) and result.get('valid')),'ops',len(result.get('operations') or []),'result_keys',','.join(sorted(result.keys())[:60]),flush=True)
except Exception as e:
 print('SAFE_GA_RUN_ERROR_CLASS',type(e).__name__,flush=True)
print('SAFE_GA_HOOK_COUNTS',dict(stats),flush=True)
