"""Stage exact captured modules and run native witnesses in a networkless container."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid
HERE=Path(__file__).resolve().parent; OPS=HERE.parent
sys.path.insert(0,str(OPS/"shift-aware-minibatch-release-20261125"))
from contract import native_bundle
sys.path.insert(0,str(HERE))
from patch import patch_joint,patch_adapter

def run(bundle,image):
    files,workers,code_hash=native_bundle(bundle)
    marker=json.loads((OPS/"shift-aware-minibatch-release-20261125/release.json").read_text())
    if workers!=marker["worker_after"] or code_hash!=marker["code_inputs_sha256"]:
        raise ValueError("native_source_drift")
    with tempfile.TemporaryDirectory(prefix="weekly-private-",dir=os.environ.get("RUNNER_TEMP")) as directory:
        root=Path(directory);root.chmod(0o700)
        native=root/"native";inputs=root/"input";work=root/"work"
        for folder in (native,inputs,work):folder.mkdir(mode=0o700)
        for name,data in files.items():
            if not name.startswith("ga_workers/"):continue
            path=native/name;path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            path.write_bytes(data);path.chmod(0o600)
        (inputs/"code-inputs.json").write_bytes(files["code-inputs.json"])
        (inputs/"code-inputs.json").chmod(0o600)
        joint=native/"ga_workers/joint_minibatch.py";adapter=native/"ga_workers/full_runtime_adapter.py"
        staged=patch_joint(joint.read_text()); staged_adapter=patch_adapter(adapter.read_text())
        joint.write_text(staged);adapter.write_text(staged_adapter)
        compile(staged,"<candidate-joint>","exec");compile(staged_adapter,"<candidate-adapter>","exec")
        print("WEEKLY_EXACT_NATIVE_STAGE_PASS",flush=True)
        uid,gid=os.getuid(),os.getgid(); name="weekly-verify-"+uuid.uuid4().hex
        common=["docker","run","--rm","--name",name,"--network","none","--read-only","--cap-drop=ALL",
          "--security-opt=no-new-privileges","--user",f"{uid}:{gid}","--pids-limit","256","--memory","3g","--cpus","2",
          "--tmpfs",f"/tmp:rw,nosuid,nodev,size=536870912,uid={uid},gid={gid},mode=700",
          "--mount",f"type=bind,src={inputs},dst=/input,readonly",
          "--mount",f"type=bind,src={native},dst=/native,readonly",
          "--mount",f"type=bind,src={work},dst=/work",
          "--mount",f"type=bind,src={OPS},dst=/public/repo/ops,readonly",image,"python3","-B","-I"]
        command=common+["/public/repo/ops/ovh/weekly-shift-calendars-20261125/native_probe.py"]
        # OPS is the repository's ops/ovh directory. Mount it at that exact public path.
        command=[x.replace("dst=/public/repo/ops,readonly","dst=/public/repo/ops/ovh,readonly") for x in command]
        try:
            with (root/"private.log").open("wb") as log:
                result=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL,timeout=420)
        finally:subprocess.run(["docker","rm","-f",name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=20)
        report_path=work/"weekly-report.json"
        if not report_path.is_file() or report_path.is_symlink() or report_path.stat().st_size>2048:
            raise ValueError("native_witness_missing")
        report=json.loads(report_path.read_text())
        expected={"friday_lunch_weekend":True,"overnight_break":True,"legacy_lunch":True}
        if result.returncode or report!=expected:
            kind=report.get("failure_type")
            allowed={"AssertionError","ValueError","KeyError","TypeError","JointContractError","FullGAError","InfeasibleCandidate","ShiftVerificationError","ImportError","AttributeError","Exception"}
            print("WEEKLY_NATIVE_WITNESS_FAILED "+(kind if kind in allowed else "unknown"),flush=True)
            raise ValueError("native_witness_failed")
        print("WEEKLY_NATIVE_WITNESSES_PASS friday_lunch_weekend overnight_break legacy_lunch",flush=True)
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--bundle",required=True,type=Path);p.add_argument("--image",required=True);args=p.parse_args()
    try:run(args.bundle,args.image)
    except Exception as e:
        known={"native_source_drift","weekly_calendar_native_baseline_drift","weekly_calendar_anchor_drift","weekly_calendar_adapter_anchor_drift","native_witness_missing","native_witness_failed"}
        print("WEEKLY_PRIVATE_PREFLIGHT_FAILED "+(str(e) if type(e) is ValueError and str(e) in known else "private_preflight_error"))
        raise SystemExit(6)
