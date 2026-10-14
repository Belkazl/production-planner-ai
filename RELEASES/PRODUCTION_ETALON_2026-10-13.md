# Production baseline — 2026-10-13 (user-accepted)

## Canonical source

- **Approved deployed source commit:** `2d4e66263ec879795a22278ecd322181c2d75a17`
- **Protected reference branch (do not change):** `etalon/production-2026-10-13-gantt-details`
- **Main:** release PR #3 merged as `dd20f332d3922724036ef902108c00b1d3c9af93`; `main` is not the immutable rollout ref.
- **Railway project:** `ProdPlan AI - Setup Bridge` (`69283d25-0397-4097-8b67-4e182977d0e0`)
- **Environment:** `production` (`d09e0202-b39d-4111-864f-849feaf0a179`)
- **Deployed service:** `aps-setup-bridge-candidate-v2` (`6e5f7005-19a1-4da1-a0db-2fd216d30ccd`)
- **Canonical working URL:** https://aps-setup-bridge-candidate-v2-production.up.railway.app/
- **Successful production deployment:** `82b8458d-456f-4fbe-8cd6-830f8a63d64e`

## Approved behavior

- Equipment Gantt, employee Gantt, order Gantt, and material Gantt.
- Colored operations and explicit black setup/transition tasks remain in the charts.
- Clicking operation blocks opens detailed operation data; setup operations and material events supported.
- GA progress is derived from completed generations / total generations (240 in this demo), not clamped at 99%.
- Stop optimization, select the best valid intermediate plan and show it on the Gantt.
- Optimization button resets to its normal state on completion.
- Previously saved plans and orders preserved; deployment does not modify storage.

## Safeguards and rollback

1. **Do not edit the canonical etalon branch in place.** Create feature branches from this SHA.
2. Deploy future changes first to QA, not the canonical production service.
3. To restore the approved release, connect the production service source to `Belkazl/production-planner-ai`, branch `etalon/production-2026-10-13-gantt-details`, exact commit `2d4e66263ec879795a22278ecd322181c2d75a17`, then wait for `SUCCESS`.
4. The prior baseline is on `etalon/production-2026-10-11-stop-best` at `f5867f3f7c00e336f396264255b178a438f6cf38`.
5. The older function `aps-setup-bridge` at https://aps-setup-bridge-production.up.railway.app/ is a different legacy service. **Do not use that domain to evaluate this release**. Do not migrate domains or browser-local saved plans without an explicit safe migration plan.

## Validation

The user accepted the QA version on 2026-10-13, including interactive block detail panels. GitHub CI build, DOM tests, and browser interaction tests passed on the feature branch. This exact compiled source SHA was redeployed to the production service on 2026-10-13 with Railway status `SUCCESS`.
