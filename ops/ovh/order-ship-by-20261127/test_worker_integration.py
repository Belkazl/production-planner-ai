import unittest
from pathlib import Path
import sys
import tempfile
import importlib.util

from patch_worker import patch

ROOT = Path(__file__).resolve().parent
ORIGINAL = ROOT.parent / 'joint-minibatch-search-20261124'
SHARED = (ROOT / 'deadlines.py').read_text()
sys.path.insert(0, str(ORIGINAL))
import test_joint

class IntegratedDeadlines(unittest.TestCase):
    def test_native_score_and_real_joint_search(self):
        module = importlib.util.module_from_spec(importlib.util.spec_from_loader('deadline_joint', loader=None))
        sys.modules[module.__name__] = module
        exec(compile(patch((ORIGINAL / 'joint_minibatch.py').read_text(), SHARED), '<joint-ship-by>', 'exec'), module.__dict__)
        m = test_joint.model()
        m['orders'] = [{'id':'L','quantity':10,'unit':'шт.'}, {'id':'U','quantity':10,'unit':'шт.','ship_by':'2026-11-24T08:10'}]
        m['equipment'] = m['equipment'][:1]
        original = test_joint.joint
        test_joint.joint = module
        try:
            ga = test_joint.namespace(m)
            module.install_joint_minibatch_search(ga, m, verify_constraints=test_joint.verify_constraints)
            result = ga['optimize'](gens=2,pop=4,seed=42)
            self.assertTrue(result['valid'])
            self.assertEqual(result['order_sequence'][0], 'U')
            self.assertEqual(result['order_deadlines'][0]['status'], 'on_time')
            self.assertEqual(result['duration_minutes'],20)
            # Continuation must keep the deadline-aware incumbent.
            result = ga['optimize'](gens=2,pop=4,seed=43,continue_run=True)
            self.assertEqual(result['order_deadlines'][0]['status'], 'on_time')
        finally:
            test_joint.joint = original
    def test_guard(self):
        with self.assertRaises(ValueError): patch('pass', SHARED)
if __name__ == '__main__': unittest.main()
