import unittest
from deadlines import deadline_offsets, deadline_report, deadline_score, deadline_sequence

MODEL = {'start':'2026-11-27T08:00:00','orders':[{'id':'A','ship_by':'2026-11-27T10:00'}, {'id':'B','ship_by':'2026-11-27T12:00'}, {'id':'C'}]}
def plan(a,b,d,valid=True,partial=False):
    return {'valid':valid,'partial':partial,'duration_minutes':d,'operations':[{'order':'A','end_min':30},{'order':'A','end_min':a},{'order':'B','end_min':b},{'order':'A','end_min':d,'phase':'setup'},{'order':'C','end_min':d}]}
class Deadlines(unittest.TestCase):
    def test_offsets(self): self.assertEqual(deadline_offsets(MODEL),{'A':120,'B':240})
    def test_last_batch_and_setup(self): self.assertEqual(deadline_report(MODEL,plan(120,241,400))[0]['status'],'on_time')
    def test_priority_over_duration(self): self.assertLess(deadline_score(MODEL,plan(120,240,500),(500,)),deadline_score(MODEL,plan(130,240,250),(250,)))
    def test_total_delay(self): self.assertLess(deadline_score(MODEL,plan(121,240,500),(500,)),deadline_score(MODEL,plan(130,240,250),(250,)))
    def test_count_over_delay(self): self.assertLess(deadline_score(MODEL,plan(300,240,500),(500,)),deadline_score(MODEL,plan(121,241,250),(250,)))
    def test_duration_tiebreak(self): self.assertLess(deadline_score(MODEL,plan(120,240,300),(300,)),deadline_score(MODEL,plan(120,240,500),(500,)))
    def test_no_deadline(self): self.assertEqual(deadline_score({'orders':[{'id':'A'}]},plan(120,240,300),(17,42)),(17,42))
    def test_partial_not_planned(self): self.assertEqual(deadline_report(MODEL,plan(120,240,300,partial=True))[0]['status'],'not_planned')
    def test_missing_order_rejected(self):
        p=plan(120,240,300);p['operations']=[r for r in p['operations'] if r['order']!='B']
        with self.assertRaises(ValueError): deadline_score(MODEL,p,(300,))
    def test_invalid_date(self):
        with self.assertRaises(ValueError): deadline_offsets({'start':MODEL['start'],'orders':[{'id':'A','ship_by':'2026-02-30T10:00'}]})
    def test_sequence(self): self.assertEqual(deadline_sequence(MODEL,['C','B','A']),('A','B','C'))
    def test_past_deadline(self): self.assertEqual(deadline_offsets({'start':MODEL['start'],'orders':[{'id':'A','ship_by':'2026-11-26T08:00'}]}),{'A':-1440})
if __name__=='__main__': unittest.main()
