import os,json,time
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from urllib.parse import urlparse
PORT=int(os.environ["PORT"])
tenant=None
class H(BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def reply(self,body):
  raw=json.dumps(body).encode();self.send_response(200);self.send_header("Content-Type","application/json");self.send_header("Content-Length",str(len(raw)));self.end_headers();self.wfile.write(raw)
 def do_GET(self):
  global tenant
  if urlparse(self.path).path=="/api/plan-progress":
   self.reply({"ok":True,"running":True,"done":4,"total":10,
     "best_preview":{"operations":[{"order":tenant}],"duration_minutes":int(tenant.replace("tenant",""))*30} if tenant else None})
  else:self.reply({"ok":True})
 def do_POST(self):
  global tenant
  raw=self.rfile.read(int(self.headers.get("Content-Length","0")));data=json.loads(raw)
  tenant=data["fixture_owner"]
  time.sleep(1.8)
  self.reply({"ok":True,"valid":True,"optimizer_tenant":tenant,
    "duration_minutes":int(tenant.replace("tenant",""))*30,
    "operations":[{"order":tenant,"duration_min":int(tenant.replace("tenant",""))*30}],
    "generations":10})
ThreadingHTTPServer(("127.0.0.1",PORT),H).serve_forever()
