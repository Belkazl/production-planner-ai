#!/usr/bin/env python3
"""Synthetic 12-order GA shift-window verifier; print no customer data."""
from ga_workers.full_runtime_adapter import _namespace, _live_scheduler_preview
from ga_workers.constraints import _verify
model={
 "scheduler_mode":"resource","start":"2026-11-10T08:00:00",
 "equipment":[{"id":"EQ"+str(i),"name":"Machine","kind":"workstation","capacity":600,"capacity_unit":"m2"} for i in range(14)],
 "employees":[{"id":"EM"+str(i),"name":"Operator","shift":"day"} for i in range(5)],
 "shifts":{"day":[["08:00","12:00"],["13:00","17:00"]]},
 "orders":[{"id":"O"+str(i),"quantity":600,"unit":"m2","technical_process_id":"TP","parameters":{"color":"A" if i%2 else "B"}} for i in range(12)],
 "technical_processes":[{"id":"TP","name":"Seven steps","operations":[{
     "id":"OP"+str(j),"name":"Stage","sequence":j+1,"duration_min":30,"setup_parameter":"color",
     "resource_requirements":[
       {"resource_type":"equipment","resource_ref":"EQ"+str(j),"resource_refs":["EQ"+str(j)],"match_mode":"specific","quantity":1},
       {"resource_type":"employee","resource_ref":"EM"+str(j%5),"resource_refs":["EM"+str(j%5)],"match_mode":"specific","quantity":1},
       {"resource_type":"material","resource_ref":"MAT","resource_refs":["MAT"],"quantity":1,"consumption_rule":"per_unit"}
     ]} for j in range(7)]}],
 "setup_rules":[{"id":"QA_AB","setup_parameter":"color","equipment_ref":"*","from_state":"A","to_state":"B","duration_min":15},
                {"id":"QA_BA","setup_parameter":"color","equipment_ref":"*","from_state":"B","to_state":"A","duration_min":15}],
 "materials":[{"id":"MAT","name":"Glaze","unit":"kg","initial_stock":200000,"deliveries":[]}]
}
ga=_namespace()
m=ga["canonicalize_model"](model)
ga["install_model"](m)
sim=ga["_pp_schedule_sequence"](m,[o["id"] for o in m["orders"]])
if callable(ga.get("_pp_setup_generic_apply")):sim=ga["_pp_setup_generic_apply"](m,sim)
ctx=sim.get("ctx") or {}
win=ctx.get("emp_windows") or {}
print("GA_SHIFT_DIAGNOSTIC_CTX",type(ctx).__name__,type(win).__name__,
      "keys",sorted(map(str,ctx.keys()))[:24],flush=True)
rows=(sim.get("operations") or [])+(sim.get("setup_operations") or [])
failures=[]
for r in rows:
 for emp in r.get("employee_ids") or []:
  s=float(r["start_min"]);d=float(r["end_min"])-s
  if not ga["_pp_in_window"](win,str(emp),s,d):
   failures.append((round(s,2),round(s+d,2),str(emp)))
print("GA_SHIFT_DIAGNOSTIC_COUNTS","rows",len(rows),"setups",len(sim.get("setup_operations") or []),"outside",len(failures),
      "first",failures[:8],"duration",sim.get("duration_minutes"),flush=True)
print("GA_SHIFT_DIAGNOSTIC_WINDOW_SAMPLE",str(next(iter(win.items()),None))[:500],flush=True)
checked=_live_scheduler_preview(sim,m,"duration",ga,[],checkpoint=True)
print("GA_SHIFT_DIAGNOSTIC_VERIFIED_CHECKPOINT",
      bool(isinstance(checked,dict) and checked.get("_pp_verified_checkpoint_v1") and
           isinstance(checked.get("resume_state"),dict)),flush=True)

try:
 errs=ga["_pp_validate_generic"](m,sim)
 print("GA_SHIFT_DIAGNOSTIC_NATIVE_VALID",len(errs or []),"error_types",
       sorted(set(str(x).split(":")[0][:35] for x in (errs or [])))[:8],flush=True)
except Exception as e:print("GA_SHIFT_DIAGNOSTIC_NATIVE_ERROR",type(e).__name__,flush=True)
try:
 _verify(m,sim,[],ga)
 print("GA_SHIFT_DIAGNOSTIC_STRICT_PASS")
except Exception as e:print("GA_SHIFT_DIAGNOSTIC_STRICT_REJECT",str(e)[:50],flush=True)

# Diagnostic-only conservative schedule re-timing. Never runs against customer data.
# Move each problematic operation and every subsequent operation forward together,
# preserving original resource order and operation precedences.
import copy
def conservative_shift_probe(source):
  trial=copy.deepcopy(source)
  timeline=sorted((trial.get("operations") or [])+(trial.get("setup_operations") or []),
                  key=lambda r:(float(r.get("start_min") or 0),float(r.get("end_min") or 0)))
  windows=(trial.get("ctx") or {}).get("emp_windows") or {}
  busy={}
  moves=0
  for index,row in enumerate(timeline):
    start=float(row.get("start_min") or 0)
    end=float(row.get("end_min") or 0)
    length=end-start
    if length<=0:return None,moves,"bad_interval"
    resources=[("eq",str(x)) for x in row.get("equipment_ids") or []]
    resources +=[("emp",str(x)) for x in row.get("employee_ids") or []]
    lower=max([start]+[busy.get(k,0) for k in resources])
    staff=list(map(str,row.get("employee_ids") or []))
    target=lower
    if staff:
      first=windows.get(staff[0]) or []
      target=None
      for a,b in first:
        s=max(lower,float(a))
        if s+length<=float(b)+1e-7 and all(ga["_pp_in_window"](windows,p,s,length) for p in staff):
          target=s;break
      if target is None:return None,moves,"no_employee_window"
    delta=target-start
    if delta>1e-7:
      if any(r.get("manual_locked") for r in timeline[index:]):
        return None,moves,"would_move_lock"
      for future in timeline[index:]:
        for key in ("start_min","end_min","finish_min","process_start_min","process_end_min",
                    "setup_start_min","setup_end_min","load_start_min","load_end_min"):
          if future.get(key) is not None:
            future[key]=round(float(future[key])+delta,6)
      moves+=1
      if moves>1500:return None,moves,"excessive_shift"
    for key in resources:busy[key]=max(busy.get(key,0),float(row["end_min"]))
  for batch in trial.get("batches") or []:
    linked=[r for r in trial.get("operations") or [] if str(r.get("order"))==str(batch.get("order"))
            and str(r.get("batch"))==str(batch.get("batch"))]
    if linked:
      batch["start_min"]=min(float(r["start_min"]) for r in linked)
      batch["end_min"]=max(float(r["end_min"]) for r in linked)
  rows=(trial.get("operations") or [])+(trial.get("setup_operations") or [])
  trial["duration_minutes"]=max(float(r["end_min"]) for r in rows)
  trial["machine_idle_minutes"]=max(0,trial["duration_minutes"]*len(model["equipment"])-
    sum(float(r["end_min"])-float(r["start_min"]) for r in rows for _ in r.get("equipment_ids") or []))
  return trial,moves,"ok"

repaired,moves,reason=conservative_shift_probe(sim)
print("GA_SHIFT_CONSERVATIVE_REPAIR",reason,"moves",moves,
      "rows",len((repaired or {}).get("operations") or []),
      "duration",round(float(repaired["duration_minutes"]),1) if repaired else "none",flush=True)
if repaired:
  try:
    _verify(m,repaired,[],ga)
    print("GA_SHIFT_CONSERVATIVE_REPAIR_VERIFIED",True,flush=True)
  except Exception as e:
    print("GA_SHIFT_CONSERVATIVE_REPAIR_VALIDATION",type(e).__name__,str(e)[:65],flush=True)
