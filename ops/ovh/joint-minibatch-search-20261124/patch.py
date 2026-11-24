"""Exact adapter additions; never rewrites existing lifecycle or decoder patches."""
import ast
from pathlib import Path
import sys


IMPORT = 'from .joint_minibatch import install_joint_minibatch_search\n'
CALL = '    install_joint_minibatch_search(ga, normalized, objective=objective, pins=pins)\n'
SOURCE = "SOURCE = Path('/tmp/production_planner.py')"
ANCHOR = '    if pins:\n        try: pins=make_constrained_scheduler(ga,pins,normalized)'


def patch(source):
    if IMPORT in source or CALL in source:
        if source.count(IMPORT) != 1 or source.count(CALL) != 1 or CALL + ANCHOR not in source:
            raise ValueError('JOINT_MINIBATCH_PARTIAL_INSTALLATION')
        ast.parse(source)
        return source
    if 'install_joint_minibatch_search' in source:
        raise ValueError('JOINT_MINIBATCH_UNKNOWN_INSTALLATION')
    for token in (SOURCE, ANCHOR, "objective=opts.get('objective') or 'duration'", 'def run(payload,progress):'):
        if source.count(token) != 1:
            raise ValueError('JOINT_MINIBATCH_ADAPTER_ANCHOR_DRIFT')
    if not source.index("objective=opts.get('objective') or 'duration'") < source.index(ANCHOR):
        raise ValueError('JOINT_MINIBATCH_ADAPTER_ORDER_DRIFT')
    output = source.replace(SOURCE, IMPORT + '\n' + SOURCE, 1).replace(ANCHOR, CALL + ANCHOR, 1)
    if output.replace(IMPORT + '\n', '', 1).replace(CALL, '', 1) != source:
        raise ValueError('JOINT_MINIBATCH_UNRELATED_SOURCE_CHANGE')
    ast.parse(output)
    return output


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: python3 patch.py INPUT_ADAPTER.py OUTPUT_ADAPTER.py')
    before = Path(sys.argv[1]).read_text()
    after = patch(before)
    Path(sys.argv[2]).write_text(after)
    print('JOINT_MINIBATCH_ADAPTER_PATCH_PASS', 'changed=' + str(before != after).lower())
