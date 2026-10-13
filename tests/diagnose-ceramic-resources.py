import json, urllib.request, urllib.error, re, collections, traceback

base="https://production-planner-gateway-production.up.railway.app"
headers={"User-Agent":"ProdPlanReadOnlyResourceEligibilityAudit/1.0","Cache-Control":"no-cache"}
def read(path,limit=1800000):
 req=urllib.request.Request(base+path,headers=headers)
 with urllib.request.urlopen(req,timeout=40) as r:return r.status,r.read(limit).decode("utf8","replace")
def normobj(x):
 if isinstance(x,dict):return x
 return {}
def ident(x):
 return {k:x.get(k) for k in ["id","name","kind","type","code","key","resource_type","resource_ref","role","equipment_ids","employee_ids","qualified_kinds","requirements"] if k in x}
try:
 status,raw=read("/api/model",5000000)
 print("LEGACY_MODEL_HTTP",status,"LENGTH",len(raw),flush=True)
 payload=json.loads(raw)
 m=normobj(payload.get("model",payload))
 print("MODEL_TOP_KEYS",list(m.keys()),flush=True)
 for key in ["orders","equipment","autoclaves","employees","roles","technical_processes","operations","setup_rules","shifts","materials"]:
  arr=m.get(key,[])
  print("MODEL_ARRAY",key,len(arr) if isinstance(arr,list) else type(arr).__name__,flush=True)
 if isinstance(m.get("orders"),list):
  orders=m.get("orders") or []
  print("MODEL_ORDER_IDS",[str(x.get("id","")) for x in orders if isinstance(x,dict)],flush=True)
  for o in orders:
   if str(o.get("id")) in ["2612","2601","2602"]:
    print("TARGET_ORDER",json.dumps({k:o.get(k) for k in ["id","name","quantity","area","technical_process_id","technical_process","process_id","process","parameters","product_code","due_date"] if k in o},ensure_ascii=False)[:2700],flush=True)
 for key in ["equipment","autoclaves","employees"]:
  arr=m.get(key,[])
  if isinstance(arr,list):
   for x in arr[:30]:
    if not isinstance(x,dict):continue
    print("RESOURCE",key,json.dumps({k:v for k,v in x.items() if k in ["id","name","kind","type","status","role","roles","skills","allowed_operations","resource_types","capacity","shift_id","equipment_kind","supported_products","capabilities"]},ensure_ascii=False)[:1250],flush=True)
 for tp in m.get("technical_processes") or []:
  if not isinstance(tp,dict):continue
  print("PROCESS",json.dumps({k:v for k,v in tp.items() if k not in ["operations","parameters"]},ensure_ascii=False)[:1300],flush=True)
  for op in tp.get("operations") or []:
   if not isinstance(op,dict):continue
   print("PROCESS_OPERATION",json.dumps({k:v for k,v in op.items() if k in ["id","name","label","kind","resource_requirements","resource_ref","resource_type","eligible_resources","equipment_kind","employee_role","parameters","requirements","type","duration_minutes","sequence","order"]},ensure_ascii=False)[:3000],flush=True)
except Exception as e:
 print("MODEL_READ_ERROR",type(e).__name__,str(e)[:180],flush=True)
try:
 status,html=read("/",2000000)
 print("LEGACY_HTML_HTTP",status,"LENGTH",len(html),flush=True)
 terms=["Нет доступного набора ресурсов","Нет доступного","__ppb__","resource_requirements","eligibleSets","eligible_resources","constraint","validator"]
 for term in terms:
  matches=list(re.finditer(re.escape(term),html,re.I))
  print("HTML_MATCH",term,len(matches),flush=True)
  for x in matches[:3]:
   a=max(0,x.start()-450);b=min(len(html),x.start()+850)
   print("HTML_CONTEXT",term,repr(html[a:b][:1300]),flush=True)
except Exception as e:
 print("HTML_READ_ERROR",type(e).__name__,str(e)[:180],flush=True)
print("READ_ONLY_MODEL_AUDIT_COMPLETE",flush=True)
