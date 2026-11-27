#!/usr/bin/env bash
# Release the reviewed equipment toolbar and restore the previous runtime on failed acceptance.
set -Eeuo pipefail
test "$DEPLOY_HOST" = 51.255.163.121
test "$DEPLOY_USER" = liftorbit-ci
test "$GITHUB_REF" = refs/heads/main
[[ "$GITHUB_RUN_ID" =~ ^[0-9]{1,16}$ ]]
attempt=$GITHUB_RUN_ATTEMPT
[[ "$attempt" =~ ^[0-9]{1,4}$ ]]
umask 077
d=$(mktemp -d "$RUNNER_TEMP/equipment-sdk-toolbar.XXXXXX")
printf '%s\n' "$DEPLOY_KEY" > "$d/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$d/known-hosts"
chmod 600 "$d/key" "$d/known-hosts"
ssh_call(){ ssh -i "$d/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$d/known-hosts" -o ConnectTimeout=20 "$@"; }
scp_call(){ scp -q -i "$d/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$d/known-hosts" -o ConnectTimeout=20 "$@"; }
target="$DEPLOY_USER@$DEPLOY_HOST"
root=/home/liftorbit-ci/liftorbit-migration
app="$root/sources/ovh-app/current"
stage="$root/sources/ovh-app/employees-sdk-$GITHUB_RUN_ID-$attempt"
unset DEPLOY_KEY DEPLOY_KNOWN_HOSTS
deployed=no
accepted=no
cleanup(){
 rc=$?
 trap - EXIT
 if test "$deployed" = yes && test "$accepted" != yes;then
   echo EQUIPMENT_SDK_ACCEPTANCE_FAILED_ROLLBACK
   if ! ssh_call "$target" bash -s -- "$GITHUB_RUN_ID" "$attempt" "$old_sha" "$new_sha" <<'REMOTE'
set -Eeuo pipefail
[[ "$1" =~ ^[0-9]{1,16}$ && "$2" =~ ^[0-9]{1,4}$ && "$3" =~ ^[0-9a-f]{64}$ && "$4" =~ ^[0-9a-f]{64}$ ]]
root=/home/liftorbit-ci/liftorbit-migration
app="$root/sources/ovh-app/current"
backup="$root/patch-backups/employees-sdk/$1-$2"
sha(){ sha256sum "$1" | cut -d' ' -f1; }
test "$(sha "$backup/auth-runtime.js")" = "$3"
test "$(sha "$app/auth-runtime.js")" = "$4"
cp -p "$backup/auth-runtime.js" "$app/auth-runtime.js"
sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/rollback-private.log" 2>&1
for n in $(seq 1 36);do
 if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1;then echo EQUIPMENT_SDK_ROLLBACK_HEALTH_PASS;exit 0;fi
 sleep 5
done
exit 6
REMOTE
   then echo EQUIPMENT_SDK_ROLLBACK_UNCONFIRMED;rc=6;fi
 fi
 rm -rf -- "$d"
 exit "$rc"
}
trap cleanup EXIT
scp_call "$target:$app/auth-runtime.js" "$d/before.js"
old_sha=$(sha256sum "$d/before.js"|cut -d' ' -f1)
node ops/ovh/employees-sdk/patch.mjs "$d/before.js" "$d/after.js"
node --check "$d/after.js"
new_sha=$(sha256sum "$d/after.js"|cut -d' ' -f1)
ssh_call "$target" bash -s -- "$GITHUB_RUN_ID" "$attempt" <<'REMOTE'
set -euo pipefail
umask 077
[[ "$1" =~ ^[0-9]{1,16}$ && "$2" =~ ^[0-9]{1,4}$ ]]
stage="/home/liftorbit-ci/liftorbit-migration/sources/ovh-app/employees-sdk-$1-$2"
test ! -e "$stage" && test ! -L "$stage"
mkdir -m 700 "$stage"
REMOTE
scp_call "$d/after.js" "$target:$stage/auth-runtime.js"
ssh_call "$target" bash -s -- "$GITHUB_RUN_ID" "$attempt" "$old_sha" "$new_sha" <<'REMOTE'
set -Eeuo pipefail
umask 077
[[ "$1" =~ ^[0-9]{1,16}$ && "$2" =~ ^[0-9]{1,4}$ && "$3" =~ ^[0-9a-f]{64}$ && "$4" =~ ^[0-9a-f]{64}$ ]]
root=/home/liftorbit-ci/liftorbit-migration
app="$root/sources/ovh-app/current"
stage="$root/sources/ovh-app/employees-sdk-$1-$2"
backup="$root/patch-backups/employees-sdk/$1-$2"
sha(){ sha256sum "$1" | cut -d' ' -f1; }
test -f "$app/auth-runtime.js" && test ! -L "$app/auth-runtime.js"
test -f "$stage/auth-runtime.js" && test ! -L "$stage/auth-runtime.js"
test "$(sha "$app/auth-runtime.js")" = "$3"
test "$(sha "$stage/auth-runtime.js")" = "$4"
tenant=$(sha "$app/tenant-model-runtime.js")
native=$(sha "$app/python-ga-upstream.mjs")
sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1
test ! -e "$backup" && test ! -L "$backup"
mkdir -m 700 -p "$backup"
cp -p "$app/auth-runtime.js" "$backup/auth-runtime.js"
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
 cp -p "$backup/auth-runtime.js" "$app/auth-runtime.js"
 sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/rollback-private.log" 2>&1
 if test $? -eq 0 && wait_smoke;then echo EQUIPMENT_SDK_ROLLBACK_HEALTH_PASS;else echo EQUIPMENT_SDK_ROLLBACK_UNCONFIRMED;fi
 exit "$rc"
}
trap rollback ERR
echo EQUIPMENT_SDK_INSTALLING
cp "$stage/auth-runtime.js" "$app/auth-runtime.js"
test "$(sha "$app/auth-runtime.js")" = "$4"
sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/update-private.log" 2>&1
wait_smoke
test "$(sha "$app/auth-runtime.js")" = "$4"
test "$(sha "$app/tenant-model-runtime.js")" = "$tenant"
test "$(sha "$app/python-ga-upstream.mjs")" = "$native"
trap - ERR
echo EQUIPMENT_SDK_SERVICE_HEALTH_PASS
REMOTE
deployed=yes
stable=0
for n in $(seq 1 30);do
 root_code=$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' https://app.liftorbit.app/ 2>/dev/null || true)
 bridge_code=$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' https://app.liftorbit.app/__bridge_health 2>/dev/null || true)
 auth_code=$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' https://app.liftorbit.app/api/auth/me 2>/dev/null || true)
 if test "$root_code" = 200 && test "$bridge_code" = 200 && test "$auth_code" = 401;then stable=$((stable+1));else stable=0;fi
 if test "$stable" -ge 3;then break;fi
 sleep 5
done
test "$stable" -ge 3
PP_EMPLOYEES_SDK_LIVE=1 node ops/ovh/employees-sdk/browser_accept.mjs
accepted=yes
echo EQUIPMENT_SDK_DEPLOYED_AND_VERIFIED
