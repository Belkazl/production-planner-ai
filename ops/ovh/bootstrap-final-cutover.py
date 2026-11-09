#!/usr/bin/env python3
"""Install strictly limited OVH cutover controls once, without changing DNS or databases."""
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request

ROOT = Path("/opt/liftorbit")
SRC = Path("/home/liftorbit-ci/liftorbit-migration")
EDGE = ROOT / "edge/config"

def run(args, **kw):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kw)

def require(cond, code):
    if not cond: raise RuntimeError("OVH_FINAL_BOOTSTRAP_" + code)

def write(path, data, mode):
    p = Path(path)
    p.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if p.is_symlink(): raise RuntimeError("OVH_REFUSE_SYMLINK_TARGET")
    tmp = p.with_name(p.name + ".next")
    with open(tmp, "xb") as output:
        output.write(data)
    tmp.chmod(mode)
    os.replace(tmp, p)
    p.chmod(mode)

def main():
    require(os.geteuid() == 0 and len(sys.argv) == 2, "ROOT_SHA_REQUIRED")
    sha = sys.argv[1]
    require(re.fullmatch(r"[0-9a-f]{40}", sha) is not None, "INVALID_PIN")
    require((ROOT / "full.compose.yml").is_file(), "STAGING_NOT_INSTALLED")
    require((EDGE / "Caddyfile.staging").is_file(), "EDGE_NOT_INSTALLED")
    require(Path("/usr/local/sbin/liftorbit-ops").is_file(), "APP_HELPER_NOT_INSTALLED")
    require(Path("/usr/local/sbin/liftorbit-edge-ops").is_file(), "EDGE_HELPER_NOT_INSTALLED")
    require(not Path("/usr/local/sbin/liftorbit-cutover-ops").exists(),
            "ALREADY_INSTALLED_REFUSE_OVERWRITE")
    for cmd in (["/usr/local/sbin/liftorbit-ops", "smoke"],
                ["/usr/local/sbin/liftorbit-edge-ops", "smoke"]):
        run(cmd)
    base = "https://raw.githubusercontent.com/Belkazl/production-planner-ai/" + sha + "/ops/ovh/"
    with urllib.request.urlopen(base + "final-cutover-ops.py", timeout=35) as inp:
        code = inp.read()
    with urllib.request.urlopen(base + "render-secrets.py", timeout=35) as inp:
        renderer = inp.read()
    require(len(code) > 5000 and len(renderer) > 2000, "PINNED_SCRIPT_MISSING")
    with tempfile.TemporaryDirectory(prefix="ovh-final-root-", dir="/tmp") as t:
        path = Path(t)
        (path / "cutover.py").write_bytes(code)
        (path / "render-secrets.py").write_bytes(renderer)
        run(["python3", "-m", "py_compile", str(path / "cutover.py"), str(path / "render-secrets.py")])
        # Test production-only secrets using the actual root-owned database credentials.
        secrets_check = path / "secrets"
        secrets_check.mkdir(mode=0o700)
        for name in ("postgres-main.env", "postgres-auth.env"):
            shutil.copyfile(ROOT / "secrets" / name, secrets_check / name)
        run(["python3", str(path / "render-secrets.py"), "--source",
             str(SRC / "production/current"), "--output", str(secrets_check),
             "--mode", "production"])
        print("OVH_FINAL_PRODUCTION_EMAIL_SECRETS_PREFLIGHT_OK")
    tls = SRC / "tls/tls-precutover-42652829924-1"
    fullchain = tls / "fullchain.pem"
    key = tls / "privkey.pem"
    require(fullchain.is_file() and key.is_file() and
            not fullchain.is_symlink() and not key.is_symlink(), "ACME_CERT_MISSING")
    run(["openssl", "x509", "-in", str(fullchain), "-noout", "-checkend", "2592000"])
    domains = run(["openssl", "x509", "-in", str(fullchain),
                   "-noout", "-ext", "subjectAltName"]).stdout.decode()
    require("DNS:liftorbit.app" in domains and "DNS:app.liftorbit.app" in domains,
            "ACME_CERT_WRONG_NAMES")
    pubcert = run(["openssl", "x509", "-in", str(fullchain), "-noout", "-pubkey"]).stdout
    pubkey = run(["openssl", "pkey", "-in", str(key), "-pubout"]).stdout
    require(pubcert == pubkey, "ACME_CERT_PRIVATE_KEY_MISMATCH")
    production_file = EDGE / "Caddyfile.production"
    text = production_file.read_text()
    for host in ("liftorbit.app", "app.liftorbit.app"):
        anchor = host + " {\n"
        require(text.splitlines().count(anchor.rstrip("\n")) == 1, "PROXY_CADDY_CONFIG_CHANGED")
        text = text.replace(anchor, anchor +
                            "  tls /etc/caddy/fullchain.pem /etc/caddy/privkey.pem\n", 1)
    # Only touches the *inactive* production template, never Caddy's active staging config.
    write(EDGE / "fullchain.pem", fullchain.read_bytes(), 0o600)
    write(EDGE / "privkey.pem", key.read_bytes(), 0o600)
    candidate = EDGE / "Caddyfile.production.test"
    write(candidate, text.encode(), 0o600)
    try:
        run(["docker", "run", "--rm", "--network", "none", "--user", "0:0",
             "-v", str(EDGE) + ":/etc/caddy:ro", "caddy:2.11.9-alpine",
             "caddy", "validate", "--config", "/etc/caddy/Caddyfile.production.test",
             "--adapter", "caddyfile"])
    except Exception:
        candidate.unlink(missing_ok=True)
        raise
    write(production_file, text.encode(), 0o644)
    candidate.unlink(missing_ok=True)
    print("OVH_FINAL_REAL_CERT_STAGED_WITH_PRODUCTION_CADDY_ONLY")
    write(ROOT / "admin/render-secrets.py", renderer, 0o700)
    write("/usr/local/sbin/liftorbit-cutover-ops", code, 0o700)
    sudoers = b"""liftorbit-ci ALL=(root) NOPASSWD: /usr/local/sbin/liftorbit-cutover-ops status, /usr/local/sbin/liftorbit-cutover-ops prepare, /usr/local/sbin/liftorbit-cutover-ops import, /usr/local/sbin/liftorbit-cutover-ops promote, /usr/local/sbin/liftorbit-cutover-ops rollback
"""
    sudoers_file = Path("/etc/sudoers.d/92-liftorbit-ci-cutover")
    sudoers_tmp = Path("/etc/sudoers.d/92-liftorbit-ci-cutover.tmp")
    sudoers_tmp.write_bytes(sudoers)
    sudoers_tmp.chmod(0o440)
    run(["visudo", "-cf", str(sudoers_tmp)])
    os.replace(sudoers_tmp, sudoers_file)
    sudoers_file.chmod(0o440)
    run(["visudo", "-cf", str(sudoers_file)])
    run(["/usr/local/sbin/liftorbit-cutover-ops", "status"])
    print("OVH_FINAL_MINIMUM_CUTOVER_PRIVILEGES_INSTALLED")
    print("OVH_FINAL_NO_DB_DNS_OR_RUNNING_CONTAINERS_MODIFIED")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("OVH_FINAL_BOOTSTRAP_FAILED", type(e).__name__,
              str(e).splitlines()[0][:100], file=sys.stderr)
        sys.exit(1)
