# LiftOrbit isolated Python GA — Railway QA report (2026-11-03)

This report records test evidence and **does not declare production cutover**.

## Isolated QA deployments
- Python worker `liftorbit-full-ga-isolation-qa-20261103`, pinned to `a2e32e70b8b6a7b338e25647b14c20632674d358`, status **SUCCESS**. Runs the version-verified privately assembled production GA, with its own OS process for every user optimization.
- Bun application `liftorbit-python-ga-app-qa-20261103`, pinned to the same SHA, status **SUCCESS**, `PP_PY_GA_WORKERS_ENABLED=1`.
- Both QA services use Railway private networking and have **no public domains**.
- Existing production app at `app.liftorbit.app` stays pinned to `6c575b658a06eccb9a03d537bcb69436a1f721b5`, status **SUCCESS**. Existing `production-planner-gateway` also stays **SUCCESS**.

## Railway black-box tests
1. Real single-user Python optimizer plan: completed and valid; material deliveries respected and one 15-minute setup honored.
2. Internal worker endpoints: health 200; absent bearer rejected 401; a different authenticated account rejected 403 for the first user's job.
3. Ten simultaneous account submissions with worker process capacity 4: all **10/10 completed**, peak 4, account operations owned, active workers returned to zero.
4. Python HTTP accept backlog enlarged to 128 to avoid connection reset under burst.
5. Ten simultaneous accounts with worker process capacity **10**: all **10/10 completed**, peak 10, active workers 0, material and setup checks passed; no `ECONNRESET`. The old test runner logged a fail solely because its previous assertion expected peak <=4. This is a stale *test threshold*, not a failed optimization.
6. Bun QA deployment: build succeeded; Python-upstream JavaScript test suite **8/8 passing**; server reached **SUCCESS**.
7. HTTP smoke against the Bun QA service through Railway private networking: `/__bridge_health` 200; `/api/model` 401; `/api/plan` 401; `/api/plan-progress` 401 for unauthenticated requests.

## Additional local integration evidence
Eight local Python QA tests previously passed, including exact manual pin times, legal setup/material routing, continuation across distinct worker PIDs, model-hash mismatch refusal, forced stop of an active process, and tenant boundary checks. The separate follow-up *remote* control test is not yet complete and should not be counted as remote evidence.

## Not yet proven
- Full signed-in application flow from account model to Python worker and back through the Bun bridge.
- Manual locks, cross-process continuation, and cancellation over the actual Bun-to-Python path, not only local adapter tests.
- Heavy-load performance and sensible memory/CPU limits at 10 optimizer processes on one 8-vCPU Railway worker; burst pass used small synthetic plans.
- Durable per-account optimization state across server restarts/multiple replicas.
- Rollback validation and monitored production rollout.

## Security
Legacy GA source and source-patch variables are sourced from Railway references, **not committed in GitHub**. No production DB credentials or AI API secrets were intentionally added to the QA service or this report. Previously exported AI API keys need rotation by the account owner.
