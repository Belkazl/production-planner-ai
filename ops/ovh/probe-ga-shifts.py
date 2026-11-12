#!/usr/bin/env python3
"""Synthetic 12-order GA shift-window verifier; print no customer data."""
from ga_workers.full_runtime_adapter import _namespace
from ga_workers.constraints import _verify
model={
 "scheduler_mode":"resource","start":"2026-11-10T08:00:00",
 "equipment":[{"id":"EQ"+str(i),"name":"Machine","kind":"workstation","capacity":600,"capacity_unit":"m2"} for i in range(14)],
 "employees":[{"id":"EM"+str(i),"name":"Operator","shift":"day"} for i in range(5)],
 "shifts":{"day":[["08:00","12:00"],["13:00","17:00"]]},
 "orders":[{"id":"O"+str(i),"quantity":600,"unit":"m2","technical_process_id":"TP","parameters":{"color":str(i%2)}} for i in range(12)],
 "technical_processes":[{"id":"TP","name":"Seven steps","operations":[{
     "id":"OP"+str(j),"name":"Stage","sequence":j+1,"duration_min":30,
     "resource_requirements":[
       {"resource_type":"equipment","resource_ref":"EQ"+str(j),"resource_refs":["EQ"+str(j)],"match_mode":"specific","quantity":1},
       {"resource_type":"employee","resource_ref":"EM"+str(j%5),"resource_refs":["EM"+str(j%5)],"match_mode":"specific","quantity":1}
     ]} for j in range(7)]}],
 "setup_rules":[],"materials":[]
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
print("GA_SHIFT_DIAGNOSTIC_COUNTS","rows",len(rows),"outside",len(failures),
      "first",failures[:8],"duration",sim.get("duration_minutes"),flush=True)
print("GA_SHIFT_DIAGNOSTIC_WINDOW_SAMPLE",str(next(iter(win.items()),None))[:500],flush=True)
try:
 errs=ga["_pp_validate_generic"](m,sim)
 print("GA_SHIFT_DIAGNOSTIC_NATIVE_VALID",len(errs or []),"error_types",
       sorted(set(str(x).split(":")[0][:35] for x in (errs or [])))[:8],flush=True)
except Exception as e:print("GA_SHIFT_DIAGNOSTIC_NATIVE_ERROR",type(e).__name__,flush=True)
try:
 _verify(m,sim,[],ga)
 print("GA_SHIFT_DIAGNOSTIC_STRICT_PASS")
except Exception as e:print("GA_SHIFT_DIAGNOSTIC_STRICT_REJECT",str(e)[:50],flush=True)
