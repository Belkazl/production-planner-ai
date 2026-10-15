# Production etalon — LiftOrbit authenticated planner (15 October 2026)

**Status: USER APPROVED / PRODUCTION REFERENCE.** The user visually confirmed on 15 October 2026 that the authenticated LiftOrbit planning UI and Equipment Gantt rendered correctly after the blank-screen fix, and explicitly instructed that this build become the production etalon.

## Exact code and running deployment

- **Source commit (pin; do not approximate):** `31f017538dddaff9b61d5a866a6b651de5921eb7`.
- **Frozen source branch:** [`etalon/production-2026-10-15-liftorbit-postlogin-fixed`](https://github.com/Belkazl/production-planner-ai/tree/etalon/production-2026-10-15-liftorbit-postlogin-fixed).
- **Release development branch:** `fix/liftorbit-postlogin-async-storage-2026-10-15` at the pinned commit above.
- **Production Railway project:** `16a27a18-a727-4a65-b75d-4368159b0e3e`; environment `675f0be6-40d5-4177-a273-c561f5c963e7`; planner service `2bf88ff3-774c-474f-a102-981452c23abd` (`prodplan-auth-integration-qa`, internal name).
- **Successful Railway deployment:** `a93ad7a6-c150-44cb-836b-d292eeb0979e`, deploying the exact code SHA above.
- **Live planner:** https://production-planner-gateway-v2-production.up.railway.app/
- **Live LiftOrbit landing:** https://prodplan-landing-v1-production.up.railway.app/ (separate service). Its existing reference is [`release/liftorbit-etalon-2026-10-15-landing`](https://github.com/Belkazl/production-planner-ai/tree/release/liftorbit-etalon-2026-10-15-landing), commit `81234b134d6b4e927ea53217062d3fcbb952ab11`.

## Acceptance

- Production login succeeds and the actual authenticated planning interface displays.
- LiftOrbit branding, English default with Russian switch, saved-plan controls, equipment utilization Gantt and equipment setup blocks are visibly present.
- The client supplied a screenshot showing the live Gantt with production equipment and explicitly confirmed the application works.
- The previous white screen was traced to synchronous `/api/db-storage` POSTs in the upstream page's early `<head>` script. The release keeps the initial server GET hydration and uses a debounced, sequential, asynchronous save queue with read-after-write confirmation, avoiding browser render stalls.
- The isolated GitHub Actions regression suite passed for login, localization, Gantt, Documents, optimizer start/restart/stop, account session and a synthetic 12-second DB-save delay. This is test/visual acceptance of the release, not a guarantee of every possible production data state.

## Data preservation: important distinction

**This etalon freezes source code, not the mutable customer database.** Creating a Git branch does not create a PostgreSQL snapshot. The existing separate production-data etalon `production-2026-10-15-ceramic-materials-v1` remains a historical snapshot; it is **not** a fresh database snapshot for this LiftOrbit release and must not automatically overwrite newer live data.

The commit changes browser-side storage write scheduling, not production database records. No clearing of browser storage, resetting projects, deleting saved plans or restoring an old database was performed to create this reference.

## Recovery procedure

1. Keep the user's live production data unchanged unless separately instructed and backed up.
2. On the Railway planner service above, deploy the **exact** source SHA `31f017538dddaff9b61d5a866a6b651de5921eb7` from the pinned etalon branch; do not rely on a moving working branch head.
3. Confirm successful deployment and runtime health, sign-in, current project visibility, Gantt, saved plan list and optimization controls.
4. The old `release/liftorbit-etalon-2026-10-15-planner` is an earlier pre-fix LiftOrbit snapshot (`6370d817...`) and is **not** the new accepted rollback version.
5. Preserve the earlier PlanTrick and LiftOrbit snapshots for history. Continue development in separate branches; do not amend this pinned etalon.

## Acceptance reference

User confirmation in the project conversation on 15 October 2026: `да всё хорошо! теперь это боевой эталонный запиши`.
