# Native operation interleaving

This module wraps the existing Python `_pp_schedule_sequence` before the existing
manual-pin wrapper. The native decoder still supplies each candidate's complete
operations, resource assignments, batch quantities and fixed durations. Two
deterministic operation dispatch orders can retime that candidate: a round-robin
order and an earliest-ready frontier with remaining-work tie breaking. The
original candidate is retained unless the new duration is strictly shorter and
the runtime's unchanged `_pp_validate_generic` accepts it.

No exported/reference plan is read by the runtime. No order names or operation
IDs are special. GA generation/run counters, algorithm metadata, order genome,
resume state and context are preserved. Native decoder errors and process
cancellation keep their existing behavior.

## Deliberately narrow eligibility

- Duration objective; at most 64 operations.
- Explicit resource mode, fixed positive operation durations, sequential process
  operations, one equipment requirement and one assigned machine per operation.
- Unit-capacity machines; native unit batches cover the complete order quantity.
- No employees, shifts, materials, setups, releases, deadlines, extra dependency
  fields or manual pins. Unknown model fields or runtime contracts fall back.
- Existing wait/idle metrics must match recognized definitions before updating
  them. Ambiguous metrics also cause fallback. Other objectives are untouched.

Only derived dispatch times are cached (at most 16 entries). Plans, contexts and
native validation results are never cached. The model specification is built
once and checked against an immutable model snapshot on every candidate. A
candidate already attaining the lower bound for its assigned resources skips
retiming. Larger production models use the original decoder without a wrapper.

## Integration

Run from the repository root:

```sh
python3 ops/ovh/operation-interleave-20261124/patch.py INPUT_ADAPTER.py OUTPUT_ADAPTER.py
```

Copy `operation_interleave.py` alongside the **active** `full_runtime_adapter.py`
in its `ga_workers` directory. The patcher adds a relative import and one install
call immediately before `make_constrained_scheduler`. It rejects anchor drift,
checks syntax and unrelated bytes, and is idempotent. It does not access runtime
variables, private assembled source, databases or credentials.

```sh
cd ops/ovh/operation-interleave-20261124
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v test_interleave.py
```

The tests cover all six order permutations of three two-step jobs (4 to 3
minutes), four unequal jobs (6 to 5), optimal four-job preservation, unit batches,
fractional durations, precedence/resource feasibility, metric and model fallback,
native rejection, cancellation, cache isolation, and guarded integration. Two
optional local tests use the previously exported native GA plan/model and the
existing public pin validator. Those fixtures are not committed. Public tests
use an explicit feasible decoder fixture; they do **not** claim to execute the
unavailable private optimizer.

The final gate is a normal native Start/Quick run on the deployed application,
showing a new 3-minute result without supplying the imported reference. Also
verify intermediate progress and Stop through their normal controls. A bounded
`PP_OPERATION_INTERLEAVE` log reports installation, the first improvement or a
fallback reason without emitting IDs, model data or private source.

The final public result also receives a copied `operation_interleave` diagnostic
object after normal ownership validation. Its fields are `version`,
`eligible`, `improved_candidates` (native candidate evaluations improved by this
decoder), `fallback_reason` (the first fixed code, or null), and
`model_field_mismatches`. For ineligible models the latter identifies all six
schema scopes, up to eight known extra field names per scope, and only each
field's kind and aggregated `empty`/`zero` booleans. Unknown names become
`other:true`; field or record limits set `truncated:true`. No field values,
arbitrary names, model IDs or inner object keys are exposed. This diagnostic
does not make any unsupported field eligible. The state belongs
to that run's GA namespace, never to a global module object. Original simulation
objects and GA counters are unchanged; the UI does not receive a warning or a
new control.
