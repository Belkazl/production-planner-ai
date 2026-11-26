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
for name,f in sorted(ga.items()):
    if not inspect.isfunction(f) or not re.search(r'compat|_pp_.*fit|_pp_.*param|_pp_.*state|_pp_.*material|_pp_.*normali|_pp_.*eligible',name,re.I):continue
    try:
        s=ast.unparse(definitions[name]) if name in definitions else inspect.getsource(f)
    except Exception:continue
    if not re.search(r'parameters|compatib|setup_parameter|order_params|order\.get|match_mode|order_value|material_consumption',s):continue
    if len(s)>7000:
        lines=s.splitlines()
        ids=set()
        for i,l in enumerate(lines):
            if re.search(r'parameters|compatib|setup_parameter|order_params|order_value|material_consumption',l):
                ids.update(range(max(0,i-1),min(len(lines),i+2)))
        s='\n'.join(lines[i] for i in sorted(ids)[:55])
    if re.search(r'(?i)gsk_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|postgres(?:ql)?://|-----BEGIN|(?:password|secret|api[_ -]?key|token)\s*[:=]\s*["\x27][^"\x27]{12,}',s):continue
    print('ORDER_NATIVE_SCHEMA',name,json.dumps(s[:7000],ensure_ascii=True))
sys.path.insert(0,str(ops/'integrated-setup-verify-20261125'))
from cases import model
base=model()
base['equipment'][0]['capabilities']={'allowed_parameters':{'color':['A','B']}}
new={'id':'NEW_ORDER','quantity':1,'unit':'шт.','technical_process_id':'SYNTHETIC_PROCESS','area':1,'process_hours':1}
missing=dict(base,orders=base['orders']+[new])
fixed=dict(base,orders=base['orders']+[dict(new,parameters=copy.deepcopy(base['orders'][-1]['parameters']))])
cases=[('complete',base,True),('missing_required_parameter',missing,False),('same_process_template',fixed,True)]
for name,m,want in cases:
    try:
        with open(os.devnull,'w') as sink,contextlib.redirect_stdout(sink),contextlib.redirect_stderr(sink):
            result=full_runtime_adapter.run({'model':copy.deepcopy(m),'options':{'generations':3,'population':6,'seed':1729,'objective':'duration'}},lambda p:None)
        valid=result.get('valid') is True
        if valid and want and name=='same_process_template':
            assert any(str(x.get('order'))=='NEW_ORDER' and not x.get('is_setup') for x in result.get('operations',[]))
        print('ORDER_NATIVE_CASE',name,json.dumps({'valid':valid,'duration':result.get('duration_minutes'),'orders':len(m['orders']),'rows':len(result.get('operations',[]))}))
    except Exception as e:
        valid=False
        print('ORDER_NATIVE_CASE',name,json.dumps({'error':type(e).__name__,'code':str(e)[:220]}))
    assert valid is want,(name,valid,want)
print('ORDER_NATIVE_COMPATIBILITY_REPRODUCTION_PASS')
browser={'scheduler_mode':'resource','start':'2026-11-25T08:00:00','quantity_unit':'m2',
 'orders':[{'id':2611,'quantity':900,'area':900,'unit':'m2','technical_process_id':'TP1','process_hours':1,'parameters':{'color':'A','width':600}},
 {'id':2612,'quantity':800,'area':800,'unit':'m2','technical_process_id':'TP1','process_hours':1,'parameters':{'color':'B','width':1200}},
 {'id':2613,'quantity':600,'area':600,'unit':'m2','technical_process_id':'TP1','process_hours':1/6,'parameters':{'color':'B','width':1200}}],
 'equipment':[{'id':'M1','name':'Synthetic press','kind':'pressing','capacity':200,'capacity_unit':'m2','capabilities':{'allowed_parameters':{'color':['A','B']},'max_parameters':{'width':1300}},'timing_profile':{'timing_mode':'throughput','throughput_per_hour':600}}],
 'employees':[],'shifts':{},'materials':[],'setup_rules':[{'id':'SET_AB','equipment_ref':'*','setup_parameter':'color','from_state':'A','to_state':'B','duration_min':5},{'id':'SET_BA','equipment_ref':'*','setup_parameter':'color','from_state':'B','to_state':'A','duration_min':5}],
 'technical_processes':[{'id':'TP1','name':'Synthetic ceramic process','operations':[{'id':'OP1','name':'Synthetic pressing','sequence':1,'duration_min':10,'setup_parameter':'color','resource_requirements':[{'resource_type':'equipment','resource_ref':'M1','resource_refs':['M1'],'match_mode':'specific','quantity':1,'unit':'pcs','consumption_rule':'during_operation'}]}]}]}
for name,m in [('browser_before',dict(browser,orders=browser['orders'][:2])),('browser_after',browser),('browser_after_strings',dict(browser,orders=[dict(o,id=str(o['id'])) for o in browser['orders']]))]:
    try:
        with open(os.devnull,'w') as sink,contextlib.redirect_stdout(sink),contextlib.redirect_stderr(sink):
            result=full_runtime_adapter.run({'model':copy.deepcopy(m),'options':{'generations':3,'population':6,'seed':1729,'objective':'duration'}},lambda p:None)
        print('ORDER_NATIVE_BROWSER_CASE',name,json.dumps({'valid':result.get('valid'),'duration':result.get('duration_minutes'),'rows':len(result.get('operations',[]))}))
    except Exception as e:
        print('ORDER_NATIVE_BROWSER_CASE',name,json.dumps({'error':type(e).__name__,'code':str(e)[:350]}))


# Scale the already-proven integrated setup case rather than inventing a new
# timing profile. Native errors in the earlier fixture occurred even BEFORE
# any AI edit; do not use that fixture as an acceptance gate.
for cap in (600,200):
    scaled=copy.deepcopy(base)
    scaled['quantity_unit']='m2'
    scaled['equipment'][0].update(capacity=cap,capacity_unit='m2')
    for o in scaled['orders']:o.update(quantity=600,area=600,unit='m2')
    added=dict(scaled,orders=scaled['orders']+[dict(new,quantity=600,area=600,unit='m2',parameters=copy.deepcopy(scaled['orders'][-1]['parameters']))])
    try:
        with open(os.devnull,'w') as sink,contextlib.redirect_stdout(sink),contextlib.redirect_stderr(sink):
            result=full_runtime_adapter.run({'model':copy.deepcopy(added),'options':{'generations':3,'population':6,'seed':1729,'objective':'duration'}},lambda p:None)
        print('ORDER_NATIVE_SCALED_CASE',cap,json.dumps({'valid':result.get('valid'),'rows':len(result.get('operations',[])),'duration':result.get('duration_minutes')}))
    except Exception as e:
        print('ORDER_NATIVE_SCALED_CASE',cap,json.dumps({'error':type(e).__name__,'code':str(e)[:350]}))
