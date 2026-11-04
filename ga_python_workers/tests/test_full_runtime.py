import sys,copy,time,unittest
from ga_workers.manager import ProcessJobManager
from ga_workers.full_runtime_adapter import run, FullGAError, _namespace

def req(typ,name):
 return {'resource_type':typ,'match_mode':'specific','resource_ref':name,'resource_refs':[name],'quantity':1}
def sample(tag,material=False,setup=False):
 mid=tag+'M'; eid=tag+'E'; emp=tag+'P'
 m={'scheduler_mode':'resource','start':'2026-11-03T08:00:00',
 'equipment':[{'id':eid,'name':'Station','kind':'workstation','capacity':10,'capacity_unit':'шт.'}],
 'employees':[{'id':emp,'name':'Operator','role':'operator','shift':'day'}],
 'shifts':{'day':[['08:00','12:00'],['13:00','17:00']]},
 'orders':[{'id':tag+'O1','quantity':5,'unit':'шт.','technical_process_id':'TP','parameters':{'color':'A'}},
           {'id':tag+'O2','quantity':5,'unit':'шт.','technical_process_id':'TP','parameters':{'color':'B'}}],
 'technical_processes':[{'id':'TP','name':'Assembly','operations':[{'id':'OP1','name':'Press','sequence':1,'duration_min':30,'setup_parameter':'color',
   'resource_requirements':[req('equipment',eid),req('employee',emp)]}]}],
 'materials':[],'setup_rules':[]}
 if setup:
  m['setup_rules']=[{'id':'AB','setup_parameter':'color','equipment_ref':'*','from_state':'A','to_state':'B','duration_min':15},
                   {'id':'BA','setup_parameter':'color','equipment_ref':'*','from_state':'B','to_state':'A','duration_min':15}]
 if material:
  m['materials']=[{'id':mid,'name':'Paint','unit':'kg','initial_stock':0,'deliveries':[{'at':'2026-11-03T09:00:00','quantity':20}]}]
  m['technical_processes'][0]['operations'][0]['resource_requirements'].append({'resource_type':'material','resource_ref':mid,'resource_refs':[mid],'quantity':1,'consumption_rule':'per_unit'})
 return m
class FullWorkerTests(unittest.TestCase):
 def test_1_live_full_ga_material_and_setup(self):
  model=sample('QA',material=True,setup=True);out=run({'model':model,'options':{'generations':12,'population':12,'seed':4}},lambda _:None)
  self.assertEqual(out.get('setup_count'),1)
  self.assertEqual(out.get('setup_minutes'),15)
  self.assertEqual(len([r for r in out['generic_operations'] if r.get('phase')=='setup']),1)
  self.assertTrue(all(float(x['start_min'])>=60 for x in out['operations']))
  self.assertTrue(out['valid'])
  self.assertTrue(all(str(x['order']).startswith('QA') for x in out['generic_operations']))
  print('FULL_GA_MATERIAL_SETUP_PASS',{'setup_minutes':out['setup_minutes'],'min_start':min(x['start_min'] for x in out['operations'])},flush=True)
 def test_2_manual_locks_honored_exactly(self):
  model=sample('L',material=True,setup=True)
  base=run({'model':model,'options':{'generations':12,'population':12,'seed':4}},lambda _:None)
  row=base['operations'][0]
  lock={k:copy.deepcopy(row.get(k)) for k in ('order','operation_id','start_min','end_min','employee_ids','equipment_ids','batch')}
  lock['start_min']+=15;lock['end_min']+=15
  result=run({'model':model,'options':{'generations':12,'population':12,'seed':4,'locked_operations':[lock]}},lambda _:None)
  selected=[r for r in result['operations'] if r.get('manual_locked')]
  self.assertEqual(len(selected),1)
  self.assertEqual(selected[0]['start_min'],lock['start_min'])
  self.assertEqual(selected[0]['end_min'],lock['end_min'])
  self.assertEqual(selected[0]['equipment_ids'],lock['equipment_ids'])
  self.assertEqual(result['locked_operations_applied'],1)
  self.assertTrue(result['valid'])
  self.assertEqual(result['setup_count'],1)
  print('FULL_GA_EXACT_LOCK_PASS',{'locked_start':lock['start_min'],'duration':result['duration_minutes']},flush=True)
 def test_3_resume_across_new_process_and_model_change_guard(self):
  model=sample('R',material=True,setup=True)
  first=run({'model':model,'options':{'generations':12,'population':12,'seed':4}},lambda _:None)
  state=first['resume_state']
  self.assertEqual(state['completed_runs'],1)
  second=run({'model':model,'options':{'generations':12,'population':12,'seed':12,'continue':True,'resume_state':state}},lambda _:None)
  self.assertTrue(second['continued'])
  self.assertGreater(second['resume_state']['total_trials'],state['total_trials'])
  self.assertEqual(second['resume_state']['completed_runs'],2)
  self.assertLessEqual(second['duration_minutes'],first['duration_minutes'])
  legacy_seed={k:copy.deepcopy(first.get(k)) for k in ('order_sequence','duration_minutes','optimization_run','total_generations')}
  seeded=run({'model':model,'options':{'generations':12,'population':12,'seed':13,'continue':True,'resume_plan':legacy_seed}},lambda _:None)
  self.assertTrue(seeded['continued'])
  self.assertEqual(seeded['resume_state']['completed_runs'],2)
  self.assertLessEqual(seeded['duration_minutes'],first['duration_minutes'])
  altered=copy.deepcopy(model);altered['orders'][0]['quantity']=99
  with self.assertRaisesRegex(FullGAError,'model_changed'):
   run({'model':altered,'options':{'continue':True,'resume_state':state}},lambda _:None)
  with self.assertRaisesRegex(FullGAError,'missing_or_invalid'):
   run({'model':model,'options':{'continue':True}},lambda _:None)
  print('FULL_GA_FRESH_PROCESS_RESUME_PASS',{'first_runs':1,'continued_runs':second['resume_state']['completed_runs'],'legacy_seed':True},flush=True)
 def test_3b_lock_conflicts_fail_closed(self):
  model=sample('BAD',material=True,setup=True)
  base=run({'model':model,'options':{'generations':12,'population':12,'seed':4}},lambda _:None)
  row=base['operations'][0]
  lock={k:copy.deepcopy(row.get(k)) for k in ('order','operation_id','start_min','end_min','employee_ids','equipment_ids','batch')}
  lock['start_min']=-15;lock['end_min']=15
  with self.assertRaisesRegex(FullGAError,'pin_time_invalid'):
   run({'model':model,'options':{'generations':8,'population':10,'seed':4,'locked_operations':[lock]}},lambda _:None)
  lock['start_min']=row['start_min']+10;lock['end_min']=row['end_min']+10
  lock['equipment_ids']=['OTHER']
  with self.assertRaisesRegex(FullGAError,'ga_no_valid_solution'):
   run({'model':model,'options':{'generations':8,'population':10,'seed':4,'locked_operations':[lock]}},lambda _:None)
 def test_3c_resume_between_distinct_os_processes(self):
  manager=ProcessJobManager(capacity=1,timeout_s=45,adapter='ga_workers.full_runtime_adapter:run')
  try:
   model=sample('RESUME',material=True,setup=True)
   first=manager.submit('one-account',{'model':model,'options':{'generations':12,'population':12,'seed':5}})
   a=manager.wait('one-account',first['job_id'],timeout=30)
   self.assertEqual(a['status'],'completed',a)
   incumbent=a['result']['resume_state']
   second=manager.submit('one-account',{'model':model,'options':{'generations':12,'population':12,'seed':9,'continue':True,'resume_state':incumbent}})
   b=manager.wait('one-account',second['job_id'],timeout=30)
   self.assertEqual(b['status'],'completed',b)
   self.assertNotEqual(a['pid'],b['pid'])
   self.assertTrue(b['result']['continued'])
   self.assertEqual(b['result']['resume_state']['completed_runs'],2)
   self.assertLessEqual(b['result']['duration_minutes'],a['result']['duration_minutes'])
   print('FULL_GA_RESUME_TWO_OS_PIDS_PASS',{'run1_pid':a['pid'],'run2_pid':b['pid']},flush=True)
  finally: manager.shutdown()
 def test_4_cross_tenant_resource_rejected(self):
  from ga_workers.full_runtime_adapter import _assert_owned
  m=sample('M')
  with self.assertRaisesRegex(FullGAError,'foreign_resource'):
   _assert_owned({'valid':True,'operations':[{'order':'MO1','equipment_ids':['OTHER-E1']}]},m)
 def test_6_cancel_full_real_running_process(self):
  manager=ProcessJobManager(capacity=2,timeout_s=70,adapter='ga_workers.full_runtime_adapter:run')
  try:
   heavy=sample('CANCEL')
   heavy['orders']=[{**copy.deepcopy(heavy['orders'][i%2]),'id':'CANCEL'+str(i)} for i in range(120)]
   j=manager.submit('cancel-account',{'model':heavy,'options':{'generations':15000,'population':250,'seed':123}})
   deadline=time.monotonic()+12
   snap=None
   while time.monotonic()<deadline:
    snap=manager.get('cancel-account',j['job_id'])
    if snap['status']=='running' and snap.get('pid'):break
    if snap['status'] in {'failed','completed','cancelled'}:break
    time.sleep(0.05)
   self.assertEqual(snap['status'],'running',snap)
   got=manager.stop('cancel-account',j['job_id'])
   self.assertEqual(got['status'],'cancelled',got)
   fin=manager.wait('cancel-account',j['job_id'],timeout=10)
   self.assertEqual(fin['status'],'cancelled')
   self.assertEqual(manager.metrics()['active'],0)
   print('FULL_GA_RUNNING_CANCEL_PASS',{'status':fin['status'],'active':manager.metrics()['active']},flush=True)
  finally:manager.shutdown()
 def test_5_10_concurrent_real_processes(self):
  manager=ProcessJobManager(capacity=4,timeout_s=80,adapter='ga_workers.full_runtime_adapter:run')
  try:
   jobs=[]
   for i in range(10):
    account='U'+str(i)
    item=manager.submit(account,{'model':sample(account,material=(i%3==0),setup=(i%2==0)),'options':{'generations':18,'population':12,'seed':100+i}})
    jobs.append((account,item['job_id']))
   snapshots=[manager.wait(account,job,timeout=75) for account,job in jobs]
   states=[s['status'] for s in snapshots]
   self.assertEqual(states,['completed']*10, snapshots)
   self.assertEqual(len({s['pid'] for s in snapshots}),10)
   self.assertLessEqual(manager.metrics()['peak'],4)
   for i,s in enumerate(snapshots):
    self.assertTrue(all(str(op['order']).startswith('U'+str(i)) for op in s['result']['generic_operations']))
   print('FULL_GA_10_ACCOUNTS_PASS',{'completed':10,'pids':10,'peak':manager.metrics()['peak']},flush=True)
  finally:manager.shutdown()
 def test_7_terminal_status_waits_until_process_slot_reaped(self):
  manager=ProcessJobManager(capacity=1,timeout_s=45,adapter='ga_workers.full_runtime_adapter:run')
  original=manager._terminate
  def slow_termination(proc):
   # Make the cleanup window observable; a completed HTTP response must
   # never arrive while the OS process still owns a compute slot.
   time.sleep(0.2)
   return original(proc)
  manager._terminate=slow_termination
  try:
   job=manager.submit('qa-atomic',{'model':sample('ATOMIC',material=True,setup=True),
      'options':{'generations':12,'population':12,'seed':101}})
   deadline=time.monotonic()+30
   while time.monotonic()<deadline:
    snapshot=manager.get('qa-atomic',job['job_id'])
    if snapshot['status']=='completed':
     self.assertEqual(manager.metrics()['active'],0)
     self.assertTrue(snapshot['progress']==100)
     break
    self.assertNotIn(snapshot['status'],('failed','timed_out','cancelled'))
    time.sleep(0.01)
   else: self.fail('atomic cleanup did not complete')
   print('FULL_GA_ATOMIC_CLEANUP_PASS',flush=True)
  finally:manager.shutdown()

if __name__=='__main__':unittest.main(verbosity=2)