import json,urllib.request,urllib.error
ROOT="http://127.0.0.1:8080"
def fetch(path,method="GET",headers=None,body=None):
 h={"accept":"application/json",**(headers or {})}
 if body is not None:
  body=json.dumps(body).encode();h["content-type"]="application/json"
 req=urllib.request.Request(ROOT+path,method=method,headers=h,data=body)
 try:
  with urllib.request.urlopen(req,timeout=20) as r:return r.status,r.read().decode(),dict(r.headers)
 except urllib.error.HTTPError as e:return e.code,e.read().decode(),dict(e.headers)
status,text,h=fetch("/")
assert status==200,(status,text[:100])
assert 'type="password"' in text and "Войти" in text
assert "QA mock production UI" not in text
print("ANON_LOGIN_PAGE_PASS")
for path in ["/api/db-storage","/api/model","/api/plan-progress","/api/optimizer-stop","/api/secret","/favicon.ico"]:
 status,body,h=fetch(path)
 assert status==401,(path,status,body[:180])
for path in ["/api/db-storage","/api/optimizer-stop","/api/plan"]:
 status,body,h=fetch(path,"POST",body={"operation":"write"})
 assert status==401,(path,status,body[:180])
status,body,h=fetch("/__bridge_health")
assert status==200 and '"auth":true' in body and 'gateway' not in body
print("ANON_PROTECTED_ROUTES_PASS")
status,body,h=fetch("/api/auth/login","POST",{"origin":"https://attacker.example"},body={"email":"x@example.test","password":"qa-test-password"})
assert status==403,(status,body)
status,body,h=fetch("/api/db-storage","POST",{"origin":"https://attacker.example","cookie":"pp_demo_auth=tenantA"},body={"hacked":True})
assert status==403,(status,body)
print("CROSS_SITE_WRITE_BLOCKED")
status,body,h=fetch("/api/auth/login","POST",{"origin":ROOT},body={"email":"qa@example.test","password":"wrong"})
assert status==401,(status,body)
status,body,h=fetch("/api/auth/login","POST",{"origin":ROOT},body={"email":"qa@example.test","password":"qa-test-password"})
assert status==200,(status,body)
sc=next((v for k,v in h.items() if k.lower()=="set-cookie"),"")
assert "pp_demo_auth=" in sc and "Domain=" not in sc and "HttpOnly" in sc,(status,repr(sc))
cookie=sc.split(";",1)[0]
status,body,h=fetch("/api/auth/me",headers={"cookie":cookie})
assert status==200,(status,body)
for tenant in ["tenantA","tenantB"]:
 status,body,h=fetch("/api/db-storage",headers={"cookie":"pp_demo_auth="+tenant})
 assert status==200 and '"tenant":"'+tenant+'"' in body,(tenant,status,body[:100])
 status,body,h=fetch("/api/model",headers={"cookie":"pp_demo_auth="+tenant})
 assert status==200 and '"id":"'+tenant+'"' in body,(tenant,status,body[:200])
 status,body,h=fetch("/",headers={"cookie":"pp_demo_auth="+tenant})
 assert status==200 and '<h1 id="qa-tenant">'+tenant+"</h1>" in body,(tenant,status,body[:300])
 assert "ppProtectedLogout" in body,(tenant,status,"logout absent")
status,body,h=fetch("/api/db-storage",headers={"cookie":"pp_demo_auth=bad"})
assert status==401,(status,body)
status,body,h=fetch("/api/auth/logout","POST",{"origin":ROOT,"cookie":cookie},body={})
assert status==200 and "Max-Age=0" in next((v for k,v in h.items() if k.lower()=="set-cookie"),"")
print("SESSION_AND_TENANT_API_PASS")
print("AUTHENTICATED_GATEWAY_MOCK_SMOKE_PASS")
