#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ "$1" =~ ^[0-9]{1,16}$ ]] && [[ "$2" =~ ^[0-9]{1,4}$ ]]
action="$3"
root=/home/liftorbit-ci/liftorbit-migration
stage="$root/sources/ovh-app/restart-lifecycle-$1-$2"
backup="$root/patch-backups/restart-lifecycle-$1-$2"
app="$root/sources/ovh-app/current"
manifest="$stage/manifest.tsv"
sha(){ sha256sum "$1" | cut -d' ' -f1; }
check(){
 local phase="$1" name old new expected
 test "$(wc -l < "$manifest")" -eq 4
 test "$(cut -f1 "$manifest" | sort | paste -sd,)" = python-ga-upstream.mjs,restart-optimizer-html.js,restart-optimizer-server.js,restart-optimizer-ui.js
 while IFS=$'\t' read -r name old new; do
  [[ "$old" =~ ^[0-9a-f]{64}$ ]] && [[ "$new" =~ ^[0-9a-f]{64}$ ]]
  expected="$old";if test "$phase" = new;then expected="$new";fi
  test -f "$app/$name" && test ! -L "$app/$name"
  test "$(sha "$app/$name")" = "$expected"
  test -f "$stage/$name" && test ! -L "$stage/$name"
  test "$(sha "$stage/$name")" = "$new"
 done < "$manifest"
 test "$(sha "$app/auth-runtime.js")" = c60ae5026f9906b0c4fb1496bd9a74e7a579124dd5f647f4d44104e92ccee9e8
 test "$(sha "$root/sources/current/ga/ga_workers/joint_minibatch.py")" = ed6782ad3837fdf5d190106c0afd2c005b1225e05e53d232ee828d623344feae
 test "$(sha "$root/sources/current/ga/ga_workers/full_runtime_adapter.py")" = e4806ff78c6c203e9a1e36513b4db0b6947c3f7bd12003468c7ae458fbca5ead
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
  if test "$a" = 200 && test "$b" = 401;then return 0;fi
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
  cp -p "$backup/$name" "$app/$name" || ok=1
 done < "$manifest"
 if test "$ok" = 0 && check old && sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/rollback-private.log" 2>&1 && health && public_health;then
  echo RESTART_LIFECYCLE_ROLLBACK_PASS;return 0
 fi
 echo RESTART_LIFECYCLE_ROLLBACK_UNCONFIRMED;return 6
}
if test "$action" = rollback;then
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
 cp -p "$app/$name" "$backup/$name"
 test "$(sha "$backup/$name")" = "$old"
done < "$manifest"
rollback(){ local rc=$?;restore||true;exit "$rc"; }
trap rollback ERR
while IFS=$'\t' read -r name old new;do cp "$stage/$name" "$app/$name";done < "$manifest"
check new
sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/update-private.log" 2>&1
health
check new
public_health
trap - ERR
echo RESTART_LIFECYCLE_DEPLOY_HEALTH_PASS
