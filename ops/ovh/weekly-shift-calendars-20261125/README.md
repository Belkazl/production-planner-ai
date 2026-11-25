# Weekly shift calendar — staged candidate, not a live release

This isolated feature adds a shift calendar editor beside Employees, with multiple shifts, ISO weekdays (Monday=1), start/end, and multiple configurable breaks. Existing seven-day legacy schedules are left unchanged until explicitly edited. New shifts default to Monday–Friday, 08:00–17:00; breaks are explicitly added rather than assumed. Names are display labels, and existing shift IDs remain stable.

Model contract: shift_calendars[shift_id] = {name, days, start, end, full_day, breaks}. The existing shifts[shift_id] list of working HH:MM intervals remains the native scheduling input. Breaks are subtracted, not merely shown. Overnight shifts belong to the day on which they start, including breaks after midnight. Calendar metadata is retained across the worker's canonicalizer. The joint search's native employee windows are replaced before operations are scheduled, and the existing feasibility validation additionally checks weekday calendars. Unconfigured shifts retain their legacy behavior.

The guarded patch transforms the public, hash-bound joint module and a single exact canonicalization assignment in the live adapter. The editor patch targets the existing resource-units HTML transformation; both the normal native page and authenticated compatibility path need staging. It refuses unexpected anchors. It has not yet been applied to production.

Run python3 -m unittest discover -s ops/ovh/weekly-shift-calendars-20261125 -p 'test_*.py' and node --test ops/ovh/weekly-shift-calendars-20261125/test-editor.mjs.

Release acceptance still required:
- Confirm real authenticated editor anchors and table markup; save/reload a synthetic project, create multiple shifts, assign an employee, validate changed calendars persist through the account API, DB storage, and worker request.
- Capture the approved exact deployed native modules privately using the established verification mechanism, stage both modules without touching live sources, run existing eleven-case native, four-case setup and shift-aware minibatch regressions plus an actual native Friday/lunch/weekend/Monday and overnight witness. Confirm setup staff obey calendars, nonstaff equipment can continue automatically, no lost pins, and the same generation/population budget.
- Confirm all legacy shifts/models, model fingerprint, continuation invalidation after calendar changes, native horizon and normalization behavior remain correct. Confirm save errors do not discard edits, and both EN/RU employee views are correct.
- Only after these checks, use the existing hash-bound release/rollback process, protecting active optimization jobs. No release or host changes are triggered by this branch.
