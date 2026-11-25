import copy
from datetime import datetime
import importlib.util
from pathlib import Path
import sys
import types
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('gap_patch', HERE / 'patch.py')
patcher = importlib.util.module_from_spec(spec); spec.loader.exec_module(patcher)
joint = types.ModuleType('gap_candidate')
sys.modules[joint.__name__] = joint
exec(compile(patcher.patch(patcher.baseline()), '<public-gap-module>', 'exec'), joint.__dict__)

def fixture():
    origin = datetime.fromisoformat('2026-11-25T00:00:00')
    windows = {e: [(480, 720), (780, 1020)] for e in ['EA', 'EB']}
    model = {'start': origin.isoformat(), 'orders': [{'id': 'T', 'unit': 'pcs'}],
        'employees': [{'id': e, 'shift': 'day'} for e in ['EA', 'EB']],
        'shifts': {'day': [['08:00','12:00'],['13:00','17:00']]},
        'equipment': [{'id': m, 'capacity_unit': 'pcs', 'timing_profile':
                      {'timing_mode': 'throughput','throughput_per_hour': 60}} for m in ['A', 'B']]}
    def row(order, m, e, a, b, batch=1):
        return {'order': order, 'batch': batch, 'start_min': a, 'end_min': b,
                'equipment_ids': [m], 'employee_ids': [e]}
    rows = [row('PA','A','EA',480,510), row('PB','B','EB',480,685),
            row('T','A','EA',510,710), row('T','B','EB',780,980)]
    ga = {'_pp_in_window': lambda w,e,s,d: any(s>=a and s+d<=b+1e-8 for a,b in w[e]),
          '_pp_batch_order_unit': lambda order: order['unit'], '_pp_batch_unit': lambda u:u}
    genome = joint.Genome(('T',), (('T', (200.0,)),))
    specs = {'T': joint.OrderSpec('T',200,200,True,(200,))}
    sim = {'operations':rows,'setup_operations':[],'ctx':{'start':origin,'emp_windows':windows}}
    return ga, model, specs, genome, sim

class GapTests(unittest.TestCase):
    def test_downstream_35_minute_window_requires_upstream_smaller_batch(self):
        args = fixture()
        direct = joint._shift_seed_candidates(*args)
        self.assertTrue(direct)
        self.assertEqual(direct[0].mapping()['T'][0], 10)
        before = copy.deepcopy(args[1:])
        proposed = joint._gap_chain_candidates(*args)
        self.assertTrue(proposed)
        self.assertEqual(proposed[0].mapping()['T'], (35, 165))
        self.assertEqual(args[1:], before)

    def test_late_gap_after_64_earlier_rows(self):
        args = fixture()
        for i in range(80):
            args[4]['operations'].append({'order': 'unrelated'+str(i), 'batch':1,
                'start_min': i, 'end_min': i+1, 'equipment_ids':['other'], 'employee_ids':[]})
        proposed = joint._gap_chain_candidates(*args)
        self.assertTrue(proposed)
        self.assertEqual(proposed[0].mapping()['T'], (35,165))

    def test_frozen_partition_and_seen_genes_are_respected(self):
        args = fixture()
        self.assertFalse(joint._gap_chain_candidates(*args, frozen={'T': (200,)}))
        prior = joint._gap_chain_candidates(*args)
        self.assertTrue(prior)
        seen = {joint._diversity_key(g) for g in prior}
        self.assertFalse(any(joint._diversity_key(g) in seen for g in joint._gap_chain_candidates(*args, seen=seen)))

    def test_material_and_setup_reservations_remain_native(self):
        args = fixture()
        args[4]['setup_operations'].append({'is_setup':True, 'start_min':685, 'end_min':700,
            'equipment_ids':['B'], 'employee_ids':['EB']})
        proposed = joint._gap_chain_candidates(*args)
        self.assertTrue(proposed)
        self.assertEqual(proposed[0].mapping()['T'], (20,180))

    def test_patch_is_bound_to_prior_worker(self):
        with self.assertRaises(ValueError):
            patcher.patch(patcher.baseline() + '\n')
        self.assertEqual(patcher.digest(patcher.baseline()), patcher.BASE_SHA)

if __name__ == '__main__':
    unittest.main()
