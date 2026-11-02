"""Synthetic legacy HTTP scheduler for integration tests, no real data."""
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json,os,time
model={"orders":[{"id":"BOOT"}]}
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def reply(self,p):
  b=json.dumps(p).encode();self.send_response(200);self.send_header("Content-Type","application/json");self.send_header("Content-Length",str(len(b)));self.end_headers();self.wfile.write(b)
 def do_GET(self):
  if self.path=="/api/model":return self.reply({"ok":True,"model":model})
  if self.path=="/api/plan-progress":return self.reply({"ok":True,"running":False})
  return self.reply({"ok":False})
 def do_POST(self):
  global model
  body=json.loads(self.rfile.read(int(self.headers.get("Content-Length","0"))))
  if self.path=="/api/project/model/import":
   model=body["model"];return self.reply({"ok":True})
  if self.path=="/api/plan":
   time.sleep(float(body.get("test_delay",.08)))
   return self.reply({"ok":True,"operations":[{"order":x["id"],"operation_id":str(i),"start_min":i*20,"end_min":(i+1)*20} for i,x in enumerate(model["orders"])],"valid":True})
  return self.reply({"ok":False})
if __name__=="__main__":ThreadingHTTPServer((os.environ.get("HOST","127.0.0.1"),int(os.environ.get("PORT","8080"))),Handler).serve_forever()
