# Production etalon — 14 October 2026 — English default + Russian switch

**Status:** Current **user-approved production reference**, accepted on 14 October 2026 (Europe/Ljubljana).

## Exact reproducible source

- **Deployed Git commit:** `1a6d4ae9ffb6978e064830c0aafd3ec92bb3422c` (this exact commit, **not** the latest head of the feature branch)
- **Dedicated reference branch:** [`etalon/production-2026-10-14-english-default-ru-switch`](https://github.com/Belkazl/production-planner-ai/tree/etalon/production-2026-10-14-english-default-ru-switch); created directly from the deployed source commit, without additional code or test changes
- **Source branch at release:** `feature/2026-10-14-english-default-language` (contains later test-only commits; always use the exact SHA or reference branch for restoration)
- **Repository:** https://github.com/Belkazl/production-planner-ai
- **Canonical production URL:** https://production-planner-gateway-v2-production.up.railway.app/
- **Railway project:** Production Planner AI (`16a27a18-a727-4a65-b75d-4368159b0e3e`)
- **Railway environment:** production (`675f0be6-40d5-4177-a273-c561f5c963e7`)
- **Railway service:** `prodplan-auth-integration-qa` (`2bf88ff3-774c-474f-a102-981452c23abd`)
- **Verified SUCCESS deployment:** `d9f17da8-0979-4d2c-a7b8-f742ffbf4be7`, started 2026-10-14 16:44:56 UTC; source SHA matches above
- **Previous production release commit (rollback reference):** `7c76f14e995b07fd99003354d4cf23205a75e802`, previous deployment `0b6098cd-a0cc-4334-8e38-4d294807a739`

## Accepted behavior

- English is the UI default on first visit. Users can switch **English / Русский** on both the login page and protected planner.
- Selected language persists across reload and sign-out; switching should not modify project or order models.
- Existing authentication, Documents tab, orders and production-parameter accordion, equipment/employee/order Gantt, setup blocks, and optimization workflow remain in scope.
- Continue to preserve the optimizer's stop, resume and restart-from-scratch behavior, saved plans, and existing tenant-scoped data.

## Verification performed before approval

- Railway production deploy returned `SUCCESS` on the exact source commit.
- **13/13 GitHub Actions checks passed** on source commit `1a6d4ae9ffb6978e064830c0aafd3ec92bb3422c`, covering build, Gantt, Orders, Documents, auth, optimization, and EN/RU preview.
- After release, the separate read-only browser smoke test against the **canonical production URL** reported `PUBLIC_I18N_PRODUCTION_PASS`: English default, Russian switch, persistence, login, no browser errors, and anonymous API access denied.
- Source of the final post-release checks: [commit `29142660b8f5`](https://github.com/Belkazl/production-planner-ai/commit/29142660b8f5ca4dc534a2953850acfe3f74fa4f) (test-only additions beyond the deployed SHA).
- User explicitly confirmed: “ок теперь этот боевой считаем эталонным.”

## Change control

The canonical reference is the **exact deployed commit** `1a6d4ae9ffb6978e064830c0aafd3ec92bb3422c` and its dedicated `etalon/` branch. This record updates release documentation on `main` **only**; it does not merge the live release into `main`, change the Railway service, or write to production data.

Start the next feature from this snapshot into a **new branch**, test against isolated/read-only fixtures and a staging copy first, and deploy only after passing browser and regression checks. Keep this snapshot and earlier etalons available for rollback.

**Important:** this is a source-code/deployment reference. It is **not** a backup of production database contents, projects or saved plans.

## Previous accepted baseline

[13 October 2026 — protected Documents + restart optimizer](https://github.com/Belkazl/production-planner-ai/tree/etalon/production-2026-10-13-documents-and-fresh-optimizer); earlier current-etalon record retained in Git history.
