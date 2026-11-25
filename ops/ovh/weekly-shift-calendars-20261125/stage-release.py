"""Stage exact reviewed changes; no production writes."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
HERE=Path(__file__).resolve().parent; OPS=HERE.parent
sys.path.insert(0,str(OPS/"shift-aware-minibatch-release-20261125"))
from contract import native_bundle
sys.path.insert(0,str(HERE))
from patch import patch_joint,patch_adapter
def sha(data):return hashlib.sha256(data).hexdigest()
def main(d):
    marker=json.loads((OPS/"shift-aware-minibatch-release-20261125/release.json").read_text())
    app=json.loads((d/"app-hashes.json").read_text())
    if app["app_hashes"]!=marker["app_hashes"] or app["protected_hashes"]!=marker["protected_hashes"]:raise ValueError("app_source_drift")
    files,workers,code=native_bundle(d/"native.bundle")
    if workers!=marker["worker_after"] or code!=marker["code_inputs_sha256"]:raise ValueError("native_source_drift")
    out=d/"new";out.mkdir(mode=0o700)
    joint=files["ga_workers/joint_minibatch.py"];adapter=files["ga_workers/full_runtime_adapter.py"]
    targets={"joint_minibatch.py":(joint,patch_joint(joint.decode()).encode()),"full_runtime_adapter.py":(adapter,patch_adapter(adapter.decode()).encode())}
    for name,(old,new) in targets.items():
        compile(new,"<weekly-candidate>","exec")
        (out/name).write_bytes(new)
    p=d/"old-ui.js";n=out/"restart-optimizer-html.js"
    with (d/"patch-private.log").open("wb") as log:
        subprocess.run(["node",str(HERE/"patch-ui.mjs"),str(p),str(n)],stdout=log,stderr=subprocess.STDOUT,check=True)
        subprocess.run(["node","--check",str(n)],stdout=log,stderr=subprocess.STDOUT,check=True)
    targets["restart-optimizer-html.js"]=(p.read_bytes(),n.read_bytes())
    manifest={name:{"old":sha(old),"new":sha(new)} for name,(old,new) in targets.items()}
    if any(x["old"]==x["new"] for x in manifest.values()):raise ValueError("empty_patch")
    (d/"manifest.tsv").write_text("".join(name+"\t"+v["old"]+"\t"+v["new"]+"\n" for name,v in sorted(manifest.items())))
    expected={"app_hashes":marker["app_hashes"],"protected_hashes":marker["protected_hashes"],"worker_hashes":workers,"code_inputs_sha256":code,"targets":manifest}
    (d/"expected.json").write_text(json.dumps(expected,separators=(",",":")))
    print("WEEKLY_RELEASE_STAGE_PASS "+json.dumps(manifest,separators=(",",":")))
if __name__=="__main__":
    try:main(Path(sys.argv[1]))
    except Exception as e:
        print("WEEKLY_RELEASE_STAGE_FAILED "+(str(e) if type(e) is ValueError and str(e) in {"app_source_drift","native_source_drift","empty_patch"} else type(e).__name__))
        raise SystemExit(6)
