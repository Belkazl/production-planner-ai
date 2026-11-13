"""Safety-first synthetic GA shift repair experiment. No production writes or models."""
import copy, runpy
from ga_workers.constraints import _verify
state=runpy.run_path("../../ops/ops/ovh/probe-ga-shifts.py")
ga,model,raw=state["ga"],state["m"],state["sim"]
sim=copy.deepcopy(raw)
windows=sim.get("ctx",{}).get("emp_windows") or {}
rows=(sim.get("operations") or [])+(sim.get("setup_operations") or [])
rows=sorted(rows,key=lambda r:(float(r.get("start_min") or 0),int(r.get("is_setup") is not True)))
print("SHIFT_REPAIR_INPUT",len(rows),"first_keys",sorted(rows[0].keys())[:40],flush=True)
print("SHIFT_REPAIR_STRUCTURE","batch_keys",sorted((sim.get("batches") or [{}])[0].keys())[:40],
      "setup_keys",sorted((sim.get("setup_operations") or [{}])[0].keys())[:40],
      "changeover_type",type(sim.get("changeovers")).__name__,flush=True)
busy={}
batch_busy={}
moved=0
delayed=0
for row in rows:
    start=float(row["start_min"])
    end=float(row["end_min"])
    duration=end-start
    if duration<=0:raise ValueError("nonpositive_duration")
    resources=[("equipment",str(x)) for x in row.get("equipment_ids") or []]
    employees=[str(x) for x in row.get("employee_ids") or []]
    resources.extend(("employee",x) for x in employees)
    batchkey=(str(row.get("order")),str(row.get("batch_id") or row.get("batch") or 1))
    at=max(start,batch_busy.get(batchkey,0.0),*[busy.get(r,0.0) for r in resources])
    if employees:
        choices=sorted((float(a),float(b)) for a,b in windows.get(employees[0],[]))
        fits=False
        for a,b in choices:
            proposed=max(at,a)
            if proposed+duration<=b+1e-7 and all(
                ga["_pp_in_window"](windows,em,proposed,duration) for em in employees):
                at=proposed;fits=True;break
        if not fits:raise ValueError("cannot_fit_in_any_staff_window")
    if at>start+1e-8:
        delta=at-start
        for name in ("start_min","end_min","finish_min","process_start_min","process_end_min",
                     "setup_start_min","setup_end_min","load_start_min","load_end_min"):
            if row.get(name) is not None:
                row[name]=round(float(row[name])+delta,6)
        moved+=1;delayed+=delta
    batch_busy[batchkey]=max(batch_busy.get(batchkey,0.0),float(row["end_min"]))
    for r in resources:busy[r]=max(busy.get(r,0.0),float(row["end_min"]))
for batch in sim.get("batches") or []:
    key=(str(batch.get("order")),str(batch.get("batch_id") or batch.get("batch") or 1))
    linked=[o for o in sim.get("operations") or [] if
            (str(o.get("order")),str(o.get("batch_id") or o.get("batch") or 1))==key]
    if linked:
        batch["start_min"]=min(float(o["start_min"]) for o in linked)
        batch["end_min"]=max(float(o["end_min"]) for o in linked)
sim["duration_minutes"]=max(float(r["end_min"]) for r in rows)
sim["fitness"]=sim["duration_minutes"]
equipment_count=len(model.get("equipment") or [])
busy_total=sum(float(r["end_min"])-float(r["start_min"]) for r in rows
               for _ in r.get("equipment_ids") or [])
sim["machine_idle_minutes"]=max(0.0,sim["duration_minutes"]*equipment_count-busy_total)
print("SHIFT_REPAIR_OUTPUT","moved",moved,"total_delay",round(delayed,1),
      "old_makespan",raw.get("duration_minutes"),"new_makespan",sim["duration_minutes"],flush=True)
try:
    _verify(model,sim,[],ga)
    print("SHIFT_REPAIR_STRICT_PASS",flush=True)
except Exception as e:
    print("SHIFT_REPAIR_STRICT_REJECT",str(e)[:90],flush=True)
    raise
