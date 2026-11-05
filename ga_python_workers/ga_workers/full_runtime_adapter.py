"""Run owner-supplied Python GA in a fresh, account-isolated worker process.

The fully assembled runtime is built at worker-service startup from Railway
reference variables. Neither source nor account data is committed to GitHub.
"""
import ast
import copy
import hashlib
import os
from pathlib import Path
from .constraints import make_constrained_scheduler, PinConstraintError
from .continuation import load_resume_state, load_resume_plan, export_resume_state, ContinuationError
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


def _extract_locks(payload, model, options):
    for owner in (options, payload, model):
        for key in ('locked_operations','manual_locks','fixed_operations','pinned_operations'):
            item = owner.get(key)
            if item:
                if not isinstance(item, list):
                    raise FullGAError('ga_locks_must_be_array')
                return copy.deepcopy(item)
    plan = payload.get('plan')
    if isinstance(plan,dict):
        rows = plan.get('generic_operations') or plan.get('operations') or []
        if not isinstance(rows,list):
            raise FullGAError('ga_plan_locks_invalid')
        return [copy.deepcopy(r) for r in rows if isinstance(r,dict) and r.get('manual_locked')]
    return []


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


def _preview_plan(best,model):
    """Normalize a live generic-GA snapshot to the public plan contract."""
    if not isinstance(best,dict) or best.get('valid') is not True:
        return None
    preview=copy.deepcopy(best)
    rows=preview.get('operations')
    if not isinstance(rows,list) or not rows:
        generic=preview.get('generic_operations')
        if isinstance(generic,list) and generic:
            # The generic optimizer's live snapshot can expose only
            # generic_operations even though the completed result exposes both.
            # Public progress consumers require operations, so derive the
            # production rows without mutating the optimizer snapshot.
            rows=[copy.deepcopy(x) for x in generic
                  if isinstance(x,dict) and x.get('phase')!='setup' and x.get('order') is not None]
            if rows:
                preview['operations']=rows
    if not isinstance(preview.get('operations'),list) or not preview['operations']:
        return None
    try:
        _assert_owned(preview,model)
    except FullGAError:
        return None
    return preview


def run(payload,progress):
    if not isinstance(payload,dict) or not isinstance(payload.get('model'),dict):
        raise FullGAError('ga_model_required')
    original=copy.deepcopy(payload['model'])
    opts=payload.get('options') or {}
    if not isinstance(opts,dict):raise FullGAError('ga_options_invalid')
    if not isinstance(original.get('orders'),list) or not original['orders']:
        raise FullGAError('ga_orders_missing')
    pins=_extract_locks(payload,original,opts)
    continuing=bool(opts.get('continue') or opts.get('continue_run'))
    ga=_namespace()
    for name in ('optimize','_pp_optimize_generic'):
        fn=ga.get(name);code=getattr(fn,'__code__',None)
        if callable(fn) and code is not None:
            print("PP_GA_OPT_META",name,{"args":list(code.co_varnames[:code.co_argcount]),"names":sorted(set(str(x) for x in code.co_names if isinstance(x,str)))},flush=True)
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
    objective=opts.get('objective') or 'duration'
    if objective not in {'duration','wait','idle','cycles','balanced'}:
        raise FullGAError('ga_objective_invalid')
    if pins or continuing:
        if not ga['_pp_generic_declared'](normalized):
            raise FullGAError('ga_locks_and_continuation_require_generic_mode')
    if pins:
        try: pins=make_constrained_scheduler(ga,pins,normalized)
        except PinConstraintError as ex: raise FullGAError(str(ex)) from ex
    if continuing:
        try:
            if opts.get('resume_state'):
                load_resume_state(opts.get('resume_state'),normalized,objective,pins,ga)
            else:
                load_resume_plan(opts.get('resume_plan'),normalized,objective,pins,ga)
        except ContinuationError as ex:raise FullGAError(str(ex)) from ex
    elif opts.get('resume_state') or opts.get('resume_plan'):
        raise FullGAError('ga_resume_state_requires_continue')
    state={'candidate_preview':None,'candidate_seq':0}
    original_progress_candidate=ga.get('_pp_progress_candidate')
    if callable(original_progress_candidate):
        def captured_progress_candidate(model_arg,sim_arg,objective_arg):
            out=original_progress_candidate(model_arg,sim_arg,objective_arg)
            try:
                raw=(ga.get('_PP_PLAN_PROGRESS') or {}).get('candidate_preview')
                live=_preview_plan(raw,normalized)
                if live is not None:
                    state['candidate_preview']=live
                    state['candidate_seq']=int(state.get('candidate_seq') or 0)+1
            except Exception:
                pass
            return out
        ga['_pp_progress_candidate']=captured_progress_candidate
    def compute():
        try:state['result']=ga['optimize'](gens,population,seed,continuing,objective)
        except BaseException as exc:state['exception']=exc
    progress({'percent':1,'phase':'starting','running':True})
    task=threading.Thread(target=compute,daemon=True)
    task.start()
    last=(-1,0)
    last_candidate_at=0.0
    last_candidate_seq=0
    while task.is_alive():
        task.join(timeout=0.15)
        try:
            snap=ga.get('_pp_progress_snapshot',lambda: {})()
            pct=int(snap.get('percent') or 0)
            best=_preview_plan(snap.get('best_preview'),normalized)
            candidate=state.get('candidate_preview') or _preview_plan(snap.get('candidate_preview'),normalized)
            candidate_seq=int(state.get('candidate_seq') or 0)
            now=time.monotonic()
            candidate_due=candidate is not None and candidate_seq!=last_candidate_seq and (now-last_candidate_at)>=2.0
            if (pct,last[1] if best is not None else 0)!=last or candidate_due:
                # Preserve the preview contract without reporting data from
                # another account; all inputs here belong to this one process.
                preview={'percent':min(99,max(1,pct)),'phase':snap.get('phase','optimizing'),'running':True}
                if best is not None:
                    preview['best_preview']=best
                if candidate_due:
                    preview['candidate_preview']=candidate
                    last_candidate_at=now
                    last_candidate_seq=candidate_seq
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
    # Portable incumbent is portable across OS processes. The authenticated
    # caller persists it per account alongside the model/last-plan state.
    if ga['_pp_generic_declared'](normalized):
        try: result['resume_state']=export_resume_state(result,normalized,objective,pins)
        except ContinuationError as ex:raise FullGAError(str(ex)) from ex
    result['locked_operations_applied']=len(pins)
    progress({'percent':100,'phase':'complete','running':False,'best_preview':result})
    return result