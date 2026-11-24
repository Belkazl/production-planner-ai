# Compact native joint continuation

The bridge preserves a worker-produced compact `resume_state` for the current
authenticated account and model. The paired Python module carries ordered
batch genes through a fresh worker. Search operators live in the adjacent
`joint-minibatch-search-20261124` module.

The current account's stored job must match the bridge's current model hash.
The state must have original SHA-256 model/pin fingerprints and an objective
matching the request. It is copied as opaque JSON, bounded to 64 KiB, 8,192
values and depth 16. Full schedule containers and non-JSON values are rejected.
Compact numeric `batches` fields remain allowed. Native schema versions and
other compact fields are preserved unchanged.

The bridge cannot recompute Python's fingerprint of its normalized model.
It deliberately does not compare that fingerprint with the bridge hash, or
replace it with current data. Python retains authority over the original
model/pin/schema checks. A separate order-only fallback carries no batch fields
and resets its score. Client-supplied native state is never promoted to trusted
server state. Fresh optimization requests remain unchanged.

The standalone Continue UI also sends the selected plan's compact ordered
partition as `resume_plan.batch_genome`. It contains no scores, fingerprints or
operation rows. The bridge normalizes it against current account order IDs and
quantities. A server native genome is used only if it matches the explicitly
selected order and partition. Another selection becomes a fresh unscored seed
that the Python worker validates against current capacities, units and pins.
Malformed explicit proposals fail before creating a job.

Stopped runs retain native state inside their server-verified full checkpoint.
The start route reads only that compact field; it does not walk hundreds of
operation rows. Stop responses still omit internal continuation state.

## Worker state, pins and previews

Version 2 retains the existing model/pin fingerprints, objective and counters,
and adds `joint_schema: "joint-minibatch-v1-20261124"` and `batch_genome`.
The genome has version 1, a complete `order_sequence`, and `partitions` in that
same order. Each partition is `{order_id, sizes}`. Sizes remain ordered and
must be positive finite numbers that sum to the current order quantity.
Bounds are 256 orders, 128 parts per order, 1,024 total parts and 64 KiB JSON.

The native installer supplies atomic `load_incumbent` and matched-result
`export_incumbent` callbacks. Import checks the model, objective, original pin
fingerprint and envelope before touching the real cache. Native validation
then checks unit precision, capacity and pinned batch identities. Scores are
always recomputed. Export requires the selected result to match a verified
native genome; an unrelated older checkpoint stays version 1.

Adding a lock to a real mixed batch changes the pin fingerprint. A separate
fresh-seed path may reuse the exact model/objective-bound partition under new
locks. It preserves the original envelope and hashes as provenance, resets
run/trial/fitness values, and requires the native loader to validate new pin
quantities before any seed write. The decoder then checks exact times,
resources, shifts and materials. A changed model or objective cannot use this
path. Explicit selected-partition proposals also receive fresh counters and
fitness, and never acquire trusted native hashes from client input.

The adapter suppresses previews during joint decoding and feasibility checks.
The first registered verified joint checkpoint may upgrade an equal-duration
v1 checkpoint without waiting for the best-preview throttle. A shorter earlier
checkpoint remains protected; normal throttling resumes after the v2 upgrade.

## Local verification

```sh
node --test ops/ovh/native-batching-continuation-20261124/test.mjs
node --test ops/ovh/native-batching-continuation-20261124/test_ui.mjs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s ops/ovh/native-batching-continuation-20261124 -p test_worker.py
```

Optional current-source preflight uses `LIFTORBIT_NATIVE_CONTINUATION_FIXTURE_ROOT`
to locate an already available staged `python-ga-upstream.mjs`; tests do not
fetch sources or connect to a service.
`LIFTORBIT_CONTINUATION_FIXTURE_ROOT` selects an already available current
`ga_workers` package, and `LIFTORBIT_SELECTED_GENOME_UI_FIXTURE` selects the
current standalone `restart-optimizer-ui.js`. Missing optional fixtures are
explicitly skipped. Deployment preflight supplies actual captured fixtures.

## Staged patch invocation

```sh
node ops/ovh/native-batching-continuation-20261124/patch.mjs STAGED_APP_ROOT
node --check STAGED_APP_ROOT/python-ga-upstream.mjs
node ops/ovh/native-batching-continuation-20261124/patch_ui.mjs INPUT_UI.js OUTPUT_UI.js
python3 ops/ovh/native-batching-continuation-20261124/patch_worker.py INPUT_ADAPTER.py OUTPUT_ADAPTER.py
```

Each command changes only its staged target. Exact continuation and preview
anchors, account scope markers and installed-source idempotence are required.
The deployment workflow is separate and requires complete native acceptance.
