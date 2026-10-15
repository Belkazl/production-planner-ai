# Production etalon — 15 October 2026 — Ceramic materials and current planning state

**Status:** User-approved new **production reference**, confirmed after viewing the live Materials editor on 15 October 2026.

This replaces the earlier *current* baseline as the approved reference, but the earlier baselines remain available. **No application code was changed or redeployed while creating this etalon.**

## Exact application build

- **Production source commit:** `1a6d4ae9ffb6978e064830c0aafd3ec92bb3422c`.
- **Pinned code reference branch:** [`etalon/production-2026-10-15-ceramic-materials`](https://github.com/Belkazl/production-planner-ai/tree/etalon/production-2026-10-15-ceramic-materials).
- **Production Railway deployment:** `d9f17da8-0979-4d2c-a7b8-f742ffbf4be7` — status **SUCCESS**.
- **Canonical live website:** https://production-planner-gateway-v2-production.up.railway.app/
- **Railway project:** `16a27a18-a727-4a65-b75d-4368159b0e3e`.
- **Railway environment:** `675f0be6-40d5-4177-a273-c561f5c963e7` (production).
- **Railway authenticated service:** `2bf88ff3-774c-474f-a102-981452c23abd`.
- This source commit is intentionally identical to the previously accepted 14 October English-default/Russian-switch build. The difference in this etalon is the **stored model data**.

## Immutable data snapshot

The **actual live authenticated tenant project data** (not a public demo fixture) was stored in a separate PostgreSQL snapshot table.

- **Snapshot name:** `production-2026-10-15-ceramic-materials-v1`.
- **Table:** `pp_production_etalon_snapshots` in the production Postgres database.
- **Snapshot captured:** `2026-10-15T05:48:31.820Z`.
- **Saved payload:** complete `prodplan.projects.v2` string containing both projects, including models, history, saved plans, and the active plan, plus the active project ID and exact source-code commit.
- **SHA-256 of saved payload:** `27b200c93c39eb2f7830c82171e2d9dbb1d169ea70dfcb7307eb95aacef79d99`.
- **Project:** `Керамика`; project revision **52**.
- **Verified model:** 12 ceramic orders (23,100 m²), six materials, six `per_m2` material requirements, eight setup rules, six saved plans, and an existing active plan.
- **Other project:** `Покраска` included in the recovery snapshot and not modified by the snapshot operation.
- **Snapshot operation:** created immutable table row and verified hash and readback transactionally; it **did not update any active project model, orders, saved plans, or optimizer data**.
- **Railway snapshot job:** `5461382d-ee3f-4407-bfbd-8f8a4cfc9710`, status **SUCCESS**, event `PP_CERAMIC_20261015_ETALON_SNAPSHOT_SAVED`.

**Important recovery limitation:** The data snapshot is stored **inside the same production database**, not in an external backup service. It is a copy of the app's project-storage record, not a full PostgreSQL backup of every database table or a guarantee against loss of the database itself. Do not publish the raw snapshot to a public repository.

## Materials now included

| Material | Unit | Quantity per m² | Initial stock | Scheduled delivery | Consuming operation |
| --- | --- | ---: | ---: | ---: | --- |
| Press body powder | kg | 18.50 | 185,000 | 265,000 — 7 Oct 2026, 08:00 | Pressing |
| Engobe | kg | 0.55 | 8,000 | 6,000 — 8 Oct 2026, 09:00 | Glazing |
| Base glaze | kg | 0.65 | 9,000 | 7,500 — 7 Oct 2026, 09:00 | Glazing |
| Digital printing ink | kg | 0.04 | 400 | 600 — 8 Oct 2026, 09:00 | Digital printing |
| Tile cartons | pcs | 0.70 | 10,000 | 8,000 — 7 Oct 2026, 08:00 | Packaging |
| Pallets | pcs | 0.02 | 250 | 250 — 8 Oct 2026, 08:00 | Packaging |

These are illustrative demo quantities, not verified real-world production norms.

## Acceptance and verification

- The user viewed the live production material table and accepted it as the new **боевой эталон**.
- The exact code/deployment SHA was read back from Railway.
- The data snapshot script verified project ID, revision, orders, material IDs/rates/stocks, setup rules and saved plans before writing the snapshot record.
- The snapshot record was immediately read back and cryptographically compared with the live project's storage before the transaction completed.
- **Scope of accepted state:** user-visible materials plus the currently running build. Do **not** infer that every optimizer regression was re-run or that dates/UI labels were changed during this snapshot.
- Earlier ceramic import and pre-change backup remain documented in [the 14 October material migration record](./PRODUCTION_CERAMIC_MATERIALS_2026-10-14.md).
- Previous production-code etalon remains at [14 October English-default/Russian-switch](https://github.com/Belkazl/production-planner-ai/tree/etalon/production-2026-10-14-english-default-ru-switch).

## Future change controls

Use the **exact pinned code commit** and **immutable project storage snapshot** to reproduce this reference version. Develop changes in separate branches, test and visually verify them in a separate environment before release. Never blindly restore the snapshot over newer legitimate project edits or saved plans; first compare revisions and preserve newer data.
