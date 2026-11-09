#!/usr/bin/env bash
# Back up both live Railway PostgreSQL 18 databases via two chained SSH tunnels.
# No Railway private keys are exported: the workspace SSH key remains on OVH.
# GitHub runner holds DB credentials/dumps ephemerally; nothing is uploaded as an artifact.
set -euo pipefail
umask 077
: "${RAILWAY_TOKEN:?}" "${OVH_HOST:?}" "${OVH_USER:?}" "${OVH_SSH_PRIVATE_KEY:?}" "${OVH_SSH_KNOWN_HOSTS:?}"
: "${GITHUB_RUN_ID:?}" "${GITHUB_RUN_ATTEMPT:?}"
[[ "$OVH_HOST" == '51.255.163.121' && "$OVH_USER" == 'liftorbit-ci' ]] || exit 2
run_id="${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
[[ "$run_id" =~ ^[0-9]+-[0-9]+$ ]] || exit 2
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/liftorbit-db-backup.XXXXXXXX")
mkdir -p "$work/backups"
printf '%s\n' "$OVH_SSH_PRIVATE_KEY" > "$work/ovh.key"
printf '%s\n' "$OVH_SSH_KNOWN_HOSTS" > "$work/ovh.hosts"
chmod 600 "$work/ovh.key" "$work/ovh.hosts"
opts=(-i "$work/ovh.key" -o IdentitiesOnly=yes -o BatchMode=yes
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$work/ovh.hosts"
  -o ConnectTimeout=20 -o ServerAliveInterval=20 -o ServerAliveCountMax=3)
target="$OVH_USER@$OVH_HOST"
forward_pid=''
CUTOVER_DONE=no
FROZEN_MAIN=no
FROZEN_AUTH=no
DNS_MUTATION_STARTED=no
OVH_PROMOTED=no
FREEZE_MARKER_CREATED=no
remote_started=no
cleanup() {
  original_status=$?
  set +e
  if [[ "$CUTOVER_DONE" != yes ]]; then
    echo 'LIFTORBIT_CUTOVER_FAILED_BEGIN_SAFE_RECOVERY'
    if [[ "$DNS_MUTATION_STARTED" == yes && -s "$work/dns-before.json" ]]; then
      python3 ops/ovh/final-dns-cutover.py restore "$work/dns-before.json" \
        && echo 'LIFTORBIT_DNS_REVERTED' || echo 'LIFTORBIT_DNS_RESTORE_NEEDS_ATTENTION'
    fi
    for entry in "postgres:$FROZEN_MAIN" "postgres-me4i:$FROZEN_AUTH"; do
      name=${entry%%:*}
      flag=${entry#*:}
      if [[ "$flag" == yes && -s "$work/$name.env" && -s "$work/$name.dbname" ]]; then
        db=$(cat "$work/$name.dbname")
        docker run --pull missing --rm --network host --user "$(id -u):$(id -g)" \
          --env-file "$work/$name.env" postgres:18 \
          psql -X -v ON_ERROR_STOP=1 -d postgres -c \
          "ALTER DATABASE \"$db\" SET default_transaction_read_only TO off;" \
          >/dev/null 2>&1
        docker run --pull missing --rm --network host --user "$(id -u):$(id -g)" \
          --env-file "$work/$name.env" postgres:18 \
          psql -X -v ON_ERROR_STOP=1 -d postgres -c \
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$db' AND pid <> pg_backend_pid();" \
          >/dev/null 2>&1
        echo "LIFTORBIT_SOURCE_DB_UNFREEZE_ATTEMPTED $name"
      fi
    done
    if [[ "$FREEZE_MARKER_CREATED" == yes ]]; then
      ssh "${opts[@]}" "$target" 'rm -f "$HOME/liftorbit-migration/backups/final-write-frozen.marker"' \
        >/dev/null 2>&1 || true
    fi
    if [[ "$OVH_PROMOTED" == yes ]]; then
      ssh "${opts[@]}" "$target" 'sudo -n /usr/local/sbin/liftorbit-cutover-ops rollback' \
        >/dev/null 2>&1 \
        && echo 'LIFTORBIT_OVH_RECOVERED_PREVIOUS_DATABASES' \
        || echo 'LIFTORBIT_OVH_ROLLBACK_NEEDS_ATTENTION'
    fi
    echo 'LIFTORBIT_CUTOVER_FAILED_RECOVERY_ATTEMPTED'
  fi
  if [[ -n "$forward_pid" ]]; then kill "$forward_pid" 2>/dev/null; wait "$forward_pid" 2>/dev/null; fi
  if [[ "$remote_started" == yes ]]; then
    ssh "${opts[@]}" "$target" "RUN_ID='$run_id' bash -se" > /dev/null 2>&1 <<'STOP_REMOTE'
set -euo pipefail
[[ "$RUN_ID" =~ ^[0-9]+-[0-9]+$ ]] || exit 2
dir="$HOME/liftorbit-migration/backup-tunnels"
pidfile="$dir/$RUN_ID.pid"
if [[ -f "$pidfile" ]]; then
  pid=$(cat "$pidfile")
  if [[ "$pid" =~ ^[0-9]+$ ]] && [[ -r "/proc/$pid/cmdline" ]]; then
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline")
    if [[ "$cmd" == *'ssh.railway.com'* && "$cmd" == *'25432'* ]]; then kill "$pid" 2>/dev/null || true; fi
  fi
  rm -f "$pidfile"
fi
STOP_REMOTE
  fi
  rm -rf "$work"
  return "$original_status"
}
trap cleanup EXIT
echo 'RAILWAY_DB_BACKUP_START'
ssh "${opts[@]}" "$target" "RUN_ID='$run_id' bash -se" <<'OPEN_REMOTE'
set -euo pipefail
umask 077
[[ "$RUN_ID" =~ ^[0-9]+-[0-9]+$ ]] || exit 2
key="$HOME/.ssh/liftorbit_railway_migration_ed25519"
test -r "$key"
dir="$HOME/liftorbit-migration/backup-tunnels"
mkdir -p "$dir"
chmod 700 "$dir"
if ss -lnt | grep -Eq '127[.]0[.]0[.]1:2543[23][[:space:]]'; then
  echo 'RAILWAY_REMOTE_TUNNEL_PORT_BUSY' >&2
  exit 3
fi
target='production-planner-gateway-production.up.railway.app@ssh.railway.com'
nohup ssh -n -N -T -i "$key" -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$dir/known_hosts" \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
  -L 127.0.0.1:25432:postgres.railway.internal:5432 \
  -L 127.0.0.1:25433:postgres-me4i.railway.internal:5432 \
  "$target" > "$dir/$RUN_ID.log" 2>&1 < /dev/null &
pid=$!
printf '%s\n' "$pid" > "$dir/$RUN_ID.pid"
for i in {1..18}; do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo 'RAILWAY_REMOTE_TUNNEL_PROCESS_EXITED' >&2
    rm -f "$dir/$RUN_ID.pid"
    exit 3
  fi
  if python3 - <<'PY'
import socket
for port in (25432,25433):
    with socket.create_connection(('127.0.0.1',port),timeout=3) as s:
        s.settimeout(3)
        s.sendall(bytes.fromhex('0000000804d2162f'))
        assert s.recv(1) in (b'S',b'N')
PY
  then
    echo 'RAILWAY_REMOTE_BOTH_DB_TUNNELS_READY'
    exit 0
  fi
  sleep 1
done
echo 'RAILWAY_REMOTE_BOTH_DB_TUNNELS_FAILED' >&2
kill "$pid" 2>/dev/null || true
rm -f "$dir/$RUN_ID.pid"
exit 3
OPEN_REMOTE
remote_started=yes
ssh "${opts[@]}" -T -N \
  -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:15432:127.0.0.1:25432 \
  -L 127.0.0.1:15433:127.0.0.1:25433 \
  "$target" > "$work/ovh-tunnel-private.log" 2>&1 &
forward_pid=$!
ready=no
for i in {1..24}; do
  if ! kill -0 "$forward_pid" 2>/dev/null; then break; fi
  if python3 - <<'PY'
import socket
for port in (15432,15433):
    with socket.create_connection(('127.0.0.1',port),timeout=2) as s:
        s.settimeout(2)
        s.sendall(bytes.fromhex('0000000804d2162f'))
        assert s.recv(1) in (b'S',b'N')
PY
  then ready=yes; break; fi
  sleep 1
done
[[ "$ready" == yes ]] || { echo 'GH_TO_OVH_RAILWAY_DATABASE_TUNNELS_FAILED' >&2; exit 4; }
echo 'RAILWAY_DB_BOTH_CHAINED_TUNNELS_CONFIRMED'

# Capture the precise DNS prior state before touching either database.
python3 ops/ovh/final-dns-cutover.py capture "$work/dns-before.json"
ssh "${opts[@]}" "$target" 'umask 077; mkdir -p "$HOME/liftorbit-migration/dns-backups"; chmod 700 "$HOME/liftorbit-migration/dns-backups"'
dns_backup="dns-final-before-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT.json"
scp -q "${opts[@]}" "$work/dns-before.json" "$target:/home/liftorbit-ci/liftorbit-migration/dns-backups/$dns_backup"
ssh "${opts[@]}" "$target" "BACKUP_FILE='$dns_backup' bash -se" <<'REMOTE'
set -euo pipefail
path="$HOME/liftorbit-migration/dns-backups/$BACKUP_FILE"
chmod 600 "$path"
python3 - "$path" <<'PY'
import json,sys
o=json.load(open(sys.argv[1]))
assert o["kind"]=="liftorbit-cutover-v1"
assert set(o["records"])=={"liftorbit.app","app.liftorbit.app"}
print("LIFTORBIT_FINAL_DNS_ROLLBACK_SNAPSHOT_SAVED")
PY
REMOTE
readiness=$(ssh "${opts[@]}" "$target" 'sudo -n /usr/local/sbin/liftorbit-cutover-ops status')
grep -Fq 'OVH_CUTOVER_STATE rollback.ready True' <<< "$readiness"
grep -Fq 'OVH_CUTOVER_STATE import.done False' <<< "$readiness"
grep -Fq 'OVH_CUTOVER_STATE promote.done False' <<< "$readiness"
ssh "${opts[@]}" "$target" 'sudo -n /usr/local/sbin/liftorbit-ops smoke' >/dev/null
ssh "${opts[@]}" "$target" 'sudo -n /usr/local/sbin/liftorbit-edge-ops status' | grep -Fq 'OVH_EDGE_MODE staging'
echo 'LIFTORBIT_PRECUTOVER_DNS_BACKUP_AND_OVH_ROLLBACK_READY'

# Read DB credentials into private runner files: never print them.
for item in 'postgres:49ab352b-7b4c-4422-910d-3b1fefaa1e37:15432' 'postgres-me4i:aaf9a34e-78c2-476a-b53c-3629e78a98c8:15433'; do
  IFS=: read -r name service port <<< "$item"
  if ! railway variable list --project 16a27a18-a727-4a65-b75d-4368159b0e3e \
      --environment production --service "$service" --json \
      > "$work/$name.variables.json" 2> "$work/$name.variable-errors"; then
    echo "LIFTORBIT_SOURCE_DB_VARIABLE_READ_FAILED $name" >&2
    exit 5
  fi
  node - "$work/$name.variables.json" "$work/$name.env" "$port" "$work/$name.dbname" <<'NODE'
const fs=require('fs');
const v=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(typeof v.DATABASE_URL!=='string')throw Error('database_url_missing');
const u=new URL(v.DATABASE_URL);
if(!['postgres','postgresql'].includes(u.protocol.slice(0,-1)))throw Error('not_postgres');
if(!/^[a-z0-9-]+[.]railway[.]internal$/.test(u.hostname))throw Error('not_private_host');
const port=process.argv[4];
if(!['15432','15433'].includes(port))throw Error('bad_port');
const db=decodeURIComponent(u.pathname.slice(1));
const fields=[decodeURIComponent(u.username),decodeURIComponent(u.password),db];
if(fields.some(x=>!x||/[\r\n]/.test(x)))throw Error('invalid_db_fields');
if(!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(db))throw Error('unsafe_db_name');
fs.writeFileSync(process.argv[3],['PGHOST=127.0.0.1','PGPORT='+port,
  'PGUSER='+fields[0],'PGPASSWORD='+fields[1],'PGDATABASE='+db,
  'PGSSLMODE=prefer','PGCONNECT_TIMEOUT=20'].join('\n')+'\n',{mode:0o600});
fs.writeFileSync(process.argv[5],db+'\n',{mode:0o600});
NODE
done
echo 'LIFTORBIT_BOTH_SOURCE_DATABASE_CONNECTIONS_CONFIGURED'

# The short migration maintenance window begins here.
# Freeze both databases, terminate stale write-capable sessions and verify
# read-only for freshly established connections before taking final backups.
for name in postgres postgres-me4i; do
  db=$(cat "$work/$name.dbname")
  old=$(docker run --pull missing --rm --network host --user "$(id -u):$(id -g)" \
    --env-file "$work/$name.env" postgres:18 psql -X -At -v ON_ERROR_STOP=1 \
    -c 'SHOW default_transaction_read_only')
  [[ "$old" == off ]] || { echo "LIFTORBIT_DB_ALREADY_READONLY_OR_UNEXPECTED $name"; exit 5; }
  if [[ "$name" == postgres ]]; then FROZEN_MAIN=yes; else FROZEN_AUTH=yes; fi
  docker run --pull missing --rm --network host --user "$(id -u):$(id -g)" \
    --env-file "$work/$name.env" postgres:18 psql -X -v ON_ERROR_STOP=1 \
    -d postgres -c "ALTER DATABASE \"$db\" SET default_transaction_read_only TO on;" >/dev/null
  docker run --pull missing --rm --network host --user "$(id -u):$(id -g)" \
    --env-file "$work/$name.env" postgres:18 psql -X -v ON_ERROR_STOP=1 \
    -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$db' AND pid <> pg_backend_pid();" >/dev/null
  actual=$(docker run --pull missing --rm --network host --user "$(id -u):$(id -g)" \
    --env-file "$work/$name.env" postgres:18 psql -X -At -v ON_ERROR_STOP=1 \
    -c 'SHOW default_transaction_read_only')
  [[ "$actual" == on ]] || { echo "LIFTORBIT_DB_FREEZE_FAILED $name"; exit 6; }
  echo "LIFTORBIT_SOURCE_DB_NEW_WRITES_FROZEN $name"
done
ssh "${opts[@]}" "$target" 'umask 077; touch "$HOME/liftorbit-migration/backups/final-write-frozen.marker"; chmod 600 "$HOME/liftorbit-migration/backups/final-write-frozen.marker"'
FREEZE_MARKER_CREATED=yes
echo 'LIFTORBIT_SOURCE_DATABASE_FREEZE_ATTESTED'

# Both fresh dumps are created only after both databases are frozen.
for name in postgres postgres-me4i; do
  echo "LIFTORBIT_FINAL_PG_DUMP_START $name"
  docker run --pull missing --rm --network host --user "$(id -u):$(id -g)" \
    --env-file "$work/$name.env" -v "$work/backups:/backups" postgres:18 \
    pg_dump --format=custom --compress=6 --no-owner --no-privileges \
    --file="/backups/$name.dump"
  test -s "$work/backups/$name.dump"
  [[ "$(head -c 5 "$work/backups/$name.dump")" == PGDMP ]] || exit 6
  docker run --pull missing --rm --network none -v "$work/backups:/backups:ro" postgres:18 \
    pg_restore --list "/backups/$name.dump" > /dev/null
  echo "LIFTORBIT_FINAL_PG_DUMP_VERIFIED $name"
done
(cd "$work/backups" && sha256sum postgres.dump postgres-me4i.dump > SHA256SUMS.txt)
backup="backup-$run_id"
remote="/home/liftorbit-ci/liftorbit-migration/backups/$backup"
ssh "${opts[@]}" "$target" "umask 077; mkdir -p '$remote'; chmod 700 '$remote'"
scp -q "${opts[@]}" "$work/backups/postgres.dump" \
  "$work/backups/postgres-me4i.dump" "$work/backups/SHA256SUMS.txt" "$target:$remote/"
ssh "${opts[@]}" "$target" "BACKUP_NAME='$backup' bash -se" <<'REMOTE'
set -euo pipefail
umask 077
[[ "$BACKUP_NAME" =~ ^backup-[0-9]+-[1-9][0-9]*$ ]] || exit 8
dir="$HOME/liftorbit-migration/backups/$BACKUP_NAME"
chmod 600 "$dir"/*.dump "$dir/SHA256SUMS.txt"
(cd "$dir" && sha256sum --check --quiet SHA256SUMS.txt)
[[ "$(head -c 5 "$dir/postgres.dump")" == PGDMP ]]
[[ "$(head -c 5 "$dir/postgres-me4i.dump")" == PGDMP ]]
pointer="$HOME/liftorbit-migration/backups/final-selected.txt"
[[ ! -L "$pointer" ]] || exit 8
printf '%s\n' "$BACKUP_NAME" > "$pointer"
chmod 600 "$pointer"
echo 'LIFTORBIT_FINAL_BACKUP_SELECTED_AND_VERIFIED'
REMOTE
echo 'LIFTORBIT_FINAL_POSTFREEZE_DATABASES_COPIED_TO_OVH'

ssh "${opts[@]}" "$target" 'sudo -n /usr/local/sbin/liftorbit-cutover-ops import'
ssh "${opts[@]}" "$target" 'sudo -n /usr/local/sbin/liftorbit-cutover-ops promote'
OVH_PROMOTED=yes
ssh "${opts[@]}" "$target" 'sudo -n /usr/local/sbin/liftorbit-ops smoke' >/dev/null
echo 'LIFTORBIT_OVH_BOTH_DATABASES_PROMOTED_AND_STACK_HEALTHY'

ssh "${opts[@]}" "$target" 'sudo -n /usr/local/sbin/liftorbit-edge-ops activate'
ssh "${opts[@]}" "$target" 'sudo -n /usr/local/sbin/liftorbit-edge-ops status' \
  | grep -Fq 'OVH_EDGE_MODE production'
origin_ready=no
for attempt in {1..12}; do
  if curl -fsS --connect-timeout 6 --max-time 14 \
    --resolve liftorbit.app:443:51.255.163.121 https://liftorbit.app/health > /dev/null 2>&1 &&
     curl -fsS --connect-timeout 6 --max-time 14 \
    --resolve app.liftorbit.app:443:51.255.163.121 https://app.liftorbit.app/__bridge_health > /dev/null 2>&1; then
    origin_ready=yes
    break
  fi
  sleep 2
done
[[ "$origin_ready" == yes ]] || { echo 'LIFTORBIT_OVH_PUBLIC_TLS_ORIGIN_FAILED'; exit 9; }
ssh "${opts[@]}" "$target" 'sudo -n /usr/local/sbin/liftorbit-edge-ops smoke'
echo 'LIFTORBIT_OVH_PUBLIC_HTTPS_BOTH_DOMAINS_VALID_WITHOUT_DNS_SWITCH'

DNS_MUTATION_STARTED=yes
python3 ops/ovh/final-dns-cutover.py switch "$work/dns-before.json"
echo 'LIFTORBIT_CLOUDFLARE_BOTH_DNS_RECORDS_NOW_OVH'
public_ready=no
for attempt in {1..12}; do
  if curl -fsS --connect-timeout 5 --max-time 15 https://liftorbit.app/health > /dev/null 2>&1 &&
     curl -fsS --connect-timeout 5 --max-time 15 https://app.liftorbit.app/__bridge_health > /dev/null 2>&1; then
    public_ready=yes
    break
  fi
  sleep 3
done
[[ "$public_ready" == yes ]] || { echo 'LIFTORBIT_POST_DNS_PUBLIC_HTTPS_FAILED'; exit 10; }
ssh "${opts[@]}" "$target" 'sudo -n /usr/local/sbin/liftorbit-cutover-ops status'
ssh "${opts[@]}" "$target" 'sudo -n /usr/local/sbin/liftorbit-ops smoke' >/dev/null
echo 'LIFTORBIT_PRODUCTION_PUBLIC_CUTOVER_VERIFIED'
CUTOVER_DONE=yes
echo 'LIFTORBIT_MIGRATION_COMPLETE_RAILWAY_PRESERVED_READONLY_FOR_ROLLBACK'
