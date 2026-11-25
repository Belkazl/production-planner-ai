# Shift-aware native minibatch release

This isolated release adds bounded candidate proposals for smaller minibatches
that fit a resource's remaining working interval before a break or shift end.
The maximum quantity is still an upper bound; the proposal does not introduce
a minimum size. Discrete quantities retain their existing integer semantics.
Proposals use the existing native working-window predicate, the observed native
throughput duration and preceding native setup reservations. Every proposed
partition is evaluated by the complete unchanged native scheduler, setup and
constraint pipeline. The selected result must satisfy the existing objective.

## Narrow deployment scope

The only writable source is `sources/current/ga/ga_workers/joint_minibatch.py`.
All other native modules, all thirteen protected application inputs and
`auth-runtime.js` remain byte-identical. The baseline is derived explicitly
from the successful, deployed combined UI release; preparation starts with an
unready baseline and no release marker. It cannot publish or deploy itself.

The runtime image is built before the single private source capture for final
verification. The existing reviewed selector transfers only native code and
selected code inputs to a private, ephemeral GitHub runner directory. App and
auth sources leave the host only as hashes. Private execution uses the ordinary runner UID in a container with no
network, a read-only root, read-only source mounts, no capabilities, no new
privileges, and bounded memory, CPU, processes and temporary storage. No customer
models, private plans, private code or raw private logs are published.

## Required evidence

The new public proposal tests must execute against the exact patched native
module. The eleven existing native regression cases and four integrated setup
cases remain mandatory and unchanged. Additional actual native witnesses must
prove that smaller quantities exploit a short window, lunch break and a window
that also requires setup, while respecting quantity conservation, caps, pinned
operations, calendars and the unchanged Quick evaluation budget. Evidence in
public logs consists only of allow-listed booleans, bounded counts and hashes.

## Deliberate deployment

Verification never deploys. After the release owner reviews the successful
candidate's exact workflow run and receipt, the owner creates a marker-only
commit. Release requires the exact branch, candidate, successful workflow and
job, matching receipt, public helper hashes, immutable source hashes and a diff
containing only the accepted marker. Deployment captures only app, auth and
native worker hashes plus the aggregate selected-code-input hash. The frozen
native selector runs on the host through a public hash-only wrapper; no second
native source or selected configuration payload is transferred to the runner.

The deployment artifact is reproduced from the public original joint module,
the unchanged public diversity patch and this release's public shift patch,
without executing the native module. The reproduced base must match the live
accepted old target hash, and the candidate must match the complete accepted
worker-after manifest. App, auth, all other worker hashes and the selected-code
input hash must match the accepted receipt. Every reconstruction helper is
included in the receipt's public-source hashes.

The remote contract rechecks source hashes, backs up the original target bound
to its accepted old hash, installs the one accepted module and invokes only the
existing `liftorbit-ops update` helper. Service smoke, bridge HTTP 200 and
unauthenticated auth HTTP 401 are mandatory. A failed installation restores the
verified old module, rebuilds it through the same helper and checks rollback
health; the failed release remains unsuccessful.
