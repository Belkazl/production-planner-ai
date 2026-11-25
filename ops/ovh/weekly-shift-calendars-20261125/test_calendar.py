import unittest
from datetime import datetime
from weekly_calendar import _wc_blocks, _wc_prepare_model, _wc_native_windows, _wc_contains, _wc_restore_model
from patch import patch_adapter

class WeeklyCalendar(unittest.TestCase):
    def setUp(self):
        self.day={"days":[1,2,3,4,5],"start":"08:00","end":"17:00","breaks":[["12:00","13:00"]]}
        self.model={"shifts":{"day":[["00:00","00:00"]]},"shift_calendars":{"day":self.day},"employees":[{"id":"E","shift":"day"}]}
    def test_lunch_and_multiple_breaks(self):
        self.day["breaks"].append(["15:00","15:15"])
        self.assertEqual(_wc_blocks(self.day),[(480,720),(780,900),(915,1020)])
        self.assertEqual(_wc_prepare_model(self.model)["shifts"]["day"],[["08:00","12:00"],["13:00","15:00"],["15:15","17:00"]])
        self.assertEqual(self.model["shifts"]["day"],[["00:00","00:00"]])
    def test_friday_to_monday_nonzero_origin(self):
        origin=datetime(2026,11,27,8)
        self.assertTrue(_wc_contains(self.day,origin,0,240))
        self.assertFalse(_wc_contains(self.day,origin,230,250))
        self.assertTrue(_wc_contains(self.day,origin,300,540))
        self.assertFalse(_wc_contains(self.day,origin,1440,1500))
        self.assertTrue(_wc_contains(self.day,origin,4320,4380))
    def test_overnight_break_on_following_day(self):
        cal={"days":[5],"start":"22:00","end":"06:00","breaks":[["01:00","01:30"]]}
        origin=datetime(2026,11,27,22)
        self.assertTrue(_wc_contains(cal,origin,0,180))
        self.assertFalse(_wc_contains(cal,origin,170,200))
        self.assertTrue(_wc_contains(cal,origin,210,480))
        self.assertFalse(_wc_contains(cal,origin,1440,1500))
    def test_previous_day_overnight(self):
        cal={"days":[7],"start":"22:00","end":"06:00","breaks":[]}
        self.assertTrue(_wc_contains(cal,datetime(2026,11,30,1),0,300))
    def test_native_window_replacement(self):
        origin=datetime(2026,11,27,8)
        raw={"E":[(480,1020),(1920,2460),(3360,3900),(4800,5340)],"untouched":[(0,5340)]}
        corrected={"E":[(0,540)],"untouched":[(-480,4860)]}
        result=_wc_native_windows(self.model,origin,raw,corrected)
        self.assertEqual(result["E"],[(0,240),(300,540),(4320,4560),(4620,4860)])
        self.assertEqual(result["untouched"],[(-480,4860)])
    def test_invalid(self):
        for value in [[],[0],[1,1]]:
            with self.assertRaises(ValueError):_wc_blocks(dict(self.day,days=value))
        for value in [[["11:00","13:00"],["12:00","14:00"]],[["07:00","08:30"]],[["08:00","17:00"]]]:
            with self.assertRaises(ValueError):_wc_blocks(dict(self.day,breaks=value))
    def test_legacy_and_restore(self):
        legacy={"shifts":{"day":[["08:00","12:00"]]}}
        self.assertIs(_wc_prepare_model(legacy),legacy)
        prepared=_wc_prepare_model(self.model)
        self.assertEqual(_wc_restore_model({"shifts":{}},prepared)["shift_calendars"],self.model["shift_calendars"])
    def test_adapter_guard(self):
        source="def f(ga,original):\n    normalized=ga['canonicalize_model'](original)\n    return normalized\n"
        staged=patch_adapter(source)
        self.assertIn("_wc_restore_model(normalized, original)",staged)
        with self.assertRaises(ValueError):patch_adapter("pass")
if __name__=="__main__":unittest.main()
