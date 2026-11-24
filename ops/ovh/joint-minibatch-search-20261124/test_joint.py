import copy
import importlib.util
import random
from pathlib import Path
import unittest

import joint_minibatch as joint


# Public synthetic adapter contract, not recovered/private runtime source.
EXPANSION = '''def _pp_expand_capacity_batches(model, order_ids, locked_operations=None):
    expanded = []
    byid = {str(row['id']): row for row in model['orders']}
    mappings = {}
    for oid in order_ids:
        src = byid[oid]
        cap = _pp_order_batch_capacity(model, src)
        remaining = src['quantity']
        sizes = []
        while remaining > 0:
            value = min(remaining, cap)
            sizes.append(value)
            remaining -= value
        for index, value in enumerate(sizes, 1):
            row = dict(src, id=oid + ':' + str(index), quantity=value,
                       _parent_order_id=oid, _batch_index=index,
                       _batch_count=len(sizes), _batch_quantity=value)
            expanded.append(row)
            mappings[row['id']] = {'order': oid, 'batch': index}
    result = dict(model, orders=expanded)
    return result, [row['id'] for row in expanded], list(locked_operations or []), mappings
'''


def model():
    return {'start': '2026-11-24T08:00:00', 'quantity_unit': 'шт.',
        'orders': [{'id': 'O', 'quantity': 30, 'unit': 'шт.'}],
        'equipment': [{'id': 'BIG', 'capacity': 10, 'capacity_unit': 'шт.'},
                      {'id': 'SMALL', 'capacity': 5, 'capacity_unit': 'шт.'}],
        'materials': []}


def namespace(m, invalid=False):
    ga = {'CURRENT_MODEL': copy.deepcopy(m), '_PP_GENERIC_STATE': {},
          'seen_genomes': [], 'scored': [], 'best_previews': [], 'steps': 0}
    ga['_pp_generic_declared'] = lambda model: True
    ga['_pp_generic_ready'] = lambda model: True
    ga['_pp_batch_order_unit'] = lambda order: order['unit']
    ga['_pp_batch_unit'] = lambda unit: unit
    # Reproduce the observed native predicate's missing numerical capacity test.
    ga['_pp_batch_equipment_fits'] = lambda order, eq: order['unit'] == eq['capacity_unit']
    def eligible(req, equipment):
        return list(equipment)
    ga['_pp_eligible_equipment'] = eligible
    ga['_pp_order_batch_capacity'] = lambda model, order: max(eq['capacity'] for eq in ga['_pp_eligible_equipment']({}, model['equipment']))
    exec(compile(EXPANSION, '<public-synthetic-expansion>', 'exec'), ga)

    def schedule_operation(ctx, order, op, earliest):
        rows = ga['_pp_eligible_equipment']({}, ctx['equipment'])
        if not rows:
            raise joint.InfeasibleCandidate('no_equipment')
        machine = min(rows, key=lambda row: (ctx['busy'][row['id']], row['id']))
        start = max(earliest, ctx['busy'][machine['id']])
        if ctx['model'].get('materials') and ctx['consumed'] + order['quantity'] > 15:
            start = max(15, start)
        ctx['consumed'] += order['quantity']
        ctx['busy'][machine['id']] = start + 10
        return start, start + 10, [], [machine['id']], []
    ga['_pp_schedule_operation'] = schedule_operation

    def schedule(candidate_model, order_ids):
        expanded, ids, locks, mapping = ga['_pp_expand_capacity_batches'](candidate_model, order_ids)
        ctx = {'model': candidate_model, 'equipment': candidate_model['equipment'],
               'busy': {row['id']: 0 for row in candidate_model['equipment']}, 'consumed': 0}
        operations, batches, vector = [], [], []
        for order in expanded['orders']:
            start, end, employees, equipment, _ = ga['_pp_schedule_operation'](ctx, order, {}, 0)
            oid, index, quantity = order['_parent_order_id'], order['_batch_index'], order['quantity']
            vector.append(quantity)
            uses = [{'id': 'M', 'quantity': quantity}] if candidate_model.get('materials') else []
            operations.append({'order': oid, 'batch': index, 'batch_quantity': quantity,
                'batch_count': order['_batch_count'], 'operation_id': 'WORK', 'equipment_ids': equipment,
                'employee_ids': employees, 'start_min': start, 'end_min': end, 'materials': uses})
            batches.append({'order': oid, 'batch': index, 'quantity': quantity,
                            'start_min': start, 'end_min': end})
        ga['seen_genomes'].append(tuple(vector))
        if invalid:
            operations[0]['equipment_ids'] = ['SMALL']
            operations[0]['batch_quantity'] = 999
        return {'operations': operations, 'batches': batches, 'duration_minutes': max(row['end_min'] for row in operations),
                'batch_count': len(batches), 'setup_operations': [], 'machine_idle_minutes': 0, 'operator_wait_minutes': 0,
                'ctx': ctx}
    ga['_pp_schedule_sequence'] = schedule
    ga['_pp_validate_generic'] = lambda model, sim: []
    def score(sim, objective):
        ga['scored'].append(tuple(row['quantity'] for row in sim['batches']))
        return (sim['duration_minutes'], sim['machine_idle_minutes'], sim['operator_wait_minutes'], len(sim['batches']))
    ga['_pp_obj_key'] = score
    def preview(model, sim, objective):
        result = copy.deepcopy(sim); result.pop('ctx', None)
        result.update(ok=True, valid=True, generic_operations=copy.deepcopy(result['operations']),
                      native_formatter_retained=True, objective=objective)
        return result
    ga['_pp_progress_preview'] = preview
    ga['_pp_progress_begin'] = lambda total, phase: ga.update(total=total, phase=phase)
    ga['_pp_progress_step'] = lambda: ga.update(steps=ga['steps'] + 1)
    ga['_pp_progress_best'] = lambda model, sim, objective: ga['best_previews'].append(copy.deepcopy(sim))
    ga['_pp_progress_candidate'] = lambda model, sim, objective: None
    ga['_pp_progress_finish'] = lambda success, error: ga.update(finished=success)
    ga['_pp_optimize_generic'] = lambda *args, **kwargs: None
    def outer(gens=8, pop=12, seed=1729, continue_run=False, objective='duration'):
        return ga['_pp_optimize_generic'](ga['CURRENT_MODEL'], gens, pop, seed, continue_run, objective)
    ga['optimize'] = outer
    return ga


def verify_constraints(model, sim, pins, ga):
    ga['constraint_checks'] = ga.get('constraint_checks', 0) + 1
    if ga.get('reject_constraint'):
        raise ValueError('synthetic_native_constraint_rejected')
    if model.get('materials'):
        early = sum(use['quantity'] for row in sim['operations'] if row['start_min'] < 15
                    for use in row.get('materials') or [])
        if early > 15:
            raise ValueError('synthetic_material_prefix_negative')
    return True


def install(ga, model, **options):
    return joint.install_joint_minibatch_search(ga, model, verify_constraints=verify_constraints, **options)


class JointTests(unittest.TestCase):
    def setUp(self):
        self.specs = {'O': joint.OrderSpec('O', 30, 10, True, (10, 5))}

    def test_split_merge_transfer_and_ordered_sizes_conserve_quantity(self):
        initial = joint.validate_genome(joint.Genome(('O',), (('O', (10, 10, 10)),)), self.specs)
        split = joint.mutate(initial, self.specs, random.Random(3), operation='split')
        self.assertEqual(len(split.mapping()['O']), 4)
        self.assertEqual(sum(split.mapping()['O']), 30)
        merged = joint.mutate(split, self.specs, random.Random(4), operation='merge')
        self.assertEqual(len(merged.mapping()['O']), 3)
        changed = joint.mutate(split, self.specs, random.Random(7), operation='transfer')
        self.assertEqual(len(changed.mapping()['O']), 4)
        self.assertEqual(sum(changed.mapping()['O']), 30)
        for seed in range(100):
            candidate = joint.mutate(split, self.specs, random.Random(seed))
            self.assertEqual(sum(candidate.mapping()['O']), 30)
            self.assertTrue(all(0 < value <= 10 and value.is_integer() for value in candidate.mapping()['O']))
        a = joint.validate_genome(joint.Genome(('O',), (('O', (10, 5, 10, 5)),)), self.specs)
        b = joint.validate_genome(joint.Genome(('O',), (('O', (5, 10, 5, 10)),)), self.specs)
        self.assertNotEqual(a, b)
        self.assertNotEqual(hash(a), hash(b))

    def test_native_expansion_mapping_and_count_retained_with_unequal_vector(self):
        m = model(); ga = namespace(m)
        native = ga['_pp_expand_capacity_batches']
        joint._install_expansion_hook(ga, lambda order, default: [10, 5, 10, 5], EXPANSION)
        expanded, ids, locks, byid = ga['_pp_expand_capacity_batches'](m, ['O'], [{'batch': 2}])
        self.assertEqual([row['quantity'] for row in expanded['orders']], [10, 5, 10, 5])
        self.assertEqual([row['_batch_count'] for row in expanded['orders']], [4] * 4)
        self.assertEqual([byid[sid]['batch'] for sid in ids], [1, 2, 3, 4])
        self.assertEqual(locks, [{'batch': 2}])
        self.assertEqual([row['quantity'] for row in native(m, ['O'])[0]['orders']], [10, 10, 10])
        self.assertEqual(m, model())

    def test_capacity_predicate_and_context_cleanup(self):
        m = model(); ga = namespace(m)
        schedule, eligible = joint._install_capacity_eligibility(ga)
        self.assertEqual(len(ga['_pp_eligible_equipment']({}, m['equipment'])), 2)
        ctx = {'model': m, 'equipment': m['equipment'], 'busy': {'BIG': 20, 'SMALL': 0}, 'consumed': 0}
        result = ga['_pp_schedule_operation'](ctx, {'quantity': 10, 'unit': 'шт.'}, {}, 0)
        self.assertEqual(result[3], ['BIG'])
        self.assertEqual(len(ga['_pp_eligible_equipment']({}, m['equipment'])), 2)
        with self.assertRaises(joint.InfeasibleCandidate):
            ga['_pp_schedule_operation'](ctx, {'quantity': 20, 'unit': 'шт.'}, {}, 0)
        self.assertEqual(len(ga['_pp_eligible_equipment']({}, m['equipment'])), 2)

    def test_unspecified_capacity_preserves_native_compatibility(self):
        m = model(); ga = namespace(m)
        order = {'quantity': 100, 'unit': 'шт.'}
        for machine in ({'id': 'UNBOUNDED', 'capacity_unit': 'шт.'},
                        {'id': 'UNBOUNDED', 'capacity_unit': 'шт.', 'capacity': 0}):
            self.assertTrue(joint._capacity_fits(ga, order, machine))
        self.assertFalse(joint._capacity_fits(ga, order, m['equipment'][0]))

    def test_real_joint_vectors_reach_mixed_witness_and_preserve_outer_formatter(self):
        m = model(); before = copy.deepcopy(m); ga = namespace(m); outer = ga['optimize']
        install(ga, m, source=EXPANSION)
        result = ga['optimize']()
        self.assertIs(ga['optimize'], outer)
        self.assertEqual(result['duration_minutes'], 20)
        self.assertTrue(result['native_formatter_retained'])
        self.assertGreater(len(set(ga['seen_genomes'])), 3)
        self.assertGreater(len({len(values) for values in ga['seen_genomes']}), 1)
        self.assertGreater(len(set(row['quantity'] for row in result['batches'])), 1)
        self.assertEqual(m, before)
        self.assertTrue(ga['finished'])
        self.assertEqual(ga['steps'], 8 * 12)
        for sim in ga['best_previews']:
            for row in sim['operations']:
                capacity = 10 if row['equipment_ids'] == ['BIG'] else 5
                self.assertLessEqual(row['batch_quantity'], capacity)

    def test_explicit_piece_unit_overrides_unrecognized_native_alias(self):
        m = model(); ga = namespace(m)
        ga['_pp_batch_order_unit'] = lambda order: 'internal_amount_alias'
        ga['_pp_batch_unit'] = lambda value: 'internal_amount_alias'
        install(ga, m, source=EXPANSION)
        result = ga['optimize'](12, 16)
        self.assertEqual(result['duration_minutes'], 20)
        self.assertTrue(all(float(quantity).is_integer() for vector in ga['seen_genomes'] for quantity in vector))
        self.assertTrue(all(float(row['batch_quantity']).is_integer()
                            for sim in ga['best_previews'] for row in sim['operations']))

    def test_adapter_formatter_and_registered_candidate_callbacks_are_after_verification(self):
        m = model(); ga = namespace(m)
        native_formatter = ga['_pp_progress_preview']
        formatted, exported, verification_flags = [], [], []
        def broken_native_preview(*args):
            raise AttributeError('synthetic recovered preview missing attribute')
        ga['_pp_progress_preview'] = broken_native_preview
        def verify(model, sim, pins, namespace):
            verification_flags.append(namespace[joint.STATE_KEY]['evaluating'])
            return verify_constraints(model, sim, pins, namespace)
        def candidate(model, sim, objective):
            self.assertFalse(ga[joint.STATE_KEY]['evaluating'])
            plan = dict(sim, valid=True)
            value = ga[joint.STATE_KEY]['export_incumbent'](plan)
            self.assertIsNotNone(value)
            exported.append(value)
        def formatter(sim):
            self.assertFalse(ga[joint.STATE_KEY]['evaluating'])
            formatted.append(True)
            return native_formatter(m, sim, 'duration')
        ga['_pp_progress_candidate'] = candidate
        joint.install_joint_minibatch_search(ga, m, source=EXPANSION,
            verify_constraints=verify, format_result=formatter)
        result = ga['optimize'](3, 8)
        self.assertTrue(formatted)
        self.assertTrue(exported)
        self.assertTrue(all(verification_flags))
        self.assertTrue(result['native_formatter_retained'])

    def test_invalid_candidate_never_reaches_fitness_or_best(self):
        m = model(); ga = namespace(m, invalid=True)
        install(ga, m, source=EXPANSION)
        with self.assertRaisesRegex(joint.JointContractError, 'joint_no_feasible_solution'):
            ga['optimize'](2, 6)
        self.assertEqual(ga['scored'], [])
        self.assertEqual(ga['best_previews'], [])
        self.assertFalse(ga['finished'])

    def test_full_native_constraint_gate_runs_before_objective(self):
        m = model(); ga = namespace(m); ga['reject_constraint'] = True
        install(ga, m, source=EXPANSION)
        with self.assertRaisesRegex(joint.JointContractError, 'joint_no_feasible_solution'):
            ga['optimize'](2, 6)
        self.assertGreater(ga['constraint_checks'], 0)
        self.assertEqual(ga['scored'], [])
        self.assertEqual(ga['best_previews'], [])

    def test_exact_unpinned_staff_shift_repair_is_reverified_before_fitness(self):
        class PinConstraintError(ValueError):
            pass
        m = model(); ga = namespace(m)
        checked, repaired, scored = [], [], []
        def verify(model, sim, pins, namespace):
            self.assertTrue(namespace[joint.STATE_KEY]['evaluating'])
            checked.append(bool(sim.get('synthetic_shift_repaired')))
            if not sim.get('synthetic_shift_repaired'):
                raise PinConstraintError('schedule_staff_shift_invalid')
            self.assertTrue(all(row['start_min'] >= 100 for row in sim['operations']))
            return verify_constraints(model, sim, pins, namespace)
        def repair(sim):
            self.assertTrue(ga[joint.STATE_KEY]['evaluating'])
            repaired.append(True)
            for row in sim['operations'] + sim['batches']:
                row['start_min'] += 100
                row['end_min'] += 100
            sim['duration_minutes'] += 100
            sim['synthetic_shift_repaired'] = True
            return sim
        original_score = ga['_pp_obj_key']
        def score(sim, objective):
            self.assertTrue(sim['synthetic_shift_repaired'])
            self.assertEqual(checked[-2:], [False, True])
            scored.append(True)
            return original_score(sim, objective)
        ga['_pp_obj_key'] = score
        joint.install_joint_minibatch_search(ga, m, source=EXPANSION,
            verify_constraints=verify, repair_candidate=repair)
        result = ga['optimize'](3, 8)
        self.assertTrue(repaired)
        self.assertEqual(len(repaired), len(scored))
        self.assertEqual(result['duration_minutes'], 120)
        self.assertTrue(all(plan['synthetic_shift_repaired'] for plan in ga['best_previews']))
        self.assertIsNotNone(ga[joint.STATE_KEY]['export_incumbent'](result))

    def test_shift_repair_never_bypasses_pins_other_errors_or_second_validation(self):
        class PinConstraintError(ValueError):
            pass
        for mode in ('pins', 'other_error', 'wrong_error_type', 'missing_result', 'changed_genes', 'still_invalid'):
            with self.subTest(mode=mode):
                m = model(); ga = namespace(m); repaired = []
                pins = [{'order': 'O', 'batch': 1, 'batch_quantity': 10}] if mode == 'pins' else []
                def verify(model, sim, pins, namespace):
                    error_type = ValueError if mode == 'wrong_error_type' else PinConstraintError
                    message = 'schedule_resource_overlap' if mode == 'other_error' else 'schedule_staff_shift_invalid'
                    raise error_type(message)
                def repair(sim):
                    repaired.append(True)
                    if mode == 'missing_result':
                        return None
                    if mode == 'changed_genes':
                        sim['batches'][0]['quantity'] += 1
                    return sim
                joint.install_joint_minibatch_search(ga, m, pins=pins, source=EXPANSION,
                    verify_constraints=verify, repair_candidate=repair)
                with self.assertRaisesRegex(joint.JointContractError, 'joint_no_feasible_solution'):
                    ga['optimize'](1, 2)
                self.assertEqual(bool(repaired), mode in ('missing_result', 'changed_genes', 'still_invalid'))
                self.assertEqual(ga['scored'], [])
                self.assertEqual(ga['best_previews'], [])

    def test_material_prefix_checked_before_scoring(self):
        m = model(); m['materials'] = [{'id': 'M', 'initial_stock': 15,
            'deliveries': [{'at': '2026-11-24T08:15:00', 'quantity': 15}]}]
        ga = namespace(m)
        install(ga, m, source=EXPANSION)
        result = ga['optimize']()
        self.assertEqual(result['duration_minutes'], 25)
        bad = copy.deepcopy(result)
        for row in bad['operations']:
            row['start_min'] = 0
        genome = joint._batch_signature(bad, ('O',))
        with self.assertRaisesRegex(joint.InfeasibleCandidate, 'joint_native_contract'):
            joint.evaluate_feasibility(ga, m, genome, bad, verify_constraints=verify_constraints)

    def test_fresh_namespace_resume_freezes_actual_five_unit_pin_and_invalid_load_is_atomic(self):
        m = model(); first = namespace(m)
        install(first, m, source=EXPANSION)
        result = first['optimize']()
        resume = first[joint.STATE_KEY]['export_incumbent'](result)
        self.assertIsNotNone(resume)
        sizes = resume['partitions'][0]['sizes']; index = sizes.index(5) + 1
        pin = {'order': 'O', 'batch': index, 'batch_quantity': 5}
        fresh = namespace(m)
        install(fresh, m, pins=[pin], source=EXPANSION)
        fresh[joint.STATE_KEY]['load_incumbent'](resume)
        # The adapter decodes an initial preview before optimize. It must use
        # the restored ordered partition already, without trusting its fitness.
        first_decode = fresh['_pp_schedule_sequence'](copy.deepcopy(m), ['O'])
        self.assertEqual([row['quantity'] for row in first_decode['batches']], sizes)
        self.assertEqual(fresh['scored'], [])
        self.assertIsNone(fresh[joint.STATE_KEY]['export_incumbent'](
            dict(first_decode, valid=True, order_sequence=['O'])))
        invalid = copy.deepcopy(resume); invalid['partitions'][0]['sizes'] = [10, 10, 10]
        with self.assertRaisesRegex(joint.JointContractError, 'joint_pin_quantity_changed'):
            fresh[joint.STATE_KEY]['load_incumbent'](invalid)
        continued = fresh['optimize'](3, 8, 1730, True)
        self.assertEqual([row['quantity'] for row in continued['batches']], sizes)
        self.assertEqual(fresh[joint.STATE_KEY]['export_incumbent'](continued), resume)
        other = copy.deepcopy(continued); other['batches'][0]['quantity'] += 1
        self.assertIsNone(fresh[joint.STATE_KEY]['export_incumbent'](other))
        resume['partitions'][0]['sizes'][0] = 999
        self.assertNotEqual(fresh[joint.STATE_KEY]['export_incumbent'](continued), resume)

    def test_pins_without_actual_partition_fail_instead_of_remapping_quantity(self):
        m = model(); ga = namespace(m)
        install(ga, m,
            pins=[{'order': 'O', 'batch': 2, 'batch_quantity': 5}], source=EXPANSION)
        with self.assertRaisesRegex(joint.JointContractError, 'joint_pin_quantity_changed'):
            ga['optimize'](1, 2)

    def test_legacy_pin_without_batch_only_accepts_unique_partition(self):
        single = joint.Genome(('O',), (('O', (5,)),))
        joint._pins_accept(single, [{'order': 'O', 'batch_quantity': 5}])
        with self.assertRaisesRegex(joint.JointContractError, 'joint_pin_batch_identity_required'):
            joint._pins_accept(joint.Genome(('O',), (('O', (5, 5)),)), [{'order': 'O'}])

    def test_legacy_multibatch_pin_without_volume_or_v2_is_explicitly_rejected(self):
        m = model(); ga = namespace(m)
        install(ga, m, pins=[{'order': 'O', 'batch': 2}], source=EXPANSION)
        with self.assertRaisesRegex(joint.JointContractError, 'joint_pin_partition_unavailable'):
            ga['optimize'](1, 2)

    def test_v1_continuation_seed_and_generation_counters_are_preserved(self):
        m = model(); m['orders'].append({'id': 'P', 'quantity': 5, 'unit': 'шт.'})
        ga = namespace(m)
        ga['_PP_GENERIC_STATE'].update(best_order=['P', 'O'], run=7, total_trials=1060, best_duration=999)
        observed_orders = []
        original = ga['_pp_schedule_sequence']
        def observed(candidate_model, order_ids):
            observed_orders.append(tuple(order_ids))
            return original(candidate_model, order_ids)
        ga['_pp_schedule_sequence'] = observed
        install(ga, m, source=EXPANSION)
        result = ga['optimize'](3, 6, 42, True)
        self.assertEqual(observed_orders[0], ('P', 'O'))
        self.assertEqual(result['total_generations'], 1063)
        self.assertEqual(result['optimization_run'], 8)
        self.assertEqual(result['generations'], 3)
        self.assertEqual(result['population'], 6)
        self.assertEqual(result['seed'], 42)
        self.assertTrue(result['continued'])
        self.assertEqual(len(result['history_best']), 3)
        self.assertEqual(result['joint_minibatch']['evaluated'], 18)

    def test_cache_cost_accounts_for_nested_context_and_oversized_plans(self):
        sim = {'operations': [{} for _ in range(joint.MAX_CACHE_ROWS + 1)],
               'ctx': {'model': {'description': 'x' * 100000}}}
        rows, size = joint._cache_cost(sim)
        self.assertGreater(rows, joint.MAX_CACHE_ROWS)
        self.assertGreater(size, 100000)

    def test_legacy_and_not_ready_routing_leave_namespace_untouched(self):
        for key in ('_pp_generic_declared', '_pp_generic_ready'):
            m = model(); ga = namespace(m); ga[key] = lambda model: False
            before = dict(ga)
            self.assertFalse(install(ga, m, source='invalid source must not be read'))
            self.assertEqual(set(ga), set(before))
            self.assertTrue(all(ga[name] is value for name, value in before.items()))

    def test_expansion_source_drift_is_atomic(self):
        m = model(); ga = namespace(m); original = ga['_pp_expand_capacity_batches']
        with self.assertRaisesRegex(joint.JointContractError, 'joint_expansion_enumeration_drift'):
            joint._install_expansion_hook(ga, lambda order, default: default, EXPANSION.replace('enumerate(sizes, 1)', 'enumerate(tuple(sizes), 1)'))
        self.assertIs(ga['_pp_expand_capacity_batches'], original)
        self.assertNotIn('_pp_joint_selected_sizes', ga)

    def test_adapter_patch_guard_reversal_and_idempotence(self):
        path = Path(__file__).with_name('patch.py')
        spec = importlib.util.spec_from_file_location('joint_patch', path)
        patcher = importlib.util.module_from_spec(spec); spec.loader.exec_module(patcher)
        source = "from pathlib import Path\nSOURCE = Path('/tmp/production_planner.py')\ndef _pp_shift_safe_checkpoint(sim,model,ga):\n    return sim\ndef _live_scheduler_preview(sim,model,objective,ga,pins,checkpoint=False):\n    return sim\ndef run(payload,progress):\n    opts={}\n    objective=opts.get('objective') or 'duration'\n    if pins:\n        try: pins=make_constrained_scheduler(ga,pins,normalized)\n        except Exception: raise\n"
        output = patcher.patch(source)
        self.assertEqual(patcher.patch(output), output)
        self.assertEqual(output.replace(patcher.IMPORT + '\n', '').replace(patcher.CALL, ''), source)
        with self.assertRaisesRegex(ValueError, 'ANCHOR_DRIFT'):
            patcher.patch(source.replace("objective=opts.get('objective') or 'duration'", 'objective="duration"'))
        with self.assertRaisesRegex(ValueError, 'ANCHOR_DRIFT'):
            patcher.patch(source.replace('def _pp_shift_safe_checkpoint(', 'def missing_shift_retimer('))


if __name__ == '__main__':
    unittest.main()
