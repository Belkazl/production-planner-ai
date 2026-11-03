# LiftOrbit GA final QA runner

This is a **private Railway networking only** test runner. Do not add a public domain. Run it in the QA environment with separate service variables:

- `GA_QA_ORIGIN=http://${{liftorbit-full-ga-isolation-qa-20261103.RAILWAY_PRIVATE_DOMAIN}}:8080`
- `GA_QA_TOKEN=${{liftorbit-full-ga-isolation-qa-20261103.PP_WORKER_INTERNAL_TOKEN}}`
- `GA_QA_APP_ORIGIN=http://${{liftorbit-python-ga-app-qa-20261103.RAILWAY_PRIVATE_DOMAIN}}:8080`

The runner checks 3 sets of 10 distinct account jobs (2/4/6 orders), materials, setup, distinct Python OS processes, and repeats manual pinned operations / cross-process continuation / changed-model protection / cancellation with a subsequent new run. It also checks the QA Bun application's anonymous access policy. All models are synthetic. No customer data or production credentials are needed.

Progress is emitted only to Railway deploy logs using the `LIFTORBIT_FINAL_...` prefix. The health route becomes 200 **only after** all tests pass; it remains 500 on failure. No secrets are logged. Test process count in GA worker is currently 10; capacity depends on Railway plan, memory/CPU, and realistic workload. This is NOT proof of all UI/account login flows.
