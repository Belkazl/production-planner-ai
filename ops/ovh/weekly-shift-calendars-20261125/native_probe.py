"""Private, isolated actual-native calendar witnesses using invented data only."""
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import sys
from datetime import datetime, timedelta

HERE=Path(__file__).resolve().parent
OPS=HERE.parent
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    mod=importlib.util.module_from_spec(spec);sys.modules[name]=mod;spec.loader.exec_module(mod);return mod
def need(value):
    if not value:raise ValueError("weekly_native_witness")

def validate_rows(plan, origin, allowed):
    rows=plan.get("generic_operations") or plan.get("operations") or []
    setups=plan.get("setup_operations") or []
    need(isinstance(rows,list) and rows)
    found=[]
    for row in rows+setups:
        if not row.get("employee_ids"):continue
        start=float(row["start_min"]);end=float(row["end_min"])
        need(end>start and any(start>=a-1e-6 and end<=b+1e-6 for a,b in allowed))
        found.append((start,end))
    need(found)
    return found

def run():
    contract=load("weekly_native_input_contract",OPS/"native-batching-verify-20261124/native_input_contract.py")
    selected=contract.select_code_fields(json.loads(Path("/input/code-inputs.json").read_text()))
    os.environ.clear()
    os.environ.update({"PATH":"/usr/local/bin:/usr/bin:/bin","LC_ALL":"C.UTF-8","PYTHONDONTWRITEBYTECODE":"1",**selected})
    sys.dont_write_bytecode=True
    sys.path.insert(0,"/native")
    from ga_workers import compile_legacy_ga, full_runtime_adapter, joint_minibatch
    compile_legacy_ga.build()
    fixture=load("weekly_native_cases",OPS/"shift-aware-minibatches-20261125/cases.py")
    observer=load("weekly_native_observer",OPS/"shift-aware-minibatches-20261125/verify_shift.py")
    options={"generations":3,"population":6,"seed":1729,"objective":"duration"}
    report={}
    for case in ("friday_lunch_weekend","overnight_break","legacy_lunch"):
        model,_=fixture.fixture("shift_window")
        if case=="friday_lunch_weekend":
            model["start"]="2026-11-27T11:30:00"
            model["shifts"]["day"]=[["08:00","12:00"],["13:00","17:00"]]
            model["shift_calendars"]={"day":{"name":"Invented day","days":[1,2,3,4,5],"start":"08:00","end":"17:00","breaks":[["12:00","13:00"]]}}
            origin=datetime.fromisoformat(model["start"])
            allowed=[]
            for day in range(28):
                d=origin.date()+timedelta(days=day)
                if d.isoweekday()<=5:
                    for low,high in ((480,720),(780,1020)):
                        allowed.append((day*1440+low-690,day*1440+high-690))
        elif case=="overnight_break":
            model["start"]="2026-11-27T22:00:00"
            model["orders"][0]["quantity"]=240
            model["shifts"]["day"]=[["22:00","01:00"],["01:30","06:00"]]
            model["shift_calendars"]={"day":{"name":"Invented night","days":[5],"start":"22:00","end":"06:00","breaks":[["01:00","01:30"]]}}
            origin=datetime.fromisoformat(model["start"])
            allowed=[(d*1440+a,d*1440+b) for d in range(0,28,7) for a,b in ((0,180),(210,480))]
        else:
            model["start"]="2026-11-25T08:00:00"
            model["shifts"]["day"]=[["08:00","12:00"],["13:00","17:00"]]
            origin=datetime.fromisoformat(model["start"])
            allowed=[(d*1440+a,d*1440+b) for d in range(28) for a,b in ((0,240),(300,540))]
        observed=observer.observe(full_runtime_adapter,joint_minibatch,model,options)
        result=observed["result"]
        need(result.get("ok") is True and result.get("valid") is True)
        need(observed["quick"] and observed["distinct"] and observed["caller_unchanged"])
        rows=validate_rows(result,origin,allowed)
        for _,candidate in observed["scored"]:
            validate_rows(candidate,origin,allowed)
        if case=="friday_lunch_weekend":
            need(any(a>=4110-1e-6 for a,b in rows) and any(b<=330+1e-6 for a,b in rows))
        report[case]=True
    # Fixed public labels only. No native source, model, exceptions, or logs leave the sandbox.
    return report
if __name__=="__main__":
    try:
        with open(os.devnull,"w") as sink,contextlib.redirect_stdout(sink),contextlib.redirect_stderr(sink):
            report=run()
        Path("/work/weekly-report.json").write_text(json.dumps(report))
    except Exception as e:
        allowed={"AssertionError","ValueError","KeyError","TypeError","JointContractError","FullGAError","InfeasibleCandidate","ShiftVerificationError","ImportError","AttributeError"}
        Path("/work/weekly-report.json").write_text(json.dumps({"failure_type":type(e).__name__ if type(e).__name__ in allowed else "Exception"}))
        raise SystemExit(6)
