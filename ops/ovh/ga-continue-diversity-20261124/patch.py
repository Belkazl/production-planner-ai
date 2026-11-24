from pathlib import Path
import ast
import hashlib
import sys

if len(sys.argv)!=3:
    raise SystemExit("usage: python3 patch.py old.py new.py")
before=Path(sys.argv[1]).read_text()
old="seed=1729 if continuing else secrets.randbits(32)"
old_lines=[line for line in before.splitlines() if line.strip()==old]
if len(old_lines)!=1:raise RuntimeError("GA_CONTINUE_ACTIVE_SEED_ANCHOR_DRIFT")
old_line=old_lines[0]
prefix=old_line[:len(old_line)-len(old_line.lstrip())]
# Fix exactly one assignment in the ACTIVE worker. Existing resume logic stays.
new=prefix+"seed=secrets.randbits(32)"
for mark in [
    "import secrets",
    "continuing=bool(opts.get('continue') or opts.get('continue_run'))",
    "load_resume_plan(",
    "ga['optimize'](gens,population,seed,",
    "result['resume_state']",
]:
    if mark not in before:raise RuntimeError("GA_CONTINUE_REQUIRED_GUARD_MISSING_"+mark)
after=before.replace(old_line,new)
if after.replace(new,old_line)!=before:
    raise RuntimeError("GA_CONTINUE_ONLY_SEED_MUST_CHANGE")
ast.parse(after)
assert after.count("seed=secrets.randbits(32)")==1
assert "seed=1729 if continuing" not in after
Path(sys.argv[2]).write_text(after)
print("GA_CONTINUE_INDEPENDENT_SEED_PATCH_PASS",{
    "old_sha256":hashlib.sha256(before.encode()).hexdigest(),
    "new_sha256":hashlib.sha256(after.encode()).hexdigest(),
    "safe_one_statement":True})
