import importlib
import sys
import time
from pathlib import Path

if len(sys.argv)!=2:
    raise SystemExit("usage: python3 test_stage.py STAGED_WORKER_DIR")
folder=Path(sys.argv[1]).resolve()
sys.path.insert(0,str(folder))
module=importlib.import_module("ga_workers.full_runtime_adapter")
stages=[]
start=time.monotonic()

def report(event):
    assert isinstance(event,dict) and "percent" in event
    stages.append((event['percent'],event.get('phase'),time.monotonic()-start))

def fake_runtime():
    time.sleep(0.27)
    return {
        'canonicalize_model':lambda m:dict(m),
        'model_ready':lambda m:True,
        'install_model':lambda m:None,
        '_pp_generic_declared':lambda m:False,
        '_pp_progress_snapshot':lambda:{'percent':0,'phase':'building_first_plan','best_preview':None},
        'optimize':lambda *args:(time.sleep(1.3) or {
           'ok':True,'valid':True,'operations':[{'order':'order-1','start':'2026-11-19T08:00:00'}],
           'duration_minutes':120})
    }
module._namespace=fake_runtime
module._assert_owned=lambda plan,model:True
model={'orders':[{'id':'order-1'}], 'equipment':[], 'employees':[]}
result=module.run({'model':model,'options':{'generations':10,'population':12}},report)
actual=[e[0] for e in stages]
expected=[1,2,3,4,5]
assert actual[:5]==expected, ("milestones",stages)
assert [e[1] for e in stages[:5]]==[
 'loading_optimizer','normalizing_model','validating_resources','configuring_optimizer','building_first_plan'], stages
assert stages[0][2]<0.15,("first callback delayed",stages)
assert stages[1][2]>=0.25,("optimizer load reported before it finished",stages)
assert stages[4][2]<0.5,("first-plan prep never reached",stages)
assert result['valid'] and actual[-1]==100,("result or terminal missing",stages)
assert stages[-1][2]-stages[4][2]>=1.2,("first plan phase did not span calculation",stages)
assert all(0<=e[0]<=100 for e in stages)
print("FIRST_STAGE_PYTHON_TRUE_MILESTONES_PASS",[(v,p,round(sec,2)) for v,p,sec in stages[:8]])
