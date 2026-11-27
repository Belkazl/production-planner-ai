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
    if not inspect.isfunction(f):continue
    try:s=ast.unparse(definitions[name]) if name in definitions else inspect.getsource(f)
    except Exception:continue
    if not re.search(r'process_factor|processFactor|[\x27"]factor[\x27"]',s):continue
    lines=s.splitlines();ids=set()
    for i,l in enumerate(lines):
        if re.search(r'process_factor|processFactor|[\x27"]factor[\x27"]',l):ids.update(range(max(0,i-2),min(len(lines),i+3)))
    print('EQUIPMENT_FACTOR_CODE',name,json.dumps('\n'.join(lines[i] for i in sorted(ids)[:40]),ensure_ascii=True))
sys.path.insert(0,str(ops/'integrated-setup-verify-20261125'))
from cases import model, rows
for mode in ('fixed','throughput'):
    for factor in (0.5,1,2):
        m=model(zero=True)
        e=m['equipment'][0]
        e['timing_profile']={'timing_mode':'fixed','duration_min':10} if mode=='fixed' else {'timing_mode':'throughput','throughput_per_hour':60}
        e.update(process_factor=factor,factor=factor,processFactor=factor)
        m['setup_rules']=[]
        with open(os.devnull,'w') as sink,contextlib.redirect_stdout(sink),contextlib.redirect_stderr(sink):
            p=full_runtime_adapter.run({'model':copy.deepcopy(m),'options':{'generations':3,'population':6,'seed':1729,'objective':'duration'}},lambda _:None)
        production,_=rows(p)
        print('EQUIPMENT_FACTOR_CASE',json.dumps({'mode':mode,'factor':factor,'valid':p.get('valid'),'durations':[r['end_min']-r['start_min'] for r in production[:6]]}))
