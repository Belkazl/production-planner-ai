#!/usr/bin/env bash
# Deliberate marker-only release of bytes accepted against actual native/app inputs.
set -euo pipefail
test "$DEPLOY_HOST" = 51.255.163.121
test "$DEPLOY_USER" = liftorbit-ci
test "$GITHUB_REF" = refs/heads/fix/gantt-zoom-500-20261124
[[ "$GITHUB_RUN_ID" =~ ^[0-9]{1,16}$ ]]
run_attempt=${GITHUB_RUN_ATTEMPT:-1}
[[ "$run_attempt" =~ ^[0-9]{1,4}$ ]]
package=ops/ovh/integrated-setup-release-20261125
marker="$package/release.json"
python3 -B -I "$package/release_guard.py" --marker "$marker"
umask 077
release_stage=$(mktemp -d "$RUNNER_TEMP/integrated-setup-release.XXXXXX")
trap 'rm -rf -- "$release_stage"' EXIT
printf '%s\n' "$DEPLOY_KEY" > "$release_stage/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$release_stage/known-hosts"
chmod 600 "$release_stage/key" "$release_stage/known-hosts"
ssh_call(){ ssh -i "$release_stage/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$release_stage/known-hosts" -o ConnectTimeout=20 "$@"; }
scp_call(){ scp -q -i "$release_stage/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$release_stage/known-hosts" -o ConnectTimeout=20 "$@"; }
target="$DEPLOY_USER@$DEPLOY_HOST"
root=/home/liftorbit-ci/liftorbit-migration
echo INTEGRATED_SETUP_RELEASE_PHASE capture_accepted_app_sources
if ! ssh_call "$target" 'python3 -B -I - --emit-private-bundle' < "$package/capture.py" \
  > "$release_stage/app.bundle" 2> "$release_stage/transport-private.log"; then
  echo INTEGRATED_SETUP_RELEASE_CAPTURE_FAILED
  exit 6
fi
echo INTEGRATED_SETUP_RELEASE_PHASE reproduce_exact_artifact
python3 -B -I "$package/stage.py" "$marker" "$release_stage"
remote_stage="$root/sources/ovh-app/integrated-setup-release-20261125-$GITHUB_RUN_ID-$run_attempt"
contract_sha=$(sha256sum "$package/deploy_contract.py" | cut -d' ' -f1)
[[ "$contract_sha" =~ ^[0-9a-f]{64}$ ]]
echo INTEGRATED_SETUP_RELEASE_PHASE upload_accepted_changes
ssh_call "$target" bash -s -- "$GITHUB_RUN_ID" "$run_attempt" <<'PREPARE'
set -euo pipefail
umask 077
[[ "$1" =~ ^[0-9]{1,16}$ ]] && [[ "$2" =~ ^[0-9]{1,4}$ ]]
stage="/home/liftorbit-ci/liftorbit-migration/sources/ovh-app/integrated-setup-release-20261125-$1-$2"
test ! -e "$stage" && test ! -L "$stage"
mkdir -p "$stage/app/baselines/2026-10-10/aps-setup-bridge" "$stage/app/tests"
PREPARE
scp_call "$release_stage/manifest.tsv" "$release_stage/code-inputs.sha256" "$release_stage/native-contract.sha256" \
  "$package/deploy_contract.py" ops/ovh/native-batching-verify-20261124/native_input_contract.py "$target:$remote_stage/" \
  2>> "$release_stage/transport-private.log"
while IFS=$'\t' read -r role name old new; do
  if test "$role" = WRITE; then
    scp_call "$release_stage/new/$name" "$target:$remote_stage/$name" 2>> "$release_stage/transport-private.log"
  fi
done < "$release_stage/manifest.tsv"
ssh_call "$target" bash -s -- "$GITHUB_RUN_ID" "$run_attempt" "$contract_sha" <<'REMOTE'
set -euo pipefail
umask 077
[[ "$1" =~ ^[0-9]{1,16}$ ]] && [[ "$2" =~ ^[0-9]{1,4}$ ]] && [[ "$3" =~ ^[0-9a-f]{64}$ ]]
root=/home/liftorbit-ci/liftorbit-migration
stage="$root/sources/ovh-app/integrated-setup-release-20261125-$1-$2"
backup="$root/patch-backups/integrated-setup-release-20261125/$1-$2"
manifest="$stage/manifest.tsv"
test -f "$stage/deploy_contract.py" && test ! -L "$stage/deploy_contract.py"
test "$(sha256sum "$stage/deploy_contract.py" | cut -d' ' -f1)" = "$3"
deployment_phase=verify_current_sources
echo INTEGRATED_SETUP_RELEASE_PHASE "$deployment_phase"
verify_sources(){ python3 -B -I "$stage/deploy_contract.py" "$stage" "$1"; }
write_target(){
  case "$1" in
    app/python-ga-upstream.mjs|app/baselines/2026-10-10/aps-setup-bridge/index.ts|app/restart-optimizer-ui.js|app/tests/python-ga-upstream.test.mjs|app/tests/python-ga-state.test.mjs)
      printf '%s/%s' "$root/sources/ovh-app/current" "${1#app/}";;
    *) return 6;;
  esac
}
sha(){ sha256sum "$1" | cut -d' ' -f1; }
wait_for_service_smoke(){
  local attempt
  for attempt in $(seq 1 36); do
    if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1; then return 0; fi
    if test "$attempt" -lt 36; then sleep 5; fi
  done
  return 1
}
public_health(){
  local endpoint="$1" expected="$2" attempt observed
  for attempt in $(seq 1 6); do
    observed=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$endpoint" 2>/dev/null) || observed=000
    [[ "$observed" =~ ^[0-9]{3}$ ]] || observed=000
    echo INTEGRATED_SETUP_RELEASE_PUBLIC_HEALTH "$deployment_phase" "attempt=$attempt" "code=$observed"
    if test "$observed" = "$expected"; then return 0; fi
    if test "$attempt" -lt 6; then sleep 5; fi
  done
  return 1
}
verify_sources old
sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1
deployment_phase=backup_sources
echo INTEGRATED_SETUP_RELEASE_PHASE "$deployment_phase"
test ! -e "$backup" && test ! -L "$backup"
mkdir -p "$backup/app/baselines/2026-10-10/aps-setup-bridge" "$backup/app/tests"
cp -p "$manifest" "$backup/manifest.tsv"
while IFS=$'\t' read -r role name old new; do
  if test "$role" = WRITE; then
    cp -p "$(write_target "$name")" "$backup/$name"
    test "$(sha "$backup/$name")" = "$old"
  fi
done < "$manifest"
rollback(){
  local failure_exit="$1" restore_exit=0 rollback_update_exit=0
  trap - ERR
  set +e
  echo INTEGRATED_SETUP_RELEASE_FAILED_PHASE "$deployment_phase"
  while IFS=$'\t' read -r role name old new; do
    if test "$role" = WRITE; then
      cp -p "$backup/$name" "$(write_target "$name")" || restore_exit=1
    fi
  done < "$manifest"
  if test "$restore_exit" -eq 0; then verify_sources old || restore_exit=1; fi
  echo INTEGRATED_SETUP_RELEASE_ROLLBACK_RESTORE_EXIT "$restore_exit"
  if test "$restore_exit" -eq 0; then
    sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/rollback-private.log" 2>&1 || rollback_update_exit=$?
  else
    rollback_update_exit=6
  fi
  echo INTEGRATED_SETUP_RELEASE_ROLLBACK_UPDATE_EXIT "$rollback_update_exit"
  if test "$restore_exit" -eq 0 && test "$rollback_update_exit" -eq 0 && wait_for_service_smoke; then
    echo INTEGRATED_SETUP_RELEASE_ROLLBACK_HEALTH_PASS
  else
    echo INTEGRATED_SETUP_RELEASE_ROLLBACK_HEALTH_UNCONFIRMED
  fi
  exit "$failure_exit"
}
deployment_phase=install_sources
echo INTEGRATED_SETUP_RELEASE_PHASE "$deployment_phase"
trap 'rollback "$?"' ERR
while IFS=$'\t' read -r role name old new; do
  if test "$role" = WRITE; then
    # Existing target modes/ownership are retained; private upload modes are not deployed.
    cp "$stage/$name" "$(write_target "$name")"
  fi
done < "$manifest"
deployment_phase=verify_staged_hashes
echo INTEGRATED_SETUP_RELEASE_PHASE "$deployment_phase"
verify_sources new
deployment_phase=update_services
echo INTEGRATED_SETUP_RELEASE_PHASE "$deployment_phase"
sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/update-private.log" 2>&1
deployment_phase=service_health
echo INTEGRATED_SETUP_RELEASE_PHASE "$deployment_phase"
wait_for_service_smoke
deployment_phase=verify_deployed_hashes
echo INTEGRATED_SETUP_RELEASE_PHASE "$deployment_phase"
verify_sources new
deployment_phase=public_bridge_health
echo INTEGRATED_SETUP_RELEASE_PHASE "$deployment_phase"
public_health https://app.liftorbit.app/__bridge_health 200
deployment_phase=public_auth_health
echo INTEGRATED_SETUP_RELEASE_PHASE "$deployment_phase"
public_health https://app.liftorbit.app/api/auth/me 401
trap - ERR
echo INTEGRATED_SETUP_RELEASE_DEPLOY_AND_HEALTH_PASS
REMOTE
