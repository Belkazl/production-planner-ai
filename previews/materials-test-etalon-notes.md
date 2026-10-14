## Non-destructive material preview route on the original APS Setup Bridge test etalon

- Existing root `/` is untouched; demo visual only at `/materials-test`.
- Routes `/materials-test/model` and `/materials-test/plan` generate read-only data from the public twelve-order ceramic model.
- The demonstration schedule reserves machines, operators and material receipts; this is **not** a GA optimisation and does not write to the real model, tenant DB, or optimiser.
- Browser deliberately blocks writes and isolates browser-local keys.
- Exact pre-patch original source is backed up under `etalon/test-setup-bridge-before-material-preview-20261014`.
