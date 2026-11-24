"""Regression: Continue evaluates a new random stream, never the same 1729 candidates."""
import ast
import pathlib
import sys
import types

old=pathlib.Path(sys.argv[1]).read_text()
new=pathlib.Path(sys.argv[2]).read_text()
assert new!=old
assert new.replace("""    # The same accepted order is a starting point, not a fixed random stream.
    # Quick mode (3 generations x 6 candidates) otherwise repeats the same
    # search neighbourhood on EVERY Continue and cannot discover new variants.
    # Independent fresh and continued jobs receive new server-side RNG seeds.
    # The validated incumbent, objective, pins and configured work count stay.
    seed=secrets.randbits(32)""","    seed=1729 if continuing else secrets.randbits(32)")==old
tree=ast.parse(new)
seeds=[node for node in ast.walk(tree)
       if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=="seed" for t in node.targets)]
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
