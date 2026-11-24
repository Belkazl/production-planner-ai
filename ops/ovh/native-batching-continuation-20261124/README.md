# Compact native continuation bridge

This staged source patch preserves a worker-produced compact `resume_state`
through the authenticated account bridge. It does not add batch search or
define the native batch genome. The Python worker must validate and restore
the confirmed native schema before this can provide joint continuation.

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

## Local verification

```sh
node --test ops/ovh/native-batching-continuation-20261124/test.mjs
```

Optional current-source preflight uses `LIFTORBIT_NATIVE_CONTINUATION_FIXTURE_ROOT`
to locate an already available staged `python-ga-upstream.mjs`; tests do not
fetch sources or connect to a service.

## Staged patch invocation

```sh
node ops/ovh/native-batching-continuation-20261124/patch.mjs STAGED_APP_ROOT
node --check STAGED_APP_ROOT/python-ga-upstream.mjs
```

Only the staged bridge file is changed. Exact Nov19 continuation anchors,
authentication/account scope markers and installed-source idempotence are
required. No workflow or deployment is included.
