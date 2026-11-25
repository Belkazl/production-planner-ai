# Gantt label and native preview presentation release

The native engine already preserves its actual zoom and timeline width when
switching employee/order tabs. A legacy rendering pass resets the visible label
to 100%. This release installs a small presentation observer that reads the
existing native engine's current zoom and keeps the label consistent with it.
It does not rescale the timeline, replace controls, reset scroll, render another
plan, recalculate utilization, or change the optimizer.

The same UI update fixes two independently reproduced preview defects. Two
retired polling readers could replay their old cached candidate over the best
plan controlled by SSE. During an active SSE run, only those exact unscoped
legacy reads receive an HTTP-successful non-plan status; native job-scoped,
forced, reconnect, Stop and completion reads keep their existing behavior.
Separately, an old server compactor removes the duplicate `generic_operations`
array even though the native presentation checksum covers it. An outer fetch
wrapper reconstructs that absent alias only when the unchanged original
checksum validates the reconstructed plan. It never changes rows, numbers,
stamps, continuation, account identity, queries, or explicitly conflicting
arrays, and never creates a new request or cache.

## Exact boundary

Only `restart-optimizer-ui.js` may change. The exact retired-reader branch is
inserted inside the existing SSE fetch controller; all bytes outside that
single wrapper remain intact. The label and then checksum-bound alias installers
are inserted immediately **before** the exact frozen resource-presentation
suffix. The latter fetch wrapper therefore runs after the existing controller.
The resource helper's end-of-file contract survives. The patch requires the
known deployed UI SHA, syntax validity, exact reversal of all three changes,
and idempotence. The release wrapper independently binds that SHA to its baseline.

The baseline combines the successfully deployed presentation release
(`c9691e7bb17fcb91f387a8bc8fcad37e81933d03`) with the subsequently deployed
native-diversity release (`9d6c068e3c6ef930abde9ad84272211989fef913`). In particular,
the active `joint_minibatch.py` must remain at
`08a3fd9d556fecb726c69ce7632851c2117f0e753c16edac183361e632afe253`.
All thirteen captured app inputs except the one UI target, `auth-runtime.js`,
every captured Python worker module, and the native selected-code digest are
protected by exact before/after hashes.

## Private acceptance

The established ordinary-user SSH capture transfers only the fixed app source
allowlist to a private temporary runner directory. Native/auth inputs emit only
hashes; no native code bundle or customer model is transferred for this UI fix.
An isolated container has no network, a read-only root, no capabilities, the
ordinary runner UID and private temporary storage. It must pass:

1. Label synchronization execution tests, including tab changes, the engine's
   actual zoom, native control identity and absence of rendering/scroll changes.
2. Retired-reader and projection regressions, including the public installed
   server compactor roundtrip, tamper/partial rejection, unchanged scoped
   requests, completed replies, Stop and account/job isolation.
3. Existing resource-presentation and secondary-zoom regressions.
4. Mandatory before/after tests against the actual captured UI, proving the
   independent label insertion and the final combined source, preservation,
   reversal and idempotence contracts. The captured Python bridge also executes
   the synthetic running/final/Stop compactor roundtrip.
5. Actual UI syntax, unchanged captured Bun ownership/persistence tests, and the
   actual `build-bridge.ts` → `feature-stop.ts` → Bun bundle build chain.

Existing tests and build scripts cannot be repaired or weakened by this release.
Raw source, stdout/stderr, models and credentials remain private. Only fixed
failure labels, check booleans and source hashes reach the acceptance receipt.
The runner removes all temporary inputs and logs after every outcome.

## Deliberate release and rollback

Source changes trigger verification only. After a successful exact candidate/run,
the release owner creates a separate `release.json` marker. Deployment requires
a marker-only Git diff, one successful matching verification job, a unique
matching receipt and unchanged public helper hashes. No marker is included in
the initial candidate.

Release recaptures the app, reproduces the exact accepted bytes, validates all
protected source hashes, and backs up the existing UI against the accepted old
SHA. It installs that one file and invokes only the already authorized
`liftorbit-ops update`/`smoke` helper operations. All hashes, service smoke and
public bridge HTTP 200 / unauthenticated auth HTTP 401 are checked afterwards.
Any failure restores the accepted original UI and rebuilds it through the same
helper. Startup smoke is retried for a bounded interval; a failed release keeps
its original failure exit status even when rollback succeeds.

Local preparation commands:

```sh
python3 -B -m unittest discover -s ops/ovh/zoom-label-release-20261125 -p 'test_*.py'
node --test ops/ovh/zoom-label-sync-20261125/test.mjs
node --test ops/ovh/native-preview-presentation-20261125/test.mjs ops/ovh/native-preview-projection-20261125/test.mjs ops/ovh/zoom-label-release-20261125/test_combined.mjs
bash -n ops/ovh/zoom-label-release-20261125/release.sh
```

The package preserves the older accepted release packages. It does not merge
the feature branch, bypass the deployment helper, or deploy to another provider.
