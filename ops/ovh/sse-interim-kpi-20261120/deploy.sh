#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$HOST" = "51.255.163.121" && test "$USER" = "liftorbit-ci"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
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
base="/home/liftorbit-ci/liftorbit-migration/sources/ovh-app"
mkdir -p old new
for n in python-ga-upstream.mjs restart-optimizer-ui.js; do
 scp_call "$USER@$HOST:$base/current/$n" "old/$n"
done
cp -a old/. new/
node ops/ovh/sse-interim-kpi-20261120/patch-live.mjs new
node --check new/python-ga-upstream.mjs
node --check new/restart-optimizer-ui.js
npm install --no-save --no-package-lock playwright-core@1.57.0
node ops/ovh/sse-stream-v1-20261120/test-backend.mjs
node ops/ovh/sse-stream-v1-20261120/test-client.cjs
node ops/ovh/sse-stream-v1-20261120/build-live-qa.mjs
node --check ops/ovh/sse-stream-v1-20261120/_live-qa.mjs
for n in python-ga-upstream.mjs restart-optimizer-ui.js; do
 sha "old/$n" > "$tmp/old-$n.sha"
 sha "new/$n" > "$tmp/new-$n.sha"
done
echo SSE_KPI_PREDEPLOY_BROWSER_BACKEND_TESTS_PASS
if [ "__PREFLIGHT_ONLY__" = yes ]; then
 echo SSE_KPI_READONLY_BRANCH_PREFLIGHT_PASS
 exit 0
fi
for n in python-ga-upstream.mjs restart-optimizer-ui.js; do
 scp_call "new/$n" "$USER@$HOST:$base/sse-kpi-20261120-$n.next"
done
deployed=0
rollback_if_needed(){
 if [ "$deployed" = 1 ]; then
  ssh_call "$USER@$HOST" bash -s <<'REMOTE' || true
  set -euo pipefail
  root="$HOME/liftorbit-migration"
  base="$root/sources/ovh-app"
  backup="$root/patch-backups/sse-kpi-20261120"
  for n in python-ga-upstream.mjs restart-optimizer-ui.js; do
   test -r "$backup/$n"
   cp -p "$backup/$n" "$base/current/$n"
  done
  sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/qa-rollback-private.log" 2>&1 || true
  healthy=no
  for attempt in $(seq 1 30); do
   if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1; then healthy=yes;break;fi
   sleep 5
  done
  test "$healthy" = yes
  echo SSE_KPI_ROLLBACK_RESTORED_AND_HEALTHY
REMOTE
 fi
}
trap rollback_if_needed ERR
ssh_call "$USER@$HOST" bash -s -- \
 "$(cat "$tmp/old-python-ga-upstream.mjs.sha")" "$(cat "$tmp/new-python-ga-upstream.mjs.sha")" \
 "$(cat "$tmp/old-restart-optimizer-ui.js.sha")" "$(cat "$tmp/new-restart-optimizer-ui.js.sha")" <<'REMOTE'
set -euo pipefail
root="$HOME/liftorbit-migration"
base="$root/sources/ovh-app"
backup="$root/patch-backups/sse-kpi-20261120"
mkdir -p "$backup"
sha(){ sha256sum "$1" | cut -d' ' -f1; }
test "$#" -eq 4
test "$(sha "$base/current/python-ga-upstream.mjs")" = "$1"
test "$(sha "$base/sse-kpi-20261120-python-ga-upstream.mjs.next")" = "$2"
test "$(sha "$base/current/restart-optimizer-ui.js")" = "$3"
test "$(sha "$base/sse-kpi-20261120-restart-optimizer-ui.js.next")" = "$4"
sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null
for n in python-ga-upstream.mjs restart-optimizer-ui.js; do
 cp -p "$base/current/$n" "$backup/$n"
done
test "$(sha "$backup/python-ga-upstream.mjs")" = "$1"
test "$(sha "$backup/restart-optimizer-ui.js")" = "$3"
restore(){
 trap - ERR
 for n in python-ga-upstream.mjs restart-optimizer-ui.js; do
  cp -p "$backup/$n" "$base/current/$n" || true
 done
 sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/rollback-private.log" 2>&1 || true
 echo SSE_KPI_INTERNAL_ROLLBACK_ATTEMPTED
}
trap restore ERR
mv "$base/sse-kpi-20261120-python-ga-upstream.mjs.next" "$base/current/python-ga-upstream.mjs"
mv "$base/sse-kpi-20261120-restart-optimizer-ui.js.next" "$base/current/restart-optimizer-ui.js"
sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/deploy-private.log" 2>&1
healthy=no
for attempt in $(seq 1 35); do
 if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1; then healthy=yes;break;fi
 sleep 5
done
test "$healthy" = yes
test "$(sha "$base/current/python-ga-upstream.mjs")" = "$2"
test "$(sha "$base/current/restart-optimizer-ui.js")" = "$4"
trap - ERR
echo SSE_KPI_TWO_FILE_PRODUCTION_DEPLOYED
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
echo SSE_KPI_HTTPS_AUTH_BOUNDARY_PASS
node ops/ovh/sse-stream-v1-20261120/_live-qa.mjs > "$tmp/qa.log" 2>&1 || {
 tail -n 65 "$tmp/qa.log"
 false
}
grep 'SSE_LIVE_PROGRESS_AND_PREVIEW_SUMMARY' "$tmp/qa.log"
grep 'SSE_VISIBLE_FULL_100_VERIFIED' "$tmp/qa.log"
grep 'CERAMIC_DURABLE_PLAN_VERIFIED' "$tmp/qa.log"
grep 'GA_START_502_HTML_ON_REAL_886_OP_CONTINUE_NO_DUPLICATE_PASS' "$tmp/qa.log"
if grep 'CERAMIC_DURABLE_PLAN_VERIFIED.*"completedEarly":true' "$tmp/qa.log"; then
 echo SSE_KPI_EARLY_STOP_REGRESSION
 false
fi
trap - ERR
echo SSE_KPI_FOUR_METRICS_TWO_REAL_886_OPERATION_GA_RUNS_PASS
