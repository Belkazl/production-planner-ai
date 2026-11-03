# LiftOrbit — repeated final QA, 2026-11-03

**Result: repeated isolated Python GA engine and internal Railway HTTP API checks passed. Production was not switched over.**

## Code provenance
- Private restored Python GA checksum: `c952f5aefcc356d9fa126c4728259918ab9e365d0b38ff09156c59c083578b4f`; reconstructed at QA worker startup from Railway variable references, not stored in this public repository.
- QA Python worker source commit: `2d01c66e4e7bf9679a1118bf86c04b0d5b20b0b6`.
- QA Bun app source commit: `a2e32e70b8b6a7b338e25647b14c20632674d358`.
- Regression runner: `ga_python_workers/qa_runner/run.mjs`, private Railway networking only.

## Defect discovered and fixed
When ten jobs completed nearly simultaneously, `manager.get()` could report `completed` before the child process had been reaped and its slot decremented. Updated `ga_workers/manager.py` to atomically finalize a job only after the OS process slot is released. Added a test that delays worker termination to expose the race deterministically.

## Local execution after the fix
Three fresh invocations of the Python test suite **9 / 9**, **9 / 9**, **9 / 9**: **27 / 27 passed**. Includes materials, 15-minute setup, pinned operation exact time/resources, resume in different Python OS process, stale model refusal, tenant boundaries, process cancellation, concurrency, and terminal-state cleanup race.

Additional Python process stress: **three separate sets of ten accounts** (2, 4, 6 orders per account); **30 / 30 jobs completed**, ten distinct PIDs per set, maximum active processes 10, zero active slots after each set.

## Railway black-box regression
Deployment `fe925842-1e64-44f0-b54d-a8301eb269b3` of `liftorbit-ga-final-runner-v4` logged `LIFTORBIT_FINAL_MULTIQA_PASS` after all tests.

| Round | Accounts finished | Orders/account | Generations | Population | Peak workers | Worker slots left |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 10/10 | 2 | 12 | 12 | 10 | 0 |
| 2 | 10/10 | 4 | 20 | 20 | 10 | 0 |
| 3 | 10/10 | 6 | 30 | 25 | 10 | 0 |

Every result remained bound to its own account. Each round also validated material-delivery timing, setup operations, ten distinct OS PIDs, and portable resume state.

**Three repeated control passes** all succeeded: a manually locked operation preserved its exact start/end, a new process continued optimization with a non-worsening result, the algorithm rejected continuation after the order model was changed, a long optimization was cancelled and its process slot freed, and the same account successfully started a new calculation after cancellation.

**Authorization checks**: a request without worker token was rejected (401), attempting to read/cancel another account's task was rejected (403). In the separate QA Bun app, `/__bridge_health` returned 200; unauthenticated `/api/model`, `/api/plan`, and `/api/plan-progress` all returned 401.

**Railway state after tests**: QA Python worker `SUCCESS`, QA Bun app `SUCCESS`; real production app remains at commit `6c575b658a06eccb9a03d537bcb69436a1f721b5` and `SUCCESS`, and original production gateway remains `SUCCESS`.

## Deployment blockers: NOT YET PROVEN
1. Full signed-in browser/account-to-Bun-to-Python-to-plan path with real account session and persistence; no test account was available for this check.
2. Sustained heavy models with hundreds of orders and 10 simultaneous optimizers, realistic CPU/memory budgets, latency SLOs, and failure/restart durability. The synthetic maximum here was six orders per account.
3. Durable job progress and incumbent storage across application restarts and multiple replicas. The current JS upstream adapter tracks sessions in memory.
4. Monitored opt-in production rollout and rollback rehearsal.

**This report is a GO for moving from engine QA to authenticated end-to-end acceptance, not an approval to switch the production feature flag on.** API tokens exposed in earlier exports should be rotated by the account owner.
