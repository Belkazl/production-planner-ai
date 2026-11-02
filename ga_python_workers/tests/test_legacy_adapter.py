import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from ga_workers.legacy_adapter import run, LegacyGAError, verify_owned

class LegacyAdapterTests(unittest.TestCase):
 def setUp(self):
  self.previous=os.environ.get("PP_GENERIC_RESTORE_LAUNCH_V2")
  os.environ["PP_GENERIC_RESTORE_LAUNCH_V2"]="import runpy;runpy.run_module('ga_workers.legacy_test_server',run_name='__main__')"
 def tearDown(self):
  if self.previous is None:os.environ.pop("PP_GENERIC_RESTORE_LAUNCH_V2",None)
  else:os.environ["PP_GENERIC_RESTORE_LAUNCH_V2"]=self.previous
 def test_ten_distinct_legacy_processes(self):
  def execute(i):
   tag="TENANT"+str(i)
   model={"orders":[{"id":tag+"-ORDER-"+str(j)} for j in range(12)]}
   return tag,run({"model":model,"options":{"test_delay":.05}},lambda _:None)
  with ThreadPoolExecutor(max_workers=10) as pool:
   results=list(pool.map(execute,range(10)))
  for tag,result in results:
   self.assertEqual(len(result["operations"]),12)
   self.assertTrue(all(op["order"].startswith(tag+"-") for op in result["operations"]))
 def test_empty_model_rejected(self):
  with self.assertRaises(LegacyGAError):run({"model":{"orders":[]}},lambda _:None)
 def test_foreign_plan_rejected(self):
  with self.assertRaises(LegacyGAError):verify_owned({"operations":[{"order":"OTHER"}]},{"orders":[{"id":"MINE"}]})
