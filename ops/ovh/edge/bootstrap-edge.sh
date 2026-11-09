#!/usr/bin/env bash
# One-time root bootstrap for HTTPS ingress in locked-down pre-cutover staging mode.
# Does not change DNS, Railway, PostgreSQL, application containers, or customer data.
set -euo pipefail
umask 077
[[ "$#" -eq 1 && "$1" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected pinned git commit SHA'; exit 2; }
[[ "$(id -u)" -eq 0 ]] || { echo 'OVH_EDGE_ROOT_REQUIRED'; exit 2; }
revision="$1"
command -v docker > /dev/null
docker compose version > /dev/null
command -v curl > /dev/null
command -v visudo > /dev/null
for endpoint in 'http://127.0.0.1:18080/health' 'http://127.0.0.1:18082/__bridge_health'; do
  curl -fsS --connect-timeout 3 --max-time 8 "$endpoint" > /dev/null || {
    echo 'OVH_EDGE_UPSTREAM_NOT_HEALTHY'; exit 3;
  }
done
root=/opt/liftorbit/edge
if [[ -f "$root/config/Caddyfile" ]]; then
  echo 'OVH_EDGE_ALREADY_CONFIGURED_REFUSE_OVERWRITE'
  exit 4
fi
for port in 80 443; do
  if ss -H -ltn "( sport = :$port )" | grep -q .; then
    echo "OVH_EDGE_PORT_BUSY $port"
    exit 4
  fi
done
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
url="https://raw.githubusercontent.com/Belkazl/production-planner-ai/$revision/ops/ovh/edge"
for file in Caddyfile.staging Caddyfile.production edge.compose.yml liftorbit-edge-ops; do
  curl -fsSL --retry 3 --connect-timeout 12 --max-time 100 "$url/$file" -o "$work/$file"
  [[ -s "$work/$file" ]] || exit 5
done
bash -n "$work/liftorbit-edge-ops"
docker compose -f "$work/edge.compose.yml" config --quiet
docker pull caddy:2.11.9-alpine > /dev/null
for file in Caddyfile.staging Caddyfile.production; do
  docker run --rm --network none -v "$work:/work:ro" caddy:2.11.9-alpine \
    caddy validate --config "/work/$file" --adapter caddyfile > /dev/null
done
echo 'OVH_EDGE_STAGING_AND_PRODUCTION_CONFIG_VALIDATED'
install -d -o root -g root -m 0755 "$root/config"
install -o root -g root -m 0644 "$work/Caddyfile.staging" "$root/config/Caddyfile.staging"
install -o root -g root -m 0644 "$work/Caddyfile.production" "$root/config/Caddyfile.production"
install -o root -g root -m 0644 "$work/Caddyfile.staging" "$root/config/Caddyfile"
install -o root -g root -m 0644 "$work/edge.compose.yml" "$root/edge.compose.yml"
install -o root -g root -m 0755 "$work/liftorbit-edge-ops" /usr/local/sbin/liftorbit-edge-ops
sudoers=/etc/sudoers.d/91-liftorbit-ci-edge
cat > "$work/sudoers" <<'EOF'
liftorbit-ci ALL=(root) NOPASSWD: /usr/local/sbin/liftorbit-edge-ops status, /usr/local/sbin/liftorbit-edge-ops smoke, /usr/local/sbin/liftorbit-edge-ops activate
EOF
chmod 0440 "$work/sudoers"
visudo -cf "$work/sudoers" > /dev/null
install -o root -g root -m 0440 "$work/sudoers" "$sudoers"
visudo -cf "$sudoers" > /dev/null
docker compose -f "$root/edge.compose.yml" up -d --no-build
for attempt in {1..30}; do
  if /usr/local/sbin/liftorbit-edge-ops smoke > /dev/null 2>&1; then
    echo 'OVH_EDGE_PRECUTOVER_HTTPS_STAGING_HEALTHY'
    /usr/local/sbin/liftorbit-edge-ops status
    exit 0
  fi
  sleep 2
done
echo 'OVH_EDGE_STAGING_SMOKE_FAILED'
/usr/local/sbin/liftorbit-edge-ops status || true
exit 6
