"""Weekly shift calendar helpers. No change to models without explicit calendars."""
import copy
import math
import re
from datetime import datetime, timedelta

def _wc_min(value):
    if not isinstance(value, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
        raise ValueError("invalid_shift_time")
    return int(value[:2])*60+int(value[3:])

def _wc_clock(value):
    value %= 1440
    return "%02d:%02d" % divmod(value,60)

def _wc_blocks(cal):
    if not isinstance(cal, dict):
        raise ValueError("invalid_shift_calendar")
    days=cal.get("days")
    if not isinstance(days,list) or not days or any(type(d) is not int or not 1<=d<=7 for d in days) or len(set(days))!=len(days):
        raise ValueError("select_working_days")
    start=_wc_min(cal.get("start")); end=_wc_min(cal.get("end"))
    if start==end and cal.get("full_day") is not True:
        raise ValueError("equal_shift_times")
    if end<=start: end+=1440
    breaks=cal.get("breaks",[])
    if not isinstance(breaks,list) or len(breaks)>24:
        raise ValueError("invalid_shift_breaks")
    intervals=[]
    for pair in breaks:
        if not isinstance(pair,list) or len(pair)!=2: raise ValueError("invalid_break")
        a,b=map(_wc_min,pair)
        if a<start:a+=1440
        if b<=a:b+=1440
        if not start<=a<b<=end: raise ValueError("break_outside_shift")
        intervals.append((a,b))
    result=[]; cursor=start
    for a,b in sorted(intervals):
        if a<cursor:raise ValueError("overlapping_breaks")
        if cursor<a:result.append((cursor,a))
        cursor=b
    if cursor<end:result.append((cursor,end))
    if not result:raise ValueError("empty_working_shift")
    return result

def _wc_prepare_model(model):
    if not isinstance(model,dict):raise ValueError("invalid_model")
    calendars=model.get("shift_calendars")
    if calendars is None:return model
    if not isinstance(calendars,dict) or len(calendars)>128:
        raise ValueError("invalid_shift_calendars")
    result=copy.deepcopy(model)
    shifts=result.get("shifts")
    if not isinstance(shifts,dict):raise ValueError("invalid_native_shifts")
    for name,cal in calendars.items():
        if not isinstance(name,str) or not name or name not in shifts:raise ValueError("unknown_calendar_shift")
        shifts[name]=[[_wc_clock(a),_wc_clock(b)] for a,b in _wc_blocks(cal)]
    return result

def _wc_restore_model(normalized, original):
    if "shift_calendars" not in original:return normalized
    if not isinstance(normalized,dict):raise ValueError("invalid_normalized_model")
    result=copy.deepcopy(normalized)
    result["shift_calendars"]=copy.deepcopy(original["shift_calendars"])
    result["shifts"]=copy.deepcopy(original["shifts"])
    return _wc_prepare_model(result)

def _wc_windows(cal,origin,first,last):
    """Return model-relative windows for days relative to the origin date."""
    blocks=_wc_blocks(cal)
    offset=origin.hour*60+origin.minute+origin.second/60+origin.microsecond/60000000
    result=[]
    for day in range(first,last+1):
        if (origin.date()+timedelta(days=day)).isoweekday() not in cal["days"]:continue
        for a,b in blocks:
            result.append((day*1440+a-offset,day*1440+b-offset))
    result.sort()
    merged=[]
    for a,b in result:
        if merged and a<=merged[-1][1]:
            merged[-1]=(merged[-1][0],max(merged[-1][1],b))
        else:merged.append((a,b))
    return merged

def _wc_native_windows(model,origin,raw,corrected):
    """Replace only explicitly configured employee calendars; keep native horizon."""
    calendars=model.get("shift_calendars") or {}
    if not calendars:return corrected
    _wc_prepare_model(model)
    staff={str(e["id"]):e.get("shift") for e in model.get("employees",[])}
    last=max((float(pair[1]) for intervals in raw.values() for pair in intervals),default=0)
    if not math.isfinite(last) or last<=0:
        raise ValueError("invalid_native_calendar_horizon")
    offset=origin.hour*60+origin.minute+origin.second/60+origin.microsecond/60000000
    horizon=last-offset
    for key in corrected:
        name=staff.get(str(key))
        if name not in calendars:continue
        windows=_wc_windows(calendars[name],origin,-1,math.ceil(last/1440))
        corrected[key]=[(a,min(b,horizon)) for a,b in windows if a<horizon and min(b,horizon)>a]
    if any(name in calendars and not any(str(k)==employee for k in corrected) for employee,name in staff.items()):
        raise ValueError("missing_native_employee_calendar")
    return corrected

def _wc_contains(cal,origin,start,end):
    if not math.isfinite(start) or not math.isfinite(end) or end<=start:return False
    offset=origin.hour*60+origin.minute+origin.second/60+origin.microsecond/60000000
    first=math.floor((start+offset)/1440)-1
    last=math.ceil((end+offset)/1440)
    # An interval longer than a full week can only fit an uninterrupted 24/7 calendar.
    if last-first>10:
        return len(cal["days"])==7 and _wc_blocks(cal)==[(_wc_min(cal["start"]),_wc_min(cal["start"])+1440)]
    return any(start>=a-1e-7 and end<=b+1e-7 for a,b in _wc_windows(cal,origin,first,last))
