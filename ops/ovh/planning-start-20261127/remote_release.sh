#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
mode=$1; run=$2; attempt=$3
[[ "$run" =~ ^[0-9]{1,16}$ ]] && [[ "$attempt" =~ ^[0-9]{1,4}$ ]]
root=/home/liftorbit-ci/liftorbit-migration
app="$root/sources/ovh-app/current"
stage="$root/sources/ovh-app/planning-start-20261127-$run-$attempt"
backup="$root/patch-backups/planning-start-20261127/$run-$attempt"
names=(auth-runtime.js)
destination(){ printf '%s\n' "$app/$1"; }
sha(){ sha256sum "$1" | cut -d' ' -f1; }
wait_smoke(){ for n in $(seq 1 36);do if sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1;then return 0;fi;sleep 5;done;return 1; }
declare -A old new
test -d "$stage" && test ! -L "$stage"
test -f "$stage/manifest.tsv" && test ! -L "$stage/manifest.tsv"
while IFS=$'\t' read -r name a b;do
 case "$name" in auth-runtime.js);; *) exit 4;; esac
 [[ "$a" =~ ^[0-9a-f]{64}$ ]] && [[ "$b" =~ ^[0-9a-f]{64}$ ]] && test "$a" != "$b"
 test -z "${old[$name]+present}"
 old[$name]=$a;new[$name]=$b
done < "$stage/manifest.tsv"
test "${#old[@]}" = "${#names[@]}"
verify(){
 local expected=$1 name dst
 for name in "${names[@]}";do
  dst=$(destination "$name")
  test -f "$dst" && test ! -L "$dst"
  if test "$expected" = old;then test "$(sha "$dst")" = "${old[$name]}";else test "$(sha "$dst")" = "${new[$name]}";fi
 done
}
restore(){
 local name dst
 for name in "${names[@]}";do
  dst=$(destination "$name")
  test "$(sha "$backup/$name")" = "${old[$name]}"
  cp -p "$backup/$name" "$dst"
 done
 verify old
 sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/rollback-private.log" 2>&1
 wait_smoke
 echo PLANNING_START_ROLLBACK_HEALTH_PASS
}
if test "$mode" = rollback;then verify new;restore;exit 0;fi
test "$mode" = install
verify old
for name in "${names[@]}";do test -f "$stage/$name" && test ! -L "$stage/$name" && test "$(sha "$stage/$name")" = "${new[$name]}";done
sudo -n /usr/local/sbin/liftorbit-ops smoke >/dev/null 2>&1
test ! -e "$backup" && test ! -L "$backup"
mkdir -m 700 -p "$backup"
for name in "${names[@]}";do cp -p "$(destination "$name")" "$backup/$name";done
cp -p "$stage/manifest.tsv" "$backup/"
rollback_error(){ local rc=$?;trap - ERR;restore || echo PLANNING_START_ROLLBACK_UNCONFIRMED;exit "$rc"; }
trap rollback_error ERR
for name in "${names[@]}";do cp "$stage/$name" "$(destination "$name")";done
verify new
sudo -n /usr/local/sbin/liftorbit-ops update > "$backup/update-private.log" 2>&1
wait_smoke
verify new
trap - ERR
echo PLANNING_START_OVH_INSTALL_HEALTH_PASS
