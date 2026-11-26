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
