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
 ("GET","/anything")
]:
 status,body,h=get(path,method,headers={"Origin":base,"Sec-Fetch-Site":"same-origin"} if method=="POST" else None)
 assert status==401,(method,path,status,body[:120])
 assert "Керамика" not in body and "2601" not in body,(method,path,"data leaked")
 print("SECURED_QA_ANON_DENIED",method,path,status,flush=True)
legacy_code,legacy_body,_=get("/?ppGantt=legacy")
assert legacy_code==200 and 'type="password"' in legacy_body and "ppGanttToolV2" not in legacy_body,(legacy_code,legacy_body[:120])
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
invalid_login=json.dumps({"email":"this-account-does-not-exist+securitytest@example.invalid","password":"synthetic-incorrect-password-only"}).encode()
status,body,_=get("/api/auth/login","POST",headers={"Origin":base,"Content-Type":"application/json","Sec-Fetch-Site":"same-origin"},data=invalid_login)
assert status in (400,401,422) and "cross_origin_forbidden" not in body,("genuine browser Origin incorrectly blocked",status,body[:200])
print("PUBLIC_PROXY_ORIGIN_ACCEPTED_VALID_LOGIN_ROUTE",status,flush=True)

