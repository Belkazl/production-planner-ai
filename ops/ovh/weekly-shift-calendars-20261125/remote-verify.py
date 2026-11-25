"""Hash-only verification, using established source selectors."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
def run(stage,phase):
    expected=json.loads((stage/"expected.json").read_text())
    selector=load("weekly_native_contract",stage/"native_input_contract.py")
    selected,manifest,_=selector.load_owned_inputs()
    workers=dict(expected["worker_hashes"])
    if phase=="new":
        for name in ("joint_minibatch.py","full_runtime_adapter.py"):
            workers["ga_workers/"+name]=expected["targets"][name]["new"]
    if manifest["source_hashes"]!=workers:raise ValueError()
    if hashlib.sha256(json.dumps(selected,separators=(",",":")).encode()).hexdigest()!=expected["code_inputs_sha256"]:raise ValueError()
    capture=load("weekly_app_capture",stage/"capture.py")
    app=capture.capture()
    if app["app_hashes"]!=expected["app_hashes"] or app["protected_hashes"]!=expected["protected_hashes"]:raise ValueError()
    print("WEEKLY_APP_NATIVE_HASHES_PASS "+phase)
if __name__=="__main__":
    try:run(Path(sys.argv[1]),sys.argv[2])
    except Exception:
        print("WEEKLY_REMOTE_SOURCE_CONTRACT_REJECTED");raise SystemExit(6)
