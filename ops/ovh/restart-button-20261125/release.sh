#!/usr/bin/env bash
set -Eeuo pipefail
test "$HOST" = 51.255.163.121
test "$USER" = liftorbit-ci
test "$GITHUB_REF" = refs/heads/fix/restart-button-lifecycle-20261125
[[ "$GITHUB_RUN_ID" =~ ^[0-9]{1,16}$ ]] && [[ "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]{1,4}$ ]]
package=ops/ovh/restart-button-20261125
umask 077
d=$(mktemp -d "$RUNNER_TEMP/restart-release.XXXXXX")
trap 'rm -rf -- "$d"' EXIT
printf '%s\n' "$KEY" > "$d/key"
printf '%s\n' "$KH" > "$d/kh"
chmod 600 "$d/key" "$d/kh"
ssh_call(){ ssh -i "$d/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$d/kh" -o ConnectTimeout=20 "$@"; }
scp_call(){ scp -q -i "$d/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$d/kh" -o ConnectTimeout=20 "$@"; }
host="$USER@$HOST"
root=/home/liftorbit-ci/liftorbit-migration
stage="$root/sources/ovh-app/restart-lifecycle-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
mkdir "$d/old"
for name in python-ga-upstream.mjs restart-optimizer-html.js restart-optimizer-server.js restart-optimizer-ui.js;do
 scp_call "$host:$root/sources/ovh-app/current/$name" "$d/old/$name" 2>>"$d/transport-private.log"
done
node "$package/patch.mjs" "$d"
for f in "$d/new/"*;do node --check "$f" >"$d/syntax.log" 2>&1;done
node "$package/test.mjs" "$d"
ssh_call "$host" bash -s -- "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" <<'PREPARE'
set -euo pipefail
umask 077
[[ "$1" =~ ^[0-9]{1,16}$ ]] && [[ "$2" =~ ^[0-9]{1,4}$ ]]
stage="/home/liftorbit-ci/liftorbit-migration/sources/ovh-app/restart-lifecycle-$1-$2"
test ! -e "$stage" && test ! -L "$stage"
mkdir -p "$stage"
PREPARE
scp_call "$d/manifest.tsv" "$d/new/"* "$host:$stage/" 2>>"$d/transport-private.log"
ssh_call "$host" bash -s -- "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" install < "$package/remote-release.sh"
if ! node "$package/live.mjs" || ! WC_LIVE=1 node ops/ovh/weekly-shift-calendars-20261125/browser.mjs;then
 echo RESTART_LIFECYCLE_LIVE_FAILED_ROLLBACK
 ssh_call "$host" bash -s -- "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" rollback < "$package/remote-release.sh"
 exit 6
fi
echo RESTART_LIFECYCLE_LIVE_ALL_PASS
