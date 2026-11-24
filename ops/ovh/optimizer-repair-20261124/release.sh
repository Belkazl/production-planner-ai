#!/usr/bin/env bash
set -euo pipefail
test "$DEPLOY_HOST" = 51.255.163.121
test "$DEPLOY_USER" = liftorbit-ci
case "$GITHUB_RUN_ID" in *[!0-9]*|'') exit 6;; esac
umask 077
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
printf '%s\n' "$DEPLOY_KEY" > "$stage/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$stage/known-hosts"
chmod 600 "$stage/key" "$stage/known-hosts"
ssh_call(){ ssh -i "$stage/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$stage/known-hosts" -o ConnectTimeout=20 "$@"; }
scp_call(){ scp -q -i "$stage/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$stage/known-hosts" -o ConnectTimeout=20 "$@"; }
root=/home/liftorbit-ci/liftorbit-migration
app="$root/sources/ovh-app/current"
ga="$root/sources/current/ga/ga_workers"
mkdir -p "$stage/old/app" "$stage/old/ga" "$stage/new"
for file in auth-runtime.js python-ga-upstream.mjs python-ga-upstream-build.ts; do
  scp_call "$DEPLOY_USER@$DEPLOY_HOST:$app/$file" "$stage/old/app/$file"
done
scp_call "$DEPLOY_USER@$DEPLOY_HOST:$ga/full_runtime_adapter.py" "$stage/old/ga/full_runtime_adapter.py"
if ssh_call "$DEPLOY_USER@$DEPLOY_HOST" test -f "$ga/operation_interleave.py"; then
  scp_call "$DEPLOY_USER@$DEPLOY_HOST:$ga/operation_interleave.py" "$stage/old/ga/operation_interleave.py"
  python3 - "$stage/old/ga/operation_interleave.py" <<'PY'
import pathlib,sys
text=pathlib.Path(sys.argv[1]).read_text()
assert 'VERSION = "operation-interleave-v1-20261124"' in text, "UNRECOGNIZED_INTERLEAVE_MODULE"
PY
fi
cp -a "$stage/old/." "$stage/new/"
node ops/ovh/optimizer-lifecycle-20261124/patch.mjs "$stage/old/app/auth-runtime.js" "$stage/new/app/auth-runtime.js"
node ops/ovh/first-candidate-preview-20261124/patch.mjs "$stage/new/app"
python3 ops/ovh/operation-interleave-20261124/patch.py "$stage/old/ga/full_runtime_adapter.py" "$stage/new/ga/full_runtime_adapter.py"
cp ops/ovh/operation-interleave-20261124/operation_interleave.py "$stage/new/ga/operation_interleave.py"
node --check "$stage/new/app/auth-runtime.js"
node --check "$stage/new/app/python-ga-upstream.mjs"
node --check --input-type=module < "$stage/new/app/python-ga-upstream-build.ts"
python3 -m py_compile "$stage/new/ga/full_runtime_adapter.py" "$stage/new/ga/operation_interleave.py"
LIFTORBIT_PREVIEW_FIXTURE_ROOT="$stage/old/app" node --test ops/ovh/first-candidate-preview-20261124/test.mjs
python3 - "$stage" <<'PY'
from pathlib import Path
import hashlib,sys
root=Path(sys.argv[1])
files=["app/auth-runtime.js","app/python-ga-upstream.mjs","app/python-ga-upstream-build.ts","ga/full_runtime_adapter.py","ga/operation_interleave.py"]
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else "MISSING"
rows=[f"{name}\t{sha(root/'old'/name)}\t{sha(root/'new'/name)}" for name in files]
(root/"manifest.tsv").write_text("\n".join(rows)+"\n")
print("OPTIMIZER_REPAIR_EXACT_SOURCE_PREFLIGHT_PASS")
PY
remote_stage="$root/sources/ovh-app/optimizer-repair-20261124-$GITHUB_RUN_ID"
ssh_call "$DEPLOY_USER@$DEPLOY_HOST" mkdir -p "$remote_stage/app" "$remote_stage/ga"
scp_call "$stage/manifest.tsv" "$DEPLOY_USER@$DEPLOY_HOST:$remote_stage/manifest.tsv"
for file in auth-runtime.js python-ga-upstream.mjs python-ga-upstream-build.ts; do
  scp_call "$stage/new/app/$file" "$DEPLOY_USER@$DEPLOY_HOST:$remote_stage/app/$file"
done
for file in full_runtime_adapter.py operation_interleave.py; do
  scp_call "$stage/new/ga/$file" "$DEPLOY_USER@$DEPLOY_HOST:$remote_stage/ga/$file"
done
ssh_call "$DEPLOY_USER@$DEPLOY_HOST" bash -s -- "$GITHUB_RUN_ID" <<'REMOTE'
set -euo pipefail
umask 077
case "$1" in *[!0-9]*|'') exit 6;; esac
root="$HOME/liftorbit-migration"
stage="$root/sources/ovh-app/optimizer-repair-20261124-$1"
backup="$root/patch-backups/optimizer-repair-20261124/$1"
manifest="$stage/manifest.tsv"
target_for(){
  case "$1" in
    app/auth-runtime.js|app/python-ga-upstream.mjs|app/python-ga-upstream-build.ts)
      printf '%s/%s' "$root/sources/ovh-app/current" "${1#app/}";;
    ga/full_runtime_adapter.py|ga/operation_interleave.py)
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
    echo OPTIMIZER_REPAIR_PUBLIC_HEALTH "$deployment_phase" "attempt=$attempt" "code=$observed" "expected=$expected"
    if test "$observed" = "$expected"; then return 0; fi
    if test "$attempt" -lt 6; then sleep 5; fi
  done
  return 1
}
test "$(wc -l < "$manifest")" -eq 5
test "$(cut -f1 "$manifest" | sort -u | wc -l)" -eq 5
while IFS=$'\t' read -r name old_sha new_sha; do
  target=$(target_for "$name")
  [[ "$old_sha" = MISSING || "$old_sha" =~ ^[0-9a-f]{64}$ ]]
  [[ "$new_sha" =~ ^[0-9a-f]{64}$ ]]
  if test "$old_sha" = MISSING; then test "$name" = ga/operation_interleave.py; fi
  test "$(sha "$target")" = "$old_sha" || { echo OPTIMIZER_REPAIR_SOURCE_DRIFT; exit 6; }
  test "$(sha "$stage/$name")" = "$new_sha" || { echo OPTIMIZER_REPAIR_UPLOAD_MISMATCH; exit 6; }
done < "$manifest"
sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null
mkdir -p "$backup/app" "$backup/ga"
cp -p "$manifest" "$backup/manifest.tsv"
while IFS=$'\t' read -r name old_sha new_sha; do
  if test "$old_sha" != MISSING; then cp -p "$(target_for "$name")" "$backup/$name"; fi
done < "$manifest"
rollback(){
  trap - ERR
  echo OPTIMIZER_REPAIR_FAILED_PHASE "$deployment_phase"
  while IFS=$'\t' read -r name old_sha new_sha; do
    target=$(target_for "$name")
    if test "$old_sha" = MISSING; then
      rm -f "$target"
    else
      cp -p "$backup/$name" "$target"
    fi
  done < "$manifest"
  rollback_update_exit=0
  sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/rollback-private.log" 2>&1 || rollback_update_exit=$?
  echo OPTIMIZER_REPAIR_ROLLBACK_UPDATE_EXIT "$rollback_update_exit"
  if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1; then
    echo OPTIMIZER_REPAIR_ROLLBACK_HEALTH_PASS
  else
    echo OPTIMIZER_REPAIR_ROLLBACK_HEALTH_UNCONFIRMED
  fi
}
deployment_phase=install_sources
trap rollback ERR
while IFS=$'\t' read -r name old_sha new_sha; do
  cp -p "$stage/$name" "$(target_for "$name")"
done < "$manifest"
deployment_phase=update_services
sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/update-private.log" 2>&1
deployment_phase=service_health
ready=no
for attempt in $(seq 1 36); do
  if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1; then ready=yes; break; fi
  sleep 5
done
test "$ready" = yes
echo OPTIMIZER_REPAIR_SERVICE_HEALTH_PASS
deployment_phase=source_hashes
while IFS=$'\t' read -r name old_sha new_sha; do
  test "$(sha "$(target_for "$name")")" = "$new_sha" || { echo OPTIMIZER_REPAIR_SOURCE_VERIFY_FAILED "$name"; false; }
done < "$manifest"
echo OPTIMIZER_REPAIR_SOURCE_HASHES_PASS
deployment_phase=public_bridge_health
public_health https://app.liftorbit.app/__bridge_health 200
deployment_phase=public_auth_health
public_health https://app.liftorbit.app/api/auth/me 401
trap - ERR
echo OPTIMIZER_REPAIR_DEPLOY_AND_HEALTH_PASS
REMOTE
