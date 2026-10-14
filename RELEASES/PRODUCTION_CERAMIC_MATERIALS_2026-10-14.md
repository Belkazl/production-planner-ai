# Production ceramic demo materials — 14 October 2026

## Status
**Applied and independently read back from the authenticated production database.** This is a **data-only** change. The app source / accepted production code etalon remains `1a6d4ae9ffb6978e064830c0aafd3ec92bb3422c` (14 October EN-default/RU switch). The Railway app service has not been redeployed for this data update.

## Scope
- Project **Керамика**, project revision **51 → 52**, 12 original orders (**23,100 m²**); 8 setup rules, existing machines/staff/order data unchanged.
- Six new materials, one replenishment per material, with material requirements attached to the relevant production operation using `consumption_rule=per_m2`.
- The separate project **Покраска** is byte-for-byte unchanged in the original project array.
- **Five saved plans, history, and messages preserved.** The previous **active** Gantt plan was invalidated (`lastPlan=null`) because it had been computed without material constraints. Rebuild the current plan in the UI before checking production-material Gantt correctness.

| Material | Per m² | Opening stock | Planned receipt | Consuming operation |
| --- | ---: | ---: | ---: | --- |
| Porcelain stoneware body powder | 18.50 kg | 185,000 kg | 265,000 kg, Oct 7 | Pressing |
| Engobe | 0.55 kg | 8,000 kg | 6,000 kg, Oct 8 | Glazing |
| Base glaze | 0.65 kg | 9,000 kg | 7,500 kg, Oct 7 | Glazing |
| Digital ink | 0.04 kg | 400 kg | 600 kg, Oct 8 | Digital decoration |
| Tile cartons | 0.70 pcs | 10,000 pcs | 8,000 pcs, Oct 7 | Packaging |
| Pallets | 0.02 pcs | 250 pcs | 250 pcs, Oct 8 | Packaging |

Dates are in October **2026**; the original model starts on 5 October 2026. Rates and receipts are **demonstration assumptions**, not production measurements.

## Backup and rollback
- A transaction created **`pp_ceramic_materials_backup_20261014`** with the complete original `prodplan.projects.v2` string, original active plan, and source checksum. The backup is in the *same Postgres database*, not in this GitHub repository.
- Pre-change SHA256: `3774a5f2fec826e8a5d720defb8de9ca5d12df3e318585ff97f4eecabb3c8dde`.
- Post-change SHA256: `85bb111922e346fdeae945db7afc822bf9bff58c8d7439ad1f3274b3586fae24`.
- The migration used explicit project ID and revision guards, exact pre-change checksum matching, atomic `UPDATE ... WHERE old_storage = expected` and in-transaction checks. It did not update other table rows.
- Rollback should restore the backup only after inspecting subsequent customer changes. **Never overwrite newer orders, project revisions, or saved plans blindly.**

## Verification evidence
- Read-only dry run: [ops commit `90bb949`](https://github.com/Belkazl/production-planner-ai/commit/90bb94942614acaa88b89f62ca7854e4540f910c) passed, with no writes.
- Transactional migration: [ops commit `a638109`](https://github.com/Belkazl/production-planner-ai/commit/a6381091a9105b5cee8ba6b210e576968ba20dd3), Railway one-shot deployment `99c50b89-d120-4191-8e54-da34bd224ca3`, status **SUCCESS**, `mode=applied`.
- Independent post-commit readback: [ops commit `b24e139`](https://github.com/Belkazl/production-planner-ai/commit/b24e1397167752b6066c7c552b8bf702b50bd310), Railway one-shot deployment `d220bbe8-3a6b-4f63-8181-5e1117db90d5`, status **SUCCESS**, event `PP_CERAMIC_MATERIALS_PRODUCTION_VERIFIED`, with all 12 orders, six materials/rules, backup integrity and unchanged other project and saved plans.
- Previous isolated visual QA checked material editor and supply/consumption Gantt. **A new full GA optimization on the updated authenticated production data has not been independently run.** The user can now create a new plan and inspect the Gantt.

Canonical authenticated app: https://production-planner-gateway-v2-production.up.railway.app/
