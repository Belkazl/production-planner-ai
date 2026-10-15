# Current production etalon

**Current user-approved production baseline: 15 October 2026 — Ceramic demo materials (with English default and Russian switch).**

- **Production application source:** `1a6d4ae9ffb6978e064830c0aafd3ec92bb3422c`.
- **Pinned source-code branch:** [`etalon/production-2026-10-15-ceramic-materials`](https://github.com/Belkazl/production-planner-ai/tree/etalon/production-2026-10-15-ceramic-materials).
- **Live site:** https://production-planner-gateway-v2-production.up.railway.app/
- **Railway deployment:** `d9f17da8-0979-4d2c-a7b8-f742ffbf4be7` — **SUCCESS**.
- **Exact production project-data snapshot:** `pp_production_etalon_snapshots` row `production-2026-10-15-ceramic-materials-v1`.
- **Data snapshot SHA-256:** `27b200c93c39eb2f7830c82171e2d9dbb1d169ea70dfcb7307eb95aacef79d99`.
- **Snapshot created:** `2026-10-15T05:48:31.820Z`.
- **Verified project:** «Керамика» revision 52, 12 orders, 6 materials, 6 consumption rules, 8 setup rules, **6 saved plans**, an existing current plan.
- **Unchanged application code:** Same deployed source commit as 14 October 2026; this newer etalon captures the **additional data state** approved by the user.

See the [complete release and recovery record](./PRODUCTION_ETALON_2026-10-15_CERAMIC_MATERIALS.md).

## Preservation and recovery

The `etalon/` branch freezes the deployed **source code**. The PostgreSQL snapshot table freezes the project's **stored models and plans**. These are two separate artifacts: a Git branch by itself does **not** back up active production data.

The snapshot is inside production Postgres, not an independent off-site database backup. Retain past etalons, never rewrite snapshots, and do not overwrite newer customer changes during recovery. Future development and optimization adjustments should be made in separate branches with regression and visual checks.

## Earlier baselines

- [14 October 2026 — Initial English-default/Russian-switch production etalon](./PRODUCTION_ETALON_2026-10-14_LANGUAGES.md).
- [14 October 2026 — Ceramic materials added, previous state backed up](./PRODUCTION_CERAMIC_MATERIALS_2026-10-14.md).
- [13 October 2026 — Protected Documents and restart optimization](https://github.com/Belkazl/production-planner-ai/tree/etalon/production-2026-10-13-documents-and-fresh-optimizer).
