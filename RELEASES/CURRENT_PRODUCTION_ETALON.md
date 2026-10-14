# Current production etalon

**Current user-approved live release:** 13 October 2026 — protected planner with Documents tab and restart-from-scratch optimization.

- **Exact deployed source commit:** `80bcc7b3a45511af3bb8db2ffbef41e56c638a4a`
- **Immutable snapshot branch:** [`etalon/production-2026-10-13-documents-and-fresh-optimizer`](https://github.com/Belkazl/production-planner-ai/tree/etalon/production-2026-10-13-documents-and-fresh-optimizer)
- **Source branch:** `release/2026-10-13-documents-and-fresh-optimizer`
- **Primary account/login URL:** https://production-planner-gateway-v2-production.up.railway.app/
- **Planner service URL:** https://aps-setup-bridge-candidate-v2-production.up.railway.app/
- **Railway production service:** `aps-setup-bridge-candidate-v2`, deployment `7ff94857-a778-4fc7-8298-9264d7be0d62` — SUCCESS, 2026-10-13 17:21 UTC
- **Railway protected gateway:** `prodplan-auth-integration-qa`, deployment `c39c0044-dcfe-463d-a67c-15a28068467c` — SUCCESS, 2026-10-13 17:20 UTC
- **User approval:** 2026-10-13, explicitly accepted the latest deployed version as the production reference.

## Included
- Existing production models, ceramic orders, setup intervals and Gantt views retained.
- Optimization progress and best intermediate plan; stop / continue / start again.
- Restart from scratch resets previous optimization metrics and initial plan, then selects the best plan from the first run as baseline for subsequent improvement, using 240 generations.
- User-requested action buttons placed in the Documents tab.
- Protected authenticated planner entrance.

## Safety and release discipline
This document updates the canonical release pointer; it **does not mean** `main` contains the deployed release source. That exact source is saved in the dedicated `etalon/` branch and deployed on Railway. The PR opened to sync code to `main` (#12) is non-mergeable without conflict resolution and must not be force-merged or used to overwrite existing release documentation.

Do not change deployed source, database, stored models, saved plans, authentication or Railway routing merely to capture the reference. Start any new features from the exact snapshot branch on a separate working branch, QA before promotion. Preserve every older baseline for rollback.

## Previous reference
[Production etalon — order volume and compact cards, 13 October 2026](./PRODUCTION_ETALON_2026-10-13_ORDER_VOLUME.md) — commit `a4162eee165fa99105880bfe2545a3f4fe36a30d`, branch `etalon/production-2026-10-13-order-volume`.
