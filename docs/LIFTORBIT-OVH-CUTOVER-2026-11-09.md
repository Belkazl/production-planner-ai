# LiftOrbit production on OVH — cutover record

**Date:** 9 November 2026, 19:55 UTC (20:55 Europe/Ljubljana)
**OVH:** 51.255.163.121
**Domains:** https://liftorbit.app and https://app.liftorbit.app
**Source infrastructure:** Railway project `Production Planner AI` (preserved for rollback).

## Completed and independently verified

- Railway PostgreSQL main and auth databases were set to read-only for fresh connections, with existing sessions terminated before the final backup.
- Fresh, SHA256-verified backups of both databases were transferred to OVH after the write freeze.
- OVH rollback backups of the previously staged local main and auth databases were created before any import.
- Both source databases were imported into shadow databases and promoted. OVH PostgreSQL main (12 public base tables) and auth (6 public base tables) passed restore validation.
- All six OVH services—postgres-main, postgres-auth, planner-gateway, auth-gateway, ga-worker, app—were confirmed `running:healthy`.
- Production Caddy HTTPS activated with a publicly trusted certificate covering both domains. Direct-origin HTTPS checks passed before DNS changes.
- Cloudflare records for the **exact two** domains were changed from proxied Railway CNAMEs to proxied A records pointing to `51.255.163.121`; MX/TXT and other DNS records were not modified.
- Public HTTPS for both health endpoints and LiftOrbit-branded HTML passed after DNS change.
- Unauthenticated `/api/auth/me`, `/api/db-storage`, `/api/account` requests were denied with HTTP 401. Cross-site login attempt returned 403.
- Weekly automated TLS expiry check and DNS-01 certificate renewal workflow was installed on default branch. First run found certificate valid for >35 days.

## Execution evidence

- GitHub Actions cutover: https://github.com/Belkazl/production-planner-ai/actions/runs/42687272951 (success).
- Public HTTPS/auth boundary/DNS validation: https://github.com/Belkazl/production-planner-ai/actions/runs/42688183225 (success).
- Initial automatic certificate expiry check: https://github.com/Belkazl/production-planner-ai/actions/runs/42688383582 (success).
- Root bootstrap, rollback backup setup and six-service health verification were previously successful.

## Operational cautions

- **Railway has NOT been deleted or cancelled.** Both former databases are deliberately left read-only; do not route users back to Railway without write-freeze reversal and reconciliation of any data written on OVH after the cutover.
- Old Railway custom domains may remain attached for rollback, but public Cloudflare DNS points to OVH.
- Full authenticated customer workflows (real-user login, account data edits, GA optimization/start/stop/continue), delivery of password-reset emails, concurrency/performance and billing/payment integration have **not** been demonstrated by post-cutover production smoke. Do not claim these tests have passed.
- The new database state is live on OVH. The initial final dumps are available on the OVH host, but continuous off-host database backups have not yet been configured.
- Do not delete the old Railway project/volumes until user acceptance tests, backup strategy and rollback policy are satisfied.
- The scheduled cert renewal relies on GitHub Actions availability and repository secrets; GitHub may disable schedules in inactive public repositories.
