"""Exact reversible proposals-only transform of the deployed diversity module."""
import ast
import hashlib
from pathlib import Path
import sys


BASE_SHA256 = '08a3fd9d556fecb726c69ce7632851c2117f0e753c16edac183361e632afe253'
VERSION = 'shift-aware-minibatches-v1-20261125'
HELPERS = Path(__file__).with_name('shift_helpers.py').read_text()

STATE_BEFORE = "             'unique_evaluations_complete': True, 'evaluating': False}\n"
STATE_AFTER = """             'unique_evaluations_complete': True,
             'shift_aware_version': SHIFT_AWARE_VERSION,
             'shift_seed_proposals': 0, 'shift_seed_evaluations': 0,
             'evaluating': False}
"""
INITIAL_BEFORE = """        individuals = _diverse_population(seeds, seeds, specs, rng, frozen,
            population, evaluated_keys, required=seeds[:1])
"""
INITIAL_AFTER = INITIAL_BEFORE + """        shift_seed_attempted = False
        shift_seed_keys = set()
"""
LOOP_BEFORE = "                for genome in individuals:\n"
LOOP_AFTER = """                for slot in range(population):
                    genome = individuals[slot]
"""
EVALUATED_BEFORE = """                        key = _diversity_key(genome)
                        if key not in evaluated_keys:
"""
EVALUATED_AFTER = """                        key = _diversity_key(genome)
                        if key in shift_seed_keys:
                            state['shift_seed_evaluations'] += 1
                        if key not in evaluated_keys:
"""
CALENDAR_BEFORE = "                            sim = ga['_pp_schedule_sequence'](copy.deepcopy(candidate_model), list(genome.sequence))\n"
CALENDAR_AFTER = CALENDAR_BEFORE + "                            sim = _shift_repair_or_reject(ga, normalized, sim, repair_candidate)\n"
ALIGN_BEFORE = "        previous_equipment = _install_capacity_eligibility(ga)\n"
ALIGN_AFTER = ALIGN_BEFORE + "        _shift_align_native_windows(ga, normalized)\n"
RANKED_BEFORE = "                        ranked.append((score, genome))\n"
RANKED_AFTER = RANKED_BEFORE + """                        if not shift_seed_attempted and attempts < generations * population:
                            shift_seed_attempted = True
                            proposed = _shift_seed_candidates(ga, normalized, specs, genome, sim, frozen)
                            existing = evaluated_keys | {_diversity_key(genome)}
                            proposed = [value for value in proposed if _diversity_key(value) not in existing]
                            if proposed:
                                shift_seed_keys.update(_diversity_key(value) for value in proposed)
                                state['shift_seed_proposals'] += len(proposed)
                                seeds = list(dict.fromkeys(seeds[:1] + proposed + seeds[1:]))
                                if slot + 1 < population:
                                    individuals[slot + 1:] = _diverse_population(
                                        proposed + individuals[slot + 1:], seeds, specs, rng, frozen,
                                        population - slot - 1, evaluated_keys, avoid=[genome])
"""
REPORT_BEFORE = "                'cache_reuses', 'unique_evaluations_complete')}\n"
REPORT_AFTER = """                'cache_reuses', 'unique_evaluations_complete', 'shift_aware_version',
                'shift_seed_proposals', 'shift_seed_evaluations')}
"""
REPLACEMENTS = (
    ('def seed_genomes(specs, frozen=None):\n', HELPERS + '\n\ndef seed_genomes(specs, frozen=None):\n'),
    (STATE_BEFORE, STATE_AFTER),
    (INITIAL_BEFORE, INITIAL_AFTER),
    (LOOP_BEFORE, LOOP_AFTER),
    (EVALUATED_BEFORE, EVALUATED_AFTER),
    (CALENDAR_BEFORE, CALENDAR_AFTER),
    (ALIGN_BEFORE, ALIGN_AFTER),
    (RANKED_BEFORE, RANKED_AFTER),
    (REPORT_BEFORE, REPORT_AFTER),
)


def digest(source):
    return hashlib.sha256(source.encode('utf-8')).hexdigest()


def _forward(source):
    for before, after in REPLACEMENTS:
        if source.count(before) != 1 or after in source:
            raise ValueError('SHIFT_MINIBATCH_ANCHOR_DRIFT')
        source = source.replace(before, after, 1)
    ast.parse(source)
    return source


def patch(source):
    if not isinstance(source, str):
        raise ValueError('SHIFT_MINIBATCH_SOURCE_TYPE')
    if digest(source) == BASE_SHA256:
        return _forward(source)
    if VERSION in source:
        before = source
        for old, new in reversed(REPLACEMENTS):
            if before.count(new) != 1:
                raise ValueError('SHIFT_MINIBATCH_PARTIAL_INSTALLATION')
            before = before.replace(new, old, 1)
        if digest(before) != BASE_SHA256 or _forward(before) != source:
            raise ValueError('SHIFT_MINIBATCH_SOURCE_DRIFT')
        return source
    raise ValueError('SHIFT_MINIBATCH_BASE_HASH')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: python3 patch.py INPUT_JOINT.py OUTPUT_JOINT.py')
    before = Path(sys.argv[1]).read_text()
    after = patch(before)
    Path(sys.argv[2]).write_text(after)
    print('SHIFT_MINIBATCH_PATCH_PASS', 'changed=' + str(before != after).lower())
