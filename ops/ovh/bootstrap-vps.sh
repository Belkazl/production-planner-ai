#!/usr/bin/env bash
# One-time OVH VPS bootstrap. Execute ONLY as root from a pinned Git commit.
# Does not touch Cloudflare, Railway production, other Docker stacks or 80/443.
set -euo pipefail
umask 077

[[ "$#" -eq 1 ]] || { echo 'Usage: bootstrap-vps.sh <approved commit SHA>'; exit 2; }
revision="$1"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a pinned Git commit SHA'; exit 2; }
[[ "$(id -u)" -eq 0 ]] || { echo 'Must run with sudo'; exit 2; }
command -v docker >/dev/null && docker compose version >/dev/null || {
  echo 'Docker and Compose must be installed before bootstrap'; exit 3;
}
command -v curl >/dev/null && command -v python3 >/dev/null || exit 3
command -v visudo >/dev/null || { echo 'visudo not available'; exit 3; }
[[ -d /home/liftorbit-ci/liftorbit-migration ]] || { echo 'Protected OVH snapshot is missing'; exit 3; }
[[ -d /home/liftorbit-ci/liftorbit-migration/sources/ovh-app/current ]] || {
  echo 'OVH-patched application sources not staged'; exit 3;
}
[[ -d /home/liftorbit-ci/liftorbit-migration/sources/current/auth ]] || exit 3
[[ -d /home/liftorbit-ci/liftorbit-migration/sources/current/ga ]] || exit 3

backup=/home/liftorbit-ci/liftorbit-migration/backups/backup-42475681877-1
[[ -s "$backup/postgres.dump" && -s "$backup/postgres-me4i.dump" && -s "$backup/SHA256SUMS.txt" ]] || {
  echo 'Verified Railway database archives not found'; exit 4;
}
(cd "$backup" && sha256sum --check --quiet SHA256SUMS.txt) || {
  echo 'Database backup checksum failed'; exit 4;
}

root=/opt/liftorbit
mkdir -p "$root"/{sources,secrets,state,admin}
chmod 0700 "$root/secrets" "$root/state" "$root/admin"
chmod 0755 "$root" "$root/sources"
url="https://raw.githubusercontent.com/Belkazl/production-planner-ai/$revision/ops/ovh"
for name in full.compose.yml render-secrets.py liftorbit-ops; do
  curl -fLSs --retry 3 --connect-timeout 12 --max-time 100 \
    "$url/$name" -o "$root/admin/$name.next"
  test -s "$root/admin/$name.next"
done

install -o root -g root -m 0644 "$root/admin/full.compose.yml.next" "$root/full.compose.yml"
install -o root -g root -m 0700 "$root/admin/render-secrets.py.next" "$root/admin/render-secrets.py"
install -o root -g root -m 0755 "$root/admin/liftorbit-ops.next" /usr/local/sbin/liftorbit-ops
rm -f "$root/admin/"*.next

copy_source() {
  local name="$1" src="$2" target="$root/sources/$name"
  test -f "$src/Dockerfile" || { echo "Missing $name Dockerfile"; exit 5; }
  if [[ ! -d "$target" ]]; then
    mkdir -p "$target"
    cp -a "$src/." "$target/"
  fi
}
src=/home/liftorbit-ci/liftorbit-migration/sources
copy_source app "$src/ovh-app/current"
copy_source auth "$src/current/auth"
copy_source ga "$src/current/ga"
mkdir -p "$root/sources/planner" "$src/planner"
curl -fLSs --retry 3 --connect-timeout 12 --max-time 100 \
  "$url/planner/Dockerfile" -o "$root/sources/planner/Dockerfile"
test -s "$root/sources/planner/Dockerfile"
curl -fLSs --retry 3 --connect-timeout 12 --max-time 100 \
  "$url/planner/apt-get" -o "$root/sources/planner/apt-get"
test -s "$root/sources/planner/apt-get"
install -o liftorbit-ci -g liftorbit-ci -m 0644 \
  "$root/sources/planner/Dockerfile" "$src/planner/Dockerfile"
install -o liftorbit-ci -g liftorbit-ci -m 0644 \
  "$root/sources/planner/apt-get" "$src/planner/apt-get"

python3 "$root/admin/render-secrets.py" \
  --source /home/liftorbit-ci/liftorbit-migration/production/current \
  --output "$root/secrets"
docker compose -f "$root/full.compose.yml" config --quiet
echo 'OVH_COMPOSE_AND_PRIVATE_CONFIG_VALIDATED'

# Deliberately small sudo permissions. Nothing resembling sudo-all or Docker-group.
sudoers=/etc/sudoers.d/90-liftorbit-ci-staging
cat > "$sudoers.next" <<'EOF'
liftorbit-ci ALL=(root) NOPASSWD: /usr/local/sbin/liftorbit-ops status, /usr/local/sbin/liftorbit-ops smoke, /usr/local/sbin/liftorbit-ops update
EOF
chmod 0440 "$sudoers.next"
visudo -cf "$sudoers.next" > /dev/null
mv -f "$sudoers.next" "$sudoers"
chmod 0440 "$sudoers"
visudo -cf "$sudoers" > /dev/null
echo 'OVH_RESTRICTED_CI_PERMISSIONS_INSTALLED'

compose=(docker compose -f "$root/full.compose.yml")
"${compose[@]}" up -d postgres-main postgres-auth
for name in postgres-main postgres-auth; do
  healthy=no
  for i in {1..90}; do
    id=$("${compose[@]}" ps -q "$name")
    if [[ -n "$id" && "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id")" == healthy ]]; then
      healthy=yes
      break
    fi
    sleep 2
  done
  [[ "$healthy" == yes ]] || { echo "OVH_POSTGRES_START_FAILED $name"; exit 6; }
done
echo 'OVH_TWO_POSTGRES_18_DATABASES_RUNNING'

restore() {
  local service="$1" archive="$2" envfile="$3" marker="$4" minimum="$5"
  local id db count
  id=$("${compose[@]}" ps -q "$service")
  db=$(sed -n 's/^POSTGRES_DB=//p' "$envfile")
  [[ "$db" =~ ^[a-zA-Z][a-zA-Z0-9_]{0,62}$ ]] || exit 6
  if [[ -f "$marker" ]]; then
    cmp -s "$backup/SHA256SUMS.txt" "$marker" || {
      echo "Restore marker mismatches current backup $service"; exit 7;
    }
    echo "OVH_DB_ALREADY_RESTORED $service"
    return 0
  fi
  count=$(docker exec -u postgres "$id" psql -U postgres -d "$db" -At \
    -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
  [[ "$count" =~ ^[0-9]+$ && "$count" -eq 0 ]] || {
    echo "Refusing to overwrite nonempty staging database $service"; exit 7;
  }
  docker cp "$archive" "$id:/tmp/liftorbit-restore.dump" > /dev/null
  docker exec -u 0 "$id" chmod 0644 /tmp/liftorbit-restore.dump
  if ! docker exec -u postgres "$id" pg_restore \
      --exit-on-error --no-owner --no-privileges -U postgres -d "$db" \
      /tmp/liftorbit-restore.dump > "$root/state/$service-restore.log" 2>&1; then
    echo "RESTORE_FAILED $service; private diagnostics in $root/state"; exit 8
  fi
  docker exec "$id" rm -f /tmp/liftorbit-restore.dump
  count=$(docker exec -u postgres "$id" psql -U postgres -d "$db" -At \
    -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
  [[ "$count" =~ ^[0-9]+$ && "$count" -ge "$minimum" ]] || {
    echo "RESTORED_TABLE_COUNT_TOO_LOW $service"; exit 8;
  }
  cp "$backup/SHA256SUMS.txt" "$marker"
  chmod 0600 "$marker"
  echo "OVH_RESTORED_POSTGRES $service tables=$count"
}
restore postgres-main "$backup/postgres.dump" "$root/secrets/postgres-main.env" "$root/state/main-restored.marker" 12
restore postgres-auth "$backup/postgres-me4i.dump" "$root/secrets/postgres-auth.env" "$root/state/auth-restored.marker" 6
echo 'OVH_TWO_DATABASES_RESTORED_AND_VALIDATED'

# All services are still loopback-only. The public domain is not redirected here.
"${compose[@]}" up -d --build planner-gateway auth-gateway ga-worker app
for service in postgres-main postgres-auth planner-gateway auth-gateway ga-worker app; do
  id=$("${compose[@]}" ps -q "$service")
  [[ -n "$id" ]] || { echo "OVH_BOOTSTRAP_SERVICE_MISSING $service"; exit 9; }
  health=starting
  for attempt in {1..100}; do
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")
    if [[ "$health" == healthy ]]; then break; fi
    if [[ "$health" == unhealthy || "$health" == exited || "$health" == dead ]]; then break; fi
    sleep 2
  done
  echo "OVH_BOOTSTRAP_SERVICE_HEALTH $service=$health"
  [[ "$health" == healthy ]] || { echo "OVH_BOOTSTRAP_SERVICE_NOT_READY $service"; exit 9; }
done
/usr/local/sbin/liftorbit-ops status
if /usr/local/sbin/liftorbit-ops smoke; then
  echo 'OVH_FULL_STAGING_HEALTHY_NO_DNS_CHANGED'
else
  echo 'OVH_SERVICES_DEPLOYED_BUT_SMOKE_FAILED; CI can now diagnose/redeploy with restricted permissions'
  exit 9
fi
