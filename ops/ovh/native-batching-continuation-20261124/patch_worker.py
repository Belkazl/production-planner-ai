"""Exact adapter integration for compact joint state; no private engine reads."""
import ast
import hashlib
from pathlib import Path
import sys


IMPORT = (
    "# pp_joint_continuation_v1: preserve fingerprint-bound ordered batch genes.\n"
    "from .joint_continuation import (\n"
    "    load_joint_resume_state as load_resume_state,\n"
    "    export_joint_resume_state as export_resume_state,\n"
    ")\n\n"
)
ANCHOR = "SOURCE = Path('/tmp/production_planner.py')"
OLD_GUARD = "native_state.get('version') != 1"
NEW_GUARD = "native_state.get('version') not in (1, 2)"


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
        return source
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
    # Only the reviewed import, version guard and export argument may change.
    reversed_source = updated.replace(IMPORT, "", 1).replace(NEW_GUARD, OLD_GUARD, 1)
    reversed_source = reversed_source.replace(",ga=ga)", ")")
    reversed_source = reversed_source.replace(",resume_plan=opts.get('resume_plan'))", ")")
    if reversed_source != source:
        raise RuntimeError("JOINT_CONTINUATION_UNRELATED_CHANGE")
    return updated


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: patch_worker.py INPUT_ADAPTER.py OUTPUT_ADAPTER.py")
    before = Path(sys.argv[1]).read_text(encoding="utf-8")
    after = patch(before)
    Path(sys.argv[2]).write_text(after, encoding="utf-8")
    print("JOINT_CONTINUATION_ADAPTER_PATCH", {"changed": before != after,
        "old_sha256": hashlib.sha256(before.encode()).hexdigest(),
        "new_sha256": hashlib.sha256(after.encode()).hexdigest()})
