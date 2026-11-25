"""Exact public-source overlay of the accepted shift-aware worker."""
import ast
import hashlib
from pathlib import Path
import runpy
import sys

HERE = Path(__file__).resolve().parent
OPS = HERE.parent
BASE_SHA = 'ed6782ad3837fdf5d190106c0afd2c005b1225e05e53d232ee828d623344feae'
HELPERS = (HERE / 'gap_helpers.py').read_text()
OLD = "                            proposed = _shift_seed_candidates(ga, normalized, specs, genome, sim, frozen)\n"
NEW = OLD + """                            chain_proposed = _gap_chain_candidates(ga, normalized, specs, genome, sim, frozen, evaluated_keys)
                            proposed = list(dict.fromkeys(proposed + chain_proposed))
"""
NEXT = """                    individuals = _diverse_population(seeds, parents, specs, rng, frozen,
                        population, evaluated_keys, avoid=list(cache) + individuals)
"""
NEXT_NEW = """                    gap_proposed = []
                    if best is not None and best[1] not in gap_probed:
                        gap_probed.add(best[1])
                        gap_proposed = _gap_chain_candidates(ga, normalized, specs, best[1], best[2], frozen, evaluated_keys)
                    individuals = _diverse_population(gap_proposed + seeds, parents, specs, rng, frozen,
                        population, evaluated_keys, avoid=list(cache) + individuals)
"""
REPLACEMENTS = (
    ('def seed_genomes(specs, frozen=None):\n', HELPERS + '\n\ndef seed_genomes(specs, frozen=None):\n'),
    ('        shift_seed_attempted = False\n', '        shift_seed_attempted = False\n        gap_probed = set()\n'),
    (OLD, NEW.replace('                            chain_proposed =', '                            gap_probed.add(genome)\n                            chain_proposed =')),
    (NEXT, NEXT_NEW),
)

def digest(source):
    return hashlib.sha256(source.encode('utf-8')).hexdigest()

def baseline():
    base = (OPS / 'joint-minibatch-search-20261124/joint_minibatch.py').read_text()
    diversity = runpy.run_path(str(OPS / 'joint-search-diversity-20261125/patch.py'))['patch']
    shift = runpy.run_path(str(OPS / 'shift-aware-minibatches-20261125/patch.py'))['patch']
    base = shift(diversity(base))
    weekly = runpy.run_path(str(OPS / 'weekly-shift-calendars-20261125/patch.py'))['patch_joint']
    base = weekly(base)
    if digest(base) != BASE_SHA:
        raise ValueError('gap_accepted_base_mismatch')
    return base

def patch(source):
    if digest(source) != BASE_SHA:
        raise ValueError('gap_active_source_mismatch')
    for before, after in REPLACEMENTS:
        if source.count(before) != 1:
            raise ValueError('gap_patch_anchor_drift')
        source = source.replace(before, after, 1)
    ast.parse(source)
    return source

if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: patch.py ACTIVE.py CANDIDATE.py')
    source = Path(sys.argv[1]).read_text()
    candidate = patch(source)
    Path(sys.argv[2]).write_text(candidate)
    print('GAP_CHAIN_PATCH_PASS', digest(candidate))
