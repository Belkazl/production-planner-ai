# Authorized ephemeral native minibatch verification

On 2026-11-24 the user explicitly approved temporary processing of the closed
optimizer code in isolated GitHub Actions for diagnosis and fix verification,
without publishing source, native logs, credentials, database data or customer
orders. The earlier host-local isolation route is disabled: `bwrap` was absent
and the single permitted harmless `unshare` probe was denied. No host isolation
probe, package installation, permission change or production restart is used.

## Private input boundary

The workflow runs only on the current feature branch and this harness's paths,
or by a manual invocation with its explicit authorization flag. The reviewed
`native_input_contract.py` runs read-only through the existing strict SSH route.
It selects the exact pinned compiler's 19 code fields, source fragments/count
and source hashes, and freezes the existing active worker Python package.
All configuration fields carrying credentials, tokens, database connections,
account state or real models are excluded. The exact compiler SHA and code-key
contract must match before the binary bundle is written.

The SSH binary output goes directly to a mode-0600 runner temporary file, never
to the Actions log. The bundle is uncompressed and bounded. The receiver refuses
unknown/traversal paths, duplicate entries, symlinks, special files, unexpected
input fields, missing modules, oversized members, wrong hashes or a changed
compiler. It manually writes only validated regular files into a mode-0700
workspace. No private file is committed, uploaded as an artifact or cached.

## Reviewed correction in the temporary copy

`--public-overlay ops/ovh/joint-minibatch-release-20261124` runs the reviewed
public preparation script against the verified temporary package before its
read-only container mount. The original package and code input must remain
byte-identical. Only `full_runtime_adapter.py`, `joint_minibatch.py` and
`joint_continuation.py` may differ; the pinned compiler must remain unchanged.
The public report records all original/candidate package hashes, the input hash
and hashes of the five public patch helpers. Patch stdout/stderr stays private.
The workflow selects this mode when the reviewed preparation script is present.

The core gate compares the ordered batch-genome digest from exported state
with the first optimized schedule in the fresh continuation namespace. Numeric
representation is normalized, while order and partition positions are retained.
This avoids treating rediscovery of the same unordered batch sizes as evidence
of restored continuation. Initial core-gate reports mark `release_gate_complete`
false until the additional production-preservation regression cases are added.
Repeated function/contract metadata is stored once in `function_metadata` and
`contract_schemas`; references preserve the report while reducing log volume.

## Native execution isolation

The fresh GitHub runner starts a disposable container using the same public
`python:3.12-slim` image as the native worker, resolved to its actual image ID.
It has no network, a read-only root, a private `/tmp` tmpfs, no capabilities,
no-new-privileges, bounded memory/CPU/processes, and runs as the ordinary runner
UID. Only the verified code package, selected code JSON and public harness are
mounted read-only; a separate private report directory is writable. No SSH key,
repository credentials, host root, Docker socket, production mount or inherited
service environment is accessible inside the container.

The original compiler, native scheduler, timing logic, validators, finalizers
and adapter execute unchanged on synthetic models. Their fixed `/tmp` paths
exist only inside this disposable container. Native stdout/stderr is captured
into a private temporary file and deleted. The parent publishes only its safe
synthetic report, code hashes and bounded function/state metadata; source
positions are removed. Failure text and tracebacks from native code never leave
the private capture. Cleanup removes the named test container and temporary
files on success, failure, timeout or cancellation; the final workflow step also
removes the transport bundle and SSH files. No artifacts are uploaded.

## Native regression cases

1. One order of 30 units, one fixed 10-minute operation, two alternative machines
   with capacities 10 and 5. Three maximum-size batches require 30 minutes. The
   mixed partition `10, 5, 10, 5` takes **20 minutes**, matching the capacity lower
   bound; equal-size splitting alone cannot achieve it.
2. The same model with 15 material units initially and 15 delivered at minute
   15. The feasible optimum is **25 minutes**. Independent checks verify actual
   per-operation consumption and chronological stock availability.
3. Continue the native result in a fresh namespace using the adapter's own
   exported resume state. The final feasible result must not worsen. Exact
   native-genome persistence and the browser/backend bridge need the actual
   native state contract and a paired test; rediscovery alone does not prove it.

No mixed result is injected into the optimizer. Handwritten schedules appear
only in unit tests of the checker. The actual native calculation must find its
own result. The observer covers the whole bounded run, retaining at most 64
partition vectors, and returns the same native objects and arguments. Raw native
validation runs only on defensive copies. These observations do not establish
that material/staff repair occurred before candidate selection; that requires
a targeted native contract test before any repair is accepted. Early compiled
AST and callable metadata survive a later fixture/schema failure.

## Local guard tests

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s ops/ovh/native-batching-verify-20261124 -p 'test_*.py' -v
```

Local guard tests never execute private code, read production input, launch a
container or probe host namespaces. A native pass is reported only from an
actual authorized run; preparation of this harness is not a recovery claim.
