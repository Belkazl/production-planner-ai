#!/usr/bin/env bash
set -Eeuo pipefail
test "$DEPLOY_HOST" = 51.255.163.121
test "$DEPLOY_USER" = liftorbit-ci
test "$GITHUB_REF" = refs/heads/fix/planning-start-20261127
[[ "$GITHUB_RUN_ID" =~ ^[0-9]{1,16}$ ]]
attempt=${GITHUB_RUN_ATTEMPT:-1}
[[ "$attempt" =~ ^[0-9]{1,4}$ ]]
umask 077
d=$(mktemp -d "$RUNNER_TEMP/planning-start-release.XXXXXX")
printf '%s\n' "$DEPLOY_KEY" > "$d/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$d/known-hosts"
chmod 600 "$d/key" "$d/known-hosts"
ssh_call(){ ssh -i "$d/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$d/known-hosts" -o ConnectTimeout=20 "$@"; }
scp_call(){ scp -q -i "$d/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$d/known-hosts" -o ConnectTimeout=20 "$@"; }
target="$DEPLOY_USER@$DEPLOY_HOST"
root=/home/liftorbit-ci/liftorbit-migration
app="$root/sources/ovh-app/current"
stage="$root/sources/ovh-app/planning-start-20261127-$GITHUB_RUN_ID-$attempt"
package=ops/ovh/planning-start-20261127
deployed=no
accepted=no
cleanup(){
 rc=$?;trap - EXIT
 if test "$deployed" = yes && test "$accepted" != yes;then
  echo PLANNING_START_BROWSER_ACCEPTANCE_FAILED_ROLLBACK
  if ! ssh_call "$target" bash -s -- rollback "$GITHUB_RUN_ID" "$attempt" < "$package/remote_release.sh";then echo PLANNING_START_ROLLBACK_UNCONFIRMED;rc=6;fi
 fi
 rm -rf -- "$d";exit "$rc"
}
trap cleanup EXIT
mkdir -m 700 "$d/before" "$d/after"
scp_call "$target:$app/auth-runtime.js" "$d/before/"
node "$package/patch.mjs" "$d/before/auth-runtime.js" "$d/after/auth-runtime.js"
node --check "$d/after/auth-runtime.js"
for name in auth-runtime.js;do
 a=$(sha256sum "$d/before/$name"|cut -d' ' -f1);b=$(sha256sum "$d/after/$name"|cut -d' ' -f1);test "$a" != "$b"
 printf '%s\t%s\t%s\n' "$name" "$a" "$b"
done > "$d/after/manifest.tsv"
echo PLANNING_START_ACTIVE_SOURCES_PATCHED_AND_COMPILED
node "$package/browser_accept.mjs"
ssh_call "$target" bash -s -- "$GITHUB_RUN_ID" "$attempt" <<'REMOTE'
set -Eeuo pipefail
umask 077
[[ "$1" =~ ^[0-9]{1,16}$ ]] && [[ "$2" =~ ^[0-9]{1,4}$ ]]
stage="/home/liftorbit-ci/liftorbit-migration/sources/ovh-app/planning-start-20261127-$1-$2"
test ! -e "$stage" && test ! -L "$stage"
mkdir -m 700 "$stage"
REMOTE
scp_call "$d/after/auth-runtime.js" "$d/after/manifest.tsv" "$target:$stage/"
ssh_call "$target" bash -s -- install "$GITHUB_RUN_ID" "$attempt" < "$package/remote_release.sh"
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
PP_PLANNING_START_LIVE=1 node "$package/browser_accept.mjs"
accepted=yes
echo PLANNING_START_DEPLOYED_AND_VERIFIED
