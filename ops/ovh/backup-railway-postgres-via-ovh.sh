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
remote_started=no
cleanup() {
  set +e
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
exit 3
OPEN_REMOTE
remote_started=yes
ssh "${opts[@]}" "$target" -T -N \
  -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:15432:127.0.0.1:25432 \
  -L 127.0.0.1:15433:127.0.0.1:25433 \
  > "$work/ovh-tunnel-private.log" 2>&1 &
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
for item in 'postgres:49ab352b-7b4c-4422-910d-3b1fefaa1e37:15432' 'postgres-me4i:aaf9a34e-78c2-476a-b53c-3629e78a98c8:15433'; do
  IFS=: read -r name service port <<< "$item"
  if ! railway variable list --project 16a27a18-a727-4a65-b75d-4368159b0e3e \
      --environment production --service "$service" --json \
      > "$work/$name.variables.json" 2> "$work/$name.variable-errors"; then
    echo "RAILWAY_DB_VARIABLE_READ_FAILED: $name" >&2
    exit 5
  fi
  node - "$work/$name.variables.json" "$work/$name.env" "$port" <<'NODE'
const fs=require('fs');
const data=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const str=data.DATABASE_URL;
if(typeof str!=='string'||!str.startsWith('postgres')) throw Error('database_url_missing');
const u=new URL(str);
if(!/^[a-z0-9-]+[.]railway[.]internal$/.test(u.hostname)) throw Error('not_private_host');
const port=process.argv[4];
if(!['15432','15433'].includes(port)) throw Error('bad_tunnel_port');
const values=[decodeURIComponent(u.username),decodeURIComponent(u.password),decodeURIComponent(u.pathname.slice(1))];
if(values.some(x=>!x||/[\r\n]/.test(x))) throw Error('invalid_postgres_fields');
const env=['PGHOST=127.0.0.1','PGPORT='+port,
  'PGUSER='+values[0], 'PGPASSWORD='+values[1], 'PGDATABASE='+values[2],
  'PGSSLMODE=prefer', 'PGCONNECT_TIMEOUT=20'].join('\n')+'\n';
fs.writeFileSync(process.argv[3],env,{mode:0o600});
NODE
  echo "PG_DUMP_START: $name"
  docker run --pull missing --rm --network host --user "$(id -u):$(id -g)" \
    --env-file "$work/$name.env" \
    -v "$work/backups:/backups" postgres:18 \
    pg_dump --format=custom --compress=6 --no-owner --no-privileges \
    --file="/backups/$name.dump"
  test -s "$work/backups/$name.dump"
  [[ "$(head -c 5 "$work/backups/$name.dump")" == PGDMP ]] || exit 6
  docker run --pull missing --rm --network none \
    -v "$work/backups:/backups:ro" postgres:18 \
    pg_restore --list "/backups/$name.dump" > /dev/null
  echo "PG_DUMP_FORMAT_VERIFIED: $name"
  rm -f "$work/$name.variables.json" "$work/$name.env" "$work/$name.variable-errors"
done
(cd "$work/backups" && sha256sum postgres.dump postgres-me4i.dump > SHA256SUMS.txt)
backup="backup-$run_id"
remote="/home/liftorbit-ci/liftorbit-migration/backups/$backup"
ssh "${opts[@]}" "$target" "umask 077; mkdir -p '$remote'; chmod 700 '$remote'"
scp -q "${opts[@]}" "$work/backups/postgres.dump" \
  "$work/backups/postgres-me4i.dump" "$work/backups/SHA256SUMS.txt" "$target:$remote/"
ssh "${opts[@]}" "$target" "BACKUP_NAME='$backup' bash -se" <<'VERIFY_REMOTE'
set -euo pipefail
umask 077
[[ "$BACKUP_NAME" =~ ^backup-[0-9]+-[0-9]+$ ]] || exit 8
dir="$HOME/liftorbit-migration/backups/$BACKUP_NAME"
chmod 600 "$dir"/*.dump "$dir/SHA256SUMS.txt"
(cd "$dir" && sha256sum --check --quiet SHA256SUMS.txt)
[[ "$(head -c 5 "$dir/postgres.dump")" == PGDMP ]]
[[ "$(head -c 5 "$dir/postgres-me4i.dump")" == PGDMP ]]
printf 'OVH_VERIFIED_TWO_PG_BACKUPS sizes_bytes='
wc -c < "$dir/postgres.dump" | tr -d ' \n'
printf ','
wc -c < "$dir/postgres-me4i.dump" | tr -d ' \n'
printf '\n'
VERIFY_REMOTE
echo 'OVH_BOTH_PG_BACKUPS_SUCCEEDED'
