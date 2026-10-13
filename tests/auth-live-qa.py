import urllib.request,urllib.error,json
base="https://pp-progress-fix-qa-20261010-production.up.railway.app"
def get(path,method="GET",headers=None,data=None):
 req=urllib.request.Request(base+path,method=method,headers={"Cache-Control":"no-cache","User-Agent":"ProdPlanSecuredCanary/1.0",**(headers or {})},data=data)
 try:
  with urllib.request.urlopen(req,timeout=40) as r:return r.status,r.read(200000).decode("utf8","replace"),dict(r.headers)
 except urllib.error.HTTPError as e:return e.code,e.read(20000).decode("utf8","replace"),dict(e.headers)
code,html,h=get("/")
assert code==200,(code,html[:120])
assert 'type="password"' in html and 'id="loginTab"' in html and "Войти" in html
assert "ppGanttToolV2" not in html and "pp-order-stacked-accordion" not in html,"production UI leaked to guest"
print("SECURED_QA_LOGIN_PAGE_PASS",len(html),flush=True)
for method,path in [
 ("GET","/api/db-storage"),("POST","/api/db-storage"),
 ("GET","/api/model"),("GET","/api/plan-progress"),
 ("POST","/api/plan"),("POST","/api/optimizer-stop"),
 ("GET","/api/resource"),("GET","/api/orders"),
 ("GET","/?ppGantt=legacy"),("GET","/anything")
]:
 status,body,h=get(path,method)
 assert status==401,(method,path,status,body[:120])
 assert "Керамика" not in body and "2601" not in body,(method,path,"data leaked")
 print("SECURED_QA_ANON_DENIED",method,path,status,flush=True)
for path in ["/api/db-storage","/api/model","/api/plan-progress","/api/optimizer-stop"]:
 status,body,h=get(path,headers={"Cookie":"pp_session=invalid; pp_demo_auth=tenantA"})
 assert status==401,(path,status,body[:150])
status,body,h=get("/__bridge_health")
assert status==200 and '"auth":true' in body and "UPSTREAM" not in body,(status,body[:200])
status,body,h=get("/api/auth/me")
assert status==401,(status,body[:120])
status,body,h=get("/api/auth/login","POST",headers={"Origin":"https://attacker.example","Content-Type":"application/json"},data=b"{}")
assert status==403,(status,body[:120])
print("SECURED_QA_NO_ANONYMOUS_ACCESS_PASS",flush=True)
