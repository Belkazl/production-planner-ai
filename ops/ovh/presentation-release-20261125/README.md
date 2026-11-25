# Bounded presentation release

This package appends the secondary Gantt zoom installer, then the resource
presentation installer, to `restart-optimizer-ui.js`. Every existing byte of that
file is preserved. The resource installer remains last so its independent
idempotence guard continues to work.

The baseline is the accepted integrated release deployed at
`3ffc6213168efee07ac1d592177d76fc7232d00f`. Its thirteen app hashes are taken from
the `app_after` receipt of verification run `45575872812`. The baseline UI hash is
`c0f5a35e82f2dc393a510d271beacc7af60997ce01b7f00dadbcb6d03d9fae84`.

## Scope and private acceptance

The write allowlist contains exactly one file: `restart-optimizer-ui.js`. The
other twelve captured app files, authentication runtime, all fifteen active
native modules and the selected native code inputs must retain their baseline
hashes. Build fixtures, optimizer code, saved plans, models, quantities, batch
partitions and database state are outside this release.

The existing ordinary `liftorbit-ci` SSH account reads a fixed allowlist of app
source files. Authentication contents never leave the host. The frozen native
input selector runs on the host and emits only worker hashes and the aggregate
code-input hash; native source/configuration contents are not transferred to CI.
Customer data and local DOM inspection fixtures are never CI inputs or artifacts.

The public Python/Node/Bun image is built before private capture. Actual-source
verification runs in a networkless container with an ordinary UID, read-only root
and input mounts, no capabilities, no new privileges and bounded resources.
Captured sources and logs remain private and are deleted. Only fixed labels,
booleans and hashes enter the receipt.

Acceptance requires:

- Both helpers' public synthetic tests and the mandatory synthetic runtime tests
  in this package, including fresh selected-result precedence and cache isolation.
- The actual captured UI matching its pinned baseline and the exact combined
  append, with idempotence and unchanged original bytes.
- The current captured Bun ownership/state tests passing without fixture edits.
- The frozen actual build verifier running `build-bridge.ts`, `feature-stop.ts`
  and Bun bundling, preserving native bypass, Stop guards and the abort signal.
- Exactly one changed captured file and unchanged inputs after all checks.

The frozen build verifier and its imports are pinned to the accepted integrated
receipt as well as included in the new public-source provenance. Existing
integrated packages are reused read-only.

## Deliberate release

Source/workflow publication starts verification only. No `release.json` is
provided before successful acceptance of the exact final candidate. The root
agent can construct it with `release_guard.marker_from_report()` after reviewing
the successful receipt and run.

The release guard requires the same repository, branch, exact candidate SHA,
successful verification workflow and single successful job. It binds every
public helper/workflow hash and the exact accepted before/after app hashes. The
only allowed difference from that candidate is the marker itself.

Staging reconstructs the exact accepted UI append privately, then rechecks every
app/native/auth hash on the host before and after installation. Remote writes
are restricted again by `deploy_contract.py` and `release.sh` to the single UI
file. Only the existing `liftorbit-ops smoke` and `update` operations use sudo;
there is no direct host Docker/systemd access or new privileged capability.

A per-run backup precedes installation. Failure restores the original UI,
rebuilds through the same helper and waits for service health while preserving
the original failure exit code. Success requires service smoke and public bridge
200/auth 401 responses. This package does not push, deploy or authorize itself.

## Local checks

```sh
bash -n ops/ovh/presentation-release-20261125/release.sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s ops/ovh/presentation-release-20261125 -p 'test_*.py'
node --test ops/ovh/presentation-release-20261125/test.mjs \
  ops/ovh/presentation-release-20261125/test-runtime.mjs \
  ops/ovh/resource-presentation-20261125/test.mjs
node ops/ovh/secondary-zoom-20261125/test.mjs
```

The actual-source test in `test.mjs` requires both private fixture root variables
set by the isolated gate. Local synthetic success cannot replace the required CI
receipt or the actual Bun build chain.
