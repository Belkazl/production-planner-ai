#!/usr/bin/env bash
# Two-file guarded production repair: complete configured GA generations, never time out.
set -euo pipefail
umask 077
test "$HOST" = "51.255.163.121"
test "$USER" = "liftorbit-ci"
work=$(mktemp -d)
cleanup(){ rm -rf "$work"; }
trap cleanup EXIT
printf '%s\n' "$KEY" > "$work/key"
printf '%s\n' "$KH" > "$work/kh"
chmod 600 "$work/key" "$work/kh"
ssh_call(){
  ssh -i "$work/key" -o BatchMode=yes -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$work/kh" -o ConnectTimeout=20 "$@"
}
scp_call(){
  scp -q -i "$work/key" -o BatchMode=yes -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$work/kh" -o ConnectTimeout=20 "$@"
}
sha(){ sha256sum "$1" | cut -d' ' -f1; }
base="/home/liftorbit-ci/liftorbit-migration/sources/current/ga/ga_workers"
stage="/home/liftorbit-ci/liftorbit-migration/sources/ovh-app"
mkdir -p old/ga_python_workers/ga_workers
for n in manager.py server.py fixture.py; do
  scp_call "$USER@$HOST:$base/$n" "old/ga_python_workers/ga_workers/$n"
done
mkdir -p new
cp -a old/. new/
python3 ops/ovh/ga-generations-only-20261120/patch.py new
python3 -m py_compile new/ga_python_workers/ga_workers/manager.py \
  new/ga_python_workers/ga_workers/server.py new/ga_python_workers/ga_workers/fixture.py
python3 ops/ovh/ga-generations-only-20261120/test.py
for n in manager.py server.py; do
  sha "old/ga_python_workers/ga_workers/$n" > "$work/old-$n.sha"
  sha "new/ga_python_workers/ga_workers/$n" > "$work/new-$n.sha"
done
node ops/ovh/sse-stream-v1-20261120/build-live-qa.mjs
node --check ops/ovh/sse-stream-v1-20261120/_live-qa.mjs
npm install --no-save --no-package-lock playwright-core@1.57.0
echo GA_GENERATIONS_ONLY_PREFLIGHT_PASS

for n in manager.py server.py; do
  scp_call "new/ga_python_workers/ga_workers/$n" "$USER@$HOST:$stage/genonly-20261120-$n.next"
done

deployed=0
rollback_if_needed(){
  if [ "$deployed" = 1 ]; then
    ssh_call "$USER@$HOST" bash -s <<'REMOTE' || true
    set -euo pipefail
    root="$HOME/liftorbit-migration"
    base="$root/sources/current/ga/ga_workers"
    backup="$root/patch-backups/ga-generations-only-20261120"
    test -r "$backup/manager.py" && test -r "$backup/server.py"
    cp -p "$backup/manager.py" "$base/manager.py"
    cp -p "$backup/server.py" "$base/server.py"
    sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/qa-rollback-private.log" 2>&1 || true
    healthy=no
    for attempt in $(seq 1 28); do
      if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1; then healthy=yes;break;fi
      sleep 5
    done
    test "$healthy" = yes
    echo GA_GENERATIONS_ONLY_ROLLBACK_HEALTHY
REMOTE
  fi
}
trap rollback_if_needed ERR

ssh_call "$USER@$HOST" bash -s -- \
   "$(cat "$work/old-manager.py.sha")" "$(cat "$work/new-manager.py.sha")" \
   "$(cat "$work/old-server.py.sha")" "$(cat "$work/new-server.py.sha")" <<'REMOTE'
set -euo pipefail
root="$HOME/liftorbit-migration"
base="$root/sources/current/ga/ga_workers"
stage="$root/sources/ovh-app"
backup="$root/patch-backups/ga-generations-only-20261120"
sha(){ sha256sum "$1" | cut -d' ' -f1; }
test "$#" -eq 4
test "$(sha "$base/manager.py")" = "$1"
test "$(sha "$stage/genonly-20261120-manager.py.next")" = "$2"
test "$(sha "$base/server.py")" = "$3"
test "$(sha "$stage/genonly-20261120-server.py.next")" = "$4"
sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null
mkdir -p "$backup"
cp -p "$base/manager.py" "$backup/manager.py"
cp -p "$base/server.py" "$backup/server.py"
test "$(sha "$backup/manager.py")" = "$1"
test "$(sha "$backup/server.py")" = "$3"
rollback(){
  trap - ERR
  cp -p "$backup/manager.py" "$base/manager.py" || true
  cp -p "$backup/server.py" "$base/server.py" || true
  sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/rollback-private.log" 2>&1 || true
  echo GA_GENERATIONS_ONLY_INTERNAL_ROLLBACK_ATTEMPTED
}
trap rollback ERR
mv "$stage/genonly-20261120-manager.py.next" "$base/manager.py"
mv "$stage/genonly-20261120-server.py.next" "$base/server.py"
sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/deploy-private.log" 2>&1
healthy=no
for attempt in $(seq 1 38); do
  if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1; then healthy=yes;break;fi
  sleep 5
done
test "$healthy" = yes
test "$(sha "$base/manager.py")" = "$2"
test "$(sha "$base/server.py")" = "$4"
trap - ERR
echo GA_GENERATIONS_ONLY_TWO_WORKER_FILES_DEPLOYED
REMOTE
deployed=1

healthy=no
for attempt in $(seq 1 22); do
  h=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 https://app.liftorbit.app/__bridge_health || true)
  a=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 https://app.liftorbit.app/api/auth/me || true)
  e=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 https://app.liftorbit.app/api/plan-events || true)
  if [ "$h" = 200 ] && [ "$a" = 401 ] && [ "$e" = 401 ]; then healthy=yes;break;fi
  sleep 5
done
test "$healthy" = yes
echo GA_GENERATIONS_ONLY_HTTP_AUTH_PASS
node ops/ovh/sse-stream-v1-20261120/_live-qa.mjs > "$work/live-qa.log" 2>&1 || {
  tail -n 65 "$work/live-qa.log"
  false
}
grep 'SSE_VISIBLE_FULL_100_VERIFIED' "$work/live-qa.log"
grep 'CERAMIC_DURABLE_PLAN_VERIFIED' "$work/live-qa.log"
grep 'GA_START_502_HTML_ON_REAL_886_OP_CONTINUE_NO_DUPLICATE_PASS' "$work/live-qa.log"
if grep 'CERAMIC_DURABLE_PLAN_VERIFIED.*"completedEarly":true' "$work/live-qa.log"; then
  echo GA_GENERATIONS_UNEXPECTED_EARLY_COMPLETION
  false
fi
if ! grep 'CERAMIC_DURABLE_PLAN_VERIFIED.*"actualGenerations":20' "$work/live-qa.log"; then
  echo GA_GENERATIONS_NOT_20_ON_QUICK_REGRESSION
  false
fi
trap - ERR
echo GA_GENERATIONS_ONLY_FULL_PRODUCTION_REGRESSION_PASS
