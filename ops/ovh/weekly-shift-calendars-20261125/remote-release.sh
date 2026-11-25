#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ "$1" =~ ^[0-9]{1,16}$ ]] && [[ "$2" =~ ^[0-9]{1,4}$ ]]
action="$3"
root=/home/liftorbit-ci/liftorbit-migration
stage="$root/sources/ovh-app/weekly-calendars-$1-$2"
backup="$root/patch-backups/weekly-calendars-$1-$2"
manifest="$stage/manifest.tsv"
target(){
  case "$1" in
    restart-optimizer-html.js) printf '%s/sources/ovh-app/current/%s' "$root" "$1";;
    joint_minibatch.py|full_runtime_adapter.py) printf '%s/sources/current/ga/ga_workers/%s' "$root" "$1";;
    *) return 6;;
  esac
}
sha(){ sha256sum "$1" | cut -d' ' -f1; }
check(){
  local phase="$1" name old new expected
  test "$(wc -l < "$manifest")" -eq 3
  test "$(cut -f1 "$manifest" | sort | paste -sd,)" = full_runtime_adapter.py,joint_minibatch.py,restart-optimizer-html.js
  while IFS=$'\t' read -r name old new; do
    [[ "$old" =~ ^[0-9a-f]{64}$ ]] && [[ "$new" =~ ^[0-9a-f]{64}$ ]]
    test "$old" != "$new"
    expected="$old"; if test "$phase" = new; then expected="$new"; fi
    test -f "$(target "$name")" && test ! -L "$(target "$name")"
    test "$(sha "$(target "$name")")" = "$expected"
    test -f "$stage/$name" && test ! -L "$stage/$name"
    test "$(sha "$stage/$name")" = "$new"
  done < "$manifest"
  python3 -B -I "$stage/remote-verify.py" "$stage" "$phase"
}
health(){
  for i in $(seq 1 36);do
    if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1;then return 0;fi
    sleep 5
  done
  return 1
}
public_health(){
  for i in $(seq 1 12);do
    a=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 https://app.liftorbit.app/__bridge_health 2>/dev/null)||a=000
    b=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 https://app.liftorbit.app/api/auth/me 2>/dev/null)||b=000
    if test "$a" = 200 && test "$b" = 401; then return 0;fi
    sleep 5
  done
  return 1
}
restore(){
  set +e
  trap - ERR
  local ok=0
  while IFS=$'\t' read -r name old new;do
    test "$(sha "$backup/$name")" = "$old" || { ok=1;continue; }
    cp -p "$backup/$name" "$(target "$name")" || ok=1
  done < "$manifest"
  if test "$ok" = 0 && check old && sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/rollback-private.log" 2>&1 && health && public_health;then
    echo WEEKLY_ROLLBACK_PASS
    return 0
  fi
  echo WEEKLY_ROLLBACK_UNCONFIRMED
  return 6
}
if test "$action" = rollback;then
  # Never overwrite a concurrent deployment: revert only our exact installed candidate.
  check new
  restore
  exit $?
fi
test "$action" = install
check old
sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null
test ! -e "$backup" && test ! -L "$backup"
mkdir -p "$backup"
while IFS=$'\t' read -r name old new;do
  cp -p "$(target "$name")" "$backup/$name"
  test "$(sha "$backup/$name")" = "$old"
done < "$manifest"
rollback(){ local rc=$?;restore||true;exit "$rc"; }
trap rollback ERR
while IFS=$'\t' read -r name old new;do cp "$stage/$name" "$(target "$name")";done < "$manifest"
check new
sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/update-private.log" 2>&1
health
check new
public_health
trap - ERR
echo WEEKLY_RELEASE_DEPLOY_AND_HEALTH_PASS
