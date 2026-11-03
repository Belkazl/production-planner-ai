"""Run owner-supplied Python GA in a fresh, account-isolated worker process.

The fully assembled runtime is built at worker-service startup from Railway
reference variables. Neither source nor account data is committed to GitHub.
"""
import ast
import copy
import hashlib
import os
from pathlib import Path
import re
import threading
import time

SOURCE = Path('/tmp/production_planner.py')


class FullGAError(RuntimeError):
    pass


def ensure_compiled():
    """Called once during service boot; reject missing or changed source."""
    from .compile_legacy_ga import build
    build()
    return True


def _namespace():
    if not SOURCE.is_file():
        raise FullGAError('ga_full_source_not_compiled')
    source = SOURCE.read_bytes()
    if len(source) > 3_000_000 or len(source) < 360_000:
        raise FullGAError('ga_compiled_source_invalid_size')
    actual=hashlib.sha256(source).hexdigest()
    expected=os.getenv('PP_PY_GA_ASSEMBLED_SHA256','')
    if expected and (not re.fullmatch(r'[0-9a-f]{64}',expected) or expected!=actual):
        raise FullGAError('ga_compiled_source_mismatch')
    tree=ast.parse(source,filename='<liftorbit-account-ga>')
    filtered=[]
    removed=set()
    for node in tree.body:
        if isinstance(node,ast.Expr) and isinstance(node.value,ast.Call):
            func=node.value.func
            if isinstance(func,ast.Name) and func.id in {'_db_init','_db_selftest','_pp_v1_selftest'}:
                removed.add(func.id)
                continue
        if isinstance(node,ast.If) and isinstance(node.test,ast.Compare):
            cmp=node.test
            if (isinstance(cmp.left,ast.Name) and cmp.left.id=='__name__'
                and any(isinstance(x,ast.Constant) and x.value=='__main__' for x in cmp.comparators)):
                continue
        filtered.append(node)
    if not {'_db_init','_db_selftest','_pp_v1_selftest'}.issubset(removed):
        raise FullGAError('ga_private_engine_boot_contract_changed')
    tree.body=filtered
    ast.fix_missing_locations(tree)
    ns={'__name__':'liftorbit_per_account_ga','__file__':str(SOURCE)}
    # No process is given DATABASE_URL or upstream AI credentials; this is
    # calculations only. The supervisor's service must have code variables only.
    os.environ['PP_SELFTEST']='0'
    os.environ['AI_BOOT_SMOKE']='0'
    exec(compile(tree,'<liftorbit-account-ga>','exec'),ns)
    required=('canonicalize_model','model_ready','install_model','optimize',
              '_pp_optimize_generic','_pp_setup_generic_apply')
    if not all(callable(ns.get(n)) for n in required):
        raise FullGAError('ga_expected_runtime_missing')
    return ns


def _unsupported_locks(payload,model,options):
    for owner in (payload,model,options):
        for key in ('locked_operations','manual_locks','fixed_operations','pinned_operations'):
            if owner.get(key):return True
    if isinstance(payload.get('plan'),dict):
        if any(isinstance(r,dict) and r.get('manual_locked') for r in
               payload['plan'].get('generic_operations',payload['plan'].get('operations',[]))):
            return True
    return False


def _assert_owned(plan,model):
    if not isinstance(plan,dict) or plan.get('valid') is not True:
        raise FullGAError('ga_invalid_plan')
    rows=plan.get('generic_operations') or plan.get('operations') or []
    if not isinstance(rows,list) or not rows:
        raise FullGAError('ga_no_operations')
    own_orders={str(o.get('id')) for o in (model.get('orders') or [])}
    own_eq={str(e.get('id')) for e in (model.get('equipment') or model.get('autoclaves') or [])}
    own_employees={str(e.get('id')) for e in (model.get('employees') or [])}
    own_materials={str(m.get('id')) for m in (model.get('materials') or [])}
    for row in rows:
        if not isinstance(row,dict) or str(row.get('order')) not in own_orders:
            raise FullGAError('ga_foreign_or_invalid_order')
        for key,allowed in [('equipment_ids',own_eq),('employee_ids',own_employees)]:
            for rid in row.get(key) or []:
                if str(rid) not in allowed:raise FullGAError('ga_foreign_resource')
        for material in row.get('materials') or []:
            if isinstance(material,dict) and material.get('id') is not None:
                if str(material['id']) not in own_materials:
                    raise FullGAError('ga_foreign_material')
    return True


def run(payload,progress):
    if not isinstance(payload,dict) or not isinstance(payload.get('model'),dict):
        raise FullGAError('ga_model_required')
    original=copy.deepcopy(payload['model'])
    opts=payload.get('options') or {}
    if not isinstance(opts,dict):raise FullGAError('ga_options_invalid')
    if not isinstance(original.get('orders'),list) or not original['orders']:
        raise FullGAError('ga_orders_missing')
    if _unsupported_locks(payload,original,opts):
        raise FullGAError('ga_manual_locks_require_verified_scheduler')
    if opts.get('continue') or opts.get('continue_run'):
        # No pretending to reuse a GA population from another process.
        raise FullGAError('ga_resume_requires_saved_incumbent')
    ga=_namespace()
    normalized=ga['canonicalize_model'](original)
    if not isinstance(normalized,dict) or not ga['model_ready'](normalized):
        raise FullGAError('ga_model_not_ready')
    ga['CURRENT_MODEL']=normalized
    ga['install_model'](normalized)
    gens=max(1,min(15000,int(opts.get('generations',120))))
    population=max(2,min(1000,int(opts.get('population',80))))
    seed=opts.get('seed',1729)
    if seed is not None and (isinstance(seed,bool) or not isinstance(seed,(int,float))):
        raise FullGAError('ga_seed_invalid')
    objective=opts.get('objective','duration')
    if objective not in {'duration','wait','idle','cycles','balanced',None}:
        raise FullGAError('ga_objective_invalid')
    state={}
    def compute():
        try:state['result']=ga['optimize'](gens,population,seed,False,objective)
        except BaseException as exc:state['exception']=exc
    progress({'percent':1,'phase':'starting','running':True})
    task=threading.Thread(target=compute,daemon=True)
    task.start()
    last=(-1,0)
    while task.is_alive():
        task.join(timeout=0.15)
        try:
            snap=ga.get('_pp_progress_snapshot',lambda: {})()
            pct=int(snap.get('percent') or 0)
            best=snap.get('best_preview')
            if (pct,last[1] if best is not None else 0)!=last:
                # Preserve the preview contract without reporting data from
                # another account; all inputs here belong to this one process.
                preview={'percent':min(99,max(1,pct)),'phase':snap.get('phase','optimizing'),'running':True}
                if isinstance(best,dict) and best.get('operations'):
                    preview['best_preview']=best
                progress(preview)
                last=(pct,1 if best is not None else 0)
        except Exception:
            pass
    if 'exception' in state:
        raise FullGAError('ga_optimizer_failed') from state['exception']
    result=state.get('result')
    if not isinstance(result,dict) or not result.get('ok') or result.get('valid') is not True:
        raise FullGAError('ga_no_valid_solution')
    _assert_owned(result,normalized)
    progress({'percent':100,'phase':'complete','running':False,'best_preview':result})
    return result