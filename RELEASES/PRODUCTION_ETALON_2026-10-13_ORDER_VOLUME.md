# Production baseline — 2026-10-13: universal output volume + collapsed parameters

## Approved production source

- **Approved source commit:** `a4162eee165fa99105880bfe2545a3f4fe36a30d`
- **Pinned snapshot branch:** `etalon/production-2026-10-13-order-volume`
- **GitHub main merged feature PR:** #4, merge commit `d740cfa6bcce92fc9d505d1acce61250674723bc`.
- **Railway project:** `ProdPlan AI - Setup Bridge` (`69283d25-0397-4097-8b67-4e182977d0e0`)
- **Railway production environment:** `d09e0202-b39d-4111-864f-849feaf0a179`
- **Railway service:** `aps-setup-bridge-candidate-v2` (`6e5f7005-19a1-4da1-a0db-2fd216d30ccd`)
- **Approved production URL:** https://aps-setup-bridge-candidate-v2-production.up.railway.app/
- **Successful production deployment:** `7ba7a1ca-0dd7-4d9f-a9a6-56122f55d5dc`, status `SUCCESS`.

## User-confirmed features

1. Order cards use three-column inputs for order number, output volume, and technological process.
2. The column is labelled **Объём выпуска**, without assuming square metres or any fixed unit.
3. Production parameters sit **below** the main three order fields in a full-width accordion, **collapsed by default**, with the current parameter count.
4. Expanded parameters retain the original editable inputs and add/delete controls; model serialization and storage APIs are unchanged.
5. The earlier approved equipment, employee, material and order Gantt charts, setup blocks, per-operation details dialogs, GA progress by completed/240 iterations, optimization stop, best intermediate plan selection, and optimization-button reset remain present.

## QA and storage safety

- Chrome QA browser tested all 12 ceramic orders, parameters expanded/collapsed, edit persistence across toggling, dynamic add/remove without saving, and the `Объём выпуска` label in the live test release.
- Browser QA reported `modelWrites: 0`; no test changes were submitted to the model import API.
- Exact approved SHA was deployed to production and Railway reported `SUCCESS`.
- The production source deployment did not intentionally update orders, database contents, production models or saved plans.

## Rollback reference

Prior approved source at `etalon/production-2026-10-13-gantt-details`, commit `2d4e66263ec879795a22278ecd322181c2d75a17`, Railway deployment `82b8458d-456f-4fbe-8cd6-830f8a63d64e`.

Restore prior version by reconnecting `aps-setup-bridge-candidate-v2` to `Belkazl/production-planner-ai`, branch `etalon/production-2026-10-13-gantt-details`, commit `2d4e66263ec879795a22278ecd322181c2d75a17`, then confirm Railway reports `SUCCESS`.

## Future work

Do not modify this baseline branch. Build subsequent UI and scheduler changes on new feature branches and test in the QA service before promoting the exact user-approved SHA. The old URL https://aps-setup-bridge-production.up.railway.app/ belongs to a different service and is not this canonical release.
