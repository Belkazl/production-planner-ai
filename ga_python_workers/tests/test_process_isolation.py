import http.client
import json
import os
import threading
import time
import unittest
from ga_workers.manager import ProcessJobManager, JobConflict, ForbiddenJob, TERMINAL
from ga_workers.server import make_server


def payload(tenant, duration=0.6):
    return {"model": {"account_fixture_tag": tenant, "orders": [{"id": tenant + "-ORDER-" + str(i)} for i in range(12)]},
            "test_cpu_seconds": duration}


def until(fn, timeout=15):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        result = fn()
        if result:
            return result
        time.sleep(0.025)
    raise TimeoutError("expected condition did not happen")


class ProcessTests(unittest.TestCase):
    def setUp(self):
        self.manager = ProcessJobManager(capacity=4, timeout_s=15, allow_fixture=True)

    def tearDown(self):
        self.manager.shutdown()

    def test_ten_real_child_processes_and_isolated_plans(self):
        jobs = {"T" + str(i): self.manager.submit("T" + str(i), payload("T" + str(i), 0.55)) for i in range(10)}
        self.assertRaises(JobConflict, self.manager.submit, "T0", payload("T0"))
        heartbeat = 0
        while True:
            states = [self.manager.get(t, j["job_id"]) for t, j in jobs.items()]
            heartbeat += 1
            if all(x["status"] in TERMINAL for x in states):
                break
            if heartbeat > 1500:
                self.fail("tasks didn't settle")
            time.sleep(0.03)
        pids = set()
        for tenant, info in jobs.items():
            result = self.manager.get(tenant, info["job_id"], include_plan=True)
            self.assertEqual("completed", result["status"], result)
            self.assertEqual(tenant, result["result"]["tenant_tag"])
            self.assertEqual(12, len(result["result"]["operations"]))
            self.assertTrue(all(x["order"].startswith(tenant + "-ORDER-") for x in result["result"]["operations"]))
            pids.add(result["pid"])
        self.assertEqual(10, len(pids))
        self.assertEqual(4, self.manager.metrics()["peak"])
        self.assertEqual(0, self.manager.metrics()["active"])
        self.assertGreater(heartbeat, 1, "HTTP parent must stay responsive during CPU work")
        print("PY_GA_TEN_SESSIONS_PASS", json.dumps({"tenants": 10, "distinct_worker_pids": len(pids), "peak": self.manager.peak, "parent_heartbeats": heartbeat}), flush=True)

    def test_candidate_preview_stays_account_isolated(self):
        jobs = {t: self.manager.submit(t, payload(t, 0.75)) for t in ("CAND_A", "CAND_B")}
        previews = {}
        for tenant, info in jobs.items():
            snap = until(lambda t=tenant, j=info["job_id"]: (
                (x := self.manager.get(t, j)) if isinstance(self.manager.get(t, j).get("candidate_preview"), dict) else None
            ), 8)
            candidate = snap["candidate_preview"]
            previews[tenant] = candidate
            self.assertEqual(tenant, candidate["tenant_tag"])
            self.assertTrue(candidate.get("candidate"))
            self.assertTrue(all(str(x["order"]).startswith(tenant + "-ORDER-") for x in candidate["operations"]))
        self.assertNotEqual(previews["CAND_A"]["tenant_tag"], previews["CAND_B"]["tenant_tag"])

    def test_hard_cancel_one_while_other_jobs_finish(self):
        long = self.manager.submit("CANCEL", payload("CANCEL", 4))
        others = {"OTHER" + str(i): self.manager.submit("OTHER" + str(i), payload("OTHER" + str(i), 0.25)) for i in range(6)}
        running = until(lambda: self.manager.get("CANCEL", long["job_id"])["pid"])
        self.assertTrue(running)
        self.assertRaises(ForbiddenJob, self.manager.get, "OTHER0", long["job_id"])
        time.sleep(0.12)
        stopped = self.manager.stop("CANCEL", long["job_id"])
        self.assertEqual("cancelled", stopped["status"])
        finished = {id: self.manager.wait(id, job["job_id"], timeout=20) for id, job in others.items()}
        self.assertTrue(all(s["status"] == "completed" for s in finished.values()))
        self.assertEqual("cancelled", self.manager.get("CANCEL", long["job_id"])["status"])
        until(lambda: self.manager.metrics()["active"] == 0, 8)
        self.assertNotIn("result", self.manager.get("CANCEL", long["job_id"], include_plan=True))
        print("PY_GA_HARD_CANCEL_PASS", json.dumps({"pid_killed": running, "other_clients_finished": len(finished)}), flush=True)

    def test_cancel_queued_job_without_spawning(self):
        m = ProcessJobManager(capacity=1, allow_fixture=True)
        try:
            first = m.submit("FIRST", payload("FIRST", 0.6))
            second = m.submit("SECOND", payload("SECOND", 0.5))
            until(lambda: m.get("FIRST", first["job_id"])["status"] == "running")
            result = m.stop("SECOND", second["job_id"])
            self.assertEqual("cancelled", result["status"])
            self.assertIsNone(result["pid"])
            self.assertEqual("completed", m.wait("FIRST", first["job_id"], 10)["status"])
        finally:
            m.shutdown()

    def test_timeout_terminates_cpu_process(self):
        m = ProcessJobManager(capacity=1, timeout_s=1, allow_fixture=True)
        try:
            job = m.submit("SLOW", payload("SLOW", 3.5))
            end = m.wait("SLOW", job["job_id"], 6)
            self.assertEqual("timed_out", end["status"])
            until(lambda: m.metrics()["active"] == 0, 4)
        finally:
            m.shutdown()


class ApiTests(unittest.TestCase):
    def test_private_http_auth_and_tenant_ownership(self):
        token = "test-token-" + "z" * 34
        mgr = ProcessJobManager(capacity=2, allow_fixture=True)
        server = make_server(port=0, bind="127.0.0.1", manager=mgr, token=token)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        port = server.server_port

        def query(method, path, body=None, account="A", bearer=token):
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            headers = {"Authorization": "Bearer " + bearer, "X-Authenticated-Account": account}
            if body is not None:
                headers["Content-Type"] = "application/json"
                body = json.dumps(body)
            conn.request(method, path, body=body, headers=headers)
            r = conn.getresponse()
            data = json.loads(r.read())
            code = r.status
            conn.close()
            return code, data
        try:
            self.assertEqual(200, query("GET", "/health")[0])
            self.assertEqual(401, query("GET", "/internal/metrics", bearer="wrong")[0])
            self.assertEqual(202, (created := query("POST", "/internal/jobs", payload("A", 1.2)))[0])
            jid = created[1]["job_id"]
            self.assertEqual(403, query("GET", "/internal/jobs/" + jid, account="B")[0])
            self.assertEqual(403, query("POST", "/internal/jobs/" + jid + "/cancel", account="B")[0])
            self.assertEqual(409, query("POST", "/internal/jobs", payload("A"))[0])
            self.assertEqual(200, query("POST", "/internal/jobs/" + jid + "/cancel")[0])
            self.assertEqual("cancelled", query("GET", "/internal/jobs/" + jid)[1]["status"])
            self.assertEqual(202, query("POST", "/internal/jobs", payload("B", 0.2), account="B")[0])
        finally:
            server.shutdown()
            server.server_close()
            mgr.shutdown()
            thread.join(timeout=2)
        print("PY_GA_PRIVATE_API_PASS", json.dumps({"auth": "denied anonymous", "foreign_get": 403, "foreign_cancel": 403, "single_job_per_tenant": True}), flush=True)


if __name__ == "__main__":
    unittest.main()
