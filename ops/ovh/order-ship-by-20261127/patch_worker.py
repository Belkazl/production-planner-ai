"""Guarded patch of the installed joint minibatch worker, preserving its other changes."""
import ast
from pathlib import Path
import sys

MARKER = '# PP_ORDER_SHIP_BY_V1'
REPLACEMENTS = (
    ('def _score(ga, sim, objective):', 'def _score(ga, sim, objective, model):'),
    ('        return tuple(_number(item) for item in value)\n    return (_number(value),)', '        native = tuple(_number(item) for item in value)\n    else:\n        native = (_number(value),)\n    return deadline_score(model, sim, native)'),
    ('score = _score(ga, sim, objective)', 'score = _score(ga, sim, objective, normalized)'),
    ('        for candidate in seeds:\n            _pins_accept(candidate, pins)', '''        if deadline_offsets(normalized):
            # Evaluate deadline-first ordering as one candidate, not a hard ordering
            # constraint. Keep the continuation incumbent first when available.
            baseline = seeds[0]
            sequence = deadline_sequence(normalized, baseline.sequence)
            parts = baseline.mapping()
            deadline_seed = validate_genome(Genome(sequence, tuple((oid, parts[oid]) for oid in sequence)), specs, frozen)
            if deadline_seed not in seeds:
                seeds.insert(1 if continue_run else 0, deadline_seed)
        for candidate in seeds:
            _pins_accept(candidate, pins)'''),
    ("            result['joint_minibatch'] =", "            if deadline_offsets(normalized):\n                result['order_deadlines'] = deadline_report(normalized, result)\n            result['joint_minibatch'] ="),
)
def patch(source, shared):
    if MARKER in source:
        raise ValueError('deadline_patch_already_installed')
    ast.parse(source)
    ast.parse(shared)
    for old, new in REPLACEMENTS:
        if source.count(old) != 1:
            raise ValueError('deadline_worker_anchor_drift: ' + old.splitlines()[0])
        source = source.replace(old, new, 1)
    # The helper is self-contained and has only standard-library imports.
    # Appending avoids a new worker package/build dependency.
    source += '\n' + MARKER + '\n' + shared + '\n'
    ast.parse(source)
    return source

if __name__ == '__main__':
    src, dst = map(Path, sys.argv[1:3])
    shared = Path(__file__).with_name('deadlines.py').read_text()
    dst.write_text(patch(src.read_text(), shared))
