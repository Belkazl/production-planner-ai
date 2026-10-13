import json,urllib.request,urllib.error,os
base=os.environ.get("PP_ORIGIN_TEST_BASE","http://127.0.0.1:8081")
def post(origin,headers=None):
 data=json.dumps({"email":"nobody@example.invalid","password":"incorrect-test-value"}).encode()
 h={"content-type":"application/json"}
 if origin is not None:h["origin"]=origin
 if headers:h.update(headers)
 req=urllib.request.Request(base+"/api/auth/login",data=data,method="POST",headers=h)
 try:
  with urllib.request.urlopen(req,timeout=15) as r:return r.status,r.read().decode()
 except urllib.error.HTTPError as e:return e.code,e.read().decode()
qa=os.environ.get("PP_ORIGIN_TEST_ALLOWED","https://pp-progress-fix-qa-20261010-production.up.railway.app")
s,b=post(qa)
assert s==401 and "invalid_credentials" in b,("expected validation to reach backend despite railway proxy",s,b[:180])
s,b=post("https://other-app.example")
assert s==403 and "cross_origin_forbidden" in b,(s,b)
s,b=post("https://aps-setup-bridge-candidate-v2-production.up.railway.app")
assert s==403 and "cross_origin_forbidden" in b,(s,b)
s,b=post(None)
assert s==403,(s,b)
s,b=post(qa,{"sec-fetch-site":"cross-site"})
assert s==403,(s,b)
print("SECURE_PROXY_ORIGIN_TEST_PASS: QA HTTPS origin accepted, foreign/missing/cross-site denied")
