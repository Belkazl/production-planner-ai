#!/usr/bin/env bash
set -Eeuo pipefail
test "$HOST" = 51.255.163.121
test "$USER" = liftorbit-ci
test "$GITHUB_REF" = refs/heads/feat/weekly-shift-calendars-20261125
[[ "$GITHUB_RUN_ID" =~ ^[0-9]{1,16}$ ]] && [[ "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]{1,4}$ ]]
package=ops/ovh/weekly-shift-calendars-20261125
umask 077
d=$(mktemp -d "$RUNNER_TEMP/weekly-release.XXXXXX")
trap 'rm -rf -- "$d"' EXIT
printf '%s\n' "$KEY" > "$d/key"
printf '%s\n' "$KH" > "$d/kh"
chmod 600 "$d/key" "$d/kh"
ssh_call(){ ssh -i "$d/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$d/kh" -o ConnectTimeout=20 "$@"; }
scp_call(){ scp -q -i "$d/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$d/kh" -o ConnectTimeout=20 "$@"; }
host="$USER@$HOST"
root=/home/liftorbit-ci/liftorbit-migration
stage="$root/sources/ovh-app/weekly-calendars-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
ssh_call "$host" 'python3 -B -I - --app-hashes' < ops/ovh/shift-aware-minibatch-release-20261125/capture.py > "$d/app-hashes.json" 2> "$d/transport-private.log"
ssh_call "$host" 'python3 -B -I - --emit-private-bundle' < ops/ovh/native-batching-verify-20261124/native_input_contract.py > "$d/native.bundle" 2>> "$d/transport-private.log"
scp_call "$host:$root/sources/ovh-app/current/restart-optimizer-html.js" "$d/old-ui.js" 2>> "$d/transport-private.log"
python3 -B -I "$package/stage-release.py" "$d"
ssh_call "$host" bash -s -- "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" <<'PREPARE'
set -euo pipefail
umask 077
[[ "$1" =~ ^[0-9]{1,16}$ ]] && [[ "$2" =~ ^[0-9]{1,4}$ ]]
stage="/home/liftorbit-ci/liftorbit-migration/sources/ovh-app/weekly-calendars-$1-$2"
test ! -e "$stage" && test ! -L "$stage"
mkdir -p "$stage"
PREPARE
scp_call "$d/manifest.tsv" "$d/expected.json" "$package/remote-verify.py" ops/ovh/shift-aware-minibatch-release-20261125/capture.py ops/ovh/native-batching-verify-20261124/native_input_contract.py "$d/new/restart-optimizer-html.js" "$d/new/full_runtime_adapter.py" "$d/new/joint_minibatch.py" "$host:$stage/" 2>> "$d/transport-private.log"
ssh_call "$host" bash -s -- "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" install < "$package/remote-release.sh"
# Exercise actual published UI, persistence, assignment and model import on a synthetic account.
if ! WC_LIVE=1 node "$package/browser.mjs";then
  echo WEEKLY_RELEASE_BROWSER_FAILED_ROLLBACK
  ssh_call "$host" bash -s -- "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" rollback < "$package/remote-release.sh"
  exit 6
fi
echo WEEKLY_RELEASE_LIVE_BROWSER_PASS
