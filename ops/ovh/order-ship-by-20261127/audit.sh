#!/usr/bin/env bash
set -Eeuo pipefail
test "$DEPLOY_USER" = liftorbit-ci
test "$GITHUB_REF" = refs/heads/fix/order-ship-by-20261127
umask 077
d=$(mktemp -d "$RUNNER_TEMP/ship-by-audit.XXXXXX")
trap 'rm -rf -- "$d"' EXIT
printf '%s\n' "$DEPLOY_KEY" > "$d/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$d/known-hosts"
chmod 600 "$d/key" "$d/known-hosts"
target="$DEPLOY_USER@$DEPLOY_HOST"
root=/home/liftorbit-ci/liftorbit-migration
app="$root/sources/ovh-app/current"
scp -q -i "$d/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$d/known-hosts" -o ConnectTimeout=20 \
 "$target:$app/auth-runtime.js" "$target:$app/tenant-model-runtime.js" "$target:$app/python-ga-upstream.mjs" "$target:$app/restart-optimizer-ui.js" "$target:$app/stop-ui.js" \
 "$target:$root/sources/current/ga/ga_workers/joint_minibatch.py" "$target:$root/sources/current/ga/ga_workers/full_runtime_adapter.py" "$d/"
python3 ops/ovh/order-ship-by-20261127/audit.py "$d"
