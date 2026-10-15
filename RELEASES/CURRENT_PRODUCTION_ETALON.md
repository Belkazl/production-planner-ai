# Current production etalon

## Current user-approved live code: LiftOrbit, 15 October 2026

**Production reference confirmed by user after the post-login blank-screen correction.** This supersedes the *code* pointer below; historical snapshots remain preserved.

- **Pinned code commit:** `31f017538dddaff9b61d5a866a6b651de5921eb7`.
- **Exact frozen source:** [`etalon/production-2026-10-15-liftorbit-postlogin-fixed`](https://github.com/Belkazl/production-planner-ai/tree/etalon/production-2026-10-15-liftorbit-postlogin-fixed).
- **Successful Railway deployment:** `a93ad7a6-c150-44cb-836b-d292eeb0979e` (service `prodplan-auth-integration-qa` in Railway, actual LiftOrbit production planner).
- **Live planner:** https://production-planner-gateway-v2-production.up.railway.app/
- **Landing etalon (separate service, unchanged):** [`release/liftorbit-etalon-2026-10-15-landing`](https://github.com/Belkazl/production-planner-ai/tree/release/liftorbit-etalon-2026-10-15-landing) at commit `81234b134d6b4e927ea53217062d3fcbb952ab11`.
- **Full acceptance, source, test and recovery record:** [PRODUCTION_ETALON_2026-10-15_LIFTORBIT_POSTLOGIN.md](./PRODUCTION_ETALON_2026-10-15_LIFTORBIT_POSTLOGIN.md).

**Important data note:** This newly approved LiftOrbit *code* snapshot did **not** make a new PostgreSQL or browser-data snapshot. The last recorded separate database snapshot is still `production-2026-10-15-ceramic-materials-v1`; it is historical and must not overwrite newer live projects. Preserve live data when deploying/recovering the pinned source. The earlier `release/liftorbit-etalon-2026-10-15-planner` (commit `6370d817...`) predates the authenticated white-screen fix and is **not** the current accepted etalon.

## Earlier production etalons (historical records, not the active source pointer)

## Live working update after the approved snapshot

**15 October 2026:** English UI completion has now been deployed to the live site at commit `ca03b6129d704f155e4007839c6af17eb9123f57` (Railway deployment `eb661751-8cf9-4c08-8f5c-4a7a9f5f644b`, **SUCCESS**). It passed independent protected and production-anonymous browser checks.

**The last user-approved rollback etalon remains the materials snapshot below** (code `1a6d4ae9ffb6978e064830c0aafd3ec92bb3422c`, Postgres snapshot `production-2026-10-15-ceramic-materials-v1`). The new live language-only patch has **not yet been explicitly accepted as a new etalon**. See the [production UI translation audit release record](./PRODUCTION_UI_TRANSLATION_AUDIT_2026-10-15.md).

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
