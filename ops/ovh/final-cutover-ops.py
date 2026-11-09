#!/usr/bin/env python3
"""Root-only guarded LiftOrbit OVH cutover. No DNS, Railway or volume deletion."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

BASE = Path("/opt/liftorbit")
SOURCE = Path("/home/liftorbit-ci/liftorbit-migration")
STATE = BASE / "state/cutover"
COMPOSE = ["docker", "compose", "-f", str(BASE / "full.compose.yml")]
DBS = (("postgres-main", "postgres.dump", 12), ("postgres-auth", "postgres-me4i.dump", 6))
SERVICES = ("postgres-main", "postgres-auth", "planner-gateway", "auth-gateway", "ga-worker", "app")

def fail(code):
    raise RuntimeError("OVH_CUTOVER_" + code)

def run(args, **kwargs):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)

def docker(args, **kwargs):
    return run(["docker", *args], **kwargs)

def compose(args):
    return run([*COMPOSE, *args])

def cid(service):
    result = compose(["ps", "-q", service]).stdout.decode().strip()
    if not result: fail("CONTAINER_MISSING_" + service)
    return result

def db_name(service):
    lines = (BASE / "secrets" / (service + ".env")).read_text().splitlines()
    names = [line.split("=", 1)[1] for line in lines if line.startswith("POSTGRES_DB=")]
    if len(names) != 1 or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,62}", names[0]):
        fail("DB_NAME_INVALID")
    return names[0]

def query(service, sql):
    return docker(["exec", "-u", "postgres", cid(service), "psql", "-X", "-v",
                   "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-Atc", sql]).stdout.decode().strip()

def exists(service, name):
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,62}", name): fail("DB_ID_INVALID")
    return query(service, "SELECT count(*) FROM pg_database WHERE datname='" + name + "'") == "1"

def rename(service, old, new):
    for name in (old, new):
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,62}", name): fail("DB_ID_INVALID")
    query(service, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='" +
          old + "' AND pid <> pg_backend_pid()")
    query(service, 'ALTER DATABASE "' + old + '" RENAME TO "' + new + '"')

def health(service):
    return docker(["inspect", "--format",
                   "{{.State.Status}}:{{if .State.Health}}{{.State.Health.Status}}{{end}}",
                   cid(service)]).stdout.decode().strip() == "running:healthy"

def all_healthy():
    for service in SERVICES:
        if not health(service): fail("SERVICE_NOT_HEALTHY_" + service)

def stage_guard():
    out = run(["/usr/local/sbin/liftorbit-edge-ops", "status"]).stdout.decode()
    if "OVH_EDGE_MODE staging" not in out: fail("EDGE_MUST_REMAIN_IN_STAGING")

def selected():
    pointer = SOURCE / "backups/final-selected.txt"
    if not pointer.is_file() or pointer.is_symlink(): fail("NO_SELECTED_BACKUP")
    name = pointer.read_text().strip()
    if not re.fullmatch(r"backup-[0-9]{8,15}-[1-9][0-9]*", name): fail("BACKUP_NAME_INVALID")
    root = SOURCE / "backups" / name
    if not root.is_dir() or root.is_symlink(): fail("SOURCE_BACKUP_NOT_FOUND")
    checkfile = root / "SHA256SUMS.txt"
    if not checkfile.is_file() or checkfile.is_symlink(): fail("NO_SOURCE_CHECKSUMS")
    for filename in ("postgres.dump", "postgres-me4i.dump"):
        p = root / filename
        if not p.is_file() or p.is_symlink(): fail("ARCHIVE_MISSING")
    run(["sha256sum", "-c", "--quiet", "SHA256SUMS.txt"], cwd=str(root))
    return name, root

def prepare():
    all_healthy()
    stage_guard()
    if (STATE / "import.done").exists(): fail("IMPORT_ALREADY_STARTED")
    if (STATE / "rollback.ready").exists():
        print("OVH_CUTOVER_ROLLBACK_ALREADY_VERIFIED")
        return
    for service, _, _ in DBS:
        target = STATE / (service + ".before.dump")
        if target.exists(): fail("PARTIAL_PREPARE_PRESENT")
        tmp = target.with_suffix(".partial")
        with tmp.open("xb") as out:
            result = subprocess.run(["docker", "exec", "-u", "postgres", cid(service),
                                    "pg_dump", "-U", "postgres", "-Fc", "--no-owner",
                                    "--no-acl", db_name(service)], stdout=out,
                                    stderr=subprocess.PIPE)
        if result.returncode != 0 or tmp.stat().st_size == 0: fail("PG_DUMP_FAILED_" + service)
        docker(["exec", "-i", "-u", "postgres", cid(service), "pg_restore", "--list"],
               input=tmp.read_bytes())
        tmp.rename(target)
        target.chmod(0o600)
        print("OVH_CUTOVER_OLD_DB_SAVED", service)
    with (STATE / "rollback.sha256").open("x") as output:
        for service, _, _ in DBS:
            file = STATE / (service + ".before.dump")
            output.write(hashlib.sha256(file.read_bytes()).hexdigest() + "  " + file.name + "\n")
    (STATE / "rollback.ready").touch(mode=0o600)
    print("OVH_CUTOVER_ROLLBACK_ARCHIVES_VERIFIED")

def stage_import():
    if not (STATE / "rollback.ready").is_file(): fail("ROLLBACK_PREPARE_REQUIRED")
    if (STATE / "import.done").exists(): fail("IMPORT_ALREADY_DONE")
    name, root = selected()
    for service, archive, minimum in DBS:
        if not health(service): fail("DB_UNHEALTHY_" + service)
        if exists(service, "pp_cutover_import"): fail("SHADOW_ALREADY_PRESENT_" + service)
        query(service, 'CREATE DATABASE "pp_cutover_import"')
        container = cid(service)
        docker(["cp", str(root / archive), container + ":/tmp/liftorbit-cutover-source.dump"])
        docker(["exec", "-u", "0", container, "chmod", "0644", "/tmp/liftorbit-cutover-source.dump"])
        log = STATE / (service + ".import.log")
        with log.open("wb") as output:
            result = subprocess.run(["docker", "exec", "-u", "postgres", container,
                "pg_restore", "--exit-on-error", "--no-owner", "--no-privileges",
                "-U", "postgres", "-d", "pp_cutover_import", "/tmp/liftorbit-cutover-source.dump"],
                stdout=output, stderr=subprocess.STDOUT)
        if result.returncode != 0: fail("SHADOW_IMPORT_FAILED_" + service)
        docker(["exec", container, "rm", "-f", "/tmp/liftorbit-cutover-source.dump"])
        count = docker(["exec", "-u", "postgres", container, "psql", "-X", "-U",
            "postgres", "-d", "pp_cutover_import", "-Atc",
            "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"]).stdout.decode().strip()
        if not count.isdecimal() or int(count) < minimum: fail("SHADOW_SCHEMA_TOO_SMALL_" + service)
        print("OVH_CUTOVER_SHADOW_IMPORTED", service, "tables=" + count)
    (STATE / "import.source").write_text(name)
    (STATE / "import.done").touch(mode=0o600)
    print("OVH_CUTOVER_SHADOWS_VALIDATED")

def recover():
    try:
        compose(["stop", "app", "ga-worker", "auth-gateway", "planner-gateway"])
        for service, _, _ in DBS:
            current = db_name(service)
            if exists(service, "pp_cutover_previous"):
                if exists(service, current):
                    if exists(service, "pp_cutover_failed"): fail("ROLLBACK_COLLISION")
                    rename(service, current, "pp_cutover_failed")
                rename(service, "pp_cutover_previous", current)
                print("OVH_CUTOVER_OLD_DB_RECOVERED", service)
        past = STATE / "secrets.before"
        if past.is_dir():
            for filename in ("planner.json", "auth.json", "ga.json", "app.json"):
                if (past / filename).is_file():
                    shutil.copyfile(past / filename, BASE / "secrets" / filename)
                    (BASE / "secrets" / filename).chmod(0o600)
        compose(["up", "-d", "planner-gateway", "auth-gateway", "ga-worker", "app"])
        (BASE / "state/cutover-ready.marker").unlink(missing_ok=True)
        (STATE / "promote.done").unlink(missing_ok=True)
        print("OVH_CUTOVER_RECOVERY_ATTEMPTED")
    except Exception:
        print("OVH_CUTOVER_RECOVERY_NEEDS_ADMINISTRATOR")
        raise

def promote():
    if not (STATE / "rollback.ready").is_file() or not (STATE / "import.done").is_file():
        fail("PREPARE_AND_IMPORT_REQUIRED")
    if (STATE / "promote.done").exists(): fail("ALREADY_PROMOTED")
    freeze = SOURCE / "backups/final-write-frozen.marker"
    if not freeze.is_file() or freeze.is_symlink(): fail("WRITE_FREEZE_ATTESTATION_MISSING")
    now = time.time()
    if freeze.stat().st_mtime > now or now - freeze.stat().st_mtime > 1800:
        fail("WRITE_FREEZE_ATTESTATION_EXPIRED")
    name, root = selected()
    if (STATE / "import.source").read_text().strip() != name: fail("SOURCE_BACKUP_CHANGED")
    if (root / "postgres.dump").stat().st_mtime < freeze.stat().st_mtime:
        fail("SOURCE_BACKUP_OLDER_THAN_FREEZE")
    all_healthy()
    stage_guard()
    past = STATE / "secrets.before"
    if past.exists(): fail("PRODUCTION_PREPARE_ALREADY_STARTED")
    past.mkdir(mode=0o700)
    for filename in ("planner.json", "auth.json", "ga.json", "app.json"):
        shutil.copyfile(BASE / "secrets" / filename, past / filename)
        (past / filename).chmod(0o600)
    try:
        compose(["stop", "app", "ga-worker", "auth-gateway", "planner-gateway"])
        for service, _, _ in DBS:
            original = db_name(service)
            if exists(service, "pp_cutover_previous"): fail("OLD_DB_NAME_EXISTS")
            rename(service, original, "pp_cutover_previous")
            rename(service, "pp_cutover_import", original)
            print("OVH_CUTOVER_DATABASE_PROMOTED", service)
        run(["python3", str(BASE / "admin/render-secrets.py"),
             "--source", str(SOURCE / "production/current"),
             "--output", str(BASE / "secrets"), "--mode", "production"])
        compose(["up", "-d", "planner-gateway", "auth-gateway", "ga-worker", "app"])
        for service in SERVICES:
            for attempt in range(100):
                if health(service): break
                time.sleep(2)
            else: fail("PROMOTED_SERVICE_FAILED_" + service)
        run(["curl", "-fsS", "--connect-timeout", "3", "--max-time", "10",
             "http://127.0.0.1:18082/__bridge_health"])
        run(["/usr/local/sbin/liftorbit-ops", "smoke"])
        (STATE / "promote.done").touch(mode=0o600)
        marker = BASE / "state/cutover-ready.marker"
        marker.touch(mode=0o600)
        marker.chmod(0o600)
        print("OVH_CUTOVER_PRODUCTION_AND_DB_HEALTHY")
        print("OVH_CUTOVER_ROOT_APPROVAL_MARKER_CREATED")
    except Exception:
        print("OVH_CUTOVER_PROMOTE_FAILED_ATTEMPTING_AUTO_RECOVERY")
        recover()
        raise

def status():
    for filename in ("rollback.ready", "import.done", "promote.done"):
        print("OVH_CUTOVER_STATE", filename, (STATE / filename).is_file())
    print(run(["/usr/local/sbin/liftorbit-ops", "status"]).stdout.decode().strip())

def refresh_certificate():
    if not (STATE / "promote.done").is_file():
        fail("CERT_RENEWAL_REQUIRES_PRODUCTION_CUTOVER")
    incoming = SOURCE / "tls/renewal-current"
    full = incoming / "fullchain.pem"
    key = incoming / "privkey.pem"
    if any(not p.is_file() or p.is_symlink() for p in (full, key)):
        fail("CERT_RENEWAL_FILES_MISSING")
    run(["openssl", "x509", "-in", str(full), "-noout", "-checkend", "2592000"])
    domains = run(["openssl", "x509", "-in", str(full),
                   "-noout", "-ext", "subjectAltName"]).stdout.decode()
    if "DNS:liftorbit.app" not in domains or "DNS:app.liftorbit.app" not in domains:
        fail("CERT_RENEWAL_SAN_MISMATCH")
    pub1 = run(["openssl", "x509", "-in", str(full), "-noout", "-pubkey"]).stdout
    pub2 = run(["openssl", "pkey", "-in", str(key), "-pubout"]).stdout
    if pub1 != pub2: fail("CERT_RENEWAL_KEY_MISMATCH")
    destination = BASE / "edge/config"
    for original, name in ((full, "fullchain.pem"), (key, "privkey.pem")):
        target = destination / name
        pending = destination / (name + ".renewal")
        if pending.exists() or target.is_symlink(): fail("CERT_RENEWAL_PATH_UNSAFE")
        pending.write_bytes(original.read_bytes())
        pending.chmod(0o600)
        pending.replace(target)
    run(["docker", "compose", "-f", str(BASE / "edge/edge.compose.yml"),
         "up", "-d", "--force-recreate", "--no-deps", "caddy"])
    run(["/usr/local/sbin/liftorbit-edge-ops", "smoke"])
    print("OVH_CUTOVER_PRODUCTION_CERTIFICATE_REFRESHED")

def main():
    if os.geteuid() != 0 or len(sys.argv) != 2: fail("ROOT_AND_ONE_ACTION_REQUIRED")
    os.umask(0o077)
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    action = sys.argv[1]
    if action == "status": status()
    elif action == "prepare": prepare()
    elif action == "import": stage_import()
    elif action == "promote": promote()
    elif action == "rollback": recover()
    elif action == "refresh-cert": refresh_certificate()
    else: fail("ACTION_NOT_PERMITTED")

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("OVH_CUTOVER_ERROR", str(exc).splitlines()[0][:150], file=sys.stderr)
        sys.exit(1)
