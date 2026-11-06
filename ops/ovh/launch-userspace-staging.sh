#!/usr/bin/env bash
# Staging-only, unprivileged watchdog for the isolated localhost landing.
set -euo pipefail
umask 077
base="$HOME/liftorbit-ci-landing"
mkdir -p "$base/logs"
if command -v flock >/dev/null 2>&1; then
  exec 9> "$base/launch.lock"
  flock -n 9 || exit 0
fi
test -r "$base/current.sha" || exit 0
sha=$(cat "$base/current.sha")
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid staging release identifier' >&2; exit 2; }
release="$base/releases/$sha"
test -f "$release/server.ts" && test -x "$HOME/.local/bin/bun" || exit 2
if curl --fail --silent --max-time 3 http://127.0.0.1:18081/health |
  python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") and d.get("service")=="prodplan-landing-v1"' >/dev/null 2>&1; then
  exit 0
fi
# Never take over a port already owned by another process.
if command -v ss >/dev/null 2>&1 && ss -lnt | grep -Eq '127[.]0[.]0[.]1:18081[[:space:]]'; then
  echo 'Staging port occupied by an unexpected/unhealthy service; refusing restart' >&2
  exit 3
fi
cd "$release"
nohup env PORT=18081 OVH_LOCAL_PREVIEW=1 OVH_LOCAL_PREVIEW_PORT=18081 \
  OVH_STAGING_BIND_LOOPBACK=1 "$HOME/.local/bin/bun" "$release/server.ts" \
  > "$base/logs/$sha.log" 2>&1 < /dev/null &
printf '%s\n' "$!" > "$base/current.pid"
for i in {1..25}; do
  if curl --fail --silent --max-time 2 http://127.0.0.1:18081/health |
    python3 -c 'import json,sys; assert json.load(sys.stdin)["ok"] is True' >/dev/null 2>&1; then
    echo "Staging userspace service started: $sha"
    exit 0
  fi
  sleep 1
done
tail -n 20 "$base/logs/$sha.log" >&2 || true
exit 1
