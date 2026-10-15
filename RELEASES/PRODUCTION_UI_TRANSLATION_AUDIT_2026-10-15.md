# Production UI translation audit — 15 October 2026

## Live release and rollback

- **New live source code commit:** `ca03b6129d704f155e4007839c6af17eb9123f57`.
- **Pinned working release branch:** [`release/2026-10-15-complete-english-ui`](https://github.com/Belkazl/production-planner-ai/tree/release/2026-10-15-complete-english-ui).
- **Production Railway deployment:** `eb661751-8cf9-4c08-8f5c-4a7a9f5f644b`, status **SUCCESS**.
- **Canonical site:** https://production-planner-gateway-v2-production.up.railway.app/
- **Previous user-approved etalon source commit:** `1a6d4ae9ffb6978e064830c0aafd3ec92bb3422c`.
- **Previous etalon code branch:** [`etalon/production-2026-10-15-ceramic-materials`](https://github.com/Belkazl/production-planner-ai/tree/etalon/production-2026-10-15-ceramic-materials).
- **Previous etalon data snapshot:** `pp_production_etalon_snapshots` / `production-2026-10-15-ceramic-materials-v1`.
- This patch is a new **working production release**. Do not call it a new user-approved *etalon* until the user accepts it. The previously approved code and data snapshot were preserved.

## What changed

Only `language-ui.js` differs in live runtime sources relative to the approved code etalon; all other additions are read-only QA browser tests and workflows. No changes were made to authentication, GA optimizer, saved plans, project data APIs, setup processing, machine assignment, or material quantities and requirements.

Fixed English UI copy including:

- Key metric delta labels (e.g. `−39 мин (−0.9%)` → `−39 min (−0.9%)`; full duration `4338 минут` → `4338 minutes`; cycle count).
- Equipment setup rules description, the column heading `Сотрудник`, and help text.
- The black setup-block legend, number of operations/setups, Gantt zoom summary and axis labels.
- Setup detail dialog: generated operation label `Переналадка: Формат пресса` → `Setup: Press format`, and Esc/outside-click hint.
- Real materials Gantt titles, shipments, consumption, event tooltips and popups.
- Dynamic GA validation text, saved-plan display status and completed-run messages.
- Locale switch accessibility labels now reflect the selected language.

The UI-only translation never rewrites underlying equipment, product, staff, process, material or other free-form model values. Thus user-entered names can legitimately remain in Russian while English UI mode is selected.

## QA evidence

- [Full protected browser interface audit and regression run](https://github.com/Belkazl/production-planner-ai/actions/runs/38691055670): **SUCCESS**. Tests cover EN/RU selection and persistence, generated metric strings, Equipment and Materials editor, real material Gantt and event dialog, Orders, staff, settings, Documents, Gantt setup details, and restart-after-stop optimization without model writes.
- [Published staging smoke test](https://github.com/Belkazl/production-planner-ai/actions/runs/38691055679): **SUCCESS**, independently re-run after staging was pinned to the release commit.
- Staging Railway source commit `ca03b6129d704f155e4007839c6af17eb9123f57`, deployment `e956faca-fea8-4f0a-ab74-f29449577c59`: **SUCCESS**.
- [Real deployed production localization smoke test](https://github.com/Belkazl/production-planner-ai/actions/runs/38691676140): **SUCCESS**, case `PP_I18N_PRODUCTION_DEPLOYED_PASS`. Checks EN default, RU switch, persistence, eight dynamic sample strings from the defects, anonymous access denied, and zero browser errors.
- Production Railway source commit matches `ca03b6129d704f155e4007839c6af17eb9123f57`; deployment `eb661751-8cf9-4c08-8f5c-4a7a9f5f644b` returned `SUCCESS`.
- No business account or authenticated production model data was read or written by the production browser smoke test.

## Change-control note

The last accepted ceramic material etalon remains pinned to `1a6d4ae9ffb6978e064830c0aafd3ec92bb3422c` with its PostgreSQL data snapshot. Code can be rolled back by redeploying that exact commit, but **do not blindly restore the old database snapshot over newer legitimate project edits**. This release contains only UI strings and does not modify database contents.
