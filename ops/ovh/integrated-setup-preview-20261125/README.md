# Show the native incumbent during optimization

The main Gantt and KPI cards use the full `best_preview` from the account-scoped
native worker. A tentative candidate does not replace that incumbent. The first
complete best is emitted immediately; subsequent updates retain the existing
four-second sampling, job identity checks and ten-operation-per-lane bound.
The visible rows, setup rows and full-plan KPI values always come from the same
plan. A valid best with no required changeovers remains valid.

Apply after the canonical integrated-setup result patch:

```sh
node ops/ovh/integrated-setup-preview-20261125/patch.mjs INPUT_UPSTREAM OUTPUT_UPSTREAM
node --test ops/ovh/integrated-setup-preview-20261125/test.mjs
```

Set `LIFTORBIT_INTEGRATED_PREVIEW_FIXTURE` to a private captured upstream source
to execute the same mocked-worker SSE cases against the actual application
module. Neither source nor customer schedules should be printed or uploaded.
