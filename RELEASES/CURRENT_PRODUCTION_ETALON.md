# Current production etalon

**Current user-approved live reference:** **14 October 2026 — English by default, Russian language switch** on the authenticated ProdPlan AI application.

- **Exact deployed source commit:** `1a6d4ae9ffb6978e064830c0aafd3ec92bb3422c`.
- **Dedicated source snapshot:** [`etalon/production-2026-10-14-english-default-ru-switch`](https://github.com/Belkazl/production-planner-ai/tree/etalon/production-2026-10-14-english-default-ru-switch).
- **Canonical production website:** https://production-planner-gateway-v2-production.up.railway.app/
- **Railway project/service:** Production Planner AI / `prodplan-auth-integration-qa` (`2bf88ff3-774c-474f-a102-981452c23abd`).
- **Deployment:** `d9f17da8-0979-4d2c-a7b8-f742ffbf4be7` — **SUCCESS** (14 October 2026).
- **Verification:** 13/13 GitHub checks passed, plus public production browser validation of EN default / RU switch / persistence / login.
- **User approval:** 14 October 2026, explicitly selected the current live version as the new production reference.

See the full [14 October 2026 production etalon release record](./PRODUCTION_ETALON_2026-10-14_LANGUAGES.md).

## Change-control rules

The exact deployed source commit and `etalon/` branch are the rollback reference. Do **not** assume that the `main` branch contains the live release; the production service is sourced independently. New changes require a separate development branch, passing CI and browser QA, then an explicit production promotion. Saving this release pointer must not modify the production service, database, authenticated accounts, models, orders, saved plans or Gantt.

The snapshot covers **code only**, not a copy of production project data or database.

## Previous user-approved reference

13 October 2026 — protected Documents tab and restart optimization:
[original etalon snapshot](https://github.com/Belkazl/production-planner-ai/tree/etalon/production-2026-10-13-documents-and-fresh-optimizer). Older etalons remain untouched.
