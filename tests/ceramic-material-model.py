#!/usr/bin/env python3
"""Read-only unit audit of an enriched model; compares every original field."""
import copy
import importlib.util
import json
import os
from pathlib import Path
spec=importlib.util.spec_from_file_location("ceramic_materials","scripts/enrich_ceramic_materials.py")
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
src=json.loads(Path("/tmp/pp-ceramics-live-model.json").read_text(encoding="utf-8"))
original=src.get("model",src)
before=copy.deepcopy(original)
updated=module.enrich(original)
assert original==before,"input fixture mutated"
assert len(updated["orders"])==12 and len(updated["materials"])==len(module.SPEC)
assert updated["orders"]==original["orders"],"orders or quantities changed"
assert updated["setup_rules"]==original["setup_rules"],"setup rules changed"
assert updated["equipment"]==original["equipment"],"equipment changed"
assert updated["employees"]==original["employees"],"staff changed"
assert updated.get("shifts")==original.get("shifts"),"shifts changed"
assert updated.get("constraints")==original.get("constraints"),"constraints changed"
assert module.enrich(updated)==updated,"migration is not idempotent"
legacy_six=copy.deepcopy(original)
legacy_six["orders"]=legacy_six["orders"][:6]
legacy_enriched=module.enrich(legacy_six)
assert len(legacy_enriched["orders"])==6 and len(legacy_enriched["materials"])==6
assert legacy_enriched["orders"]==legacy_six["orders"],"six-order tenant model changed"
assert module.enrich(legacy_enriched)==legacy_enriched
bad=copy.deepcopy(original);bad["orders"][0]["id"]=1
try:module.enrich(bad)
except ValueError:pass
else:raise AssertionError("must refuse unrelated orders")
area=sum(x["area"] for x in original["orders"])
names={x["id"]:x for x in updated["materials"]}
for mid,name,unit,rate,opid,stock,delivery,at in module.SPEC:
 item=names[mid]
 assert item["unit"]==unit and item["initial_stock"]==stock
 assert item["deliveries"]==[{"at":at,"quantity":delivery}]
 assert item["consumption_per_unit"]==rate
 assert item["_demo_planned_demand"]==round(area*rate,5)
 assert stock+delivery>=area*rate
 op=next(o for o in updated["technical_processes"][0]["operations"] if o["id"]==opid)
 reqs=[x for x in op["resource_requirements"] if x.get("resource_ref")==mid]
 assert len(reqs)==1
 r=reqs[0]
 assert r["resource_type"]=="material" and r["consumption_rule"]=="per_m2"
 assert r["quantity"]==rate and r["unit"]==unit and r["match_mode"]=="specific"
for old,new in zip(original["technical_processes"][0]["operations"],updated["technical_processes"][0]["operations"]):
 oldreq=old.get("resource_requirements",[])
 assert new.get("resource_requirements",[])[:len(oldreq)]==oldreq
 assert {k:v for k,v in old.items() if k!="resource_requirements"}=={k:v for k,v in new.items() if k!="resource_requirements"}
totals={mid:round(area*rate,3) for mid,_,_,rate,_,_,_,_ in module.SPEC}
print("CERAMICS_MATERIALS_VALIDATION_PASS",json.dumps({"orders":len(updated["orders"]),"volume_m2":area,"materials":len(names),"totalDemand":totals,"preserved":["orders","setup_rules","equipment","employees","shifts","constraints"],"idempotent":True,"safeScope":True,"legacySixOrdersSupported":True},ensure_ascii=False))
