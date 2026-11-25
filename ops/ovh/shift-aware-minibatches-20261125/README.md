# Shift-aware minibatch proposals

This package transforms only the deployed `ga_workers/joint_minibatch.py` with
SHA-256 `08a3fd9d556fecb726c69ce7632851c2117f0e753c16edac183361e632afe253`.
The previous search, continuation, native adapter, decoder, feasibility checks,
objective, formatting, and application packages remain separate and unchanged.

## Behavior

Capacity is an upper bound. After the first feasible native simulation, the
search can propose at most two additional ordered partitions that use time
before a work break or the end of a shift. Each proposal changes one unpinned
order, preserves its earlier batch prefix and total quantity, and adds at most
two parts. The remaining quantity is balanced within the existing native cap.

The proposal uses the resource assignment and setup reservations of that same
native simulation. A production row must agree with the selected machine's
linear throughput profile. Fixed and unsupported timing formulas do not acquire
an invented per-unit duration. Setup staff are checked only during their setup
phase; production staff are checked during production. The existing native
`_pp_in_window` predicate decides whether each phase fits. Its calendar argument
is opaque.

The helper checks the known resource-ready instant first. Confirmed public
`shifts: {name: [[HH:MM, HH:MM]]}` values supply additional start hints only when
`model.start` and the native context's time origin agree. The native predicate
still decides every fit. Unsupported calendar/origin representations supply no
extra start hints. There are explicit bounds on hint starts, considered rows,
days, and predicate calls. No new full decoder calls are made.

Discrete quantities have their existing indivisible unit of one. Continuous
quantities, including square metres, can be below one; there is no new minimum
batch quantity. Every proposed genome goes through the existing validation.

The exact baseline or continuation incumbent remains the first evaluation.
Unevaluated window proposals get priority in the remaining normal population
slots, including a useful proposal that already exists as a later seed. Quick
remains three generations by six individuals. The complete native decoder,
setup handling, material and resource constraints, and native objective decide
whether a proposal improves the incumbent. A winning plan is not required to
contain different batch sizes. No operation time is post-processed.

The current one-partition-per-order genome is retained. This package does not
add stage-specific grouping, raise any equipment capacity, or alter pinned
partitions or continuation state schemas.

## Files and invocation

`shift_helpers.py` is inserted verbatim by the exact reversible `patch.py`
transform. It is not a second deployed worker module.

```sh
python3 patch.py INPUT_JOINT.py OUTPUT_JOINT.py
python3 -m unittest discover -s ops/ovh/shift-aware-minibatches-20261125 -p 'test_*.py'
```

An optional `LIFTORBIT_SHIFT_AWARE_FIXTURE` path verifies an already staged
candidate byte for byte. The local tests include all original joint-search
assertions, the old Quick miss, exact 30-unit and 25-unit window cuts, lunch and
overnight cases, pinned prefixes, continuation, later/common staff availability,
separate setup staff, and a 0.5-square-metre continuous case.

## Actual native gate

```sh
python3 -I verify_shift.py \
  --package-root /native \
  --code-inputs /input/code-inputs.json \
  --contract-helper /public/repo/ops/ovh/native-batching-verify-20261124/native_input_contract.py \
  --report /work/out/shift-report.json
```

The verifier independently validates the exact installed module, selects only
the existing code-input allowlist, and compiles the captured native runtime.
It accepts no customer fixture. The four invented reported cases are:

| Case | Available time and prefix | Required native result |
| --- | --- | --- |
| `shift_window` | 00:00–00:30, then 01:00–09:00; quantity 400, maximum 200 | A 30-unit cut is evaluated; makespan 460 → 430 |
| `lunch_break` | 08:00–12:00, 13:00–17:00; pinned work through 11:30; quantity 200 | A 30-unit cut is evaluated; makespan 980 → 950 |
| `setup_reservation` | 00:00–01:00, 02:00–10:00; pinned 30-unit prefix and a five-minute setup | A 25-unit cut is evaluated; native makespan 495 with the setup reserved |
| `overnight` | Daily 00:00–08:00; pinned work through minute 450; quantity 400 | A 30-unit cut is evaluated; makespan 1840 → 1810 |

Two internal native witnesses additionally require a shift that begins after
ready=0 and a non-midnight model origin. They cannot pass by silently skipping
the hint. A fresh-namespace continuation must evaluate its exact incumbent
first. The unchanged diversity behavioral verifier also runs against the new
module. Existing native eleven-case and integrated four-case release gates are
required separately.

The observer returns original native objects and scores. It observes the public
joint `_score` call after feasibility checks, rather than assuming every internal
native objective call is a verified candidate. Inputs and captured source stay
unchanged. Output is a bounded 0600 JSON report with fixed names, booleans and
numeric witnesses; child output and source are not forwarded.

Local synthetic success is not a substitute for this actual-native gate.
