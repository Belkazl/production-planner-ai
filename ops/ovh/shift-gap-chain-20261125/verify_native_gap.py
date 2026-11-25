"""Synthetic actual-native witness, using the existing private verifier."""
import contextlib, copy, hashlib, importlib.util, json, os, runpy, sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
OPS=HERE.parent
sys.dont_write_bytecode=True

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    mod=importlib.util.module_from_spec(spec);sys.modules[name]=mod;spec.loader.exec_module(mod)
    return mod

def fixture():
    model={'scheduler_mode':'resource','quantity_unit':'pcs','start':'2026-11-25T00:00:00',
        'materials':[],'setup_rules':[],'constraints':[],
        'shifts':{'day':[['08:00','12:00'],['13:00','17:00']]},
        'equipment':[{'id':m,'name':m,'kind':'workstation','capacity':200,'capacity_unit':'pcs',
            'timing_profile':{'timing_mode':'throughput','throughput_per_hour':60}} for m in ('A','B')],
        'employees':[{'id':e,'name':e,'role':'operator','shift':'day'} for e in ('EA','EB')],
        'orders':[{'id':oid,'quantity':q,'unit':'pcs','technical_process_id':oid+'_TP'}
            for oid,q in [('PA',30),('PB',205),('T',200)]],'technical_processes':[]}
    def op(oid,seq,m,e):
        return {'id':oid,'name':oid,'sequence':seq,'duration_min':1,'resource_requirements':[
            {'resource_type':k,'match_mode':'specific','resource_ref':r,'resource_refs':[r],'quantity':1}
            for k,r in [('equipment',m),('employee',e)]]}
    model['technical_processes']=[{'id':oid+'_TP','name':oid,'operations':ops}
        for oid,ops in [('PA',[op('PA_OP',1,'A','EA')]),('PB',[op('PB_OP',1,'B','EB')]),
        ('T',[op('T_A',1,'A','EA'),op('T_B',2,'B','EB')])]]
    pins=[{'order':oid,'operation_id':opid,'batch':b,'batch_quantity':q,'start_min':s,'end_min':s+q,
        'equipment_ids':[m],'employee_ids':[e]} for oid,opid,b,q,s,m,e in
        [('PA','PA_OP',1,30,480,'A','EA'),('PB','PB_OP',1,200,480,'B','EB'),('PB','PB_OP',2,5,680,'B','EB')]]
    return model,pins

def check(plan,model,pins):
    assert not plan.get('setup_operations')
    batches={(b['order'],b['batch']):float(b.get('quantity',b.get('area'))) for b in plan['batches']}
    assert len(batches)==len(plan['batches'])
    assert all(0<q<=200 and q.is_integer() for q in batches.values())
    assert all(sum(q for (oid,_),q in batches.items() if oid==o['id'])==o['quantity'] for o in model['orders'])
    busy={x:[] for x in ('A','B','EA','EB')};chains={}
    ids={'PA':['PA_OP'],'PB':['PB_OP'],'T':['T_A','T_B']}
    for r in plan['operations']:
        key=(r['order'],r['batch']);q=batches[key];op=r['operation_id'];s,t=r['start_min'],r['end_min']
        assert op in ids[key[0]] and abs(t-s-q)<1e-5 and abs(r['batch_quantity']-q)<1e-5
        m='A' if op in ('PA_OP','T_A') else 'B'
        assert r['equipment_ids']==[m] and r['employee_ids']==['E'+m] and not r.get('materials')
        day=int(s//1440);assert any(day*1440+a<=s+1e-5 and t<=day*1440+b+1e-5 for a,b in [(480,720),(780,1020)])
        for rid in (m,'E'+m):busy[rid].append((s,t))
        c=chains.setdefault(key,{});assert op not in c;c[op]=(s,t)
    assert set(chains)==set(batches)
    for key,c in chains.items():
        assert set(c)==set(ids[key[0]])
        assert all(c[a][1]<=c[b][0]+1e-5 for a,b in zip(ids[key[0]],ids[key[0]][1:]))
    for intervals in busy.values():
        intervals.sort();assert all(a[1]<=b[0]+1e-5 for a,b in zip(intervals,intervals[1:]))
    for p in pins:
        rows=[r for r in plan['operations'] if all(r[k]==p[k] for k in ('order','batch','operation_id'))]
        assert len(rows)==1 and all(rows[0][k]==p[k] for k in ('batch_quantity','start_min','end_min','equipment_ids','employee_ids'))
    finish=max(r['end_min'] for r in plan['operations']);assert abs(finish-plan['duration_minutes'])<1e-5
    return finish

def run():
    patch=load('gap_patch',HERE/'patch.py')
    assert Path('/native/ga_workers/joint_minibatch.py').read_text()==patch.patch(patch.baseline())
    contract=load('gap_contract',OPS/'native-batching-verify-20261124/native_input_contract.py')
    selected=contract.select_code_fields(json.loads(Path('/input/code-inputs.json').read_text()))
    compiler=Path('/native/ga_workers/compile_legacy_ga.py').read_bytes()
    assert hashlib.sha256(compiler).hexdigest()==contract.COMPILE_SHA and contract.compiler_keys(compiler)==contract.CODE_KEYS
    os.environ.clear();os.environ.update({'PATH':'/usr/local/bin:/usr/bin:/bin','LC_ALL':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1',**selected})
    sys.path.insert(0,'/native')
    from ga_workers import compile_legacy_ga,full_runtime_adapter,joint_minibatch
    compile_legacy_ga.build()
    v=load('gap_shift_verifier',OPS/'shift-aware-minibatches-20261125/verify_shift.py')
    old=v.candidate_before(patch.baseline())
    model,pins=fixture();opts={'generations':3,'population':6,'seed':1729,'objective':'duration','locked_operations':pins}
    previous=v.observe(full_runtime_adapter,old,model,copy.deepcopy(opts))
    changed=v.observe(full_runtime_adapter,joint_minibatch,model,copy.deepcopy(opts))
    old_finish=check(previous['result'],model,pins);new_finish=check(changed['result'],model,pins)
    for _,p in changed['scored']:check(p,model,pins)
    exact=any(g.mapping()['T'][0]==35 and any(r['order']=='T' and r['operation_id']=='T_B' and r['batch']==1
              and r['start_min']==685 and r['end_min']==720 for r in p['operations']) for g,p in changed['scored'])
    report={'old_finish':old_finish,'new_finish':new_finish,'exact_gap_evaluated':exact,
        'quick_budget':changed['quick'],'distinct':changed['distinct'],'caller_unchanged':changed['caller_unchanged'],
        'no_regression':new_finish<=old_finish+1e-5,'target_reached':new_finish<=945+1e-5}
    Path('/work/gap-witness.json').write_text(json.dumps(report))
    assert all(v is True for k,v in report.items() if k not in ('old_finish','new_finish'))
    cases=load('gap_previous_cases',OPS/'shift-aware-minibatches-20261125/cases.py')
    div=load('gap_previous_div',OPS/'joint-search-diversity-20261125/verify_diversity.py')
    reg=load('gap_previous_reg',OPS/'native-batching-verify-20261124/regression_cases.py')
    prev=runpy.run_path(str(OPS/'joint-search-diversity-20261125/patch.py'))['patch']((OPS/'joint-minibatch-search-20261124/joint_minibatch.py').read_text())
    result=v.new_report();result['exact_module_installed']=True
    result=v.verify(full_runtime_adapter,joint_minibatch,prev,cases,div.verify,reg.check_production,result,['bootstrap'])
    assert result['all_shift_checks_passed'] is True
    report['previous_shift_checks']=True
    Path('/work/gap-witness.json').write_text(json.dumps(report))
    return report

if __name__=='__main__':
    try:
        with open(os.devnull,'w') as sink,contextlib.redirect_stdout(sink),contextlib.redirect_stderr(sink):report=run()
        print('GAP_NATIVE_PASS '+json.dumps(report))
    except Exception as e:
        print('GAP_NATIVE_FAILED '+type(e).__name__)
        sys.exit(6)
