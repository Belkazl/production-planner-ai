import json
import unittest

from native_batch_semantics import summarize_native_batch_semantics


class NativeBatchSemanticTests(unittest.TestCase):
    def test_sequence_shuffle_swap_and_decoder_arguments(self):
        source = '''
def _pp_optimize_generic(model, gens, pop, seed, continue_run):
    ids = list(model)
    seq = ids[:]
    rng.shuffle(seq)
    seq[i], seq[j] = seq[j], seq[i]
    child = seq[:cut] + seq[cut:]
    return _pp_schedule_sequence(model, child)
'''
        result = summarize_native_batch_semantics(source, 'PP_GENERIC_CORE_B64')
        row = result['functions'][0]
        self.assertIn('random_shuffle', row['mutation_kinds'])
        self.assertIn('subscript_swap_same_container', row['mutation_kinds'])
        self.assertIn('slice_or_container_concatenation', row['mutation_kinds'])
        self.assertEqual(row['decoder_calls'][0]['args'], [{'kind': 'name', 'name': 'model'}, {'kind': 'name', 'name': 'child'}])
        self.assertEqual(row['technical_key_writes'], [])
        self.assertFalse(row['absence_of_batch_search_proven'])

    def test_known_batch_reads_writes_and_genome_construction(self):
        source = '''
def _pp_expand_capacity_batches(model, order_ids, locked_operations):
    sizes = order.get('batch_sizes')
    cap = order['capacity']
    order['batch_quantity'] = size
    gene = {'batch_sizes': sizes, 'order_sequence': order_ids, 'private_batch_secret': 'never-output'}
    order.update(batch_count=count)
    return external_decode(model, gene)
'''
        row = summarize_native_batch_semantics(source, 'PP_CAPACITY_BATCHING_PATCH_CODE')['functions'][0]
        self.assertEqual(row['technical_key_reads'], ['batch_sizes', 'capacity'])
        self.assertEqual(row['technical_key_writes'], ['batch_count', 'batch_quantity'])
        self.assertIn('batch_sizes', row['constructed_technical_keys'])
        self.assertIn('external_decode', row['other_calls_requiring_review'])
        encoded = json.dumps(row)
        self.assertNotIn('private_batch_secret', encoded)
        self.assertNotIn('never-output', encoded)

    def test_literals_defaults_and_errors_never_exported(self):
        source = '''
def _pp_optimize_generic(model, gens='private-default-token'):
    password = 'private-value-token'
    n = 987654321
    seq = model.get('not_allowlisted_private_key')
    _pp_schedule_sequence(model, seq, message='private-runtime-token')
'''
        result = summarize_native_batch_semantics(source, 'fixed-origin')
        encoded = json.dumps(result)
        for value in ('private-default-token', 'private-value-token', '987654321', 'not_allowlisted_private_key', 'private-runtime-token'):
            self.assertNotIn(value, encoded)
        self.assertTrue(result['functions'][0]['definition_time_expressions_omitted'])
        broken = summarize_native_batch_semantics("def _pp_optimize_generic(: private-token", 'fixed-origin')
        self.assertEqual(broken['status'], 'unparseable_source')
        self.assertNotIn('private-token', json.dumps(broken))

    def test_nested_local_helpers_and_dynamic_calls_remain_unresolved(self):
        source = '''
def _pp_optimize_generic(model):
    def score(seq):
        return _pp_schedule_sequence(model, seq)
    action = globals()['private-strategy']
    action(model)
    getattr(engine, 'private-method')(model)
    eval('private-source')
    return score(ids)
'''
        row = summarize_native_batch_semantics(source, 'fixed-origin')['functions'][0]
        self.assertEqual(row['local_functions'], ['score'])
        self.assertEqual(row['decoder_calls'][0]['scope'], '_pp_optimize_generic.score')
        self.assertGreaterEqual(row['dynamic_call_count'], 4)
        self.assertIn('action', row['other_calls_requiring_review'])
        self.assertFalse(row['absence_of_batch_search_proven'])
        self.assertNotIn('private-strategy', json.dumps(row))

    def test_only_exact_targets_and_bounded_output(self):
        source = 'def secret_other():\n    return 1\n'
        self.assertEqual(summarize_native_batch_semantics(source, 'fixed-origin')['functions'], [])
        huge = 'def _pp_optimize_generic(model):\n' + ''.join('    variable_%d = helper_%d(model)\n' % (i, i) for i in range(200))
        row = summarize_native_batch_semantics(huge, 'fixed-origin')['functions'][0]
        self.assertEqual(row['call_count'], 200)
        self.assertLessEqual(len(row['calls']), 96)
        self.assertTrue(row['calls_truncated'])
        self.assertLessEqual(len(row['assignments']), 64)
        self.assertTrue(row['assignments_truncated'])
        self.assertLessEqual(len(row['call_names']), 128)
        self.assertTrue(row['call_names_truncated'])

    def test_serialized_metadata_has_total_byte_limit(self):
        fragment = 'def _pp_optimize_generic(model):\n' + ''.join(
            "    candidate_%d = external_helper_%d(model['batch_sizes'], model['batch_quantity'], argument_%d, other_%d)\n" % (i, i, i, i)
            for i in range(180))
        result = summarize_native_batch_semantics(fragment * 8, 'PP_GENERIC_CORE_B64')
        self.assertTrue(result['output_truncated'])
        self.assertLessEqual(len(json.dumps(result, ensure_ascii=True, separators=(',', ':')).encode()), 32768)


if __name__ == '__main__':
    unittest.main()
