#!/usr/bin/env bash
# Authorized factor correction: candidate tested before one-module installation.
set -euo pipefail
test "$DEPLOY_HOST" = 51.255.163.121
test "$DEPLOY_USER" = liftorbit-ci
test "$GITHUB_REF" = refs/heads/fix/universal-process-factor-20261127
[[ "$GITHUB_RUN_ID" =~ ^[0-9]{1,16}$ ]]
run_attempt=${GITHUB_RUN_ATTEMPT:-1}
[[ "$run_attempt" =~ ^[0-9]{1,4}$ ]]
package=ops/ovh/universal-process-factor-20261127
umask 077
release_stage=$(mktemp -d "$RUNNER_TEMP/process-factor.XXXXXX")
trap 'rm -rf -- "$release_stage"' EXIT
docker build -f ops/ovh/shift-aware-minibatch-release-20261125/Dockerfile.verify -t process-factor-verify:local ops/ovh/shift-aware-minibatch-release-20261125
printf '%s\n' "$DEPLOY_KEY" > "$release_stage/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$release_stage/known-hosts"
chmod 600 "$release_stage/key" "$release_stage/known-hosts"
ssh_call(){ ssh -i "$release_stage/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$release_stage/known-hosts" -o ConnectTimeout=20 "$@"; }
scp_call(){ scp -q -i "$release_stage/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$release_stage/known-hosts" -o ConnectTimeout=20 "$@"; }
target="$DEPLOY_USER@$DEPLOY_HOST"
root=/home/liftorbit-ci/liftorbit-migration
ssh_call "$target" 'python3 -B -I - --app-hashes' < ops/ovh/shift-aware-minibatch-release-20261125/capture.py > "$release_stage/app-hashes.json" 2> "$release_stage/transport-private.log"
ssh_call "$target" 'python3 -B -I - --emit-private-bundle' < ops/ovh/native-batching-verify-20261124/native_input_contract.py > "$release_stage/native.bundle" 2>> "$release_stage/transport-private.log"
python3 -B -I "$package/prepare.py" "$release_stage"
rm "$release_stage/native.bundle"
# Native execution can read code-only inputs, not the SSH key or any other runner data.
isolated(){ local candidate="$1"; shift
 docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user "$(id -u):$(id -g)" --pids-limit 128 --memory 2g --cpus 2 --tmpfs /tmp:rw,nosuid,nodev,size=536870912 --mount "type=bind,src=$release_stage/$candidate/native,dst=/native,readonly" --mount "type=bind,src=$release_stage/input,dst=/input,readonly" --mount "type=bind,src=$release_stage/out,dst=/out" --mount "type=bind,src=$PWD/ops/ovh,dst=/public/ops,readonly" process-factor-verify:local python3 -B -I "$@"
}
# Preserve existing plan digests with coefficient 1 and test exact candidate.
isolated old /public/ops/universal-process-factor-20261127/verify.py old
isolated new /public/ops/universal-process-factor-20261127/verify.py new
# Required original native regressions, integrated setups, and shift-aware search.
if ! isolated new /public/ops/native-batching-verify-20261124/verify_native.py --child /native --report /out/native-eleven.json --overlay-gates > "$release_stage/native-regressions-private.log" 2>&1; then echo PROCESS_FACTOR_NATIVE_REGRESSION_FAILED; exit 6; fi
if ! isolated new /public/ops/integrated-setup-verify-20261125/verify_worker.py --package-root /native --code-inputs /input/code-inputs.json --fixtures /out/native-fixtures.json --report /out/worker-report.json --contract-helper /public/ops/native-batching-verify-20261124/native_input_contract.py > "$release_stage/integrated-private.log" 2>&1; then echo PROCESS_FACTOR_INTEGRATED_REGRESSION_FAILED; exit 6; fi
# Diagnose any legacy shift gate failure on both the untouched and candidate runtime.
shift_status=0
isolated new /public/ops/shift-aware-minibatches-20261125/verify_shift.py --package-root /native --code-inputs /input/code-inputs.json --contract-helper /public/ops/native-batching-verify-20261124/native_input_contract.py --report /out/shift-report.json > "$release_stage/shift-private.log" 2>&1 || shift_status=$?
if test "$shift_status" -ne 0; then
 isolated old /public/ops/shift-aware-minibatches-20261125/verify_shift.py --package-root /native --code-inputs /input/code-inputs.json --contract-helper /public/ops/native-batching-verify-20261124/native_input_contract.py --report /out/shift-baseline.json > "$release_stage/shift-baseline-private.log" 2>&1 || true
 python3 - "$release_stage" <<'PY'
import sys,json,hashlib
from pathlib import Path
root=Path(sys.argv[1])
for name in ('shift-baseline','shift-report'):
 p=root/'out'/(name+'.json')
 if p.is_file():
  r=json.loads(p.read_text())
  # The legacy verifier's report is a fixed, sanitized synthetic schema.
  print('PROCESS_FACTOR_SHIFT_DIAGNOSTIC',name,json.dumps({k:r.get(k) for k in ('exact_module_installed','failure','failed_checks','cases','internal_windows','all_shift_checks_passed')}))
print('PROCESS_FACTOR_SHIFT_MODULE_HASH',hashlib.sha256((root/'old/native/ga_workers/joint_minibatch.py').read_bytes()).hexdigest())
PY
 echo PROCESS_FACTOR_SHIFT_REGRESSION_FAILED
 exit 6
fi
python3 - "$release_stage/out" <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1])
n=json.loads((p/'native-eleven.json').read_text()); w=json.loads((p/'worker-report.json').read_text()); s=json.loads((p/'shift-report.json').read_text())
assert n.get('status')=='native_witness_pass' and n.get('release_gate_complete') is True and n.get('ordered_continuation_verified') is True and len(n.get('cases',{}))==11
assert w.get('all_native_checks_passed') is True and len(w.get('cases',{}))==4
assert s.get('all_shift_checks_passed') is True
print('PROCESS_FACTOR_ALL_REGRESSIONS_PASS native=11 integrated=4 shift=4')
PY
remote_stage="$root/sources/ovh-app/universal-process-factor-20261127-$GITHUB_RUN_ID-$run_attempt"
contract_sha=$(sha256sum "$package/deploy_contract.py" | cut -d' ' -f1)
[[ "$contract_sha" =~ ^[0-9a-f]{64}$ ]]
echo PROCESS_FACTOR_RELEASE_PHASE upload_one_accepted_module
ssh_call "$target" bash -s -- "$GITHUB_RUN_ID" "$run_attempt" <<'PREPARE'
set -euo pipefail
umask 077
[[ "$1" =~ ^[0-9]{1,16}$ ]] && [[ "$2" =~ ^[0-9]{1,4}$ ]]
stage="/home/liftorbit-ci/liftorbit-migration/sources/ovh-app/universal-process-factor-20261127-$1-$2"
test ! -e "$stage" && test ! -L "$stage"
mkdir -p "$stage/ga"
PREPARE
scp_call "$release_stage/manifest.tsv" "$release_stage/code-inputs.sha256" "$release_stage/native-contract.sha256" \
  "$package/deploy_contract.py" ops/ovh/native-batching-verify-20261124/native_input_contract.py "$target:$remote_stage/" \
  2>> "$release_stage/transport-private.log"
scp_call "$release_stage/new/ga/full_runtime_adapter.py" "$target:$remote_stage/ga/full_runtime_adapter.py" \
  2>> "$release_stage/transport-private.log"
ssh_call "$target" bash -s -- "$GITHUB_RUN_ID" "$run_attempt" "$contract_sha" <<'REMOTE'
# Post-install function failures must inherit the rollback ERR handler.
set -Eeuo pipefail
umask 077
[[ "$1" =~ ^[0-9]{1,16}$ ]] && [[ "$2" =~ ^[0-9]{1,4}$ ]] && [[ "$3" =~ ^[0-9a-f]{64}$ ]]
root=/home/liftorbit-ci/liftorbit-migration
stage="$root/sources/ovh-app/universal-process-factor-20261127-$1-$2"
backup="$root/patch-backups/universal-process-factor-20261127/$1-$2"
target="$root/sources/current/ga/ga_workers/full_runtime_adapter.py"
test -f "$stage/deploy_contract.py" && test ! -L "$stage/deploy_contract.py"
test "$(sha256sum "$stage/deploy_contract.py" | cut -d' ' -f1)" = "$3"
deployment_phase=verify_current_sources
echo PROCESS_FACTOR_RELEASE_PHASE "$deployment_phase"
verify_sources(){ python3 -B -I "$stage/deploy_contract.py" "$stage" "$1"; }
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
    echo PROCESS_FACTOR_RELEASE_PUBLIC_HEALTH "$deployment_phase" "attempt=$attempt" "code=$observed"
    if test "$observed" = "$expected"; then return 0; fi
    if test "$attempt" -lt 6; then sleep 5; fi
  done
  return 1
}
verify_sources old
sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1
deployment_phase=backup_native_module
echo PROCESS_FACTOR_RELEASE_PHASE "$deployment_phase"
# Bind the backup to the accepted manifest, not a potentially changed target.
accepted_old=''
while IFS=$'\t' read -r role name old new; do
  if test "$role" = WRITE; then
    test "$name" = ga/full_runtime_adapter.py
    [[ "$old" =~ ^[0-9a-f]{64}$ ]] && [[ "$new" =~ ^[0-9a-f]{64}$ ]]
    test "$old" != "$new"
    test -z "$accepted_old"
    accepted_old="$old"
  fi
done < "$stage/manifest.tsv"
[[ "$accepted_old" =~ ^[0-9a-f]{64}$ ]]
test ! -e "$backup" && test ! -L "$backup"
mkdir -p "$backup/ga"
cp -p "$stage/manifest.tsv" "$backup/manifest.tsv"
cp -p "$target" "$backup/ga/full_runtime_adapter.py"
test "$(sha "$backup/ga/full_runtime_adapter.py")" = "$accepted_old"
rollback(){
  local failure_exit="$1" restore_exit=0 rollback_update_exit=0
  trap - ERR
  set +e
  echo PROCESS_FACTOR_RELEASE_FAILED_PHASE "$deployment_phase"
  cp -p "$backup/ga/full_runtime_adapter.py" "$target" || restore_exit=1
  if test "$restore_exit" -eq 0; then verify_sources old || restore_exit=1; fi
  echo PROCESS_FACTOR_RELEASE_ROLLBACK_RESTORE_EXIT "$restore_exit"
  if test "$restore_exit" -eq 0; then
    sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/rollback-private.log" 2>&1 || rollback_update_exit=$?
  else
    rollback_update_exit=6
  fi
  echo PROCESS_FACTOR_RELEASE_ROLLBACK_UPDATE_EXIT "$rollback_update_exit"
  if test "$restore_exit" -eq 0 && test "$rollback_update_exit" -eq 0 && wait_for_service_smoke; then
    echo PROCESS_FACTOR_RELEASE_ROLLBACK_HEALTH_PASS
  else
    echo PROCESS_FACTOR_RELEASE_ROLLBACK_HEALTH_UNCONFIRMED
  fi
  exit "$failure_exit"
}
deployment_phase=install_native_module
echo PROCESS_FACTOR_RELEASE_PHASE "$deployment_phase"
trap 'rollback "$?"' ERR
# The existing target's mode and owner are preserved; uploads remain private.
test -f "$target" && test ! -L "$target"
cp "$stage/ga/full_runtime_adapter.py" "$target"
deployment_phase=verify_staged_hashes
echo PROCESS_FACTOR_RELEASE_PHASE "$deployment_phase"
verify_sources new
deployment_phase=update_services
echo PROCESS_FACTOR_RELEASE_PHASE "$deployment_phase"
sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/update-private.log" 2>&1
deployment_phase=service_health
echo PROCESS_FACTOR_RELEASE_PHASE "$deployment_phase"
wait_for_service_smoke
deployment_phase=verify_deployed_hashes
echo PROCESS_FACTOR_RELEASE_PHASE "$deployment_phase"
verify_sources new
deployment_phase=public_bridge_health
echo PROCESS_FACTOR_RELEASE_PHASE "$deployment_phase"
public_health https://app.liftorbit.app/__bridge_health 200
deployment_phase=public_auth_health
echo PROCESS_FACTOR_RELEASE_PHASE "$deployment_phase"
public_health https://app.liftorbit.app/api/auth/me 401
trap - ERR
echo PROCESS_FACTOR_RELEASE_DEPLOY_AND_HEALTH_PASS
REMOTE
