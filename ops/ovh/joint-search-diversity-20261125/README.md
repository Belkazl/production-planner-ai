# Bounded diversity for the existing joint batch search

This package patches only candidate generation in the existing public
`joint_minibatch.py`. Quick remains three generations of six candidates. The
native decoder, equipment eligibility, quantity and pin checks, material and
shift validation, setup handling, objective, formatter and continuation schema
are unchanged.

The previous population builder admitted duplicate genes and put the same
incumbent into each generation's evaluation list. Those positions incremented
the search budget while reusing an existing cached score. Homogeneous machine
capacities could also make the maximum, heterogeneous and minimum initial
partitions identical.

## Changes

The original capacity seeds remain first. Three additional deterministic
proposals change one mutable order each: a balanced partition, a half split,
and an unequal split. Each new seed adds at most two parts across the entire
model. It preserves positive quantities, units, every order total, native
maximum capacity, the 128-parts-per-order and 1,024-total-parts bounds, and all
frozen partitions. Impossible or duplicate proposals are omitted.

Population construction rejects genes already chosen for that population,
recently evaluated genes, and cached genes when it can find a new legal
candidate. It tries at most `max(32, population * 8)` crossover/mutation
proposals per population. The best result remains available for final selection
and as a parent; it does not consume another evaluation position merely to
retrieve the same score. The exact continuation incumbent is still evaluated
first in the fresh worker.

A finite or exhausted search neighbourhood falls back to existing legal genes
after the bounded retries. A one-piece, one-order model therefore still
terminates with the requested budget and its one valid candidate. This patch
does not require different quantities in the winning plan and does not accept
an infeasible candidate for the sake of diversity.

## Diagnostics

The original `joint_minibatch.evaluated`, feasible/rejected counters and cache
bounds are retained. The result additionally contains:

| Field | Meaning |
| --- | --- |
| `search_diversity_version` | `joint-search-diversity-v1-20261125` |
| `decoder_evaluations` | Actual calls made because a gene was absent from the native-result cache |
| `cache_reuses` | Evaluation positions served from that cache |
| `unique_evaluations` | Distinct evaluated ordered genomes tracked in this worker installation |
| `unique_evaluations_complete` | Whether the distinct counter is complete |

At most 4,096 fixed-size SHA-256 fingerprints are retained. After that bound,
the unique count remains a lower bound and `unique_evaluations_complete` becomes
false. Decoder and cache counters remain exact. Fingerprints are search
bookkeeping, not authorization or feasibility evidence. No customer identifiers,
partitions or model content are added to diagnostics.

## Exact patch contract

```sh
python3 ops/ovh/joint-search-diversity-20261125/patch.py INPUT_JOINT.py OUTPUT_JOINT.py
```

The input must have SHA-256
`a368dca1ec1b1aaab0bd7c91f6e7d39c7c259d82f9c49d8df5f3186502c548cc`, or be the
exact output of this patch. Eight exact replacements are reversible to those
original bytes. Partial installations and unrelated edits fail closed. The
original repository file is not modified by this package.

## Local checks

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s ops/ovh/joint-search-diversity-20261125 -p 'test_*.py' -v
```

The suite runs all 21 original joint-search tests against the patched module
without changing their assertions. Additional checks cover discrete and
continuous quantities, homogeneous capacities, frozen partitions, exact
continuation seeding, unchanged bounds, finite-space fallback, bounded unique
tracking, and the actual decoder-call count in the public synthetic fixture.
Its six-order Quick case evaluates 18 distinct ordered genes and retains the
full-batch baseline when all alternatives have a worse duration.

`LIFTORBIT_JOINT_DIVERSITY_FIXTURE` may name an already staged
`ga_workers/joint_minibatch.py`. The optional source test then requires the exact
patched bytes and idempotence. It never fetches or modifies that fixture.

## Isolated actual-native check

The following command belongs only in the existing private, network-isolated,
code-only verification container:

```sh
python3 -I ops/ovh/joint-search-diversity-20261125/verify_diversity.py \
  --package-root /native \
  --code-inputs /input/code-inputs.json \
  --contract-helper /public/repo/ops/ovh/native-batching-verify-20261124/native_input_contract.py \
  --report /work/out/diversity-report.json
```

The driver checks the exact patched module, selects the established code-only
environment fields, verifies the original compiler contract, compiles the
installed native source, and invokes the actual worker with an invented
six-order model. An observer records the real native decoder's ordered batch
genes while returning each native object unchanged. The existing independent
`check_production` checker verifies the final schedule.

The fixed report format is `joint-search-diversity-verification-v1`. Its required
boolean fields are `exact_module_installed`, `native_valid`,
`independent_valid`, `quick_budget_unchanged`, `distinct_native_evaluations`,
`partition_seed_diversity`, `count_seed_diversity`, `seed_growth_bounded`,
`baseline_retained`, `caller_inputs_unchanged`, and
`all_diversity_checks_passed`. It additionally contains bounded integer counts,
`unique_evaluations_complete`, and `production_writes: false`. Native output and
exception text are suppressed. The driver accepts no customer-model argument.

This check supplements the unchanged native eleven-case acceptance and the
integrated setup cases; it does not replace them.

## Supported search space

The current v1 genome has one ordered partition per order. Each logical batch
retains that quantity throughout its route. Its native route-wide capacity
ceiling is preserved by this patch.

Different physical loads at different operations require an additional native
quantity-flow representation. For example, several small upstream batches
could form one larger downstream load only after all required upstream work
has completed. That requires operation-specific grouping, predecessor coverage,
material/setup evaluation, stable pin identities and versioned continuation.
It is not implemented here. Increasing a global capacity limit or combining
finished schedule rows outside the native candidate evaluation would not
implement that contract correctly.
