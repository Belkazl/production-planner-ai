#!/usr/bin/env bash
# GA interim changeovers: backend-only source-guarded OVH rollout.
set -euo pipefail
umask 077
test "$HOST" = "51.255.163.121"
test "$USER" = "liftorbit-ci"
tmp=$(mktemp -d)
cleanup(){ rm -rf "$tmp"; }
trap cleanup EXIT
printf '%s\n' "$KEY" > "$tmp/key"
printf '%s\n' "$KH" > "$tmp/kh"
chmod 600 "$tmp/key" "$tmp/kh"
ssh_call(){
 ssh -i "$tmp/key" -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$tmp/kh" -o ConnectTimeout=20 "$@"
}
scp_call(){
 scp -q -i "$tmp/key" -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$tmp/kh" -o ConnectTimeout=20 "$@"
}
sha(){ sha256sum "$1" | cut -d' ' -f1; }
base=/home/liftorbit-ci/liftorbit-migration/sources/ovh-app
mkdir -p old new
scp_call "$USER@$HOST:$base/current/python-ga-upstream.mjs" old/python-ga-upstream.mjs
cp -p old/python-ga-upstream.mjs new/python-ga-upstream.mjs
node ops/ovh/sse-detached-setups-20261120/patch-live.mjs new
node --check new/python-ga-upstream.mjs
npm install --no-save --no-package-lock playwright-core@1.57.0
node ops/ovh/sse-stream-v1-20261120/test-backend.mjs
SSE_TEST_CANDIDATE_WITHOUT_SETUPS=1 node ops/ovh/sse-stream-v1-20261120/test-backend.mjs
node ops/ovh/sse-stream-v1-20261120/test-client.cjs
node ops/ovh/sse-stream-v1-20261120/build-live-qa.mjs
node --check ops/ovh/sse-stream-v1-20261120/_live-qa.mjs
sha old/python-ga-upstream.mjs > "$tmp/old.sha"
sha new/python-ga-upstream.mjs > "$tmp/new.sha"
echo SSE_DETACHED_SETUP_PREDEPLOY_TWO_WORKER_CASES_AND_BROWSER_PASS
if [ "${DETACHED_SETUP_PREFLIGHT_ONLY:-no}" = yes ]; then
 echo SSE_DETACHED_SETUP_READONLY_PREFLIGHT_PASS
 exit 0
fi

scp_call new/python-ga-upstream.mjs "$USER@$HOST:$base/sse-detached-setups-20261120.next"
deployed=0
rollback_if_needed(){
 if [ "$deployed" = 1 ]; then
  ssh_call "$USER@$HOST" bash -s <<'REMOTE' || true
  set -euo pipefail
  root="$HOME/liftorbit-migration"
  base="$root/sources/ovh-app"
  backup="$root/patch-backups/sse-detached-setups-20261120"
  test -r "$backup/python-ga-upstream.mjs"
  cp -p "$backup/python-ga-upstream.mjs" "$base/current/python-ga-upstream.mjs"
  sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/qa-rollback-private.log" 2>&1 || true
  healthy=no
  for attempt in $(seq 1 35); do
   if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1; then healthy=yes;break;fi
   sleep 5
  done
  test "$healthy" = yes
  echo SSE_DETACHED_SETUP_FULL_ROLLBACK_HEALTHY
REMOTE
 fi
}
trap rollback_if_needed ERR

ssh_call "$USER@$HOST" bash -s -- "$(cat "$tmp/old.sha")" "$(cat "$tmp/new.sha")" <<'REMOTE'
set -euo pipefail
root="$HOME/liftorbit-migration"
base="$root/sources/ovh-app"
current="$base/current/python-ga-upstream.mjs"
staged="$base/sse-detached-setups-20261120.next"
backup="$root/patch-backups/sse-detached-setups-20261120"
sha(){ sha256sum "$1" | cut -d' ' -f1; }
test "$#" -eq 2
test "$(sha "$current")" = "$1"
test "$(sha "$staged")" = "$2"
sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null
mkdir -p "$backup"
cp -p "$current" "$backup/python-ga-upstream.mjs"
test "$(sha "$backup/python-ga-upstream.mjs")" = "$1"
restore(){
 trap - ERR
 cp -p "$backup/python-ga-upstream.mjs" "$current" || true
 sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/rollback-private.log" 2>&1 || true
 echo SSE_DETACHED_SETUP_INTERNAL_ROLLBACK_ATTEMPTED
}
trap restore ERR
mv "$staged" "$current"
sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/deploy-private.log" 2>&1
healthy=no
for attempt in $(seq 1 36); do
 if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1; then healthy=yes;break;fi
 sleep 5
done
test "$healthy" = yes
test "$(sha "$current")" = "$2"
trap - ERR
echo SSE_DETACHED_SETUP_BACKEND_ONLY_DEPLOYED
REMOTE
deployed=1

healthy=no
for attempt in $(seq 1 20); do
 h=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 https://app.liftorbit.app/__bridge_health || true)
 a=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 https://app.liftorbit.app/api/auth/me || true)
 e=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 https://app.liftorbit.app/api/plan-events || true)
 if [ "$h" = 200 ] && [ "$a" = 401 ] && [ "$e" = 401 ]; then healthy=yes;break;fi
 sleep 5
done
test "$healthy" = yes
echo SSE_DETACHED_SETUP_PRODUCTION_HTTP_BOUNDARY_PASS
node ops/ovh/sse-stream-v1-20261120/_live-qa.mjs > "$tmp/live-qa.log" 2>&1 || {
 tail -n 70 "$tmp/live-qa.log"
 false
}
grep 'SSE_REAL_FIRST_TEN_OPS_INCLUDING_SETUPS_SAMPLE' "$tmp/live-qa.log"
grep 'SSE_VISIBLE_FULL_100_VERIFIED' "$tmp/live-qa.log"
grep 'CERAMIC_DURABLE_PLAN_VERIFIED' "$tmp/live-qa.log"
grep 'GA_START_502_HTML_ON_REAL_886_OP_CONTINUE_NO_DUPLICATE_PASS' "$tmp/live-qa.log"
grep 'SSE_LIVE_PROGRESS_AND_PREVIEW_SUMMARY' "$tmp/live-qa.log"
if grep 'CERAMIC_DURABLE_PLAN_VERIFIED.*"completedEarly":true' "$tmp/live-qa.log"; then
 echo SSE_DETACHED_SETUP_EARLY_TERMINATION_DETECTED
 false
fi
trap - ERR
echo SSE_DETACHED_SETUP_REAL_INTERMEDIATE_CHANGEOVERS_TWO_GA_RUNS_PASS
