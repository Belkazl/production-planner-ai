"""Ship-by deadlines on the native project-local planning timeline."""
from datetime import datetime, timedelta
import math
import re


def deadline_offsets(model):
    offsets = {}
    for order in model.get('orders', []):
        raw = order.get('ship_by')
        if raw is None or raw == '':
            continue
        if not isinstance(raw, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}', raw):
            raise ValueError('invalid_ship_by')
        due = datetime.fromisoformat(raw)
        start = datetime.fromisoformat(model['start']).replace(tzinfo=None)
        oid = str(order['id'])
        if oid in offsets:
            raise ValueError('duplicate_order_deadline')
        offsets[oid] = (due - start).total_seconds() / 60
    return offsets


def deadline_report(model, plan):
    due = deadline_offsets(model)
    if not due:
        return []
    complete = isinstance(plan, dict) and plan.get('valid') is not False and not plan.get('partial')
    ends = {}
    if complete:
        for row in plan.get('operations') or []:
            if row.get('is_setup') or row.get('phase') == 'setup':
                continue
            oid = str(row.get('order'))
            if oid not in due:
                continue
            end = row.get('end_min')
            if isinstance(end, bool) or not isinstance(end, (int, float)) or not math.isfinite(end) or end < 0:
                raise ValueError('invalid_order_completion')
            ends[oid] = max(ends.get(oid, 0), end)
    report = []
    for oid, deadline in due.items():
        end = ends.get(oid)
        late = None if end is None else max(0, end - deadline)
        report.append(dict(order_id=oid, deadline_min=deadline, completion_min=end,
                           late_minutes=late, status='not_planned' if end is None else
                           'late' if late > 1e-7 else 'on_time'))
    return report


def deadline_score(model, plan, native_score):
    report = deadline_report(model, plan)
    if not report:
        return native_score
    if any(row['status'] == 'not_planned' for row in report):
        raise ValueError('deadline_candidate_missing_order')
    duration = plan.get('duration_minutes')
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration < 0:
        raise ValueError('invalid_plan_duration')
    return (sum(row['status'] == 'late' for row in report),
            math.fsum(row['late_minutes'] for row in report), duration)


def deadline_sequence(model, sequence):
    due = deadline_offsets(model)
    return tuple(sorted(sequence, key=lambda oid: due.get(str(oid), math.inf)))
