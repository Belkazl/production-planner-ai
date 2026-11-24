# Deliberate verified joint-minibatch release

The overlay is prepared against the actual worker package and tested first in
the isolated native acceptance workflow. Only the explicitly authorized
ephemeral code inputs and synthetic models enter that test. Private native
source, raw logs, credentials and customer data are never published.

## Overlay interface

```sh
python3 -I ops/ovh/joint-minibatch-release-20261124/prepare_overlay.py INPUT_PACKAGE OUTPUT_PACKAGE
```

Both arguments name `ga_workers` directories. Output must not exist; input
remains byte-identical. The only worker changes are `full_runtime_adapter.py`,
`joint_minibatch.py`, and `joint_continuation.py`. The compiler, constraints,
operation interleave and diagnostics remain unchanged. Combined patches must
be idempotent.

## Deliberate release marker

There is no `release.json` in this preparation. Publishing helpers or a workflow
cannot deploy. The feature-branch release workflow triggers only when the
release owner creates or updates
`ops/ovh/joint-minibatch-release-20261124/release.json` after native acceptance.

| Marker field | Required evidence |
| --- | --- |
| `schema` | Integer `1` |
| `candidate_commit` | Exact tested commit |
| `verification_run_id` | Successful native run for that commit |
| `code_inputs_sha256` | Safe report's selected code-input digest |
| `package_before` | Safe report's complete original worker hash map |
| `package_after` | Safe report's complete candidate worker hash map |
| `public_sources` | Exact fixed dependency hash map produced below |

```sh
python3 ops/ovh/joint-minibatch-release-20261124/release_guard.py --public-hashes
```

All release helpers must already exist in the tested candidate. The release
commit may differ only in the marker. The guard checks the exact repository,
branch, workflow, successful run and job, then reads that job's safe JSON
report. It requires complete native acceptance, verified ordered continuation,
matching original/candidate package and code-input hashes, and all five overlay
helper hashes. A successful baseline or partial diagnostic cannot deploy.
The GitHub token is removed before following the Actions log blob redirect.

## Staging and deployment

The runner re-captures the approved bounded code-only bundle and reproduces the
exact accepted overlay. Current app bridge/UI sources are staged separately.
Preflight checks use the actual captured adapter, continuation module, bridge
and standalone UI file.

The five-file write allowlist contains the three worker files above and the
app's `python-ga-upstream.mjs` and `restart-optimizer-ui.js`. The worker source
root is `sources/current/ga/ga_workers`, independent of the app source tree.
The app's `auth-runtime.js` and `python-ga-upstream-build.ts`, and every other
worker module, have exact hash preservation guards. The standalone UI patch
changes only compact selected-plan continuation; existing zoom and lifecycle
wrappers remain intact.

On the host, the script verifies all current and staged hashes and rejects
symlink/nonregular targets before writes. It uses only existing supported
`liftorbit-ops update` and `smoke` operations, checks source hashes again, and
confirms the existing bridge/auth health responses. A failure restores the
five-file backup and uses the same update path. If source restoration fails,
it does not deploy a mixed source tree. Public logs contain fixed phase/failure
labels, exit codes and HTTP status codes. Build logs stay private on the host;
temporary runner inputs and logs are removed on exit.

## Public checks

```sh
bash -n ops/ovh/joint-minibatch-release-20261124/release.sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s ops/ovh/joint-minibatch-release-20261124 -p 'test_*.py'
```

These tests exercise wrong-commit and incomplete-gate rejection, package/input
drift, dependency identity, token stripping, the five-file staging allowlist,
and auth UI preservation. They do not connect to SSH, run the native engine or
mutate a service.
