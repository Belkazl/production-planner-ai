#!/usr/bin/env bash
set -Eeuo pipefail
test "$DEPLOY_HOST" = 51.255.163.121
test "$DEPLOY_USER" = liftorbit-ci
test "$GITHUB_REF" = refs/heads/fix/ga-decimal-progress-20261126
[[ "$GITHUB_RUN_ID" =~ ^[0-9]{1,16}$ ]]
attempt=${GITHUB_RUN_ATTEMPT:-1}
[[ "$attempt" =~ ^[0-9]{1,4}$ ]]
umask 077
d=$(mktemp -d "$RUNNER_TEMP/decimal-progress.XXXXXX")
printf '%s\n' "$DEPLOY_KEY" > "$d/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$d/kh"
chmod 600 "$d/key" "$d/kh"
ssh_call(){ ssh -i "$d/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$d/kh" -o ConnectTimeout=20 "$@"; }
scp_call(){ scp -q -i "$d/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$d/kh" -o ConnectTimeout=20 "$@"; }
target="$DEPLOY_USER@$DEPLOY_HOST"
root=/home/liftorbit-ci/liftorbit-migration
app="$root/sources/ovh-app/current"
worker="$root/sources/current/ga/ga_workers"
stage="$root/sources/ovh-app/decimal-progress-20261126-$GITHUB_RUN_ID-$attempt"
names=(full_runtime_adapter.py manager.py python-ga-upstream.mjs restart-optimizer-ui.js auth-runtime.js)
paths=("$worker/full_runtime_adapter.py" "$worker/manager.py" "$app/python-ga-upstream.mjs" "$app/restart-optimizer-ui.js" "$app/auth-runtime.js")
sha(){ sha256sum "$1" | cut -d' ' -f1; }
deployed=no
accepted=no
cleanup(){
 rc=$?
 trap - EXIT
 if test "$deployed" = yes && test "$accepted" != yes;then
  echo DECIMAL_ACCEPTANCE_FAILED_ROLLBACK
  if ! ssh_call "$target" bash -s -- "$GITHUB_RUN_ID" "$attempt" "${old[@]}" "${new[@]}" <<'REMOTE'
set -Eeuo pipefail
umask 077
[[ "$1" =~ ^[0-9]{1,16}$ ]] && [[ "$2" =~ ^[0-9]{1,4}$ ]]
root=/home/liftorbit-ci/liftorbit-migration
backup="$root/patch-backups/decimal-progress-20261126/$1-$2"
shift 2
test "$#" -eq 10
for h in "$@";do [[ "$h" =~ ^[0-9a-f]{64}$ ]];done
hashes=("$@")
names=(full_runtime_adapter.py manager.py python-ga-upstream.mjs restart-optimizer-ui.js auth-runtime.js)
paths=("$root/sources/current/ga/ga_workers/full_runtime_adapter.py" "$root/sources/current/ga/ga_workers/manager.py" "$root/sources/ovh-app/current/python-ga-upstream.mjs" "$root/sources/ovh-app/current/restart-optimizer-ui.js" "$root/sources/ovh-app/current/auth-runtime.js")
sha(){ sha256sum "$1"|cut -d' ' -f1; }
for i in 0 1 2 3 4;do
 test "$(sha "${paths[$i]}")" = "${hashes[$((i+5))]}"
 test "$(sha "$backup/${names[$i]}")" = "${hashes[$i]}"
done
for i in 0 1 2 3 4;do cp -p "$backup/${names[$i]}" "${paths[$i]}";done
sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/rollback-private.log" 2>&1
for n in $(seq 1 36);do
 if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1;then echo DECIMAL_ROLLBACK_HEALTH_PASS;exit 0;fi
 sleep 5
done
exit 6
REMOTE
  then echo DECIMAL_ROLLBACK_UNCONFIRMED;rc=6;fi
 fi
 rm -rf -- "$d"
 exit "$rc"
}
trap cleanup EXIT
mkdir -m 700 "$d/before" "$d/after"
for i in 0 1 2 3 4;do scp_call "$target:${paths[$i]}" "$d/before/${names[$i]}";done
python3 -B ops/ovh/ga-decimal-progress-20261126/patch.py "$d/before" "$d/after"
node --check "$d/after/python-ga-upstream.mjs"
node --check "$d/after/restart-optimizer-ui.js"
node --check "$d/after/auth-runtime.js"
node ops/ovh/ga-decimal-progress-20261126/browser-unit.mjs "$d/after/restart-optimizer-ui.js"
old=();new=()
for i in 0 1 2 3 4;do old+=("$(sha "$d/before/${names[$i]}")");new+=("$(sha "$d/after/${names[$i]}")");done
ssh_call "$target" bash -s -- "$GITHUB_RUN_ID" "$attempt" <<'REMOTE'
set -euo pipefail
umask 077
[[ "$1" =~ ^[0-9]{1,16}$ ]] && [[ "$2" =~ ^[0-9]{1,4}$ ]]
stage="/home/liftorbit-ci/liftorbit-migration/sources/ovh-app/decimal-progress-20261126-$1-$2"
test ! -e "$stage" && test ! -L "$stage"
mkdir -m 700 "$stage"
REMOTE
for i in 0 1 2 3 4;do scp_call "$d/after/${names[$i]}" "$target:$stage/${names[$i]}";done
ssh_call "$target" bash -s -- "$GITHUB_RUN_ID" "$attempt" "${old[@]}" "${new[@]}" <<'REMOTE'
set -Eeuo pipefail
umask 077
[[ "$1" =~ ^[0-9]{1,16}$ ]] && [[ "$2" =~ ^[0-9]{1,4}$ ]]
root=/home/liftorbit-ci/liftorbit-migration
stage="$root/sources/ovh-app/decimal-progress-20261126-$1-$2"
backup="$root/patch-backups/decimal-progress-20261126/$1-$2"
shift 2
test "$#" -eq 10
for h in "$@";do [[ "$h" =~ ^[0-9a-f]{64}$ ]];done
hashes=("$@")
names=(full_runtime_adapter.py manager.py python-ga-upstream.mjs restart-optimizer-ui.js auth-runtime.js)
paths=("$root/sources/current/ga/ga_workers/full_runtime_adapter.py" "$root/sources/current/ga/ga_workers/manager.py" "$root/sources/ovh-app/current/python-ga-upstream.mjs" "$root/sources/ovh-app/current/restart-optimizer-ui.js" "$root/sources/ovh-app/current/auth-runtime.js")
sha(){ sha256sum "$1"|cut -d' ' -f1; }
for i in 0 1 2 3 4;do
 test -f "${paths[$i]}" && test ! -L "${paths[$i]}"
 test -f "$stage/${names[$i]}" && test ! -L "$stage/${names[$i]}"
 test "$(sha "${paths[$i]}")" = "${hashes[$i]}"
 test "$(sha "$stage/${names[$i]}")" = "${hashes[$((i+5))]}"
done
sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1
test ! -e "$backup" && test ! -L "$backup"
mkdir -m 700 -p "$backup"
for i in 0 1 2 3 4;do
 cp -p "${paths[$i]}" "$backup/${names[$i]}"
 test "$(sha "$backup/${names[$i]}")" = "${hashes[$i]}"
done
wait_smoke(){
 for n in $(seq 1 36);do
   if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1;then return 0;fi
   sleep 5
 done
 return 1
}
rollback(){
 rc=$?
 trap - ERR
 set +e
 for i in 0 1 2 3 4;do cp -p "$backup/${names[$i]}" "${paths[$i]}";done
 sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/rollback-private.log" 2>&1
 if test $? -eq 0 && wait_smoke;then echo DECIMAL_INSTALL_ROLLBACK_HEALTH_PASS;else echo DECIMAL_INSTALL_ROLLBACK_UNCONFIRMED;fi
 exit "$rc"
}
trap rollback ERR
echo DECIMAL_INSTALL_FIVE_PROGRESS_FILES
for i in 0 1 2 3 4;do cp "$stage/${names[$i]}" "${paths[$i]}";done
for i in 0 1 2 3 4;do test "$(sha "${paths[$i]}")" = "${hashes[$((i+5))]}";done
sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/update-private.log" 2>&1
wait_smoke
for i in 0 1 2 3 4;do test "$(sha "${paths[$i]}")" = "${hashes[$((i+5))]}";done
trap - ERR
echo DECIMAL_INTERNAL_HEALTH_PASS
REMOTE
deployed=yes
stable=0
for n in $(seq 1 30);do
 root_code=$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' https://app.liftorbit.app/ 2>/dev/null || true)
 bridge_code=$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' https://app.liftorbit.app/__bridge_health 2>/dev/null || true)
 auth_code=$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' https://app.liftorbit.app/api/auth/me 2>/dev/null || true)
 printf 'DECIMAL_PUBLIC_READY attempt=%s root=%s bridge=%s auth=%s\n' "$n" "$root_code" "$bridge_code" "$auth_code"
 if test "$root_code" = 200 && test "$bridge_code" = 200 && test "$auth_code" = 401;then stable=$((stable+1));else stable=0;fi
 if test "$stable" -ge 3;then break;fi
 sleep 5
done
test "$stable" -ge 3
node ops/ovh/ga-decimal-progress-20261126/browser-live.mjs
accepted=yes
echo DECIMAL_PROGRESS_DEPLOYED_AND_VERIFIED
