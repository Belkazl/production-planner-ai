"""Apply a single exact native duration integration; no optimizer/search changes."""
import ast
import hashlib
from pathlib import Path
import sys

OLD_SHA = '11a877e02cdc39f60d6597be8ca306135f7daff142dd9fb620e0f9f2dd6f95eb'
MARK = 'PP_UNIVERSAL_PROCESS_FACTOR_V1'

def patch(source):
    assert hashlib.sha256(source).hexdigest() == OLD_SHA, 'adapter_source_drift'
    text = source.decode('utf-8')
    assert MARK not in text, 'already_patched'
    tree = ast.parse(text)
    funcs = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_namespace']
    assert len(funcs) == 1, 'namespace_anchor'
    last = funcs[0].body[-1]
    assert isinstance(last, ast.Return) and isinstance(last.value, ast.Name) and last.value.id == 'ns', 'namespace_return_anchor'
    lines = text.splitlines(keepends=True)
    i = last.lineno - 1
    indent = lines[i][:len(lines[i])-len(lines[i].lstrip())]
    assert lines[i].strip() == 'return ns', 'exact_return_anchor'
    code = '''# PP_UNIVERSAL_PROCESS_FACTOR_V1: scale production duration once, regardless of timing mode.
import functools as _pp_factor_functools
_pp_factor_original = ns['_pp_v1_duration']
_pp_factor_number = ns['_pp_v1_num']
@_pp_factor_functools.wraps(_pp_factor_original)
def _pp_factor_duration(base_dur, eq, order, op):
    factor = max(1e-6, _pp_factor_number((eq or {}).get('process_multiplier', (eq or {}).get('multiplier', 1.0)), 1.0))
    if factor == 1.0:
        return _pp_factor_original(base_dur, eq, order, op)
    # Legacy fallback already multiplies by the coefficient. Neutralize it in a
    # shallow copy only, then scale the complete native duration exactly once.
    neutral = dict(eq or {})
    neutral['process_multiplier'] = 1.0
    neutral['multiplier'] = 1.0
    return _pp_factor_original(base_dur, neutral, order, op) * factor
ns['_pp_v1_duration'] = _pp_factor_duration
'''
    inserted = ''.join(indent + line + '\n' for line in code.splitlines())
    result = ''.join(lines[:i]) + inserted + ''.join(lines[i:])
    assert result.replace(inserted, '', 1) == text
    compile(result, '<process-factor-adapter>', 'exec')
    return result.encode('utf-8')

if __name__ == '__main__':
    src, dst = map(Path, sys.argv[1:])
    dst.write_bytes(patch(src.read_bytes()))
