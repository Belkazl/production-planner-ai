#!/usr/bin/env bash
# Deploy only the two reviewed application files, with automatic rollback on any failed check.
set -Eeuo pipefail
test "$DEPLOY_HOST" = 51.255.163.121
test "$DEPLOY_USER" = liftorbit-ci
test "$GITHUB_REF" = refs/heads/feat/groq-assistant-20261125
[[ "$GITHUB_RUN_ID" =~ ^[0-9]{1,16}$ ]]
attempt=${GITHUB_RUN_ATTEMPT:-1}
[[ "$attempt" =~ ^[0-9]{1,4}$ ]]
umask 077
d=$(mktemp -d "$RUNNER_TEMP/groq-release.XXXXXX")
printf '%s\n' "$DEPLOY_KEY" > "$d/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$d/known-hosts"
chmod 600 "$d/key" "$d/known-hosts"
ssh_call(){ ssh -i "$d/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$d/known-hosts" -o ConnectTimeout=20 "$@"; }
scp_call(){ scp -q -i "$d/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$d/known-hosts" -o ConnectTimeout=20 "$@"; }
target="$DEPLOY_USER@$DEPLOY_HOST"
root=/home/liftorbit-ci/liftorbit-migration
app="$root/sources/ovh-app/current"
stage="$root/sources/ovh-app/groq-assistant-20261125-$GITHUB_RUN_ID-$attempt"
backup="$root/patch-backups/groq-assistant-20261125/$GITHUB_RUN_ID-$attempt"
deployed=no
accepted=no
cleanup(){
  rc=$?
  trap - EXIT
  if test "$deployed" = yes && test "$accepted" != yes; then
    echo GROQ_LIVE_ACCEPTANCE_FAILED_ROLLBACK
    if ! ssh_call "$target" bash -s -- "$GITHUB_RUN_ID" "$attempt" "$new_auth" "$new_tenant" <<'REMOTE'
set -Eeuo pipefail
umask 077
[[ "$1" =~ ^[0-9]{1,16}$ ]] && [[ "$2" =~ ^[0-9]{1,4}$ ]] && [[ "$3" =~ ^[0-9a-f]{64}$ ]] && [[ "$4" =~ ^[0-9a-f]{64}$ ]]
root=/home/liftorbit-ci/liftorbit-migration
app="$root/sources/ovh-app/current"
backup="$root/patch-backups/groq-assistant-20261125/$1-$2"
sha(){ sha256sum "$1" | cut -d' ' -f1; }
test "$(sha "$app/auth-runtime.js")" = "$3"
test "$(sha "$app/tenant-model-runtime.js")" = "$4"
test "$(sha "$backup/auth-runtime.js")" = c60ae5026f9906b0c4fb1496bd9a74e7a579124dd5f647f4d44104e92ccee9e8
test "$(sha "$backup/tenant-model-runtime.js")" = 77544897a595c4effd16f631fd3194c9eab74dace4bdbfc60ba07f59b744fa48
cp -p "$backup/auth-runtime.js" "$app/auth-runtime.js"
cp -p "$backup/tenant-model-runtime.js" "$app/tenant-model-runtime.js"
sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/rollback-private.log" 2>&1
for n in $(seq 1 36); do
 if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1; then echo GROQ_LIVE_ROLLBACK_HEALTH_PASS;exit 0;fi
 sleep 5
done
exit 6
REMOTE
    then echo GROQ_LIVE_ROLLBACK_UNCONFIRMED; rc=6; fi
  fi
  rm -rf -- "$d"
  exit "$rc"
}
trap cleanup EXIT
mkdir -m 700 "$d/before" "$d/after"
echo GROQ_RELEASE_CAPTURE_CODE_ONLY
scp_call "$target:$app/auth-runtime.js" "$target:$app/tenant-model-runtime.js" "$d/before/"
node ops/ovh/groq-assistant-20261125/patch.mjs "$d/before" "$d/after"
node --check "$d/after/auth-runtime.js"
node --check "$d/after/tenant-model-runtime.js"
new_auth=$(sha256sum "$d/after/auth-runtime.js"|cut -d' ' -f1)
new_tenant=$(sha256sum "$d/after/tenant-model-runtime.js"|cut -d' ' -f1)
ssh_call "$target" bash -s -- "$GITHUB_RUN_ID" "$attempt" <<'REMOTE'
set -euo pipefail
umask 077
[[ "$1" =~ ^[0-9]{1,16}$ ]] && [[ "$2" =~ ^[0-9]{1,4}$ ]]
stage="/home/liftorbit-ci/liftorbit-migration/sources/ovh-app/groq-assistant-20261125-$1-$2"
test ! -e "$stage" && test ! -L "$stage"
mkdir -m 700 "$stage"
REMOTE
scp_call "$d/after/auth-runtime.js" "$d/after/tenant-model-runtime.js" "$target:$stage/"
ssh_call "$target" bash -s -- "$GITHUB_RUN_ID" "$attempt" "$new_auth" "$new_tenant" <<'REMOTE'
set -Eeuo pipefail
umask 077
[[ "$1" =~ ^[0-9]{1,16}$ ]] && [[ "$2" =~ ^[0-9]{1,4}$ ]] && [[ "$3" =~ ^[0-9a-f]{64}$ ]] && [[ "$4" =~ ^[0-9a-f]{64}$ ]]
root=/home/liftorbit-ci/liftorbit-migration
app="$root/sources/ovh-app/current"
stage="$root/sources/ovh-app/groq-assistant-20261125-$1-$2"
backup="$root/patch-backups/groq-assistant-20261125/$1-$2"
sha(){ sha256sum "$1" | cut -d' ' -f1; }
for name in auth-runtime.js tenant-model-runtime.js;do
 test -f "$app/$name" && test ! -L "$app/$name"
 test -f "$stage/$name" && test ! -L "$stage/$name"
done
test "$(sha "$app/auth-runtime.js")" = c60ae5026f9906b0c4fb1496bd9a74e7a579124dd5f647f4d44104e92ccee9e8
test "$(sha "$app/tenant-model-runtime.js")" = 77544897a595c4effd16f631fd3194c9eab74dace4bdbfc60ba07f59b744fa48
test "$(sha "$stage/auth-runtime.js")" = "$3"
test "$(sha "$stage/tenant-model-runtime.js")" = "$4"
sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1
test ! -e "$backup" && test ! -L "$backup"
mkdir -m 700 -p "$backup"
cp -p "$app/auth-runtime.js" "$app/tenant-model-runtime.js" "$backup/"
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
 cp -p "$backup/auth-runtime.js" "$backup/tenant-model-runtime.js" "$app/"
 sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/rollback-private.log" 2>&1
 if test $? -eq 0 && wait_smoke;then echo GROQ_DEPLOY_ROLLBACK_HEALTH_PASS;else echo GROQ_DEPLOY_ROLLBACK_UNCONFIRMED;fi
 exit "$rc"
}
trap rollback ERR
echo GROQ_RELEASE_INSTALLING_TWO_FILES
cp "$stage/auth-runtime.js" "$stage/tenant-model-runtime.js" "$app/"
test "$(sha "$app/auth-runtime.js")" = "$3"
test "$(sha "$app/tenant-model-runtime.js")" = "$4"
sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/update-private.log" 2>&1
wait_smoke
test "$(sha "$app/auth-runtime.js")" = "$3"
test "$(sha "$app/tenant-model-runtime.js")" = "$4"
trap - ERR
echo GROQ_RELEASE_SERVICE_HEALTH_PASS
REMOTE
deployed=yes
node ops/ovh/groq-assistant-20261125/live.mjs
accepted=yes
echo GROQ_ASSISTANT_DEPLOYED_AND_VERIFIED
