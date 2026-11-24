# Host-local verification of existing native minibatch optimization

Prepared locally. The earlier proposal to transfer private code/config-derived
inputs to an external runner was rejected and has been removed. **Private code,
selected code variables, configuration and native logs stay on the OVH host.**
Only synthetic test results and bounded technical metadata may leave it.

## Execution gate

The workflow is manual and defaults to disabled. A read-only capability audit
must be reviewed first. The ordinary CI account then runs a harmless rootless
`bwrap` probe before reading private inputs. The binary must already exist as a
non-setuid/non-setgid system program. No tool installation, sudo, Docker access,
permission changes, fallback to shared host `/tmp`, or alternative privilege
route is implemented. If isolation is unavailable or denied, verification stops.

The sandbox has separate user, PID and network namespaces, a private `/tmp`
tmpfs, private `/proc` and `/dev`, and read-only system binaries/libraries. It
does not mount host `/home`, `/run`, `/var`, the host root filesystem, database
sockets, or unrelated configuration. The probe verifies namespace separation
and the private tmpfs. No private input is read if that check fails.

## Private data handling

`native_input_contract.py` reads the existing accessible worker input, selects
only the exact compiler's 19 code fields, runtime code fragments/count and code
hashes, and validates the pinned native compiler. Credential fields are omitted.
It has no transport, archive, serializer-to-stdout or external export API.

The host-local parent creates a mode-0700 temporary workspace, freezes the
existing worker Python package, and writes only the selected code fields to a
mode-0600 file. The sandbox reads that file into a cleared environment. Existing
native compiler, scheduler, timings, validators and adapter execute unchanged;
their fixed `/tmp` files exist only inside the namespace. Private output is
captured on the host and deleted together with the private workspace. No HTTP
server, production API, database or service restart is involved.

The only writable bind is a separate private result directory. The public
report contains synthetic outcomes, source hashes, and bounded function/state
key metadata. It contains no native source, arbitrary literal values, defaults,
environment values, credentials or real account models. The workflow uploads
only the two reviewed public harness files to a temporary host directory; it
downloads no private files and creates no artifacts.

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
only in local unit tests of the checker. The actual native calculation must find
its own result. The observer covers the whole bounded run, retaining at most 64
different partition vectors, and returns the same native objects and arguments.
Raw native validation runs only on defensive copies. Final timing and validation
remain in the original optimizer/adapter. Early compiled AST and callable
metadata survive a later fixture/schema failure.

## Local guard tests

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v test_harness.py
```

Local guard tests do not execute private code, read production input, or probe
host namespaces. Native evidence exists only after a separately authorized,
successful host-local verification.
