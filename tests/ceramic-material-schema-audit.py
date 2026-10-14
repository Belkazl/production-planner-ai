#!/usr/bin/env python3
"""Read-only audit of the published demo schema. Never write to app endpoints."""
import collections, json, re, urllib.request
base="https://production-planner-gateway-production.up.railway.app"
headers={"User-Agent":"ProdPlanCeramicMaterialsSchemaQA/1.0","Cache-Control":"no-cache"}
def read(path,limit):
 with urllib.request.urlopen(urllib.request.Request(base+path,headers=headers),timeout=55) as response:
  assert response.status==200,(path,response.status)
  return response.read(limit)
m=json.loads(read("/api/model",5000000).decode("utf-8"))
m=m.get("model",m)
assert len(m.get("orders",[]))==12,"Demo fixture changed"
print("MATERIAL_AUDIT_SCHEMA",json.dumps({"model_keys":sorted(m),"material_count":len(m.get("materials",[])),"operations_type":type(m.get("operations")).__name__,"schema_version":m.get("schema_version"),"quantity_unit":m.get("quantity_unit"),"start":m.get("start")},ensure_ascii=False),flush=True)
print("MATERIAL_AUDIT_ORDERS",json.dumps([{"id":o.get("id"),"qty":o.get("quantity"),"area":o.get("area"),"unit":o.get("unit"),"color":o.get("parameters",{}).get("Глазурь/цвет"),"family":o.get("parameters",{}).get("product_family"),"finish":o.get("parameters",{}).get("finish"),"mass_kg_m2":o.get("parameters",{}).get("mass_kg_m2"),"thickness_mm":o.get("parameters",{}).get("thickness_mm")} for o in m.get("orders",[])],ensure_ascii=False),flush=True)
print("MATERIAL_AUDIT_ORDER_TOTALS",json.dumps({"area":sum(float(o.get("area") or o.get("quantity") or 0) for o in m["orders"]),"colors":dict(collections.Counter((o.get("parameters",{}) or {}).get("Глазурь/цвет") for o in m["orders"]))},ensure_ascii=False),flush=True)
for tp in m.get("technical_processes",[]):
 print("MATERIAL_AUDIT_PROCESS",json.dumps({"id":tp.get("id"),"keys":list(tp.keys()),"operations":[{"id":o.get("id"),"name":o.get("name"),"keys":list(o.keys()),"rr":o.get("resource_requirements")} for o in tp.get("operations",[])]},ensure_ascii=False)[:10000],flush=True)
for key in ["materials","supplies","deliveries","operations","constraints","shifts"]:
 v=m.get(key)
 print("MATERIAL_AUDIT_ROOT",json.dumps({"field":key,"type":type(v).__name__,"sample":v if isinstance(v,(dict,list)) and len(str(v))<1100 else (list(v)[:12] if isinstance(v,dict) else f"count={len(v)}" if isinstance(v,list) else v)},ensure_ascii=False,default=str)[:1400],flush=True)
html=read("/",2500000).decode("utf-8","replace")
for needle in ["function renderSection", "function editMaterials", "renderMaterials", "material_requirements", "resource_type:'material'", "resource_type:\"material\"", "initial_stock", "data-mat", "Сохранить изменения", "Материалы", "material_consumption", "Расход", "material_id", "material_kg"]:
 matches=list(re.finditer(re.escape(needle),html,re.I))
 contexts=[html[max(0,match.start()-250):match.start()+800] for match in matches[:3]]
 print("MATERIAL_AUDIT_HTML",json.dumps({"needle":needle,"hits":len(matches),"samples":contexts},ensure_ascii=False)[:4300],flush=True)
print("MATERIAL_AUDIT_PASS",flush=True)
