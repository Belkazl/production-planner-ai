"""Exact, reversible search-only patch for the public joint minibatch module."""
import ast
import hashlib
from pathlib import Path
import sys


BASE_SHA256 = 'a368dca1ec1b1aaab0bd7c91f6e7d39c7c259d82f9c49d8df5f3186502c548cc'
VERSION = 'joint-search-diversity-v1-20261125'

CONSTANTS = '''
SEARCH_DIVERSITY_VERSION = 'joint-search-diversity-v1-20261125'
MAX_DIVERSITY_ATTEMPTS_PER_SLOT = 8
MAX_TRACKED_UNIQUE_EVALUATIONS = 4096
MAX_SEED_EXTRA_PARTS = 2
'''

HELPERS = '''def _diversity_key(genome):
    # Bounded fingerprints are used only to avoid repeated search work.
    return hashlib.sha256(json.dumps(genome.json(), separators=(',', ':'),
                                    allow_nan=False).encode()).digest()


def _diversity_seed(base, specs, frozen, mode, offset):
    """One changed order, at most two additional parts, no capacity change."""
    parts = base.mapping()
    mutable = [oid for oid in base.sequence if not frozen or oid not in frozen]
    total = sum(len(values) for values in parts.values())
    for index in range(len(mutable)):
        oid = mutable[(index + offset) % len(mutable)]
        spec, values = specs[oid], list(parts[oid])
        room = min(MAX_PARTS - len(values), MAX_TOTAL_PARTS - total)
        if mode == 'balanced':
            count = len(values) + min(MAX_SEED_EXTRA_PARTS, room)
            if spec.discrete:
                count = min(count, int(spec.quantity))
                quotient, remainder = divmod(int(spec.quantity), count)
                changed = [float(quotient + (at < remainder)) for at in range(count)]
            else:
                changed = [spec.quantity / count] * count
                changed[-1] = spec.quantity - math.fsum(changed[:-1])
        else:
            if room < 1:
                continue
            eligible = [at for at, value in enumerate(values)
                        if value >= 2] if spec.discrete else [
                            at for at, value in enumerate(values)
                            if value > EPS * max(1, spec.quantity) * 4]
            if not eligible:
                continue
            at = max(eligible, key=lambda item: values[item])
            value = values[at]
            fraction = .5 if mode == 'half' else .25
            cut = max(1, math.floor(value * fraction)) if spec.discrete else value * fraction
            changed = values[:at] + [cut, value - cut] + values[at + 1:]
        proposal = dict(parts)
        proposal[oid] = tuple(changed)
        try:
            candidate = validate_genome(Genome(base.sequence,
                tuple((key, proposal[key]) for key in base.sequence)), specs, frozen)
        except JointContractError:
            continue
        if candidate != base:
            return candidate
    return None


def _diverse_population(preferred, parents, specs, rng, frozen, population,
                        seen, avoid=(), required=()):
    """Try new legal genes within a fixed retry budget; finite spaces repeat."""
    chosen, keys = [], set()
    avoided = {_diversity_key(genome) for genome in avoid}

    def add(genome, force=False):
        if len(chosen) >= population:
            return False
        key = _diversity_key(genome)
        if key in keys or not force and (key in seen or key in avoided):
            return False
        chosen.append(genome)
        keys.add(key)
        return True

    # A fresh worker must re-evaluate the exact continuation incumbent first.
    for genome in required:
        add(genome, force=True)
    for genome in preferred:
        add(genome)
    pool = list(dict.fromkeys(parents or preferred))
    _require(bool(pool), 'joint_search_seed_missing')
    budget = max(32, population * MAX_DIVERSITY_ATTEMPTS_PER_SLOT)
    for _ in range(budget):
        if len(chosen) >= population:
            break
        left, right = rng.choice(pool), rng.choice(pool)
        child = crossover(left, right, specs, rng, frozen)
        child = mutate(child, specs, rng, frozen)
        if rng.random() < .35:
            child = mutate(child, specs, rng, frozen)
        add(child)
    # Do not spin or change the requested budget when no new gene is found.
    # This is necessary for a one-piece order, fully frozen orders, or any
    # finite/exhausted neighbourhood. Existing native cache semantics apply.
    fallback = list(dict.fromkeys(pool + list(preferred) + chosen))
    cursor = 0
    while len(chosen) < population:
        chosen.append(fallback[cursor % len(fallback)])
        cursor += 1
    return chosen


'''

SEEDS_BEFORE = '''        if genome not in seeds:
            seeds.append(genome)
    return seeds
'''
SEEDS_AFTER = '''        if genome not in seeds:
            seeds.append(genome)
    baseline = seeds[0]
    for offset, mode in enumerate(('balanced', 'half', 'unequal')):
        candidate = _diversity_seed(baseline, specs, frozen, mode, offset)
        if candidate is not None and candidate not in seeds:
            seeds.append(candidate)
    return seeds
'''

STATE_BEFORE = '''             'peak_cache_entries': 0, 'peak_cache_rows': 0, 'peak_cache_bytes': 0,
             'evaluating': False}
'''
STATE_AFTER = '''             'peak_cache_entries': 0, 'peak_cache_rows': 0, 'peak_cache_bytes': 0,
             'search_diversity_version': SEARCH_DIVERSITY_VERSION,
             'decoder_evaluations': 0, 'unique_evaluations': 0, 'cache_reuses': 0,
             'unique_evaluations_complete': True, 'evaluating': False}
    evaluated_keys = set()
'''

INITIAL_BEFORE = '''        individuals = list(dict.fromkeys(seeds))[:population]
        while len(individuals) < population:
            individuals.append(mutate(rng.choice(seeds), specs, rng, frozen))
'''
INITIAL_AFTER = '''        individuals = _diverse_population(seeds, seeds, specs, rng, frozen,
            population, evaluated_keys, required=seeds[:1])
'''

CACHE_BEFORE = '''                    if genome in cache:
                        evaluated, _, _ = cache[genome]
                        cache.move_to_end(genome)
                    else:
                        runtime['active'] = genome
'''
CACHE_AFTER = '''                    if genome in cache:
                        state['cache_reuses'] += 1
                        evaluated, _, _ = cache[genome]
                        cache.move_to_end(genome)
                    else:
                        state['decoder_evaluations'] += 1
                        key = _diversity_key(genome)
                        if key not in evaluated_keys:
                            if len(evaluated_keys) < MAX_TRACKED_UNIQUE_EVALUATIONS:
                                evaluated_keys.add(key)
                                state['unique_evaluations'] += 1
                            else:
                                state['unique_evaluations_complete'] = False
                        runtime['active'] = genome
'''

NEXT_BEFORE = '''                parents = [genome for _, genome in ranked[:max(2, population // 3)]] or seeds
                next_generation = [best[1]] if best is not None else [seeds[0]]
                while len(next_generation) < population:
                    left, right = rng.choice(parents), rng.choice(parents)
                    child = crossover(left, right, specs, rng, frozen)
                    # Mutate both the order and partition dimensions over time.
                    child = mutate(child, specs, rng, frozen)
                    if rng.random() < .35:
                        child = mutate(child, specs, rng, frozen)
                    next_generation.append(child)
                individuals = next_generation
'''
NEXT_AFTER = '''                if _generation + 1 < generations:
                    parents = [genome for _, genome in ranked[:max(2, population // 3)]] or seeds
                    if best is not None:
                        # Keep the incumbent as a parent and in `best`, without
                        # spending another evaluation slot on the same score.
                        parents = list(dict.fromkeys([best[1]] + parents))
                    individuals = _diverse_population(seeds, parents, specs, rng, frozen,
                        population, evaluated_keys, avoid=list(cache) + individuals)
'''

REPORT_BEFORE = '''                'peak_cache_entries', 'peak_cache_rows', 'peak_cache_bytes')}
'''
REPORT_AFTER = '''                'peak_cache_entries', 'peak_cache_rows', 'peak_cache_bytes',
                'search_diversity_version', 'decoder_evaluations', 'unique_evaluations',
                'cache_reuses', 'unique_evaluations_complete')}
'''

REPLACEMENTS = (
    ('MAX_CACHE_BYTES = 32 * 1024 * 1024\n', 'MAX_CACHE_BYTES = 32 * 1024 * 1024\n' + CONSTANTS),
    ('def seed_genomes(specs, frozen=None):\n', HELPERS + 'def seed_genomes(specs, frozen=None):\n'),
    (SEEDS_BEFORE, SEEDS_AFTER),
    (STATE_BEFORE, STATE_AFTER),
    (INITIAL_BEFORE, INITIAL_AFTER),
    (CACHE_BEFORE, CACHE_AFTER),
    (NEXT_BEFORE, NEXT_AFTER),
    (REPORT_BEFORE, REPORT_AFTER),
)


def digest(source):
    return hashlib.sha256(source.encode('utf-8')).hexdigest()


def _forward(source):
    for before, after in REPLACEMENTS:
        if source.count(before) != 1 or after in source:
            raise ValueError('JOINT_DIVERSITY_ANCHOR_DRIFT')
        source = source.replace(before, after, 1)
    ast.parse(source)
    return source


def patch(source):
    if not isinstance(source, str):
        raise ValueError('JOINT_DIVERSITY_SOURCE_TYPE')
    if digest(source) == BASE_SHA256:
        return _forward(source)
    if VERSION in source:
        before = source
        for old, new in reversed(REPLACEMENTS):
            if before.count(new) != 1:
                raise ValueError('JOINT_DIVERSITY_PARTIAL_INSTALLATION')
            before = before.replace(new, old, 1)
        if digest(before) != BASE_SHA256 or _forward(before) != source:
            raise ValueError('JOINT_DIVERSITY_SOURCE_DRIFT')
        return source
    raise ValueError('JOINT_DIVERSITY_SOURCE_DRIFT')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: python3 patch.py INPUT_JOINT.py OUTPUT_JOINT.py')
    try:
        before = Path(sys.argv[1]).read_text(encoding='utf-8')
        after = patch(before)
        Path(sys.argv[2]).write_text(after, encoding='utf-8')
    except Exception:
        raise SystemExit('JOINT_SEARCH_DIVERSITY_PATCH_REJECTED') from None
    print('JOINT_SEARCH_DIVERSITY_PATCH_PASS', 'changed=' + str(before != after).lower(),
          'base_sha256=' + BASE_SHA256, 'candidate_sha256=' + digest(after))
