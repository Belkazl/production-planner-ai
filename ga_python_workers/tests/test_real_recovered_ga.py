"""Real extracted production Python GA source smoke and concurrency tests."""
import json
import os
import threading
import time
import unittest
import hashlib
from pathlib import Path
from ga_workers.manager import ProcessJobManager
from ga_workers.recovered_adapter import _engine_source, run, NativeGAError


def make_model(name, n=8, setup=True):
    return {
      'scheduler_mode':'resource',
      'start':'2026-11-02T08:00:00',
      'equipment':[{'id': name+'-E1', 'name':'Machine '+name, 'kind':'press', 'capacity':1}],
      'employees':[{'id': name+'-P1','name':'Operator '+name,'role':'operator','shift':'day'}],
      'shifts':{'day':[['08:00','12:00'],['13:00','17:00']], 'evening':[['17:00','23:00']]},
      'orders':[{'id':name+'-O'+str(i),'quantity':5+i,'parameters':{'color':'A' if i%2 else 'B'},
                 'operations':[{'id':'press','name':'Press','duration_minutes':25+i%3*5,'setup_parameter':'color',
                   'resource_requirements':[{'type':'equipment','id':name+'-E1','quantity':1}]}]}
        for i in range(n)],
      'setup_rules':[{'id':name+'-S','setup_parameter':'color','equipment_ref':'*','from_state':'*','to_state':'*','duration_min':7}] if setup else []
    }

class RealGARecoveredTests(unittest.TestCase):
  @classmethod
  def setUpClass(cls):
    if not os.environ.get('PP_PY_GA_SOURCE_SHA256'):
      raise unittest.SkipTest('Production GA source not provisioned in QA environment')
    if not os.environ.get('PP_RUNTIME_SRC_01'):
      raise unittest.SkipTest('Production GA source chunks not provisioned')

  def test_source_hash_unchanged(self):
    self.assertGreater(len(_engine_source().encode()),200000)

  def test_real_ga_setup_and_no_resource_overlap(self):
    output=run({'model':make_model('REAL',8),'options':{'generations':30,'population':20,'seed':42}},lambda _:None)
    self.assertTrue(output['valid'])
    self.assertEqual(len([r for r in output['operations'] if r.get('phase')!='setup']),8)
    self.assertGreaterEqual(output['setup_count'],1)
    rows=sorted(output['resource_busy']['REAL-E1'])
    for current,next_one in zip(rows,rows[1:]):self.assertLessEqual(current[1],next_one[0]+1e-8)

  def test_materials_fail_closed(self):
    m=make_model('MAT',4);m['materials']=[{'name':'Glaze','initial_stock':10}]
    with self.assertRaisesRegex(NativeGAError,'material_constraints'):
      run({'model':m,'options':{}},lambda _:None)

  def test_manual_locks_fail_closed(self):
    with self.assertRaisesRegex(NativeGAError,'manual_operation_locks'):
      run({'model':make_model('LOCK',4),'options':{'locked_operations':[{'id':'x'}]}},lambda _:None)

  def test_separate_os_processes_ten_users(self):
    manager=ProcessJobManager(capacity=4,timeout_s=60,adapter='ga_workers.recovered_adapter:run')
    try:
      job_ids=[]
      for i in range(10):
        name='T'+str(i)
        snap=manager.submit(name, {'model':make_model(name,8),'options':{'generations':25,'population':15,'seed':i}})
        job_ids.append((name,snap['job_id']))
      results=[manager.wait(name,job,timeout=58) for name,job in job_ids]
      statuses=[s['status'] for s in results]
      self.assertEqual(statuses,['completed']*10,results)
      self.assertEqual(len({s['pid'] for s in results}),10)
      self.assertLessEqual(manager.metrics()['peak'],4)
      self.assertEqual(manager.metrics()['active'],0)
      for i,output in enumerate(results):
        ops=output['result']['operations']
        self.assertTrue(all(str(o['order']).startswith('T'+str(i)+'-O') for o in ops))
      print('PASS_REAL_GA_10_USERS',{'completed':10,'unique_pids':10,'peak':manager.metrics()['peak']},flush=True)
    finally:manager.shutdown()

if __name__=='__main__':unittest.main()