#!/usr/bin/env bash
# Deliberate marker-gated release. Never invoke for a baseline-only probe.
set -euo pipefail
test "$DEPLOY_HOST" = 51.255.163.121
test "$DEPLOY_USER" = liftorbit-ci
test "$GITHUB_REF" = refs/heads/fix/gantt-zoom-500-20261124
case "$GITHUB_RUN_ID" in *[!0-9]*|'') exit 6;; esac
run_attempt=${GITHUB_RUN_ATTEMPT:-1}
case "$run_attempt" in *[!0-9]*|'') exit 6;; esac
marker=ops/ovh/joint-minibatch-release-20261124/release.json
PYTHONDONTWRITEBYTECODE=1 python3 ops/ovh/joint-minibatch-release-20261124/release_guard.py --marker "$marker"
umask 077
release_stage=$(mktemp -d "$RUNNER_TEMP/joint-minibatch-release.XXXXXX")
trap 'rm -rf -- "$release_stage"' EXIT
printf '%s\n' "$DEPLOY_KEY" > "$release_stage/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$release_stage/known-hosts"
chmod 600 "$release_stage/key" "$release_stage/known-hosts"
ssh_call(){ ssh -i "$release_stage/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$release_stage/known-hosts" -o ConnectTimeout=20 "$@"; }
scp_call(){ scp -q -i "$release_stage/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$release_stage/known-hosts" -o ConnectTimeout=20 "$@"; }
target="$DEPLOY_USER@$DEPLOY_HOST"
root=/home/liftorbit-ci/liftorbit-migration
app="$root/sources/ovh-app/current"
echo JOINT_RELEASE_PHASE capture_verified_sources
mkdir -p "$release_stage/old/app" "$release_stage/new/app"
ssh_call "$target" 'PYTHONDONTWRITEBYTECODE=1 python3 -I - --emit-private-bundle' \
  < ops/ovh/native-batching-verify-20261124/native_input_contract.py \
  > "$release_stage/private.bundle" 2> "$release_stage/transport-private.log"
for file in auth-runtime.js python-ga-upstream.mjs python-ga-upstream-build.ts restart-optimizer-ui.js; do
  scp_call "$target:$app/$file" "$release_stage/old/app/$file" 2>> "$release_stage/transport-private.log"
done
cp -a "$release_stage/old/app/." "$release_stage/new/app/"
echo JOINT_RELEASE_PHASE prepare_exact_overlay
PYTHONDONTWRITEBYTECODE=1 python3 ops/ovh/joint-minibatch-release-20261124/stage.py native "$marker" "$release_stage"
node ops/ovh/native-batching-continuation-20261124/patch.mjs "$release_stage/new/app"
node ops/ovh/native-batching-continuation-20261124/patch_ui.mjs "$release_stage/old/app/restart-optimizer-ui.js" "$release_stage/new/app/restart-optimizer-ui.js"
if node --check "$release_stage/new/app/python-ga-upstream.mjs" > "$release_stage/syntax-private.log" 2>&1 \
    && node --check "$release_stage/new/app/restart-optimizer-ui.js" >> "$release_stage/syntax-private.log" 2>&1; then
  echo JOINT_RELEASE_GATE_PASS app_syntax
else
  echo JOINT_RELEASE_GATE_FAILED app_syntax
  exit 6
fi
run_gate(){
  local label="$1"; shift
  if "$@" > "$release_stage/$label-private.log" 2>&1; then
    echo JOINT_RELEASE_GATE_PASS "$label"
  else
    echo JOINT_RELEASE_GATE_FAILED "$label"
    return 1
  fi
}
run_gate worker_continuation env PYTHONDONTWRITEBYTECODE=1 LIFTORBIT_CONTINUATION_FIXTURE_ROOT="$release_stage/native/ga_workers" \
  python3 -m unittest discover -s ops/ovh/native-batching-continuation-20261124 -p test_worker.py
run_gate bridge_continuation env LIFTORBIT_NATIVE_CONTINUATION_FIXTURE_ROOT="$release_stage/old/app" \
  node --test ops/ovh/native-batching-continuation-20261124/test.mjs
run_gate scoped_stop_sse env LIFTORBIT_PREVIEW_FIXTURE_ROOT="$release_stage/new/app" \
  node --test ops/ovh/first-candidate-preview-20261124/test.mjs
run_gate selected_plan_ui env LIFTORBIT_SELECTED_GENOME_UI_FIXTURE="$release_stage/old/app/restart-optimizer-ui.js" \
  node --test ops/ovh/native-batching-continuation-20261124/test_ui.mjs
run_gate operation_interleave env PYTHONDONTWRITEBYTECODE=1 PP_NATIVE_CONSTRAINTS="$release_stage/native/ga_workers/constraints.py" \
  python3 -m unittest discover -s ops/ovh/operation-interleave-20261124 -p test_interleave.py
PYTHONDONTWRITEBYTECODE=1 python3 ops/ovh/joint-minibatch-release-20261124/stage.py manifest "$marker" "$release_stage"

remote_stage="$root/sources/ovh-app/joint-minibatch-release-20261124-$GITHUB_RUN_ID-$run_attempt"
echo JOINT_RELEASE_PHASE upload_exact_changes
ssh_call "$target" mkdir -p "$remote_stage/app" "$remote_stage/ga"
scp_call "$release_stage/manifest.tsv" "$release_stage/code-inputs.sha256" "$target:$remote_stage/"
scp_call ops/ovh/native-batching-verify-20261124/native_input_contract.py "$target:$remote_stage/input_contract.py"
scp_call "$release_stage/new/app/python-ga-upstream.mjs" "$target:$remote_stage/app/python-ga-upstream.mjs"
scp_call "$release_stage/new/app/restart-optimizer-ui.js" "$target:$remote_stage/app/restart-optimizer-ui.js"
for file in full_runtime_adapter.py joint_minibatch.py joint_continuation.py; do
  scp_call "$release_stage/new/ga_workers/$file" "$target:$remote_stage/ga/$file"
done
ssh_call "$target" bash -s -- "$GITHUB_RUN_ID" "$run_attempt" <<'REMOTE'
set -euo pipefail
umask 077
case "$1" in *[!0-9]*|'') exit 6;; esac
case "$2" in *[!0-9]*|'') exit 6;; esac
root="$HOME/liftorbit-migration"
stage="$root/sources/ovh-app/joint-minibatch-release-20261124-$1-$2"
backup="$root/patch-backups/joint-minibatch-release-20261124/$1-$2"
manifest="$stage/manifest.tsv"
deployment_phase=verify_current_sources
echo JOINT_RELEASE_PHASE "$deployment_phase"
target_for(){
  case "$1" in
    app/auth-runtime.js|app/python-ga-upstream.mjs|app/python-ga-upstream-build.ts|app/restart-optimizer-ui.js)
      printf '%s/%s' "$root/sources/ovh-app/current" "${1#app/}";;
    ga/*)
      [[ "$1" =~ ^ga/[A-Za-z_][A-Za-z0-9_]*\.py$ ]] || exit 6
      printf '%s/%s' "$root/sources/current/ga/ga_workers" "${1#ga/}";;
    *) exit 6;;
  esac
}
sha(){ if test -f "$1"; then sha256sum "$1" | cut -d' ' -f1; else printf MISSING; fi; }
verify_manifest(){
  python3 - "$manifest" "$root/sources/current/ga/ga_workers" "$1" <<'PY'
from pathlib import Path
import re,sys
manifest,package,phase=Path(sys.argv[1]),Path(sys.argv[2]),sys.argv[3]
try:
    rows=[line.split('\t') for line in manifest.read_text().splitlines()]
    allowed={'app/python-ga-upstream.mjs','app/restart-optimizer-ui.js','ga/full_runtime_adapter.py','ga/joint_minibatch.py','ga/joint_continuation.py'}
    if not 11<=len(rows)<=68 or any(len(row)!=4 for row in rows):raise ValueError()
    if len({row[1] for row in rows})!=len(rows):raise ValueError()
    if {row[1] for row in rows if row[0]=='WRITE'}!=allowed:raise ValueError()
    if not {'app/auth-runtime.js','app/python-ga-upstream-build.ts'}.issubset({row[1] for row in rows if row[0]=='PRESERVE'}):raise ValueError()
    for role,name,old,new in rows:
        if role not in {'WRITE','PRESERVE'}:raise ValueError()
        if not re.fullmatch(r'[0-9a-f]{64}',new):raise ValueError()
        if old=='MISSING':
            if name not in {'ga/joint_minibatch.py','ga/joint_continuation.py'}:raise ValueError()
        elif not re.fullmatch(r'[0-9a-f]{64}',old):raise ValueError()
        if role=='PRESERVE' and old!=new:raise ValueError()
        if name.startswith('ga/'):
            if not re.fullmatch(r'ga/[A-Za-z_][A-Za-z0-9_]*\.py',name):raise ValueError()
        elif name not in {'app/auth-runtime.js','app/python-ga-upstream.mjs','app/python-ga-upstream-build.ts','app/restart-optimizer-ui.js'}:raise ValueError()
    expected={name[3:] for _,name,old,_ in rows if name.startswith('ga/') and (phase=='new' or old!='MISSING')}
    actual={path.name for path in package.glob('*.py')}
    if actual!=expected or any((package/name).is_symlink() or not (package/name).is_file() for name in actual):raise ValueError()
except Exception:
    print('JOINT_RELEASE_REMOTE_MANIFEST_REJECTED')
    raise SystemExit(6)
print('JOINT_RELEASE_REMOTE_MANIFEST_VERIFIED')
PY
}
verify_code_inputs(){
  PYTHONDONTWRITEBYTECODE=1 python3 -I - "$stage/input_contract.py" "$stage/code-inputs.sha256" <<'PY'
import hashlib,importlib.util,json,re,sys
from pathlib import Path
try:
    spec=importlib.util.spec_from_file_location('reviewed_code_input_contract',sys.argv[1])
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    expected=Path(sys.argv[2]).read_text().strip()
    if not re.fullmatch(r'[0-9a-f]{64}',expected):raise ValueError()
    selected=module.select_code_fields(json.loads(module.read_owned(module.CONFIG)))
    actual=hashlib.sha256(json.dumps(selected,separators=(',',':')).encode()).hexdigest()
    if actual!=expected:raise ValueError()
except Exception:
    print('JOINT_RELEASE_NATIVE_CODE_INPUTS_DRIFT')
    raise SystemExit(6)
print('JOINT_RELEASE_NATIVE_CODE_INPUTS_VERIFIED')
PY
}
verify_sources(){
  local mode="$1" role name old new actual destination
  verify_manifest "$mode"
  while IFS=$'\t' read -r role name old new; do
    destination=$(target_for "$name")
    test ! -L "$destination" || { echo JOINT_RELEASE_SOURCE_SYMLINK_REJECTED "$name"; return 6; }
    if test "$mode" = new || test "$old" != MISSING; then
      test -f "$destination" || { echo JOINT_RELEASE_SOURCE_NOT_REGULAR "$name"; return 6; }
    fi
    actual=$(sha "$destination")
    if test "$mode" = old; then
      test "$actual" = "$old" || { echo JOINT_RELEASE_SOURCE_DRIFT "$name"; return 6; }
      if test "$role" = WRITE; then
        test -f "$stage/$name" && test ! -L "$stage/$name" || { echo JOINT_RELEASE_UPLOAD_NOT_REGULAR "$name"; return 6; }
        test "$(sha "$stage/$name")" = "$new" || { echo JOINT_RELEASE_UPLOAD_MISMATCH "$name"; return 6; }
      fi
    else
      test "$actual" = "$new" || { echo JOINT_RELEASE_SOURCE_VERIFY_FAILED "$name"; return 6; }
    fi
  done < "$manifest"
}
public_health(){
  local endpoint="$1" expected="$2" attempt observed
  for attempt in $(seq 1 6); do
    observed=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$endpoint" 2>/dev/null) || observed=000
    [[ "$observed" =~ ^[0-9]{3}$ ]] || observed=000
    echo JOINT_RELEASE_PUBLIC_HEALTH "$deployment_phase" "attempt=$attempt" "code=$observed"
    if test "$observed" = "$expected"; then return 0; fi
    if test "$attempt" -lt 6; then sleep 5; fi
  done
  return 1
}
wait_for_service_smoke(){
  local attempt
  for attempt in $(seq 1 36); do
    if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1; then return 0; fi
    if test "$attempt" -lt 36; then sleep 5; fi
  done
  return 1
}
verify_sources old
verify_code_inputs
sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1
deployment_phase=backup_sources
echo JOINT_RELEASE_PHASE "$deployment_phase"
test ! -e "$backup/manifest.tsv"
mkdir -p "$backup/app" "$backup/ga"
cp -p "$manifest" "$backup/manifest.tsv"
while IFS=$'\t' read -r role name old new; do
  if test "$role" = WRITE && test "$old" != MISSING; then
    cp -p "$(target_for "$name")" "$backup/$name"
    test "$(sha "$backup/$name")" = "$old"
  fi
done < "$manifest"
rollback(){
  local failure_exit="$1" restore_exit=0 rollback_update_exit=0
  trap - ERR
  set +e
  echo JOINT_RELEASE_FAILED_PHASE "$deployment_phase"
  while IFS=$'\t' read -r role name old new; do
    if test "$role" = WRITE; then
      if test "$old" = MISSING; then
        rm -f "$(target_for "$name")" || restore_exit=1
      else
        cp -p "$backup/$name" "$(target_for "$name")" || restore_exit=1
      fi
    fi
  done < "$manifest"
  echo JOINT_RELEASE_ROLLBACK_RESTORE_EXIT "$restore_exit"
  if test "$restore_exit" -eq 0; then
    sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/rollback-private.log" 2>&1 || rollback_update_exit=$?
  else
    rollback_update_exit=6
  fi
  echo JOINT_RELEASE_ROLLBACK_UPDATE_EXIT "$rollback_update_exit"
  if test "$restore_exit" -eq 0 && test "$rollback_update_exit" -eq 0 && wait_for_service_smoke; then
    echo JOINT_RELEASE_ROLLBACK_HEALTH_PASS
  else
    echo JOINT_RELEASE_ROLLBACK_HEALTH_UNCONFIRMED
  fi
  exit "$failure_exit"
}
deployment_phase=install_sources
echo JOINT_RELEASE_PHASE "$deployment_phase"
trap 'rollback "$?"' ERR
while IFS=$'\t' read -r role name old new; do
  if test "$role" = WRITE; then cp -p "$stage/$name" "$(target_for "$name")"; fi
done < "$manifest"
deployment_phase=update_services
echo JOINT_RELEASE_PHASE "$deployment_phase"
sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/update-private.log" 2>&1
deployment_phase=service_health
echo JOINT_RELEASE_PHASE "$deployment_phase"
wait_for_service_smoke
deployment_phase=verify_deployed_hashes
echo JOINT_RELEASE_PHASE "$deployment_phase"
verify_sources new
verify_code_inputs
deployment_phase=public_bridge_health
echo JOINT_RELEASE_PHASE "$deployment_phase"
public_health https://app.liftorbit.app/__bridge_health 200
deployment_phase=public_auth_health
echo JOINT_RELEASE_PHASE "$deployment_phase"
public_health https://app.liftorbit.app/api/auth/me 401
trap - ERR
echo JOINT_RELEASE_DEPLOY_AND_HEALTH_PASS
REMOTE
