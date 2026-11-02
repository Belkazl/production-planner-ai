# LiftOrbit Python GA — isolated process supervisor (integration stage)

The actual GA algorithm is not replaced. This service provides process isolation
for the **existing** Python optimizer once its trusted callable is wired through
`PP_PY_GA_ADAPTER=<trusted_module>:<run_function>` with signature
`run(payload: dict, progress: callable) -> dict`.

**Deployment status: prototype, not yet wired to production Python GA.**
The production Python engine is currently assembled from environment variables
on the existing Railway service. Its callable/source must be identified and
bound before any traffic is routed to this service.

## Behaviour

* Each accepted job launches its own Python OS process via `multiprocessing.spawn`.
* Up to `PP_PY_GA_MAX_PROCS` jobs (default 4) execute simultaneously.
* Extra jobs queue; a user cannot run two jobs at once.
* `POST /internal/jobs/<id>/cancel` terminates the process, not just the HTTP
  request. Results from terminated jobs cannot overwrite an existing result.
* Progress is sent over a parent-owned pipe; memory is per-process, so other
  users cannot access in-flight model state.
* Job status and results are **volatile**; PostgreSQL persistence/restart
  recovery is the separate next milestone.
* Only private service clients holding `PP_WORKER_INTERNAL_TOKEN` may invoke
  jobs, and they must supply an already verified `X-Authenticated-Account`.
  External clients should never know the token or the account header protocol.
* **Do not expose a public domain** on the Railway worker service.

## Required variables

* `PP_WORKER_INTERNAL_TOKEN`: random secret, 24+ characters, shared with the
  authenticated API server. Do not put it in the repo.
* `PP_PY_GA_ADAPTER`: trusted production module:function; a missing setting
  makes the service refuse to start.
* `PP_PY_GA_MAX_PROCS`: integer 1..32 (suggested starting value 4).
* `PP_PY_GA_TIMEOUT_S`: timeout for each job, suggested 600 seconds.
* `PP_WORKER_TEST=1`: allows `ga_workers.fixture:run`, **QA only**.

## API contract

* `POST /internal/jobs`: JSON `{model, ...ga_arguments}` -> 202 job status.
* `GET /internal/jobs/<id>`: progress/result (requires same authenticated account).
* `POST /internal/jobs/<id>/cancel`: stop exact child process.
* `GET /internal/metrics`: internal accounting (authorized).
* `GET /health`: readiness.

No production model or database is read from inside the worker by default; the
existing trusted backend must obtain the model using its own account-storage
boundary before submitting. Raw usernames or arbitrary client-supplied tenant
IDs must never be accepted as account identity.

## Test

`python -m unittest discover -s tests -v`

The fixture consumes CPU and emits order-scoped progress. Passing tests alone
does **not** prove integration with the original Python GA or its capacity,
materials and scheduling constraints.
