"""Exact adapter integration for compact joint state; no private engine reads."""
import ast
import hashlib
from pathlib import Path
import sys


IMPORT = (
    "# pp_joint_continuation_v1: preserve fingerprint-bound ordered batch genes.\n"
    "from .joint_continuation import (\n"
    "    load_joint_resume_state as load_resume_state,\n"
    "    load_joint_resume_plan as load_resume_plan,\n"
    "    export_joint_resume_state as export_resume_state,\n"
    ")\n\n"
)
ANCHOR = "SOURCE = Path('/tmp/production_planner.py')"
OLD_GUARD = "native_state.get('version') != 1"
NEW_GUARD = "native_state.get('version') not in (1, 2)"
OLD_CHECKPOINT_GATE = "if now_check-state['best_checked_at']>=1.5 or not state.get('verified_checkpoint'):"
NEW_CHECKPOINT_GATE = ("if (now_check-state['best_checked_at']>=1.5 or not state.get('verified_checkpoint') or\n"
                       "                    _pp_joint_checkpoint_needs_genome(ga,state.get('verified_checkpoint'),sim_arg,objective_arg)):")
PREVIEW_CHECK = "    if _pp_joint_preview_evaluating(ga):\n        return None\n"
OLD_CHECKPOINT_ORDER = "        stored=cache.get('best_order')\n"
NEW_CHECKPOINT_ORDER = OLD_CHECKPOINT_ORDER + '''        # pp_joint_checkpoint_order_v1: the evaluated gene owns its sequence.
        joint=ga.get('_PP_JOINT_BATCH_STATE')
        if (isinstance(joint,dict) and joint.get('version')=='joint-minibatch-v1-20261124'
                and joint.get('evaluating') is not True and type(joint.get('feasible')) is int
                and joint['feasible']>0):
            evaluated=sim.get('order_sequence')
            if (not isinstance(evaluated,list) or len(evaluated)!=len(model_ids)
                    or set(map(str,evaluated))!=set(model_ids)):
                return None
            stored=list(map(str,evaluated))
'''
PREVIEW_HELPERS = '''# pp_joint_preview_verified_v1: publish only a feasibility-checked joint gene.
def _pp_joint_preview_evaluating(ga):
    joint=ga.get('_PP_JOINT_BATCH_STATE') if isinstance(ga,dict) else None
    return (isinstance(joint,dict) and joint.get('version')=='joint-minibatch-v1-20261124'
            and joint.get('evaluating') is True)


def _pp_joint_checkpoint_needs_genome(ga,checkpoint,sim=None,objective='duration'):
    joint=ga.get('_PP_JOINT_BATCH_STATE') if isinstance(ga,dict) else None
    if (not isinstance(joint,dict) or joint.get('version')!='joint-minibatch-v1-20261124'
            or joint.get('evaluating') is True or type(joint.get('feasible')) is not int
            or joint['feasible']<1):
        return False
    export=joint.get('export_incumbent')
    if not callable(export) or not isinstance(sim,dict):
        return False
    try:
        # This callback accepts only an exact genotype already registered after
        # complete feasibility checks. A best event occurs once per improvement;
        # throttling it can otherwise retain an older best for the whole run.
        genome=export(sim)
        if not isinstance(genome,dict):
            return False
        saved=checkpoint.get('resume_state') if isinstance(checkpoint,dict) else None
        if not (isinstance(saved,dict) and saved.get('version')==2
                and saved.get('joint_schema')=='joint-minibatch-v1-20261124'
                and saved.get('batch_genome')==genome):
            return True
        if objective!='duration':
            return True
        return 0<=float(sim['duration_minutes'])<float(checkpoint['duration_minutes'])-1e-8
    except (ValueError,TypeError,KeyError,OverflowError):
        return False


'''


def _patch_checkpoint_order(source):
    if 'pp_joint_checkpoint_order_v1' in source:
        if source.count(NEW_CHECKPOINT_ORDER) != 1:
            raise RuntimeError('JOINT_CONTINUATION_CHECKPOINT_ORDER_PARTIAL_INSTALLATION')
        return source
    if (source.count(OLD_CHECKPOINT_ORDER) != 1 or source.count("plan['order_sequence']=seq") != 1):
        raise RuntimeError('JOINT_CONTINUATION_CHECKPOINT_ORDER_ANCHOR_DRIFT')
    updated = source.replace(OLD_CHECKPOINT_ORDER, NEW_CHECKPOINT_ORDER, 1)
    if updated.replace(NEW_CHECKPOINT_ORDER, OLD_CHECKPOINT_ORDER, 1) != source:
        raise RuntimeError('JOINT_CONTINUATION_CHECKPOINT_ORDER_UNRELATED_CHANGE')
    ast.parse(updated)
    return updated


def _patch_preview(source):
    if 'pp_joint_preview_verified_v1' in source:
        if (source.count(PREVIEW_HELPERS) != 1 or source.count(PREVIEW_CHECK) != 1
                or source.count(NEW_CHECKPOINT_GATE) != 1 or OLD_CHECKPOINT_GATE in source):
            raise RuntimeError('JOINT_CONTINUATION_PREVIEW_PARTIAL_INSTALLATION')
        return _patch_checkpoint_order(source)
    if any(token in source for token in ('_pp_joint_preview_evaluating', '_pp_joint_checkpoint_needs_genome')):
        raise RuntimeError('JOINT_CONTINUATION_PREVIEW_UNKNOWN_INSTALLATION')
    tree = ast.parse(source)
    helpers = [node for node in tree.body if isinstance(node, ast.FunctionDef)
               and node.name == '_live_scheduler_preview']
    if len(helpers) != 1 or source.count(OLD_CHECKPOINT_GATE) != 1:
        raise RuntimeError('JOINT_CONTINUATION_PREVIEW_ANCHOR_DRIFT')
    helper = helpers[0]
    if ([arg.arg for arg in helper.args.args] != ['sim', 'model', 'objective', 'ga', 'pins', 'checkpoint']
            or len(helper.args.defaults) != 1 or not isinstance(helper.args.defaults[0], ast.Constant)
            or helper.args.defaults[0].value is not False):
        raise RuntimeError('JOINT_CONTINUATION_PREVIEW_SIGNATURE_DRIFT')
    body = helper.body
    if isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
        body = body[1:]
    expected_first = ast.parse("if not isinstance(sim,dict) or not isinstance(sim.get('ctx'),dict):\n    return None").body[0]
    if not body or ast.dump(body[0]) != ast.dump(expected_first):
        raise RuntimeError('JOINT_CONTINUATION_PREVIEW_FIRST_GUARD_DRIFT')
    # The existing best-selection rule must admit an equal-duration upgrade and
    # must continue protecting an earlier shorter verified checkpoint.
    if source.count("float(live['duration_minutes'])<=float(old['duration_minutes'])+1e-8") != 1:
        raise RuntimeError('JOINT_CONTINUATION_PREVIEW_BEST_ORDER_DRIFT')
    lines = source.splitlines(keepends=True)
    lines.insert(body[0].lineno - 1, PREVIEW_CHECK)
    updated = ''.join(lines).replace(ANCHOR, PREVIEW_HELPERS + ANCHOR, 1)
    updated = updated.replace(OLD_CHECKPOINT_GATE, NEW_CHECKPOINT_GATE, 1)
    ast.parse(updated)
    reversed_source = (updated.replace(PREVIEW_HELPERS, '', 1).replace(PREVIEW_CHECK, '', 1)
                       .replace(NEW_CHECKPOINT_GATE, OLD_CHECKPOINT_GATE, 1))
    if reversed_source != source:
        raise RuntimeError('JOINT_CONTINUATION_PREVIEW_UNRELATED_CHANGE')
    return _patch_checkpoint_order(updated)


def _export_calls(tree):
    found = []

    def visit(node, scopes):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            arguments = node.args.posonlyargs + node.args.args + node.args.kwonlyargs
            has_ga = any(argument.arg == "ga" for argument in arguments)
            has_ga = has_ga or any(isinstance(child, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id == "ga" for target in child.targets)
                for child in ast.walk(node))
            scopes = scopes + [(node.name, has_ga)]
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "export_resume_state":
            if not scopes or not any(scope[1] for scope in scopes) or len(node.args) != 4:
                raise RuntimeError("JOINT_CONTINUATION_EXPORT_SCOPE_DRIFT")
            found.append(node)
        for child in ast.iter_child_nodes(node):
            visit(child, scopes)

    visit(tree, [])
    if not 1 <= len(found) <= 4:
        raise RuntimeError("JOINT_CONTINUATION_EXPORT_COUNT_DRIFT")
    return found


def patch(source):
    tree = ast.parse(source)
    for required in ("from .continuation import", "ContinuationError", "def run(payload,progress):",
                     "_assert_owned(result,normalized)", "ga['optimize'](gens,population,seed,",
                     "load_resume_state", "result['resume_state']"):
        if required not in source:
            raise RuntimeError("JOINT_CONTINUATION_ADAPTER_CONTRACT_DRIFT")
    loads = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
             and isinstance(node.func, ast.Name) and node.func.id == "load_resume_state"]
    if not 1 <= len(loads) <= 3 or any(len(node.args) != 5 for node in loads):
        raise RuntimeError("JOINT_CONTINUATION_LOAD_CONTRACT_DRIFT")
    for node in loads:
        if not all(isinstance(arg, ast.Name) and arg.id == name
                   for arg, name in zip(node.args[1:], ("normalized", "objective", "pins", "ga"))):
            raise RuntimeError("JOINT_CONTINUATION_LOAD_BINDING_DRIFT")
    plan_loads = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
                  and isinstance(node.func, ast.Name) and node.func.id == 'load_resume_plan']
    if len(plan_loads) > 3 or any(len(node.args) != 5 or node.keywords for node in plan_loads):
        raise RuntimeError('JOINT_CONTINUATION_PLAN_LOAD_CONTRACT_DRIFT')
    for node in plan_loads:
        if not all(isinstance(arg, ast.Name) and arg.id == name
                   for arg, name in zip(node.args[1:], ('normalized', 'objective', 'pins', 'ga'))):
            raise RuntimeError('JOINT_CONTINUATION_PLAN_LOAD_BINDING_DRIFT')
    exports = _export_calls(tree)
    installed = "pp_joint_continuation_v1" in source
    if installed:
        if source.count(IMPORT) != 1 or OLD_GUARD in source:
            raise RuntimeError("JOINT_CONTINUATION_PARTIAL_INSTALLATION")
        for node in loads:
            if len(node.keywords) != 1 or node.keywords[0].arg != "resume_plan":
                raise RuntimeError("JOINT_CONTINUATION_PARTIAL_LOAD_INSTALLATION")
            expected = ast.parse("opts.get('resume_plan')", mode="eval").body
            if ast.dump(node.keywords[0].value) != ast.dump(expected):
                raise RuntimeError("JOINT_CONTINUATION_PARTIAL_LOAD_INSTALLATION")
        if any(len(node.keywords) != 1 or node.keywords[0].arg != "ga"
               or not isinstance(node.keywords[0].value, ast.Name) or node.keywords[0].value.id != "ga"
               for node in exports):
            raise RuntimeError("JOINT_CONTINUATION_PARTIAL_EXPORT_INSTALLATION")
        return _patch_preview(source)
    if "from .joint_continuation" in source or any(node.keywords for node in exports + loads):
        raise RuntimeError("JOINT_CONTINUATION_UNRECOGNIZED_INSTALLATION")
    if source.count(ANCHOR) != 1 or source.count(OLD_GUARD) > 1:
        raise RuntimeError("JOINT_CONTINUATION_SOURCE_ANCHOR_DRIFT")
    if "native_state=opts.get('resume_state')" in source and OLD_GUARD not in source:
        raise RuntimeError("JOINT_CONTINUATION_NATIVE_VERSION_GUARD_DRIFT")
    data = source.encode("utf-8")
    lines = source.splitlines(keepends=True)
    offsets = [0]
    for line in lines:
        offsets.append(offsets[-1] + len(line.encode("utf-8")))
    insertions = []
    for node in exports:
        end = offsets[node.end_lineno - 1] + node.end_col_offset
        if data[end - 1:end] != b")":
            raise RuntimeError("JOINT_CONTINUATION_EXPORT_ANCHOR_DRIFT")
        insertions.append((end - 1, b",ga=ga"))
    for node in loads:
        end = offsets[node.end_lineno - 1] + node.end_col_offset
        if data[end - 1:end] != b")":
            raise RuntimeError("JOINT_CONTINUATION_LOAD_ANCHOR_DRIFT")
        insertions.append((end - 1, b",resume_plan=opts.get('resume_plan')"))
    for offset, addition in sorted(insertions, reverse=True):
        data = data[:offset] + addition + data[offset:]
    updated = data.decode("utf-8").replace(ANCHOR, IMPORT + ANCHOR, 1)
    if OLD_GUARD in updated:
        updated = updated.replace(OLD_GUARD, NEW_GUARD, 1)
    ast.parse(updated)
    # Only the reviewed import, version guard and load/export arguments change.
    reversed_source = updated.replace(IMPORT, "", 1).replace(NEW_GUARD, OLD_GUARD, 1)
    reversed_source = reversed_source.replace(",ga=ga)", ")")
    reversed_source = reversed_source.replace(",resume_plan=opts.get('resume_plan'))", ")")
    if reversed_source != source:
        raise RuntimeError("JOINT_CONTINUATION_UNRELATED_CHANGE")
    return _patch_preview(updated)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: patch_worker.py INPUT_ADAPTER.py OUTPUT_ADAPTER.py")
    before = Path(sys.argv[1]).read_text(encoding="utf-8")
    after = patch(before)
    Path(sys.argv[2]).write_text(after, encoding="utf-8")
    print("JOINT_CONTINUATION_ADAPTER_PATCH", {"changed": before != after,
        "old_sha256": hashlib.sha256(before.encode()).hexdigest(),
        "new_sha256": hashlib.sha256(after.encode()).hexdigest()})
