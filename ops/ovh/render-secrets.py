#!/usr/bin/env python3
"""Generate isolated OVH staging secrets from private Railway configs.
Never prints secrets. Input is the SSH CI user's locked-down snapshots.
Output is root-only and only staged local databases are used.
"""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
from urllib.parse import quote, urlsplit


def abort(message):
    raise SystemExit("OVH_CONFIG_ERROR: " + message)


def load_json(root, name):
    path = root / (name + ".json")
    values = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(values, dict) or not values:
        abort("invalid_config_" + name)
    if not all(isinstance(k, str) and isinstance(v, str) for k, v in values.items()):
        abort("non_string_variable_" + name)
    if any("${{" in v for v in values.values()):
        abort("unresolved_railway_reference_" + name)
    return {k: v for k, v in values.items() if not k.startswith("RAILWAY_")}


def db_name(values):
    url = values.get("DATABASE_URL", "")
    try:
        parsed = urlsplit(url)
    except ValueError:
        abort("invalid_postgres_url")
    if parsed.scheme not in {"postgres", "postgresql"}:
        abort("expected_postgresql_url")
    if not parsed.hostname or not parsed.hostname.endswith(".railway.internal"):
        abort("postgres_url_must_be_private")
    name = parsed.path.lstrip("/")
    if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_]{0,62}", name):
        abort("unsafe_postgres_database_name")
    return name


def pg_password(out, name):
    path = out / (name + ".env")
    if path.exists():
        data = dict(line.split("=", 1) for line in path.read_text().splitlines() if "=" in line)
        if data.get("POSTGRES_USER") != "postgres" or not data.get("POSTGRES_PASSWORD"):
            abort("existing_postgres_secret_invalid_" + name)
        return data["POSTGRES_PASSWORD"]
    return secrets.token_urlsafe(40)


def pg_url(password, database, host):
    return f"postgresql://postgres:{quote(password, safe='')}@{host}:5432/{database}"


def write_private(path, text):
    if path.is_symlink():
        abort("refuse_symlink_output_" + path.name)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as file:
        file.write(text)
    os.chmod(path, 0o600)


def write_json(out, name, data):
    if not all(isinstance(v, str) for v in data.values()):
        abort("non_string_runtime_variable_" + name)
    write_private(out / (name + ".json"), json.dumps(data, ensure_ascii=False, separators=(",", ":")))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    source = args.source.resolve(strict=True)
    args.output.mkdir(mode=0o700, parents=True, exist_ok=True)
    output = args.output.resolve(strict=True)
    output.chmod(0o700)

    required = ("postgres", "postgres-me4i", "gateway", "auth-gateway", "auth-app", "ga-worker")
    configs = {name: load_json(source, name) for name in required}
    if configs["auth-app"].get("PP_PY_GA_STATE_TOKEN") != configs["auth-gateway"].get("PP_QA_STATE_TOKEN"):
        abort("ga_state_token_mismatch")
    if configs["auth-app"].get("PP_PY_GA_WORKER_TOKEN") != configs["ga-worker"].get("PP_WORKER_INTERNAL_TOKEN"):
        abort("ga_worker_token_mismatch")
    if configs["auth-gateway"].get("PP_QA_AUTH_ONLY") != "1":
        abort("auth_gateway_not_tenant_isolated")
    if configs["auth-app"].get("PP_PY_GA_WORKERS_ENABLED") != "1":
        abort("isolated_ga_workers_not_enabled")
    if configs["auth-app"].get("PP_PY_GA_PERSISTENCE_ENABLED") != "1":
        abort("ga_state_persistence_not_enabled")
    if not configs["gateway"].get("PP_GENERIC_RESTORE_LAUNCH_V2"):
        abort("planner_runtime_source_missing")
    if not configs["ga-worker"].get("PP_PY_GA_ADAPTER"):
        abort("python_ga_adapter_missing")
    for i in range(1, 22):
        if not configs["ga-worker"].get(f"PP_RUNTIME_SRC_{i:02d}"):
            abort("missing_ga_source_chunk")

    main_db = db_name(configs["postgres"])
    auth_db = db_name(configs["postgres-me4i"])
    pass_main = pg_password(output, "postgres-main")
    pass_auth = pg_password(output, "postgres-auth")
    write_private(output / "postgres-main.env",
                  f"POSTGRES_USER=postgres\nPOSTGRES_DB={main_db}\nPOSTGRES_PASSWORD={pass_main}\n")
    write_private(output / "postgres-auth.env",
                  f"POSTGRES_USER=postgres\nPOSTGRES_DB={auth_db}\nPOSTGRES_PASSWORD={pass_auth}\n")
    legacy_uri = pg_url(pass_main, main_db, "postgres-main")
    auth_uri = pg_url(pass_auth, auth_db, "postgres-auth")

    planner = dict(configs["gateway"])
    planner.update({
        "DATABASE_URL": legacy_uri,
        "GATEWAY_URL": "http://planner-gateway:8080",
        "BACKEND_URL": "http://planner-gateway:8080",
        "PORT": "8080",
        "PP_OVH_STAGING": "1",
    })
    write_json(output, "planner", planner)

    auth = dict(configs["auth-gateway"])
    auth.update({
        "DATABASE_URL": auth_uri,
        "LEGACY_DATABASE_URL": legacy_uri,
        "PP_QA_AUTH_ONLY": "1",
        "PP_LEGACY_SNAPSHOT_MIGRATE": "0",
        "PP_PASSWORD_RESET_BOOTSTRAP": "0",
        "PP_PASSWORD_RESET_DIAGNOSTIC": "0",
        "PP_STORAGE_DIAGNOSTIC": "0",
        "PORT": "8080",
        "PP_OVH_STAGING": "1",
    })
    # Avoid sending real emails from a staging system.
    auth.pop("RESEND_API_KEY", None)
    auth.pop("PP_PASSWORD_RESET_FROM", None)
    write_json(output, "auth", auth)

    worker = dict(configs["ga-worker"])
    worker.update({"PORT": "8080", "PP_OVH_STAGING": "1", "PP_WORKER_TEST": "0"})
    write_json(output, "ga", worker)

    app = dict(configs["auth-app"])
    app.update({
        "PP_AUTH_GATEWAY_ORIGIN": "http://auth-gateway:8080",
        "PP_PLANNER_HTML_ORIGIN": "http://planner-gateway:8080",
        "PP_PY_GA_STATE_ORIGIN": "http://auth-gateway:8080",
        "PP_PY_GA_WORKER_ORIGIN": "http://ga-worker:8080",
        "PP_OVH_STAGING": "1",
        "PORT": "8080",
    })
    write_json(output, "app", app)
    print("OVH_STAGING_SIX_SERVICE_CONFIGURATION_VALIDATED (no secret values printed)")


if __name__ == "__main__":
    main()
