import urllib.request,re,json
url="https://production-planner-gateway-production.up.railway.app/"
req=urllib.request.Request(url,headers={"User-Agent":"ProdPlan-ReadOnly-UI-Reset-Audit/1.0"})
with urllib.request.urlopen(req,timeout=30) as r:s=r.read(2000000).decode("utf-8","replace")
print("UPSTREAM_HTML_LENGTH",len(s),flush=True)
searches=[
 "function ppIncumbentCurrentPlan(){","function restorePlan(","function renderKpisWithDelta(","function renderKpiDelta(","function renderPlan(","function clearPlan(","function ppProjectAfterPlan","window.ppProjectAfterPlan=",
 "opt.onclick=","q('opt').onclick=","const cont=hasResult","let hasResult=","var hasResult=","hasResult=false;",
 "id=\"validator\"","id=\"dur\"","id=\"cycle\"","id=\"wait\"","id=\"idle\"","id=\"planStatus\"","id=\"valid\"","id=\"kpi\"","function updateSummary","function showStatus","previousKpiMetrics",
 "function ppIncumbentDecision(a,b){","id=\"ppLivePanelV2\"","id=\"ppRealOptProgressV1\"","const opt=","function renderPlan"] 
for term in searches:
 hits=list(re.finditer(re.escape(term),s))
 print("UI_ANCHOR",repr(term),len(hits),flush=True)
 for m in hits[:2]:
  before=260 if term in ["opt.onclick=","const cont=hasResult","id=\"validator\"","id=\"kpi\"","previousKpiMetrics"] else 80
  after=1750 if "function " in term or "opt.onclick=" in term else 800
  print("UI_CONTEXT",repr(term),m.start(),json.dumps(s[max(0,m.start()-before):min(len(s),m.end()+after)],ensure_ascii=False),flush=True)
print("DONE_UPSTREAM_UI_READ_ONLY",flush=True)
