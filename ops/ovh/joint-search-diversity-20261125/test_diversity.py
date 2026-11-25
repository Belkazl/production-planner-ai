import ast
import copy
import importlib.util
import os
from pathlib import Path
import random
import sys
import types
import unittest
from unittest.mock import patch as mock_patch


HERE = Path(__file__).resolve().parent
PREVIOUS = HERE.parent / 'joint-minibatch-search-20261124'


def load_file(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


patcher = load_file('joint_diversity_patch', HERE / 'patch.py')
BEFORE = (PREVIOUS / 'joint_minibatch.py').read_text()
AFTER = patcher.patch(BEFORE)
joint = types.ModuleType('joint_minibatch')
joint.__file__ = str(PREVIOUS / 'joint_minibatch.py')
previous_binding = sys.modules.get('joint_minibatch')
sys.modules['joint_minibatch'] = joint
exec(compile(AFTER, '<public-patched-joint-minibatch>', 'exec'), joint.__dict__)
legacy = load_file('joint_diversity_existing_tests', PREVIOUS / 'test_joint.py')
if previous_binding is not None:
    sys.modules['joint_minibatch'] = previous_binding


def homogeneous_model(order_count=6, quantity=12, capacity=6):
    model = legacy.model()
    model['orders'] = [{'id': 'SYNTHETIC_' + str(i), 'quantity': quantity, 'unit': 'шт.'}
                       for i in range(order_count)]
    for machine in model['equipment']:
        machine['capacity'] = capacity
    return model


def installed(model, pins=None):
    ga = legacy.namespace(model)
    original = ga['_pp_schedule_sequence']
    observed = []

    def scheduler(candidate_model, order_ids):
        result = original(candidate_model, order_ids)
        observed.append(joint._batch_signature(result, tuple(order_ids)))
        return result

    ga['_pp_schedule_sequence'] = scheduler
    joint.install_joint_minibatch_search(ga, model, source=legacy.EXPANSION,
        pins=pins, verify_constraints=legacy.verify_constraints)
    return ga, observed


class DiversityTests(unittest.TestCase):
    def test_exact_base_guard_idempotence_and_unchanged_native_functions(self):
        self.assertEqual(patcher.digest(BEFORE), patcher.BASE_SHA256)
        self.assertEqual(patcher.patch(AFTER), AFTER)
        for changed in (BEFORE + '\n', AFTER + '\n', AFTER.replace('MAX_SEED_EXTRA_PARTS = 2', 'MAX_SEED_EXTRA_PARTS = 3')):
            with self.assertRaises(ValueError):
                patcher.patch(changed)
        before = {node.name: ast.dump(node, include_attributes=False)
                  for node in ast.parse(BEFORE).body if isinstance(node, ast.FunctionDef)}
        after = {node.name: ast.dump(node, include_attributes=False)
                 for node in ast.parse(AFTER).body if isinstance(node, ast.FunctionDef)}
        protected = ('validate_genome', '_greedy', 'mutate', 'crossover',
            '_install_expansion_hook', '_capacity_fits', '_install_capacity_eligibility',
            '_batch_signature', 'evaluate_feasibility', '_model_specs', '_pins_accept', '_score', '_cache_cost')
        for name in protected:
            self.assertEqual(after[name], before[name], name)

    def test_homogeneous_seeds_are_distinct_bounded_and_conservative(self):
        specs = {str(i): joint.OrderSpec(str(i), 12, 6, True, (6,)) for i in range(6)}
        seeds = joint.seed_genomes(specs)
        self.assertEqual(len(seeds), 4)
        self.assertEqual(len(set(seeds)), len(seeds))
        baseline = seeds[0]
        self.assertTrue(all(values == (6, 6) for _, values in baseline.partitions))
        counts = {sum(map(len, seed.mapping().values())) for seed in seeds}
        self.assertEqual(counts, {12, 13, 14})
        for seed in seeds:
            self.assertEqual(joint.validate_genome(seed, specs), seed)
            changed = [oid for oid in specs if seed.mapping()[oid] != baseline.mapping()[oid]]
            self.assertLessEqual(len(changed), 1)
            self.assertLessEqual(sum(map(len, seed.mapping().values())), 14)

    def test_continuous_seeds_and_frozen_partitions_keep_quantity_and_bounds(self):
        specs = {str(i): joint.OrderSpec(str(i), 2400, 200, False, (200,)) for i in range(4)}
        frozen = {'0': (150, 50) + (200,) * 11}
        seeds = joint.seed_genomes(specs, frozen)
        baseline_count = sum(map(len, seeds[0].mapping().values()))
        self.assertGreater(len(seeds), 1)
        for seed in seeds:
            self.assertEqual(joint.validate_genome(seed, specs, frozen), seed)
            self.assertEqual(seed.mapping()['0'], frozen['0'])
            self.assertLessEqual(sum(map(len, seed.mapping().values())), baseline_count + 2)
            for oid, values in seed.partitions:
                self.assertAlmostEqual(sum(values), 2400)
                self.assertTrue(all(0 < value <= 200 for value in values))

    def test_part_and_total_bounds_are_not_relaxed_for_seed_diversity(self):
        specs = {str(i): joint.OrderSpec(str(i), 128, 1, True, (1,)) for i in range(8)}
        seeds = joint.seed_genomes(specs)
        self.assertEqual(len(seeds), 1)
        self.assertEqual(sum(map(len, seeds[0].mapping().values())), joint.MAX_TOTAL_PARTS)
        self.assertTrue(all(len(values) == joint.MAX_PARTS for _, values in seeds[0].partitions))

    def test_quick_evaluates_eighteen_distinct_native_inputs_and_keeps_baseline(self):
        model = homogeneous_model()
        before = copy.deepcopy(model)
        ga, observed = installed(model)
        result = ga['optimize'](3, 6, 1729)
        self.assertEqual(len(observed), 18)
        self.assertEqual(len(set(observed)), 18)
        self.assertEqual((result['generations'], result['population'], ga['steps']), (3, 6, 18))
        self.assertEqual(result['duration_minutes'], 60)
        self.assertEqual(result['batch_count'], 12)
        self.assertTrue(all(row['quantity'] == 6 for row in result['batches']))
        self.assertEqual(model, before)
        report = result['joint_minibatch']
        self.assertEqual((report['evaluated'], report['decoder_evaluations'], report['unique_evaluations'],
                          report['cache_reuses']), (18, 18, 18, 0))
        self.assertTrue(report['unique_evaluations_complete'])
        self.assertEqual(report['search_diversity_version'], patcher.VERSION)

    def test_continue_scores_exact_incumbent_first_and_preserves_pin_partition(self):
        model = homogeneous_model()
        oid = model['orders'][0]['id']
        pin = {'order': oid, 'batch': 1, 'batch_quantity': 3}
        ga, observed = installed(model, [pin])
        sequence = tuple(str(row['id']) for row in model['orders'])
        mapping = {key: ((3, 3, 6) if key == oid else (6, 6)) for key in sequence}
        incumbent = joint.Genome(sequence[::-1], tuple((key, mapping[key]) for key in sequence[::-1]))
        ga[joint.STATE_KEY]['load_incumbent'](incumbent.json())
        result = ga['optimize'](3, 6, 41, True)
        self.assertEqual(observed[0], incumbent)
        self.assertTrue(all(candidate.mapping()[oid] == (3, 3, 6) for candidate in observed))
        self.assertEqual(len(set(observed)), 18)
        self.assertTrue(result['continued'])
        self.assertLessEqual(result['duration_minutes'], 70)

    def test_finite_space_fallback_is_bounded_and_keeps_quick_budget(self):
        model = homogeneous_model(order_count=1, quantity=1, capacity=1)
        ga, observed = installed(model)
        with mock_patch.object(joint, 'mutate', wraps=joint.mutate) as mutations:
            result = ga['optimize'](3, 6, 19)
        self.assertLessEqual(mutations.call_count, 3 * 6 * joint.MAX_DIVERSITY_ATTEMPTS_PER_SLOT * 2)
        self.assertEqual(len(observed), 1)
        report = result['joint_minibatch']
        self.assertEqual((report['evaluated'], report['decoder_evaluations'], report['unique_evaluations'],
                          report['cache_reuses']), (18, 1, 1, 17))
        self.assertTrue(report['unique_evaluations_complete'])
        self.assertEqual((result['generations'], result['population']), (3, 6))

    def test_unique_tracking_bound_is_explicit_without_changing_decoder_budget(self):
        ga, observed = installed(homogeneous_model())
        with mock_patch.object(joint, 'MAX_TRACKED_UNIQUE_EVALUATIONS', 4):
            result = ga['optimize'](3, 6, 1729)
        report = result['joint_minibatch']
        self.assertEqual(len(set(observed)), 18)
        self.assertEqual(report['decoder_evaluations'], 18)
        self.assertEqual(report['unique_evaluations'], 4)
        self.assertFalse(report['unique_evaluations_complete'])

    @unittest.skipUnless(os.environ.get('LIFTORBIT_JOINT_DIVERSITY_FIXTURE'), 'optional staged actual-source module')
    def test_staged_actual_source_is_exact_patched_candidate(self):
        source = Path(os.environ['LIFTORBIT_JOINT_DIVERSITY_FIXTURE']).read_text()
        self.assertEqual(patcher.patch(source), source)
        self.assertEqual(patcher.digest(source), patcher.digest(AFTER))


def load_tests(loader, tests, pattern):
    # Run every existing public joint test against the patched module, retaining
    # its original assertions and its native/constraint fixture contracts.
    tests.addTests(loader.loadTestsFromModule(legacy))
    return tests


if __name__ == '__main__':
    unittest.main()
