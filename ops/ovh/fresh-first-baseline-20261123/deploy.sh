#!/usr/bin/env bash
# OVH only. One UI file. Preserve models and Saved plans, roll back on failed QA.
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
base=/home/liftorbit-ci/liftorbit-migration/sources/ovh-app
scp_call "$USER@$HOST:$base/current/restart-optimizer-ui.js" "$tmp/old.js"
node ops/ovh/fresh-first-baseline-20261123/patch.mjs "$tmp/old.js" "$tmp/new.js"
node --check "$tmp/new.js"
npm install --no-save --no-package-lock playwright-core@1.57.0
node ops/ovh/fresh-first-baseline-20261123/test.cjs "$tmp/new.js"
old_sha=$(sha "$tmp/old.js")
new_sha=$(sha "$tmp/new.js")
echo FRESH_FIRST_BASELINE_CODE_AND_BROWSER_PREFLIGHT_PASS
if [ "${FRESH_BASELINE_PREFLIGHT_ONLY:-no}" = yes ];then
 echo FRESH_FIRST_BASELINE_READONLY_PREFLIGHT_PASS
 exit 0
fi
scp_call "$tmp/new.js" "$USER@$HOST:$base/fresh-first-baseline-20261123.next"
deployed=0
rollback_if_needed(){
 if [ "$deployed" = 1 ];then
  ssh_call "$USER@$HOST" bash -s <<'REMOTE' || true
  set -euo pipefail
  root="$HOME/liftorbit-migration"
  base="$root/sources/ovh-app"
  backup="$root/patch-backups/fresh-first-baseline-20261123/restart-optimizer-ui.js"
  target="$base/current/restart-optimizer-ui.js"
  test -r "$backup"
  cp -p "$backup" "$target"
  sudo -n /usr/local/sbin/liftorbit-ops update > "$root/patch-backups/fresh-first-baseline-20261123/qa-rollback-private.log" 2>&1 || true
  healthy=no
  for attempt in $(seq 1 30);do
   if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1;then healthy=yes;break;fi
   sleep 5
  done
  test "$healthy" = yes
  echo FRESH_FIRST_BASELINE_ROLLBACK_HEALTHY
REMOTE
 fi
}
trap rollback_if_needed ERR

ssh_call "$USER@$HOST" bash -s -- "$old_sha" "$new_sha" <<'REMOTE'
set -euo pipefail
root="$HOME/liftorbit-migration"
base="$root/sources/ovh-app"
target="$base/current/restart-optimizer-ui.js"
staged="$base/fresh-first-baseline-20261123.next"
backup="$root/patch-backups/fresh-first-baseline-20261123"
sha(){ sha256sum "$1" | cut -d' ' -f1; }
test "$#" -eq 2
test "$(sha "$target")" = "$1"
test "$(sha "$staged")" = "$2"
sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null
mkdir -p "$backup"
cp -p "$target" "$backup/restart-optimizer-ui.js"
test "$(sha "$backup/restart-optimizer-ui.js")" = "$1"
restore(){
 trap - ERR
 cp -p "$backup/restart-optimizer-ui.js" "$target" || true
 sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/rollback-private.log" 2>&1 || true
 echo FRESH_FIRST_BASELINE_INTERNAL_ROLLBACK_ATTEMPTED
}
trap restore ERR
mv "$staged" "$target"
sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/deploy-private.log" 2>&1
healthy=no
for attempt in $(seq 1 35);do
 if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1;then healthy=yes;break;fi
 sleep 5
done
test "$healthy" = yes
test "$(sha "$target")" = "$2"
trap - ERR
echo FRESH_FIRST_BASELINE_UI_ONLY_DEPLOYED
REMOTE
deployed=1

healthy=no
for attempt in $(seq 1 22);do
 h=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 https://app.liftorbit.app/__bridge_health || true)
 a=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 https://app.liftorbit.app/api/auth/me || true)
 e=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 https://app.liftorbit.app/api/plan-events || true)
 if [[ "$h" = 200 && "$a" = 401 && "$e" = 401 ]];then healthy=yes;break;fi
 sleep 5
done
test "$healthy" = yes
echo FRESH_FIRST_BASELINE_HTTPS_AUTH_PASS
# Recheck exact deployed byte source after building.
scp_call "$USER@$HOST:$base/current/restart-optimizer-ui.js" "$tmp/current.js"
test "$(sha "$tmp/current.js")" = "$new_sha"
node ops/ovh/fresh-first-baseline-20261123/test.cjs "$tmp/current.js"
echo FRESH_FIRST_BASELINE_DEPLOYED_BROWSER_REGRESSION_PASS
trap - ERR
echo FRESH_FIRST_BASELINE_OVH_COMPLETE
