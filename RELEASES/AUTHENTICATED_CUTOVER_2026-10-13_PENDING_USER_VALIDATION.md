# Protected production entrypoint — 2026-10-13

## Deployment state

- **Previous approved UI/GA baseline (preserved):** `etalon/production-2026-10-13-order-volume`, SHA `a4162eee165fa99105880bfe2545a3f4fe36a30d`.
- **Authenticated bridge candidate source (pinned):** SHA `7ebbb2b363018057fed551ea9a8cf94d6d7cabba`, branch `feature/authenticated-production-bridge-20261013`.
- **Primary user-facing login URL:** https://production-planner-gateway-v2-production.up.railway.app/
- **Secured legacy planning URL:** https://aps-setup-bridge-candidate-v2-production.up.railway.app/
- **Original account server (private internal connection in same Railway project):** `production-planner-gateway-v2.railway.internal:8080`, service `df70f615-c94a-490e-a731-308eeafafe3e`. Public troubleshooting hostname: `prodplan-auth-backend-production.up.railway.app`.
- **New user-facing secure bridge:** `prodplan-auth-integration-qa`, service `2bf88ff3-774c-474f-a102-981452c23abd` in Railway project `Production Planner AI`. The hostname `production-planner-gateway-v2-production.up.railway.app` was moved from original account server to this bridge. The original account server code, database and accounts were not modified.
- **Secure planner bridge at previous UI hostname:** `aps-setup-bridge-candidate-v2`, service `6e5f7005-19a1-4da1-a0db-2fd216d30ccd` in `ProdPlan AI - Setup Bridge`, connected to the same pinned commit. Its `PP_AUTH_GATEWAY_ORIGIN` points to the original account server public troubleshooting hostname.
- **Chrome-flagged temporary testing hostname:** `pp-progress-fix-qa-20261010-production.up.railway.app`, removed from public Railway routing. Do not reenable or ask users to ignore Chrome warnings.

## Verified (synthetic-only, no user passwords)

- Login form returns HTTP 200 at the primary hostname.
- Unauthenticated model, saved-plan storage, optimizer, and progress routes return 401 from both primary and secured previous planning domains.
- A synthetic invalid login reaches the existing account server, returning 400 rather than `cross_origin_forbidden` or a backend outage.
- Cross-site login submission is rejected with 403.
- The original account server responds to authentication checks through Railway private networking.
- The primary bridge is pinned to SHA `7ebbb2b363018057fed551ea9a8cf94d6d7cabba`; Railway deployment `77f92c8b-aaad-470a-94ba-ce3b8afac2d5` reported SUCCESS.

## Not yet verified — do not claim complete production acceptance

1. User's Chrome no longer showing Dangerous on the **primary** hostname (cannot observe user's browser from tools).
2. Actual existing-account login and authenticated Gantt UX; only synthetic invalid credentials and mock valid sessions were tested.
3. User-visible preservation of project «Керамика», all 12 orders, and saved plans after login (no user credentials were used).
4. Retirement / security review of older public legacy endpoints, including `aps-setup-bridge-production.up.railway.app` and `production-planner-gateway-production.up.railway.app`.

Avoid requesting passwords in chat, do not bypass Chrome security warnings, and do not remove data or underlying Railway services during cleanup.

## Rollback of primary login hostname

If the new bridge has a critical runtime issue, use Railway domain update on service `2bf88ff3-774c-474f-a102-981452c23abd` to rename its hostname away from `production-planner-gateway-v2-production.up.railway.app`, then update original account service `df70f615-c94a-490e-a731-308eeafafe3e` hostname from `prodplan-auth-backend-production.up.railway.app` back to `production-planner-gateway-v2-production.up.railway.app`. This restores the old gateway-v2 UI; the authenticated bridge remains running with the same approved code.

The predecessor visual production SHA `a4162eee...` remains on its immutable etalon branch for UI/code rollback.
