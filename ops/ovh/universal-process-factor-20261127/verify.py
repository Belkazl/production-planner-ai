"""Inspect order-parameter requirements on an isolated native runtime.
Only synthetic fixtures are run; no account records or credentials."""
import ast,builtins,contextlib,copy,hashlib,importlib.util,inspect,json,os,re,sys
from pathlib import Path
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
    return module
ops=Path('/public/ops')
contract=load('native_contract',ops/'native-batching-verify-20261124/native_input_contract.py')
selected=contract.select_code_fields(json.loads(Path('/input/code-inputs.json').read_text()))
compiler=Path('/native/ga_workers/compile_legacy_ga.py').read_bytes()
assert hashlib.sha256(compiler).hexdigest()==contract.COMPILE_SHA
os.environ.clear();os.environ.update({'PATH':'/usr/local/bin:/usr/bin:/bin','LC_ALL':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1',**selected})
sys.path.insert(0,'/native')
from ga_workers import compile_legacy_ga,full_runtime_adapter
with open(os.devnull,'w') as sink,contextlib.redirect_stdout(sink),contextlib.redirect_stderr(sink):
    compile_legacy_ga.build()
    trees=[]
    def capture_compile(source,*args,**kwargs):
        if isinstance(source,ast.AST):trees.append(source)
        return builtins.compile(source,*args,**kwargs)
    full_runtime_adapter.compile=capture_compile
    try:ga=full_runtime_adapter._namespace()
    finally:del full_runtime_adapter.compile
    definitions={n.name:n for tree in trees for n in ast.walk(tree) if isinstance(n,ast.FunctionDef)}



# Real native scheduler with synthetic inputs. No private source or data emitted.
import math
sys.path.insert(0,str(ops/'integrated-setup-verify-20261125'))
from cases import model, rows, schedule_digest
mode=sys.argv[1]
assert mode in ('old','new')
fn=ga['_pp_v1_duration']
assert (hasattr(fn,'__wrapped__')) == (mode=='new')
profiles={'fallback':None,'fixed':{'timing_mode':'fixed','duration_min':10},
          'fixed_default':{'timing_mode':'fixed'},
          'throughput':{'timing_mode':'throughput','throughput_per_hour':6},
          'flow':{'timing_mode':'flow','residence_min':4,'throughput_per_hour':10},
          'invalid_throughput':{'timing_mode':'throughput','throughput_per_hour':0}}
results={}
for name,profile in profiles.items():
    for factor in ((1.0,) if mode=='old' else (0.8,1.0,1.2,2.0)):
        eq={'process_multiplier':factor}
        if profile is not None:eq['timing_profile']=copy.deepcopy(profile)
        original=copy.deepcopy(eq)
        d=fn(10,eq,{'batch_quantity':1},{'id':'O'})
        assert math.isclose(d,10*factor,abs_tol=1e-7),(name,factor,d)
        assert eq==original,'direct_input_mutated'
    if name not in ('fallback','fixed','throughput','flow'):continue
    for factor in ((1.0,) if mode=='old' else (0.8,1.0,1.2)):
        m=model(zero=True)
        m['setup_rules']=[]
        e=m['equipment'][0]
        e['process_multiplier']=factor
        if profile is None:e.pop('timing_profile',None)
        else:e['timing_profile']=copy.deepcopy(profile)
        before=copy.deepcopy(m)
        with open(os.devnull,'w') as sink,contextlib.redirect_stdout(sink),contextlib.redirect_stderr(sink):
            plan=full_runtime_adapter.run({'model':copy.deepcopy(m),'options':{'generations':3,'population':6,'seed':1729,'objective':'duration'}},lambda _:None)
        assert plan.get('valid') is True,(name,factor,'invalid')
        production,setups=rows(plan)
        assert len(production)==3 and not setups
        for r in production:
            assert math.isclose(r['end_min']-r['start_min'],10*factor,abs_tol=1e-6),(name,factor,'duration',r['end_min']-r['start_min'])
            assert r['batch_quantity']==1
        assert m==before
        if factor==1:
            results[name]=schedule_digest(plan)
        print('PROCESS_FACTOR_NATIVE_CASE',json.dumps({'mode':name,'factor':factor,'operation_minutes':10*factor,'valid':True}))
if mode=='old':
    Path('/out/baseline.json').write_text(json.dumps(results))
else:
    assert results==json.loads(Path('/out/baseline.json').read_text()),'factor_one_changed_schedule'
    # Ensure setups retain their own unscaled duration and calendar constraints.
    for factor in (0.8,1.2):
        m=model(delayed=True)
        m['equipment'][0]['process_multiplier']=factor
        # Force a color transition with a fixed order sequence, using the same
        # existing native fixture. Validate independently rather than assume order.
        with open(os.devnull,'w') as sink,contextlib.redirect_stdout(sink),contextlib.redirect_stderr(sink):
            plan=full_runtime_adapter.run({'model':copy.deepcopy(m),'options':{'generations':3,'population':6,'seed':1729,'objective':'duration'}},lambda _:None)
        assert plan.get('valid') is True
        production,setups=rows(plan)
        assert len(production)==3
        for r in production:
            assert r.get('employee_ids')==['SYNTHETIC_EMPLOYEE'],'production_staff_assignment'
        for r in production+setups:
            a,b=r['start_min'],r['end_min']
            want=15 if r in setups else 10*factor
            assert math.isclose(b-a,want,abs_tol=1e-6)
            assert r.get('equipment_ids')==['SYNTHETIC_MACHINE'],'equipment_assignment'
            # As in the independent integrated-setup checker, employee windows
            # constrain rows with an assigned employee, not autonomous setup rows.
            if r.get('employee_ids'):
                assert r['employee_ids']==['SYNTHETIC_EMPLOYEE']
                day=math.floor(a/1440)
                assert any(a>=day*1440+x-1e-6 and b<=day*1440+y+1e-6 for x,y in ((0,25),(40,240))),('staff_calendar',factor,r in setups,a,b)
        intervals=sorted((r['start_min'],r['end_min']) for r in production+setups)
        assert all(a[1]<=b[0]+1e-6 for a,b in zip(intervals,intervals[1:])),'equipment_overlap'
        assert sum(sum(float(x['quantity']) for x in r.get('materials',[])) for r in production)==3
        ledger=sorted((r['start_min'],float(x['quantity'])) for r in production for x in r.get('materials',[]))
        used=0
        for start,quantity in ledger:
            used+=quantity
            assert used <= 2+(1 if start>=80-1e-6 else 0),'material_prefix'
        print('PROCESS_FACTOR_SETUP_ASSIGNMENTS',json.dumps({'factor':factor,'rows':[{'setup':r in setups,'staff_assigned':bool(r.get('employee_ids')),'start':r['start_min'],'end':r['end_min']} for r in production+setups]}))
        print('PROCESS_FACTOR_SETUP_SHIFT_MATERIAL_PASS',json.dumps({'factor':factor,'setup_count':len(setups),'production_count':3}))
    print('PROCESS_FACTOR_ACCEPTANCE_PASS',json.dumps({'factor_one_identical':True,'modes':list(results),'direct_cases':24,'scheduler_cases':12,'unchanged_setups':True}))
