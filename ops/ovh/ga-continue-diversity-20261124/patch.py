from pathlib import Path
import ast
import hashlib
import sys

if len(sys.argv)!=3:
    raise SystemExit("usage: python3 patch.py old.py new.py")
before=Path(sys.argv[1]).read_text()
old="    seed=1729 if continuing else secrets.randbits(32)"
new="""    # The same accepted order is a starting point, not a fixed random stream.
    # Quick mode (3 generations x 6 candidates) otherwise repeats the same
    # search neighbourhood on EVERY Continue and cannot discover new variants.
    # Independent fresh and continued jobs receive new server-side RNG seeds.
    # The validated incumbent, objective, pins and configured work count stay.
    seed=secrets.randbits(32)"""
if before.count(old)!=1:raise RuntimeError("GA_CONTINUE_ACTIVE_SEED_ANCHOR_DRIFT")
for mark in [
    "import secrets",
    "continuing=bool(opts.get('continue') or opts.get('continue_run'))",
    "load_resume_plan(",
    "ga['optimize'](gens,population,seed,",
    "result['resume_state']",
]:
    if mark not in before:raise RuntimeError("GA_CONTINUE_REQUIRED_GUARD_MISSING_"+mark)
after=before.replace(old,new)
if after.replace(new,old)!=before:
    raise RuntimeError("GA_CONTINUE_ONLY_SEED_MUST_CHANGE")
ast.parse(after)
assert after.count("seed=secrets.randbits(32)")==1
assert "seed=1729 if continuing" not in after
Path(sys.argv[2]).write_text(after)
print("GA_CONTINUE_INDEPENDENT_SEED_PATCH_PASS",{
    "old_sha256":hashlib.sha256(before.encode()).hexdigest(),
    "new_sha256":hashlib.sha256(after.encode()).hexdigest(),
    "safe_one_statement":True})
