# Existing native minibatch mechanism: bounded diagnostics

This release observes the currently installed optimizer. It does **not** install
a replacement search, change model quantities/capacities, choose a batch size,
retime operations, modify GA metrics, or change native continuation/Stop behavior.

The adapter installs `batch_size_diagnostics.py` before the existing pin wrapper
and adds `batch_size_diagnostics` to the finalized account result. The observer
calls the original scheduler with unchanged arguments and returns the exact same
object. Native exceptions, including cancellation, propagate unchanged.

Function metadata is limited to bounded binding/implementation names, parameter
names/kinds, callable references/aliases, definition line numbers, and callable
closure metadata to depth 3. String constants use an explicit allowlist of
technical batch/split/lot/chunk parameter names; identifier shape alone does not
authorize exporting a string. It
does not output source, defaults, arbitrary constants, closed-over model values,
environment values, credentials, or account identifiers. No diagnostic data is
printed. There are at most 56 function entries and 16 native scheduler samples.
After sample 16, calls only forward to the original function and check the bound.

The samples report batch sizes/counts and whether per-order input/partition
vectors vary. Vector hashes and order IDs remain private in the per-run closure.
An independent material-stock prefix diagnostic distinguishes the first raw
candidate from the finalized plan. This is not a complete feasibility validator
and cannot replace native setup, compatibility, or schedule validation.

Observed local account fixtures (not committed) showed a 4394-minute preview with
six material stock shortages and an 8570-minute final plan with no material
shortages. Therefore a future batch-search repair must establish where native
feasibility repair occurs before comparing candidate objectives.

## Commands

```sh
python3 patch.py INPUT_ADAPTER.py OUTPUT_ADAPTER.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v test_diagnostics.py
```

Place the module alongside the active `ga_workers/full_runtime_adapter.py`.
The patcher uses exact public adapter anchors, verifies byte-exact reversal of
its additions, parses the result, rejects partial/drifted installations, and is
idempotent. It leaves the existing operation-interleave wrapper untouched.
