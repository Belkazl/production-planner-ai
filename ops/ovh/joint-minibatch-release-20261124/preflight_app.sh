#!/usr/bin/env bash
# Read-only host capture and private runner preflight of the exact app overlay.
# The binary transfer and every source-bearing diagnostic stay in RUNNER_TEMP.
set -euo pipefail
umask 077

if test "$#" = 1 && test "$1" = --emit-private-bundle; then
  PYTHONDONTWRITEBYTECODE=1 python3 -I - <<'PY'
import io, os, stat, sys, tarfile
from pathlib import Path

root = Path('/home/liftorbit-ci/liftorbit-migration')
app = root / 'sources/ovh-app/current'
names = ('python-ga-upstream.mjs', 'python-ga-upstream-build.ts', 'restart-optimizer-ui.js')
maximum = 4 * 1024 * 1024
try:
    if sys.stdout.isatty():
        raise ValueError()
    resolved_app = app.resolve(strict=True)
    if not resolved_app.is_relative_to(root.resolve(strict=True)) or not resolved_app.is_dir():
        raise ValueError()
    files = {}
    for name in names:
        path = resolved_app / name
        if path.is_symlink() or path.resolve(strict=True).parent != resolved_app:
            raise ValueError()
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, 'rb') as handle:
            before = os.fstat(handle.fileno())
            if (not stat.S_ISREG(before.st_mode) or before.st_uid not in (0, os.getuid())
                    or not 0 < before.st_size <= maximum):
                raise ValueError()
            data = handle.read(maximum + 1)
            after = os.fstat(handle.fileno())
            if (len(data) != before.st_size or len(data) > maximum
                    or (before.st_size, before.st_mtime_ns, before.st_ino, before.st_dev)
                    != (after.st_size, after.st_mtime_ns, after.st_ino, after.st_dev)):
                raise ValueError()
        files[name] = data
    # All three approved, regular file reads finish before any binary output.
    with tarfile.open(fileobj=sys.stdout.buffer, mode='w|', format=tarfile.USTAR_FORMAT) as archive:
        for name in names:
            member = tarfile.TarInfo(name)
            member.size = len(files[name])
            member.mode = 0o600
            member.mtime = 0
            archive.addfile(member, io.BytesIO(files[name]))
except Exception:
    print('JOINT_APP_SOURCE_CAPTURE_FAILED', file=sys.stderr)
    raise SystemExit(6)
PY
  exit 0
fi

if test "$#" != 1 || test -z "${RUNNER_TEMP:-}" || test ! -d "$RUNNER_TEMP"; then
  echo JOINT_APP_PREFLIGHT_FAILED invocation
  exit 6
fi
app_preflight_bundle="$1"
if test "$app_preflight_bundle" != "$RUNNER_TEMP/native-batching-app.bundle"; then
  echo JOINT_APP_PREFLIGHT_FAILED bundle_path
  exit 6
fi
app_preflight_stage=$(mktemp -d "$RUNNER_TEMP/joint-app-preflight.XXXXXX")
cleanup(){
  local status="$?"
  trap - EXIT
  rm -rf -- "$app_preflight_stage" >/dev/null 2>&1 || true
  rm -f -- "$app_preflight_bundle" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT
preflight_repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd -P)
cd "$preflight_repo"
run_gate(){
  local label="$1"; shift
  if "$@" > "$app_preflight_stage/$label-private.log" 2>&1; then
    echo JOINT_APP_PREFLIGHT_PASS "$label"
  else
    echo JOINT_APP_PREFLIGHT_FAILED "$label"
    return 6
  fi
}

run_gate bundle_contract env PYTHONDONTWRITEBYTECODE=1 python3 -I - "$app_preflight_bundle" "$app_preflight_stage" <<'PY'
import os, stat, sys, tarfile
from pathlib import Path

bundle, stage = map(Path, sys.argv[1:])
names = {'python-ga-upstream.mjs', 'python-ga-upstream-build.ts', 'restart-optimizer-ui.js'}
maximum = 4 * 1024 * 1024
try:
    if bundle.is_symlink():
        raise ValueError()
    descriptor = os.open(bundle, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= 16 * 1024 * 1024:
            raise ValueError()
        files = {}
        with tarfile.open(fileobj=stream, mode='r:') as archive:
            for member in archive:
                if (member.name not in names or member.name in files or not member.isfile()
                        or member.type != tarfile.REGTYPE or member.linkname or member.pax_headers
                        or not 0 < member.size <= maximum):
                    raise ValueError()
                handle = archive.extractfile(member)
                if handle is None:
                    raise ValueError()
                with handle:
                    data = handle.read(maximum + 1)
                if len(data) != member.size or len(data) > maximum:
                    raise ValueError()
                files[member.name] = data
        if set(files) != names:
            raise ValueError()
    for label in ('old', 'new'):
        target = stage / label
        target.mkdir(mode=0o700)
        for name, data in files.items():
            with open(target / name, 'xb') as handle:
                os.chmod(target / name, 0o600)
                handle.write(data)
except Exception:
    print('JOINT_APP_BUNDLE_CONTRACT_REJECTED')
    raise SystemExit(6)
PY

run_gate source_class node ops/ovh/native-batching-continuation-20261124/patch.mjs \
  --classify "$app_preflight_stage/old/python-ga-upstream.mjs"
PYTHONDONTWRITEBYTECODE=1 python3 -I - "$app_preflight_stage/source_class-private.log" <<'PY'
import json, re, sys
from pathlib import Path
try:
    text = Path(sys.argv[1]).read_text()
    prefix = 'NATIVE_CONTINUATION_SOURCE_CLASS '
    if len(text) > 1024 or not text.startswith(prefix):
        raise ValueError()
    value = json.loads(text[len(prefix):])
    variants = {'nov17_owned_plan', 'nov19_stored_order_fastpath', 'nov19_client_order_v2', 'joint_compact_v1', 'unknown'}
    if (set(value) != {'variant', 'sha256'} or value['variant'] not in variants
            or re.fullmatch('[0-9a-f]{64}', value['sha256']) is None):
        raise ValueError()
    print(prefix + json.dumps(value, separators=(',', ':')))
except Exception:
    print('JOINT_APP_PREFLIGHT_FAILED source_class_contract')
    raise SystemExit(6)
PY
run_gate bridge_patch node ops/ovh/native-batching-continuation-20261124/patch.mjs "$app_preflight_stage/new"
run_gate selected_plan_patch node ops/ovh/native-batching-continuation-20261124/patch_ui.mjs \
  "$app_preflight_stage/old/restart-optimizer-ui.js" "$app_preflight_stage/new/restart-optimizer-ui.js"
run_gate preserved_build cmp -s "$app_preflight_stage/old/python-ga-upstream-build.ts" "$app_preflight_stage/new/python-ga-upstream-build.ts"
run_gate app_syntax bash -c 'node --check "$1" && node --check "$2" && node --check --input-type=module < "$3"' bash \
  "$app_preflight_stage/new/python-ga-upstream.mjs" "$app_preflight_stage/new/restart-optimizer-ui.js" \
  "$app_preflight_stage/new/python-ga-upstream-build.ts"
run_gate bridge_continuation env LIFTORBIT_NATIVE_CONTINUATION_FIXTURE_ROOT="$app_preflight_stage/old" \
  node --test ops/ovh/native-batching-continuation-20261124/test.mjs
run_gate selected_plan_ui env LIFTORBIT_SELECTED_GENOME_UI_FIXTURE="$app_preflight_stage/old/restart-optimizer-ui.js" \
  node --test ops/ovh/native-batching-continuation-20261124/test_ui.mjs
run_gate scoped_stop_sse env LIFTORBIT_PREVIEW_FIXTURE_ROOT="$app_preflight_stage/new" \
  node --test ops/ovh/first-candidate-preview-20261124/test.mjs
echo JOINT_APP_PREFLIGHT_COMPLETE
