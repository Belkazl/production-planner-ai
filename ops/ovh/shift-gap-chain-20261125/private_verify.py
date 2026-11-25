"""Private no-network actual-native verification of a single public module."""
import argparse, hashlib, json, os, subprocess, sys, tempfile, runpy
from pathlib import Path
HERE=Path(__file__).resolve().parent
OPS=HERE.parent
sys.path.insert(0,str(OPS/'shift-aware-minibatch-release-20261125'))
from contract import native_bundle,digest,read_json,TARGET
from verify import app_manifest,write_files
sys.dont_write_bytecode=True

def verify(bundle,app_path,image):
    files,workers,code_hash=native_bundle(bundle)
    prior=read_json(OPS/'shift-aware-minibatch-release-20261125/release.json')
    if workers!=prior['worker_after'] or code_hash!=prior['code_inputs_sha256']:
        raise ValueError('native_baseline_drift')
    app=app_manifest(app_path)
    patch=runpy.run_path(str(HERE/'patch.py'))
    new=patch['patch'](files[TARGET].decode('utf-8')).encode('utf-8')
    if files[TARGET].decode('utf-8')!=patch['baseline']():
        raise ValueError('public_base_mismatch')
    after=dict(workers);after[TARGET]=digest(new)
    files[TARGET]=new
    with tempfile.TemporaryDirectory(prefix='gap-chain-private-',dir=os.getenv('RUNNER_TEMP')) as temp:
        root=Path(temp);root.chmod(0o700)
        native=root/'native';inputs=root/'input';work=root/'work';work.mkdir(mode=0o700)
        write_files(native,{name:data for name,data in files.items() if name.startswith('ga_workers/')})
        write_files(inputs,{'code-inputs.json':files['code-inputs.json']})
        uid,gid=os.getuid(),os.getgid()
        command=['docker','run','--rm','--network','none','--read-only','--cap-drop=ALL',
            '--security-opt=no-new-privileges','--user',f'{uid}:{gid}','--pids-limit','256',
            '--memory','3g','--cpus','2','--tmpfs',
            f'/tmp:rw,nosuid,nodev,size=536870912,uid={uid},gid={gid},mode=700',
            '--mount',f'type=bind,src={inputs},dst=/input,readonly',
            '--mount',f'type=bind,src={native},dst=/native,readonly',
            '--mount',f'type=bind,src={work},dst=/work',
            '--mount',f'type=bind,src={OPS},dst=/public/ops,readonly',
            image]
        def gate(name,args,timeout=420):
            with (root/(name+'-private.log')).open('wb') as log:
                result=subprocess.run(command+args,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
            if result.returncode:
                if name=='gap' and (work/'gap-witness.json').is_file():
                    report=read_json(work/'gap-witness.json')
                    keys=('old_finish','new_finish','exact_gap_evaluated','quick_budget','distinct','caller_unchanged','no_regression','target_reached')
                    print('GAP_SAFE_FAILURE '+json.dumps({k:report[k] for k in keys if type(report.get(k)) in (bool,int,float)}))
                raise ValueError('gate_'+name)
            print('GAP_PRIVATE_GATE_PASS '+name,flush=True)
        gate('gap',['python3','-B','-I','/public/ops/shift-gap-chain-20261125/verify_native_gap.py'])
        report=read_json(work/'gap-witness.json')
        if not all(report.get(k) is True for k in ('exact_gap_evaluated','quick_budget','distinct','caller_unchanged','no_regression','target_reached','previous_shift_checks')):
            raise ValueError('gate_gap_report')
        gate('eleven',['python3','-B','-I','/public/ops/native-batching-verify-20261124/verify_native.py',
            '--child','/native','--report','/work/native-eleven.json','--overlay-gates'])
        eleven=read_json(work/'native-eleven.json',4*1024*1024)
        if eleven.get('release_gate_complete') is not True or eleven.get('ordered_continuation_verified') is not True:
            raise ValueError('gate_eleven_report')
        gate('integrated',['python3','-B','-I','/public/ops/integrated-setup-verify-20261125/verify_worker.py',
            '--package-root','/native','--code-inputs','/input/code-inputs.json','--fixtures','/work/native-fixtures.json',
            '--report','/work/worker-report.json','--contract-helper','/public/ops/native-batching-verify-20261124/native_input_contract.py'])
        integrated=read_json(work/'worker-report.json',4*1024*1024)
        if integrated.get('all_native_checks_passed') is not True or integrated.get('fixture_count')!=4:
            raise ValueError('gate_integrated_report')
        if {name:digest((native/name).read_bytes()) for name in after}!=after:
            raise ValueError('candidate_drift')
        return {'status':'gap_native_verified','production_writes':False,'worker_before':workers,
            'worker_after':after,'code_inputs_sha256':code_hash,'app_hashes':app['app_hashes'],
            'protected_hashes':app['protected_hashes'],'witness':report,'native_eleven':True,'integrated_four':True,
            'source_commit':os.environ.get('GITHUB_SHA')}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--bundle',required=True,type=Path);p.add_argument('--app',required=True,type=Path);p.add_argument('--image',required=True)
    a=p.parse_args()
    try:print('GAP_NATIVE_ACCEPTANCE '+json.dumps(verify(a.bundle,a.app,a.image),separators=(',',':')),flush=True)
    except Exception as e:
        allowed={'native_baseline_drift','public_base_mismatch','gate_gap','gate_gap_report','gate_eleven','gate_eleven_report','gate_integrated','gate_integrated_report','candidate_drift'}
        print('GAP_NATIVE_VERIFICATION_FAILED '+(str(e) if type(e) is ValueError and str(e) in allowed else type(e).__name__),flush=True)
        sys.exit(6)
