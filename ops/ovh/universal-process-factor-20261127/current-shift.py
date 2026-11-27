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



# Test the CURRENT, hash-pinned shift module. The older release verifier
# requires a retired artifact hash; do not alter that historical guard.
import math
from ga_workers import joint_minibatch
assert hashlib.sha256(Path('/native/ga_workers/joint_minibatch.py').read_bytes()).hexdigest()=='928d453f4546a0a85210eb984a23b4a0af4596fb880348d7128c5cbcacafa572'
shift=load('current_shift_verifier',ops/'shift-aware-minibatches-20261125/verify_shift.py')
cases=load('current_shift_cases',ops/'shift-aware-minibatches-20261125/cases.py')
sys.path.insert(0,str(ops/'integrated-setup-verify-20261125'))
from cases import schedule_digest
mode=sys.argv[1]
assert mode in ('old','new')
results={}
def solve(m,pins=(),continued=None):
    opts={'generations':3,'population':6,'seed':1729,'objective':'duration'}
    if pins:opts['locked_operations']=copy.deepcopy(pins)
    if continued is not None:opts.update({'continue':True,'resume_state':copy.deepcopy(continued)})
    before=copy.deepcopy(m)
    with open(os.devnull,'w') as sink,contextlib.redirect_stdout(sink),contextlib.redirect_stderr(sink):
        plan=full_runtime_adapter.run({'model':m,'options':opts},lambda _:None)
    assert m==before,'model_mutated'
    assert plan.get('valid') is True and plan.get('ok') is True,'invalid_plan'
    assert plan.get('generations')==3 and plan.get('population')==6,'quick_budget'
    return plan
def record(name,m,pins=(),continued=None):
    p=solve(m,pins,continued)
    facts=cases.check(p,m,pins)
    results[name]={'digest':schedule_digest(p),'facts':facts,'batches':len(p['batches']),
        'evaluated':(p.get('joint_minibatch') or {}).get('evaluated')}
    print('PROCESS_FACTOR_CURRENT_SHIFT_CASE',json.dumps({'runtime':mode,'case':name,'duration':facts['duration_minutes'],'first_cut':facts['first_cut'],'valid':True}))
    return p
for name in cases.CASE_NAMES:
    m,pins=cases.fixture(name)
    p=record(name,m,pins)
    if name=='shift_window':
        c=record('continuation',m,pins,p['resume_state'])
        assert c.get('continued') is True and c['duration_minutes']<=p['duration_minutes']+1e-6
for name,start,windows in [('later_ready','2026-11-25T00:00:00',[['08:00','08:30'],['09:00','17:00']]),('nonzero_origin','2026-11-25T08:00:00',[['10:00','10:30'],['11:00','19:00']])]:
    m,_=cases.fixture('shift_window');m['start']=start;m['shifts']={'day':windows}
    record(name,m)
if mode=='old':
    Path('/out/current-shift-baseline.json').write_text(json.dumps(results))
else:
    assert results==json.loads(Path('/out/current-shift-baseline.json').read_text()),'current_shift_baseline_changed'
    for factor in (0.8,1.2):
        m,_=cases.fixture('shift_window')
        m['equipment'][0]['process_multiplier']=factor
        p=solve(m)
        prod=[r for r in p['operations'] if not cases.is_setup(r)]
        assert prod and len(prod)==len(p['batches'])
        assert not any(cases.is_setup(r) for r in p['operations']) and not p.get('setup_operations')
        assert math.isclose(sum(r['batch_quantity'] for r in prod),400,abs_tol=1e-6)
        batches={r['batch']:r.get('quantity',r.get('area')) for r in p['batches']}
        assert len(batches)==len(prod)
        cal=cases.intervals(m)
        for r in prod:
            a,b,q=r['start_min'],r['end_min'],r['batch_quantity']
            assert batches[r['batch']]==q and 0<q<=200 and q==int(q)
            assert math.isclose(b-a,q*factor,abs_tol=1e-6)
            assert r['employee_ids']==[cases.EMPLOYEE] and r['equipment_ids']==[cases.MACHINE]
            assert any(a>=x-1e-6 and b<=y+1e-6 for x,y in cal),'scaled_shift_calendar'
        intervals=sorted((r['start_min'],r['end_min']) for r in prod)
        assert all(a[1]<=b[0]+1e-6 for a,b in zip(intervals,intervals[1:]))
        assert math.isclose(p['duration_minutes'],intervals[-1][1],abs_tol=1e-6)
        print('PROCESS_FACTOR_SCALED_BATCH_SHIFT_PASS',json.dumps({'factor':factor,'batches':len(prod),'first_batch':prod[0]['batch_quantity'],'duration':p['duration_minutes']}))
    print('PROCESS_FACTOR_CURRENT_SHIFT_PASS',json.dumps({'same_current_baseline':True,'cases':len(results),'scaled_batch_cases':2}))
    Path('/out/current-shift-pass.json').write_text(json.dumps({'passed':True,'cases':len(results),'scaled_batch_cases':2}))
