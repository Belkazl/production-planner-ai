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

# The two rule codes must have the same real native material calculation
# for square-metre models. All inputs are synthetic, with quantities > 1
# and a capacity that forces splitting into more than one batch.
sys.path.insert(0,str(ops/'integrated-setup-verify-20261125'))
from cases import model, rows, schedule_digest
import math
def fixture(unit,rule):
    m=model(zero=True)
    m['quantity_unit']=unit
    m['equipment'][0].update(capacity=7,capacity_unit=unit)
    m['orders']=[dict(m['orders'][0],quantity=20,area=20,unit=unit)]
    m['setup_rules']=[]
    m['materials']=[{'id':'SYNTHETIC_MATERIAL','name':'Synthetic powder','unit':'kg','initial_stock':500,'deliveries':[]}]
    m['technical_processes'][0]['operations'][0]['resource_requirements'].append({
        'resource_type':'material','match_mode':'specific','resource_ref':'SYNTHETIC_MATERIAL','resource_refs':['SYNTHETIC_MATERIAL'],
        'quantity':18.5,'unit':'kg','consumption_rule':rule})
    return m
def solve(m):
    with open(os.devnull,'w') as sink,contextlib.redirect_stdout(sink),contextlib.redirect_stderr(sink):
        p=full_runtime_adapter.run({'model':copy.deepcopy(m),'options':{'generations':3,'population':6,'seed':1729,'objective':'duration'}},lambda _:None)
    assert p.get('valid') is True,'native_invalid'
    production,_=rows(p)
    assert len(production)>=3,'missing_split_batches'
    total=0.0
    for r in production:
        q=float(r['batch_quantity'])
        used=sum(float(x['quantity']) for x in r.get('materials',[]) if x.get('id')=='SYNTHETIC_MATERIAL')
        assert math.isclose(used,18.5*q,rel_tol=1e-8,abs_tol=1e-8),('wrong_material_consumption',q,used)
        total+=used
    assert math.isclose(total,370,rel_tol=1e-8,abs_tol=1e-8),('wrong_total',total)
    return p,total
legacy,total=solve(fixture('m2','per_m2'))
canonical,new_total=solve(fixture('m2','per_unit'))
assert schedule_digest(legacy)==schedule_digest(canonical),'schedule_changed'
for unit in ('kg','l','pcs'):
    _,amount=solve(fixture(unit,'per_unit'))
    assert amount==new_total
print('CONSUMPTION_NATIVE_EQUIVALENCE_PASS',json.dumps({'legacy_m2':total,'canonical_m2':new_total,'other_units':['kg','l','pcs'],'same_schedule':True}))
