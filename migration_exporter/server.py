"""Temporary, read-only PostgreSQL backup exporter for OVH migration.
Bound to Railway private network for PG; only authenticated HTTP clients can
request pg_dump streams. Remove the service immediately after migration.
"""
import hmac
import os
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Lock

PORT = int(os.environ.get("PORT", "8080"))
EXPORT_TOKEN = os.environ.get("MIGRATION_EXPORT_TOKEN", "")
DATABASES = {
    "/backup/postgres": "MIGRATION_DB_MAIN",
    "/backup/postgres-me4i": "MIGRATION_DB_OTHER",
}
EXCLUSIVE = Lock()
CHUNK_BYTES = 64 * 1024


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        # No request paths, bearer tokens, DB URLs, or customer details in logs.
        return

    def respond(self, code: int, payload: bytes = b""):
        self.send_response(code)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if payload:
            self.wfile.write(payload)

    def write_chunk(self, content: bytes):
        self.wfile.write(format(len(content), "x").encode("ascii") + b"\r\n")
        self.wfile.write(content)
        self.wfile.write(b"\r\n")
        self.wfile.flush()

    def do_GET(self):
        if self.path == "/health":
            self.respond(200, b"ok")
            return
        if self.path not in DATABASES:
            self.respond(404)
            return
        got = self.headers.get("Authorization", "")
        expected = "Bearer " + EXPORT_TOKEN
        if len(EXPORT_TOKEN) < 40 or not hmac.compare_digest(got, expected):
            self.respond(404)
            return
        uri = os.environ.get(DATABASES[self.path], "")
        if not uri.startswith(("postgresql://", "postgres://")):
            self.respond(503)
            return
        if not EXCLUSIVE.acquire(blocking=False):
            self.respond(429)
            return
        p = None
        try:
            env = dict(os.environ)
            env["PGCONNECT_TIMEOUT"] = "15"
            # pg_dump emits a consistent logical snapshot, no DB writes.
            p = subprocess.Popen(
                ["pg_dump", "--format=custom", "--no-owner", "--no-privileges",
                 "--dbname=" + uri],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                env=env,
                bufsize=0,
            )
            head = p.stdout.read(5)
            if head != b"PGDMP":
                p.wait(timeout=20)
                self.respond(502)
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Transfer-Encoding", "chunked")
            self.send_header("Cache-Control", "no-store, private")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.write_chunk(head)
            while True:
                piece = p.stdout.read(CHUNK_BYTES)
                if not piece:
                    break
                self.write_chunk(piece)
            p.wait(timeout=30)
            if p.returncode != 0:
                # Omit terminating chunk: curl must fail on incomplete response.
                self.close_connection = True
                return
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            self.close_connection = True
        except Exception:
            self.close_connection = True
        finally:
            if p is not None and p.poll() is None:
                p.kill()
                p.wait()
            EXCLUSIVE.release()


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
