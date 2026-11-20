import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
const root=process.argv[2];
if(!root)throw Error("SSE_WORKER_SOURCE_ROOT_REQUIRED");
const get=n=>resolve(root,n);
const here="ops/ovh/sse-stream-v1-20261120/";
const repl=(s,a,b,name)=>{
 if(s.split(a).length!==2)throw Error("SSE_WORKER_SOURCE_DRIFT_"+name+"_"+(s.split(a).length-1));
 return s.replace(a,b);
};
let manager=readFileSync(get("ga_python_workers/ga_workers/manager.py"),"utf8");
manager=repl(manager,
 "    progress: int = 0\n    stage: str = 'queued'",
 "    progress: int = 0\n    event_seq: int = 0\n    stage: str = 'queued'","job_event_seq");
manager=repl(manager,
 '            job.state = "cancelled"\n            job.ended_at = time.monotonic()',
 '            job.state = "cancelled"\n            job.event_seq += 1\n            job.ended_at = time.monotonic()',"cancel_seq");
manager=repl(manager,
 '                job.started_at, job.state = time.monotonic(), "running"',
 '                job.started_at, job.state = time.monotonic(), "running"\n                job.event_seq += 1\n                self.cv.notify_all()',"running_seq");
manager=repl(manager,
 '                            if isinstance(data.get("best_preview"), dict):\n                                job.best_preview = data["best_preview"]',
 '                            if isinstance(data.get("best_preview"), dict):\n                                job.best_preview = data["best_preview"]\n                            job.event_seq += 1\n                            self.cv.notify_all()',"progress_push");
manager=repl(manager,
 '                    job.ended_at = time.monotonic()\n                if self.by_account.get(job.account_id) == job.job_id:',
 '                    job.ended_at = time.monotonic()\n                    job.event_seq += 1\n                if self.by_account.get(job.account_id) == job.job_id:',"terminal_seq");
manager=repl(manager,"    def metrics(self):",
 readFileSync(here+"worker-event-wait.py.txt","utf8")+"    def metrics(self):","wait_event_method");
let server=readFileSync(get("ga_python_workers/ga_workers/server.py"),"utf8");
server=repl(server,'        server_version = "LiftOrbit-GA-Worker"',
 '        server_version = "LiftOrbit-GA-Worker"\n        protocol_version = "HTTP/1.1"',"http11");
server=repl(server,"        def do_GET(self):",
 readFileSync(here+"worker-events-server.py.txt","utf8")+"        def do_GET(self):","server_sse_handler");
server=repl(server,
 '            if len(parts) == 3 and parts[:2] == ["internal", "jobs"]:',
 '            if len(parts) == 4 and parts[:2] == ["internal", "jobs"] and parts[3] == "events":\n                try:\n                    return self.stream_events(principal, parts[2])\n                except JobNotFound:\n                    return self.respond(404, {"error": "job_not_found"})\n                except ForbiddenJob:\n                    return self.respond(403, {"error": "account_mismatch"})\n            if len(parts) == 3 and parts[:2] == ["internal", "jobs"]:',"worker_events_route");
for(const [name,body] of [["manager.py",manager],["server.py",server]]){
 const path=get("ga_python_workers/ga_workers/"+name);
 writeFileSync(path,body);
 console.log("SSE_WORKER_PATCHED",name,body.length,createHash("sha256").update(body).digest("hex"));
}
