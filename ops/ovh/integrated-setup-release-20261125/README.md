# Integrated native setup acceptance and release

This package verifies that the app preserves a feasible native schedule, including
setup rows, material availability, staff shifts, pins, metrics and continuation.
It leaves the native worker and its selected code inputs byte-identical.

## Private actual-source acceptance

The verification workflow reads an exact allowlist of thirteen app source files
using the existing ordinary CI account. It also records the hash of
`auth-runtime.js` without transferring its contents. Native input capture uses the
previously reviewed code-only selector; no customer models, orders, credentials
or database contents are test inputs.

The ephemeral runner builds a public Python/Node/Bun image before receiving the
private inputs. Verification then runs with no network, no capabilities, an
ordinary UID, read-only root and source mounts, and private temporary output.
Private source, fixture data and subprocess logs are deleted and never uploaded
as artifacts. Only fixed status codes, public source-anchor names, synthetic
aggregate checks and hashes enter the workflow log.

Acceptance requires all eleven existing native regressions, four additional
native setup/material/shift/pin cases, and whole-pipeline checks through the
captured upstream and APS handlers. The actual captured Bun ownership and state
tests run against the patched app. If their obsolete synthetic native-result
fixtures fail, the reviewed exact fixture replacement is applied and the same
assertions must pass. This is reflected explicitly in the acceptance receipt.

The captured `feature-stop.ts` and `stop-ui.js` are additional read-only build
inputs. A required private replay executes the actual `build-bridge.ts`, then
`feature-stop.ts`, then Bun bundling in an isolated temporary copy. It checks that
the native result bypass, abort signal and Stop guards survive that build chain.
All eight build-chain checks must pass alongside the native and app gates, and
neither build input belongs to the deployment write allowlist.

## Deliberate release

Publishing source or workflow changes only starts verification. Production is
changed only when the root agent deliberately updates this package's
`release.json` after the final exact candidate succeeds. No marker is supplied in
this package before acceptance. `release_guard.marker_from_report()` constructs
the marker from the safe accepted receipt, the exact candidate commit and its
successful verification run.

The release guard requires the same repository, feature branch, workflow,
candidate SHA, single successful job, public helper hashes and accepted source
hashes. The only difference from the accepted candidate may be `release.json`.
Capture-only and incomplete reports cannot authorize deployment.

Release recreates and checks the exact accepted app bytes privately. It writes
only `python-ga-upstream.mjs`, the APS baseline `index.ts`, and
`restart-optimizer-ui.js`; the two captured test fixtures are additionally written
only when the accepted before/after build gate proved their update necessary.
All other captured sources, `auth-runtime.js`, every active native module and
selected native code inputs are checked before and after deployment.

The host uses only the existing `liftorbit-ops smoke` and `update` operations.
Every writable source has a per-run backup before installation. Failure restores
the files, rebuilds through the same helper and waits for startup health while
preserving the original failure exit code. Successful release requires the
six-service smoke check and the existing public bridge 200/auth 401 responses.
No worker mutation, database operation, direct host Docker access or new service
endpoint is part of this release.

## Local pure checks

```sh
bash -n ops/ovh/integrated-setup-release-20261125/release.sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s ops/ovh/integrated-setup-release-20261125 -p 'test_*.py'
```

These tests validate bounded private transport, safe failure formatting, exact
receipt/manifest rejection and rollback using local stub services. They do not
execute the native engine or touch infrastructure; the actual isolated acceptance
workflow is required before a release marker can be created.
