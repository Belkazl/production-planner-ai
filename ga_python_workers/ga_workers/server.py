"""Private Railway service API for isolated Python GA jobs.

Not internet-facing: no Railway custom domain. Clients require an internal token
and account identity asserted by the already authenticated LiftOrbit backend.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import json
import os
from urllib.parse import urlsplit
from .manager import ProcessJobManager, JobConflict, JobNotFound, ForbiddenJob, ServiceBusy

MAX_BODY = 4_000_000


def make_server(port=None, manager=None, token=None, bind="0.0.0.0"):
    token = token if token is not None else os.getenv("PP_WORKER_INTERNAL_TOKEN", "")
    if len(token) < 24:
        raise RuntimeError("PP_WORKER_INTERNAL_TOKEN must be configured and long enough")
    adapter = os.getenv("PP_PY_GA_ADAPTER", "")
    if manager is None:
        if not adapter:
            raise RuntimeError("PP_PY_GA_ADAPTER is not configured; refusing to start")
        allow_fixture = os.getenv("PP_WORKER_TEST", "0") == "1"
        manager = ProcessJobManager(
            adapter=adapter, allow_fixture=allow_fixture,
            capacity=int(os.getenv("PP_PY_GA_MAX_PROCS", "4")),
            timeout_s=int(os.getenv("PP_PY_GA_TIMEOUT_S", "600")))
    port = int(os.getenv("PORT", "8080") if port is None else port)

    class Handler(BaseHTTPRequestHandler):
        server_version = "LiftOrbit-GA-Worker"

        def log_message(self, *_):
            return  # Never log bearer tokens, model data or query strings.

        def respond(self, code, data):
            payload = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def authorized(self):
            sent = self.headers.get("Authorization", "")
            principal = self.headers.get("X-Authenticated-Account", "").strip()
            # This identity is asserted by the trusted LiftOrbit API, never the browser.
            if not hmac.compare_digest(sent.encode(), ("Bearer " + token).encode()):
                self.respond(401, {"error": "service_auth_required"})
                return None
            if not principal or len(principal) > 256:
                self.respond(401, {"error": "authenticated_account_required"})
                return None
            return principal

        def do_GET(self):
            path = urlsplit(self.path).path
            if path == "/health":
                return self.respond(200, {"ok": True, "type": "python-process-ga", "ready": True})
            principal = self.authorized()
            if not principal:
                return
            if path == "/internal/metrics":
                return self.respond(200, manager.metrics())
            parts = path.strip("/").split("/")
            if len(parts) == 3 and parts[:2] == ["internal", "jobs"]:
                try:
                    return self.respond(200, manager.get(principal, parts[2], include_plan=True))
                except JobNotFound:
                    return self.respond(404, {"error": "job_not_found"})
                except ForbiddenJob:
                    return self.respond(403, {"error": "account_mismatch"})
            return self.respond(404, {"error": "not_found"})

        def do_POST(self):
            principal = self.authorized()
            if not principal:
                return
            path = urlsplit(self.path).path
            if path == "/internal/jobs":
                try:
                    size = int(self.headers.get("Content-Length", "0"))
                    if size <= 0 or size > MAX_BODY:
                        return self.respond(413, {"error": "invalid_payload_size"})
                    payload = json.loads(self.rfile.read(size))
                    if not isinstance(payload, dict):
                        return self.respond(422, {"error": "invalid_payload"})
                    return self.respond(202, manager.submit(principal, payload))
                except JobConflict:
                    return self.respond(409, {"error": "already_running_for_account"})
                except ServiceBusy:
                    return self.respond(503, {"error": "queue_full"})
                except (ValueError, json.JSONDecodeError):
                    return self.respond(422, {"error": "invalid_payload"})
            parts = path.strip("/").split("/")
            if len(parts) == 4 and parts[:2] == ["internal", "jobs"] and parts[3] == "cancel":
                try:
                    return self.respond(200, manager.stop(principal, parts[2]))
                except JobNotFound:
                    return self.respond(404, {"error": "job_not_found"})
                except ForbiddenJob:
                    return self.respond(403, {"error": "account_mismatch"})
            return self.respond(404, {"error": "not_found"})

    server = ThreadingHTTPServer((bind, port), Handler)
    server.daemon_threads = True
    server.ga_job_manager = manager
    return server


def main():
    server = make_server()
    print("PY_GA_WORKER_READY", json.dumps({"port": server.server_port,
          "limit": server.ga_job_manager.capacity, "adapter_configured": True}), flush=True)
    try:
        server.serve_forever(poll_interval=0.1)
    finally:
        server.shutdown()
        server.ga_job_manager.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
