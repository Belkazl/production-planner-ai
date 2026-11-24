"""Regression: Continue evaluates a new random stream, never the same 1729 candidates."""
import ast
import pathlib
import sys
import types

old=pathlib.Path(sys.argv[1]).read_text()
new=pathlib.Path(sys.argv[2]).read_text()
assert new!=old
originals=[line for line in old.splitlines() if line.strip()=="seed=1729 if continuing else secrets.randbits(32)"]
assert len(originals)==1
old_line=originals[0]
indent=old_line[:len(old_line)-len(old_line.lstrip())]
new_line=indent+"seed=secrets.randbits(32)"
assert new.replace(new_line,old_line)==old, "only existing worker RNG assignment changed"

tree=ast.parse(new)
seeds=[node for node in ast.walk(tree)
       if isinstance(node,ast.Assign) and ast.get_source_segment(new,node).strip()=="seed=secrets.randbits(32)"]
assert len(seeds)==1,len(seeds)
statement=seeds[0]
assert isinstance(statement.value,ast.Call)
assert isinstance(statement.value.func,ast.Attribute)
assert isinstance(statement.value.func.value,ast.Name)
assert statement.value.func.value.id=="secrets" and statement.value.func.attr=="randbits"
assert len(statement.value.args)==1 and isinstance(statement.value.args[0],ast.Constant) and statement.value.args[0].value==32

class DistinctStream:
    seeds=[91387501,278993001]
    def __init__(self):self.i=0
    def randbits(self,bits):
        assert bits==32
        index=self.i
        self.i+=1
        return self.seeds[index]
generator=DistinctStream()
expr=compile(ast.Expression(statement.value),"<real-adapter-seed>","eval")
first=eval(expr,{"secrets":generator,"continuing":True})
second=eval(expr,{"secrets":generator,"continuing":True})
assert first!=second and generator.i==2
# A fresh run and each further continuation use the same secure seed source.
assert eval(expr,{"secrets":types.SimpleNamespace(randbits=lambda b:3211),"continuing":False})==3211
source=new
for marker in [
    "load_resume_plan(","ga['optimize'](gens,population,seed,",
    "result['resume_state']",
    "if continuing:",
    "progress(",
]:
    assert marker in source,marker
print("GA_CONTINUE_PER_RUN_RANDOM_SEED_REGRESSION_PASS",{"seeds":[first,second],"source_has_incumbent":True})
