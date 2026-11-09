# LiftOrbit — production cutover gates (9 November 2026)

## Verified, independently observable facts
- OVH host: 51.255.163.121; technical SSH account: liftorbit-ci (restricted sudo only).
- Private OVH stack: PostgreSQL main + PostgreSQL auth + planner + auth gateway + GA worker + app — all six healthy (GitHub Actions run 42614542534).
- Local origins: landing http://127.0.0.1:18080; app http://127.0.0.1:18082.
- HTTPS ingress Caddy runs on OVH in **staging mode**; non-local requests for liftorbit.app and app.liftorbit.app receive HTTP 403. Both origins passed anonymous access, brand HTML, CSRF and session-boundary checks (run 42615983425).
- The most recent read-only Railway backup available at time of writing is backup-42610789251-1, containing validated main and auth PostgreSQL dumps. It is **not a final synchronized cutover backup**.
- Fresh backup restored into disposable six-service integration stack successfully (run 42611891704).
- Email: current OVH staging deliberately suppresses actual Resend emails; generator now supports explicit --mode production, validated in run 42616350356; switching email mode remains required before live use.
- CPU/RAM/storage: 2 vCPU; 3819 MiB RAM; 0 swap; ~34 GiB free disk at audit time (run 42616861166). This is **capacity information**, not proof of performance at 10+ concurrent optimizations.
- DNS custom domains liftorbit.app (Railway landing) and app.liftorbit.app (Railway application) remain Railway-managed. GitHub has **no usable Cloudflare DNS API token configured** (run 42616706407).
- Restricted SSH can run liftorbit-ops status/smoke/update and liftorbit-edge-ops status/smoke/activate. Caddy activation is blocked by a **fresh root-owned /opt/liftorbit/state/cutover-ready.marker**, which is intentionally missing (run 42614542534). Do not bypass this gate.

## NEVER perform these out of order
1. Obtain authorized Cloudflare DNS-edit access (ideally narrowly scoped zone token) and verify DNS records, proxy status and SSL mode before changing anything.
2. Verify Railway's current application and DB status and decide a maintenance window. **Stop or otherwise reliably prevent new writes to both Railway databases before taking final dumps.** Otherwise DNS propagation could produce split-brain and customer data loss. Existing Railway `*.up.railway.app` domains must also be accounted for.
3. While Railway writes are frozen, make **new** consistent pg_dump snapshots of both production databases; verify checksums and schema. Do not reuse the dated 42610789251-1 snapshot as a final backup without proving no changes.
4. Before modifying OVH databases, make verified rollback backups of both current OVH volumes. Restore final Railway data into new shadow DBs or into a staged copy, **never delete a production volume without a rollback**, and verify both DBs and account data parity.
5. Apply production-only email config from verified private Railway source using render-secrets.py --mode production (Resend and reset origin). Restart the affected service after a proper restore and test password-reset capability without sending actual emails to arbitrary users.
6. Verify the six-service authenticated app behavior on OVH and local HTTPS. As of 9 Nov only anonymous/auth boundary checks and healthy probes have been observed: do not claim full end-to-end account workflows are tested.
7. Obtain explicit administrator approval via the root-owned fresh cutover marker. Only then use the delegated `liftorbit-edge-ops activate` action to enable real ACME HTTPS. Check certificate issuance and public HTTPS using a direct-origin DNS override before switching DNS; an orange-cloud Cloudflare proxy may affect validation.
8. Change **both** liftorbit.app and app.liftorbit.app Cloudflare DNS records to OVH, preserving the existing zone's email MX/TXT/DMARC/SPF/DKIM records. Verify external HTTPS, cookies, login, sessions, GA calculation/stop/continue, and domain redirects. Watch errors and DB writes.
9. Keep Railway (including original DBs) intact and available for rollback during the observation period. Remove the Railway custom domains, services and related expenses **only after** success and backups are independently verified.

## Rollback plan
- DNS rollback targets are the exact Cloudflare records and Railway targets exported immediately before cutover. Do not guess their names, Cloudflare proxy modes or TTL.
- If failures arise, halt writes to OVH, revert BOTH DNS records to their recorded prior values, and verify that Railway remains healthy.
- Preserve Railway DBs unmodified until rollback window closes. Since the stacks do not replicate continuously, data written to OVH after cutover needs an explicit reconciliation decision before restoring Railway routing.
- Do not run a generic `docker compose down -v` or remove PostgreSQL volumes.

## What remains blocked
- Cloudflare credential or UI access for the two DNS records.
- A controlled Railway write freeze, final DB dump/restore and old-state rollback.
- Root-authorized production HTTPS activation marker.
- Final authenticated user acceptance and payment/reset tests.

This checklist is a migration control record, **not proof that public cutover has happened**. Private stage must stay closed (HTTP 403 externally) until the gates above are met.
