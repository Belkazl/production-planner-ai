"""Stage the exact captured native module and protect all other source hashes."""
import json
import hashlib
from pathlib import Path
import sys
import re

HERE = Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from patch import patch
sys.path.insert(0,str(HERE.parent/'shift-aware-minibatch-release-20261125'))
from contract import native_bundle, APP_FILES, PROTECTED_FILES

def digest(data):return hashlib.sha256(data).hexdigest()

root=Path(sys.argv[1])
files,before,code_hash=native_bundle(root/'native.bundle')
app=json.loads((root/'app-hashes.json').read_text())
assert app['format']=='shift-aware-minibatch-app-hashes-v1'
assert set(app['app_hashes'])==set(APP_FILES) and set(app['protected_hashes'])==set(PROTECTED_FILES)
assert all(re.fullmatch(r'[0-9a-f]{64}',v) for v in [*app['app_hashes'].values(),*app['protected_hashes'].values()])
target='ga_workers/full_runtime_adapter.py'
candidate=patch(files[target])
after=dict(before,**{target:digest(candidate)})
assert {n for n in before if before[n]!=after[n]}=={target}
for label in ('old','new'):
    for name,data in files.items():
        if name.startswith('ga_workers/'):
            p=root/label/'native'/name
            p.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            p.write_bytes(candidate if label=='new' and name==target else data)
            p.chmod(0o600)
(root/'input').mkdir(mode=0o700)
(root/'input/code-inputs.json').write_bytes(files['code-inputs.json'])
(root/'new/ga').mkdir(mode=0o700)
(root/'new/ga/full_runtime_adapter.py').write_bytes(candidate)
(root/'out').mkdir(mode=0o700)
rows=[('PRESERVE','app/'+n,h,h) for n,h in {**app['app_hashes'],**app['protected_hashes']}.items()]
rows.extend(('WRITE' if n==target else 'PRESERVE','ga/'+n.removeprefix('ga_workers/'),h,after[n]) for n,h in before.items())
(root/'manifest.tsv').write_text(''.join('\t'.join(r)+'\n' for r in rows))
(root/'code-inputs.sha256').write_text(code_hash+'\n')
(root/'native-contract.sha256').write_text(digest((HERE.parent/'native-batching-verify-20261124/native_input_contract.py').read_bytes())+'\n')
print('PROCESS_FACTOR_EXACT_MODULE',json.dumps({'before':before[target],'after':after[target],'only_one_module_changed':True}))
