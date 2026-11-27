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


# Print only the explicitly reviewed duration function and structural metadata of the adapter.
fn=ga['_pp_v1_duration']
s=ast.unparse(definitions[fn.__name__])
assert not re.search(r'(?i)password|secret|api[_-]?key|authorization|token|postgresql://|-----BEGIN',s)
print('FACTOR_DURATION_SOURCE',json.dumps(s))
source=Path('/native/ga_workers/full_runtime_adapter.py').read_text()
tree=ast.parse(source)
for n in tree.body:
    if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in ('_namespace','run'):
        print('FACTOR_ADAPTER_STRUCTURE',json.dumps({'name':n.name,'args':[a.arg for a in n.args.args],
            'returns':[ast.unparse(r.value)[:150] for r in ast.walk(n) if isinstance(r,ast.Return)],
            'body_end':[ast.unparse(x)[:200] for x in n.body[-5:]],
            'calls':[ast.unparse(x.func) for x in ast.walk(n) if isinstance(x,ast.Call) and 'namespace' in ast.unparse(x.func)]}))
print('FACTOR_GLOBAL_IDENTITY',fn.__globals__ is ga)
print('FACTOR_DURATION_CALLERS',json.dumps(sorted(n for n,d in definitions.items() if n!='_pp_v1_duration' and any(isinstance(x,ast.Name) and x.id=='_pp_v1_duration' for x in ast.walk(d)))))
print('FACTOR_ADAPTER_HASH',hashlib.sha256(source.encode()).hexdigest())
