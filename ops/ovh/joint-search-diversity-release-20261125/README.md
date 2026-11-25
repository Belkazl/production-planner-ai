# Native minibatch search diversity release

This package verifies and releases one change to the existing native v1
optimizer: deterministic legal partition seeds and generation-wide novelty.
The search budget remains the requested generations × population. It does not
introduce stage grouping, change the decoder, relax feasibility checks, rewrite
metrics, or change the continuation genotype.

## Release boundary

The only writable production source is
`sources/current/ga/ga_workers/joint_minibatch.py` under the existing migration
root. Every other captured Python worker source, all thirteen protected app
inputs, `auth-runtime.js`, and the selected native code-input digest must remain
byte-identical. App sources leave the host only as SHA-256 hashes. The existing
reviewed native selector transfers its code-only bundle privately to the
ephemeral GitHub runner; credentials, customer data and model instances are
excluded.

The baseline is an explicit derivative of the successful **deployed**
presentation release, using its `app_after` hashes. `baseline.py --check` rejects
an unready or incomplete baseline before private capture. The release owner must
confirm the presentation deployment is healthy before publishing this candidate.
The baseline contains both the accepted presentation candidate/run and the
deliberate presentation marker commit. It is never inferred from a guessed
current version.

## Mandatory verification

The public runtime image is built before private inputs arrive. The native
package is copied privately; the exact public diversity patch changes only
`joint_minibatch.py`. All private execution occurs in a network-disabled
container with a read-only root, no capabilities, no new privileges, the ordinary
runner UID, bounded memory/process count, and a private temporary filesystem.
The candidate package and selected code inputs are read-only mounts.

Every gate is required:

1. Public diversity tests execute against the actual patched module.
2. The unchanged eleven native cases exercise mixed partitions, material
   availability, the three-minute cutlet regression, multiple orders and stages,
   staff shifts and setups, Stop checkpoint restoration, selected partitions,
   new pins and subsequent same-pin Continue.
3. The unchanged four integrated native cases independently verify that setups
   participate in fitness and reservations, material/shift constraints remain
   valid, real pins stay fixed, and a zero-setup plan remains authoritative.
4. A separate real adapter witness uses six invented orders and Quick **3 × 6**.
   It verifies distinct native genotype evaluations, deterministic partition and
   batch-count diversity, bounded seed growth, baseline retention and unchanged
   caller inputs. It exports only fixed booleans and bounded aggregate counts.

No private plan, source, raw stdout/stderr, image layer containing private code,
or bundle is published as an artifact. Failure output contains only fixed gate,
case, check and exception-class labels. All runner private files are removed
after success or failure.

## Acceptance and deliberate deployment

The verification workflow triggers on this package and its public patch package.
It never deploys. A successful bounded receipt includes the exact original and
candidate worker hashes, unchanged app/auth hashes, selected-code digest, actual
runtime image ID, public helper hashes, and all mandatory check results.

After reviewing that exact candidate's successful workflow run, the release
owner derives `release.json` with `release_guard.marker_from_report`. No marker
is included before acceptance. The release workflow triggers only when that
marker changes. Its guard requires the same repository/branch, exact successful
verification head, one successful `verify` job, a unique matching receipt, and
an ancestor-to-release diff containing **only** this marker.

Release repeats the ordinary-user code-only capture, reproduces the accepted
one-file artifact locally without executing native code, and rejects any source
drift. Before writing, the remote contract rechecks all regular-file hashes and
the native selector. It backs up the one target, preserves its existing mode and
owner, installs only accepted bytes, and invokes the existing authorized
`liftorbit-ops update` helper. The same helper's smoke gate and public bridge 200 /
unauthenticated auth 401 checks are required before success.

On any failure after installation, the original module is restored and verified,
the existing update helper rebuilds that original version, and bounded startup
smoke retries check rollback health. The original failed release still exits
unsuccessfully. Update and rollback logs stay private on the host. There is no
direct Docker, process-environment inspection, new sudo grant, main-branch merge,
or deployment to another provider.

## Local commands

```sh
python3 -B -m unittest discover -s ops/ovh/joint-search-diversity-release-20261125 -p 'test_*.py'
bash -n ops/ovh/joint-search-diversity-release-20261125/release.sh
python3 -B -I ops/ovh/joint-search-diversity-release-20261125/baseline.py --check
```

To explicitly derive a baseline from a **plain successful presentation report**
after its deployment, supply all provenance values:

```sh
python3 -B -I ops/ovh/joint-search-diversity-release-20261125/baseline.py \
  --presentation-report /private/presentation-report.json \
  --candidate ACCEPTED_PRESENTATION_COMMIT \
  --verification-run ACCEPTED_PRESENTATION_RUN \
  --deployed-commit PRESENTATION_MARKER_COMMIT \
  --output ops/ovh/joint-search-diversity-release-20261125/baseline.json
```

Placeholders in this example are intentionally invalid; no guessed hashes or
automatic approval substitute is supported. Remote actions belong to the release
owner and are not performed by local preparation or tests.
