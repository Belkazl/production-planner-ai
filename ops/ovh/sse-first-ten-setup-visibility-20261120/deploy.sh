#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$HOST" = "51.255.163.121"
test "$USER" = "liftorbit-ci"
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
mkdir -p new
scp_call "$USER@$HOST:$base/current/python-ga-upstream.mjs" "$tmp/old.mjs"
node ops/ovh/sse-first-ten-setup-visibility-20261120/patch.mjs "$tmp/old.mjs" new/python-ga-upstream.mjs
node --check new/python-ga-upstream.mjs
npm install --no-save --no-package-lock playwright-core@1.57.0
node ops/ovh/sse-stream-v1-20261120/test-backend.mjs
node ops/ovh/sse-stream-v1-20261120/test-client.cjs
node ops/ovh/sse-stream-v1-20261120/build-live-qa.mjs
node --check ops/ovh/sse-stream-v1-20261120/_live-qa.mjs
echo SSE_FIRST_TEN_VISIBLE_SETUP_PREFLIGHT_PASS
if [ "${FIRST_TEN_VISIBILITY_PREFLIGHT_ONLY:-no}" = yes ]; then
 echo SSE_FIRST_TEN_VISIBLE_SETUP_READONLY_PASS
 exit 0
fi

before=$(sha "$tmp/old.mjs")
after=$(sha new/python-ga-upstream.mjs)
scp_call new/python-ga-upstream.mjs "$USER@$HOST:$base/first-ten-visibility-20261120.next"
deployed=0
rollback_if_needed(){
 if [ "$deployed" = 1 ]; then
  ssh_call "$USER@$HOST" bash -s <<'REMOTE' || true
  set -euo pipefail
  root="$HOME/liftorbit-migration"
  base="$root/sources/ovh-app"
  backup="$root/patch-backups/first-ten-visibility-20261120"
  test -r "$backup/python-ga-upstream.mjs"
  cp -p "$backup/python-ga-upstream.mjs" "$base/current/python-ga-upstream.mjs"
  sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/qa-rollback-private.log" 2>&1 || true
  healthy=no
  for attempt in $(seq 1 30); do
   if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1; then healthy=yes;break;fi
   sleep 5
  done
  test "$healthy" = yes
  echo SSE_FIRST_TEN_VISIBLE_SETUP_ROLLBACK_HEALTHY
REMOTE
 fi
}
trap rollback_if_needed ERR

ssh_call "$USER@$HOST" bash -s -- "$before" "$after" <<'REMOTE'
set -euo pipefail
root="$HOME/liftorbit-migration"
base="$root/sources/ovh-app"
old="$base/current/python-ga-upstream.mjs"
staged="$base/first-ten-visibility-20261120.next"
backup="$root/patch-backups/first-ten-visibility-20261120"
sha(){ sha256sum "$1" | cut -d' ' -f1; }
test $# -eq 2
test "$(sha "$old")" = "$1"
test "$(sha "$staged")" = "$2"
sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null
mkdir -p "$backup"
cp -p "$old" "$backup/python-ga-upstream.mjs"
test "$(sha "$backup/python-ga-upstream.mjs")" = "$1"
rollback(){
 trap - ERR
 cp -p "$backup/python-ga-upstream.mjs" "$old" || true
 sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/rollback-private.log" 2>&1 || true
 echo SSE_FIRST_TEN_VISIBLE_SETUP_INTERNAL_ROLLBACK_ATTEMPTED
}
trap rollback ERR
mv "$staged" "$old"
sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/deploy-private.log" 2>&1
healthy=no
for attempt in $(seq 1 35); do
 if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1; then healthy=yes;break;fi
 sleep 5
done
test "$healthy" = yes
test "$(sha "$old")" = "$2"
trap - ERR
echo SSE_FIRST_TEN_VISIBLE_SETUP_BACKEND_DEPLOYED
REMOTE
deployed=1
healthy=no
for attempt in $(seq 1 20); do
 h=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 https://app.liftorbit.app/__bridge_health || true)
 a=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 https://app.liftorbit.app/api/auth/me || true)
 e=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 https://app.liftorbit.app/api/plan-events || true)
 if [[ "$h" = 200 && "$a" = 401 && "$e" = 401 ]]; then healthy=yes;break;fi
 sleep 5
done
test "$healthy" = yes
echo SSE_FIRST_TEN_VISIBLE_SETUP_HTTPS_AUTH_PASS
node ops/ovh/sse-stream-v1-20261120/_live-qa.mjs > "$tmp/live-qa.log" 2>&1 || {
 tail -n 60 "$tmp/live-qa.log"
 false
}
grep 'SSE_LIVE_PROGRESS_AND_PREVIEW_SUMMARY' "$tmp/live-qa.log"
grep 'SSE_VISIBLE_FULL_100_VERIFIED' "$tmp/live-qa.log"
grep 'CERAMIC_DURABLE_PLAN_VERIFIED' "$tmp/live-qa.log"
grep 'GA_START_502_HTML_ON_REAL_886_OP_CONTINUE_NO_DUPLICATE_PASS' "$tmp/live-qa.log"
if grep 'CERAMIC_DURABLE_PLAN_VERIFIED.*"completedEarly":true' "$tmp/live-qa.log"; then
 echo SSE_FIRST_TEN_UNEXPECTED_EARLY_FINISH
 false
fi
trap - ERR
echo SSE_FIRST_TEN_VISIBLE_SETUP_TWO_REAL_GA_RUNS_PASS
