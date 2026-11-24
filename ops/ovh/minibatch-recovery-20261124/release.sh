#!/usr/bin/env bash
set -euo pipefail
test "$DEPLOY_HOST" = 51.255.163.121
test "$DEPLOY_USER" = liftorbit-ci
case "$GITHUB_RUN_ID" in *[!0-9]*|'') exit 6;; esac
run_attempt=${GITHUB_RUN_ATTEMPT:-1}
case "$run_attempt" in *[!0-9]*|'') exit 6;; esac
umask 077
release_stage=$(mktemp -d)
trap 'rm -rf "$release_stage"' EXIT
printf '%s\n' "$DEPLOY_KEY" > "$release_stage/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$release_stage/known-hosts"
chmod 600 "$release_stage/key" "$release_stage/known-hosts"
ssh_call(){ ssh -i "$release_stage/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$release_stage/known-hosts" -o ConnectTimeout=20 "$@"; }
scp_call(){ scp -q -i "$release_stage/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$release_stage/known-hosts" -o ConnectTimeout=20 "$@"; }
root=/home/liftorbit-ci/liftorbit-migration
app="$root/sources/ovh-app/current"
ga="$root/sources/current/ga/ga_workers"
echo MINIBATCH_RECOVERY_PHASE download_current_sources
mkdir -p "$release_stage/old/app" "$release_stage/old/ga" "$release_stage/new"
scp_call "$DEPLOY_USER@$DEPLOY_HOST:$app/auth-runtime.js" "$release_stage/old/app/auth-runtime.js"
scp_call "$DEPLOY_USER@$DEPLOY_HOST:$ga/full_runtime_adapter.py" "$release_stage/old/ga/full_runtime_adapter.py"
if ssh_call "$DEPLOY_USER@$DEPLOY_HOST" test -f "$ga/batch_size_diagnostics.py"; then
  scp_call "$DEPLOY_USER@$DEPLOY_HOST:$ga/batch_size_diagnostics.py" "$release_stage/old/ga/batch_size_diagnostics.py"
  # This is the first diagnostic module release. A retry may encounter this exact version.
  cmp -s "$release_stage/old/ga/batch_size_diagnostics.py" ops/ovh/batch-size-search-20261124/batch_size_diagnostics.py || {
    echo MINIBATCH_RECOVERY_UNRECOGNIZED_DIAGNOSTIC_MODULE
    exit 6
  }
fi
cp -a "$release_stage/old/." "$release_stage/new/"
echo MINIBATCH_RECOVERY_PHASE prepare_guarded_sources
node ops/ovh/units-ui-20261124/patch.mjs "$release_stage/old/app/auth-runtime.js" "$release_stage/new/app/auth-runtime.js"
python3 ops/ovh/batch-size-search-20261124/patch.py "$release_stage/old/ga/full_runtime_adapter.py" "$release_stage/new/ga/full_runtime_adapter.py"
cp ops/ovh/batch-size-search-20261124/batch_size_diagnostics.py "$release_stage/new/ga/batch_size_diagnostics.py"
node --check "$release_stage/new/app/auth-runtime.js"
python3 -m py_compile "$release_stage/new/ga/full_runtime_adapter.py" "$release_stage/new/ga/batch_size_diagnostics.py"
python3 - "$release_stage" <<'PY'
from pathlib import Path
import hashlib,sys
stage=Path(sys.argv[1])
files=["app/auth-runtime.js","ga/full_runtime_adapter.py","ga/batch_size_diagnostics.py"]
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else "MISSING"
rows=[f"{name}\t{sha(stage/'old'/name)}\t{sha(stage/'new'/name)}" for name in files]
(stage/"manifest.tsv").write_text("\n".join(rows)+"\n")
print("MINIBATCH_RECOVERY_EXACT_SOURCE_PREFLIGHT_PASS")
PY
remote_stage="$root/sources/ovh-app/minibatch-recovery-20261124-$GITHUB_RUN_ID-$run_attempt"
echo MINIBATCH_RECOVERY_PHASE upload_checked_sources
ssh_call "$DEPLOY_USER@$DEPLOY_HOST" mkdir -p "$remote_stage/app" "$remote_stage/ga"
scp_call "$release_stage/manifest.tsv" "$DEPLOY_USER@$DEPLOY_HOST:$remote_stage/manifest.tsv"
scp_call "$release_stage/new/app/auth-runtime.js" "$DEPLOY_USER@$DEPLOY_HOST:$remote_stage/app/auth-runtime.js"
for file in full_runtime_adapter.py batch_size_diagnostics.py; do
  scp_call "$release_stage/new/ga/$file" "$DEPLOY_USER@$DEPLOY_HOST:$remote_stage/ga/$file"
done
ssh_call "$DEPLOY_USER@$DEPLOY_HOST" bash -s -- "$GITHUB_RUN_ID" "$run_attempt" <<'REMOTE'
set -euo pipefail
umask 077
case "$1" in *[!0-9]*|'') exit 6;; esac
case "$2" in *[!0-9]*|'') exit 6;; esac
root="$HOME/liftorbit-migration"
stage="$root/sources/ovh-app/minibatch-recovery-20261124-$1-$2"
backup="$root/patch-backups/minibatch-recovery-20261124/$1-$2"
manifest="$stage/manifest.tsv"
deployment_phase=verify_current_sources
echo MINIBATCH_RECOVERY_PHASE "$deployment_phase"
target_for(){
  case "$1" in
    app/auth-runtime.js)
      printf '%s/%s' "$root/sources/ovh-app/current" "${1#app/}";;
    ga/full_runtime_adapter.py|ga/batch_size_diagnostics.py)
      printf '%s/%s' "$root/sources/current/ga/ga_workers" "${1#ga/}";;
    *) exit 6;;
  esac
}
sha(){ if test -f "$1"; then sha256sum "$1" | cut -d' ' -f1; else printf MISSING; fi; }
public_health(){
  local endpoint="$1" expected="$2" attempt observed
  for attempt in $(seq 1 6); do
    observed=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$endpoint" 2>/dev/null) || observed=000
    [[ "$observed" =~ ^[0-9]{3}$ ]] || observed=000
    echo MINIBATCH_RECOVERY_PUBLIC_HEALTH "$deployment_phase" "attempt=$attempt" "code=$observed" "expected=$expected"
    if test "$observed" = "$expected"; then return 0; fi
    if test "$attempt" -lt 6; then sleep 5; fi
  done
  return 1
}
test "$(wc -l < "$manifest")" -eq 3
test "$(cut -f1 "$manifest" | sort -u | wc -l)" -eq 3
while IFS=$'\t' read -r name old_sha new_sha; do
  target=$(target_for "$name")
  [[ "$old_sha" = MISSING || "$old_sha" =~ ^[0-9a-f]{64}$ ]]
  [[ "$new_sha" =~ ^[0-9a-f]{64}$ ]]
  if test "$old_sha" = MISSING; then test "$name" = ga/batch_size_diagnostics.py; fi
  test "$(sha "$target")" = "$old_sha" || { echo MINIBATCH_RECOVERY_SOURCE_DRIFT "$name"; exit 6; }
  test "$(sha "$stage/$name")" = "$new_sha" || { echo MINIBATCH_RECOVERY_UPLOAD_MISMATCH "$name"; exit 6; }
done < "$manifest"
deployment_phase=backup_sources
echo MINIBATCH_RECOVERY_PHASE "$deployment_phase"
sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1
test ! -e "$backup/manifest.tsv"
mkdir -p "$backup/app" "$backup/ga"
cp -p "$manifest" "$backup/manifest.tsv"
while IFS=$'\t' read -r name old_sha new_sha; do
  if test "$old_sha" != MISSING; then
    cp -p "$(target_for "$name")" "$backup/$name"
    test "$(sha "$backup/$name")" = "$old_sha"
  fi
done < "$manifest"
rollback(){
  local failure_exit="$1" restore_exit=0 rollback_update_exit=0
  trap - ERR
  set +e
  echo MINIBATCH_RECOVERY_FAILED_PHASE "$deployment_phase"
  while IFS=$'\t' read -r name old_sha new_sha; do
    target=$(target_for "$name")
    if test "$old_sha" = MISSING; then
      rm -f "$target" || restore_exit=1
    else
      cp -p "$backup/$name" "$target" || restore_exit=1
    fi
  done < "$manifest"
  echo MINIBATCH_RECOVERY_ROLLBACK_RESTORE_EXIT "$restore_exit"
  sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/rollback-private.log" 2>&1 || rollback_update_exit=$?
  echo MINIBATCH_RECOVERY_ROLLBACK_UPDATE_EXIT "$rollback_update_exit"
  if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1; then
    echo MINIBATCH_RECOVERY_ROLLBACK_HEALTH_PASS
  else
    echo MINIBATCH_RECOVERY_ROLLBACK_HEALTH_UNCONFIRMED
  fi
  exit "$failure_exit"
}
deployment_phase=install_sources
echo MINIBATCH_RECOVERY_PHASE "$deployment_phase"
trap 'rollback "$?"' ERR
while IFS=$'\t' read -r name old_sha new_sha; do
  cp -p "$stage/$name" "$(target_for "$name")"
done < "$manifest"
deployment_phase=update_services
echo MINIBATCH_RECOVERY_PHASE "$deployment_phase"
sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/update-private.log" 2>&1
deployment_phase=service_health
echo MINIBATCH_RECOVERY_PHASE "$deployment_phase"
ready=no
for attempt in $(seq 1 36); do
  if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1; then ready=yes; break; fi
  sleep 5
done
test "$ready" = yes
echo MINIBATCH_RECOVERY_SERVICE_HEALTH_PASS
deployment_phase=source_hashes
echo MINIBATCH_RECOVERY_PHASE "$deployment_phase"
while IFS=$'\t' read -r name old_sha new_sha; do
  test "$(sha "$(target_for "$name")")" = "$new_sha" || { echo MINIBATCH_RECOVERY_SOURCE_VERIFY_FAILED "$name"; false; }
done < "$manifest"
echo MINIBATCH_RECOVERY_SOURCE_HASHES_PASS
deployment_phase=public_bridge_health
echo MINIBATCH_RECOVERY_PHASE "$deployment_phase"
public_health https://app.liftorbit.app/__bridge_health 200
deployment_phase=public_auth_health
echo MINIBATCH_RECOVERY_PHASE "$deployment_phase"
public_health https://app.liftorbit.app/api/auth/me 401
trap - ERR
echo MINIBATCH_RECOVERY_DEPLOY_AND_HEALTH_PASS
REMOTE
