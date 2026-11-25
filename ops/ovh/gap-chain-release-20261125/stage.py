"""Build the single accepted public worker and protect all current server hashes."""
import json,os,re,runpy,subprocess,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent;OPS=HERE.parent;REPO=HERE.parents[2]
sys.path.insert(0,str(OPS/'shift-aware-minibatch-release-20261125'))
from contract import APP_FILES,PROTECTED_FILES,TARGET,hashes,read_json,digest,validate_worker_change
from release_guard import github_read
BRANCH='fix/shift-gap-chain-v2-20261125'
MARKER='ops/ovh/gap-chain-release-20261125/release.json'
def stage(root):
    assert os.environ.get('GITHUB_REPOSITORY')=='Belkazl/production-planner-ai'
    assert os.environ.get('GITHUB_REF')=='refs/heads/'+BRANCH
    marker=read_json(HERE/'release.json')
    assert set(marker)=={'candidate_commit','verification_run_id'}
    sha,run_id=marker['candidate_commit'],marker['verification_run_id']
    assert re.fullmatch('[0-9a-f]{40}',sha) and type(run_id) is int and 0<run_id<10**16
    head=os.environ['GITHUB_SHA']
    subprocess.run(['git','merge-base','--is-ancestor',sha,head],cwd=REPO,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    changes=subprocess.check_output(['git','diff','--name-only',sha,head],cwd=REPO,text=True).splitlines()
    assert MARKER in changes and all(p.startswith('ops/ovh/gap-chain-release-20261125/') or p=='.github/workflows/liftorbit-gap-chain-release-20261125.yml' for p in changes)
    token=os.environ['GITHUB_TOKEN'];base='/actions/runs/'+str(run_id)
    run=json.loads(github_read(base,token))
    assert run['id']==run_id and run['status']=='completed' and run['conclusion']=='success'
    assert run['head_sha']==sha and run['head_branch']==BRANCH
    assert run['path']=='.github/workflows/liftorbit-gap-chain-private-20261125.yml'
    assert run['repository']['full_name']=='Belkazl/production-planner-ai'
    jobs=json.loads(github_read(base+'/jobs?filter=latest&per_page=100',token))['jobs']
    assert len(jobs)==1 and jobs[0]['name']=='verify' and jobs[0]['conclusion']=='success'
    log=github_read('/actions/jobs/'+str(jobs[0]['id'])+'/logs',token,8*1024*1024).decode()
    reports=[json.loads(m[1]) for line in log.splitlines() if (m:=re.fullmatch(r'(?:[0-9T:.+Z -]+)?GAP_NATIVE_ACCEPTANCE (.{1,131072})',line))]
    assert len(reports)==1;report=reports[0]
    assert report['status']=='gap_native_verified' and report['production_writes'] is False and report['source_commit']==sha
    assert all(report.get(k) is True for k in ('native_eleven','integrated_four','weekly_calendar'))
    w=report['witness']
    assert all(w.get(k) is True for k in ('exact_gap_evaluated','quick_budget','distinct','caller_unchanged','no_regression','target_reached','previous_shift_checks'))
    assert w['new_finish']<=945.00001 and w['new_finish']<=w['old_finish']+0.00001
    before,after=report['worker_before'],report['worker_after']
    hashes(before,workers=True);hashes(after,workers=True);validate_worker_change(before,after)
    hashes(report['app_hashes'],APP_FILES);hashes(report['protected_hashes'],PROTECTED_FILES)
    assert re.fullmatch('[0-9a-f]{64}',report['code_inputs_sha256'])
    patch=runpy.run_path(str(OPS/'shift-gap-chain-20261125/patch.py'))
    source=patch['baseline']();assert digest(source.encode())==before[TARGET]
    candidate=patch['patch'](source).encode();assert digest(candidate)==after[TARGET]
    path=root/'new/ga/joint_minibatch.py';path.parent.mkdir(mode=0o700,parents=True);path.write_bytes(candidate);path.chmod(0o600)
    app=dict(report['app_hashes'],**report['protected_hashes'])
    rows=[('PRESERVE','app/'+name,h,h) for name,h in app.items()]
    rows += [('WRITE' if name==TARGET else 'PRESERVE','ga/'+name.removeprefix('ga_workers/'),h,after[name]) for name,h in before.items()]
    (root/'manifest.tsv').write_text(''.join('\t'.join(row)+'\n' for row in rows))
    (root/'code-inputs.sha256').write_text(report['code_inputs_sha256']+'\n')
    helper=OPS/'native-batching-verify-20261124/native_input_contract.py'
    (root/'native-contract.sha256').write_text(digest(helper.read_bytes())+'\n')
    print('GAP_RELEASE_EXACT_ACCEPTANCE_VERIFIED',flush=True)
if __name__=='__main__':
    try:stage(Path(sys.argv[1]))
    except Exception as e:
        print('GAP_RELEASE_GUARD_REJECTED '+type(e).__name__,flush=True);sys.exit(6)
