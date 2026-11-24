import json,os,sys,urllib.parse
from pathlib import Path
import pg8000.dbapi
from uuid import UUID
cfg=json.loads((Path.home()/"liftorbit-migration/production/current/auth-gateway.json").read_text())
dsn=urllib.parse.urlsplit(cfg["DATABASE_URL"])
params={"user":urllib.parse.unquote(dsn.username or ""),
        "password":urllib.parse.unquote(dsn.password or ""),
        "database":urllib.parse.unquote(dsn.path.lstrip("/")),
        "port":int(dsn.port or 5432)}
email="belkazl@gmail.com"
expected="079b431f-9e60-45c9-8ec9-5222d6a5aa61"
for ip in ["172.19.0.2","172.19.0.3"]:
 try:
  conn=pg8000.dbapi.connect(host=ip,timeout=3,**params)
  conn.autocommit=True
  cur=conn.cursor()
  cur.execute("SELECT to_regclass('public.qa_accounts'),to_regclass('public.qa_storage')");tables=cur.fetchone()
  print("CANDIDATE",ip,"TABLES_EXIST",bool(tables[0] and tables[1]))
  if not tables[0] or not tables[1]:conn.close();continue
  cur.execute("SELECT id FROM qa_accounts WHERE email=%s",[email]);row=cur.fetchone()
  print("ACCOUNT_FOUND",bool(row),"ORIGINAL_TENANT_ID_MATCH",bool(row and row[0]==expected))
  if row:
   account_id=row[0]
   cur.execute("SELECT storage FROM qa_storage WHERE account_id=%s",[account_id])
   storage_row=cur.fetchone()
   storage=storage_row[0] if storage_row else {}
   if isinstance(storage,str):storage=json.loads(storage)
   projects=storage.get("prodplan.projects.v2","[]")
   if isinstance(projects,str):projects=json.loads(projects)
   assert isinstance(projects,list)
   active=storage.get("prodplan.project.active.v2")
   print("ACCOUNT_PROJECTS",json.dumps({"count":len(projects),"names":[p.get("name","")[:100] for p in projects],"activeProjectMatches":next((p.get("name") for p in projects if p.get("id")==active),None),"projectListBytes":len(json.dumps(projects,ensure_ascii=False)),"storageKeys":len(storage)},ensure_ascii=False))
   for project in projects[:1]:
    print("PROJECT_SHAPE",{"keys":sorted(project.keys()),"idType":type(project.get("id")).__name__})
    model=project.get("model",{})
    print("MODEL_SHAPE",{"keys":sorted(model.keys()),"orders":len(model.get("orders",[])),"equipment":len(model.get("equipment",[])),"employees":len(model.get("employees",[])),"processes":len(model.get("technical_processes",[]))})
    for key in ("orders","equipment","employees","technical_processes","setup_rules","materials"):
     if model.get(key):
      first=model[key][0]
      print("ROW_SHAPE",key,sorted(first.keys()) if isinstance(first,dict) else type(first).__name__)
      if key=="technical_processes" and isinstance(first,dict):
       ops=first.get("operations",[])
       print("OP_SHAPE",{"operationCount":len(ops),"keys":sorted(ops[0].keys()) if ops and isinstance(ops[0],dict) else []})
   try:
    cur.execute("SELECT status,progress FROM qa_optimization_jobs WHERE account_id=%s ORDER BY created_at DESC LIMIT 1",[account_id]);last=cur.fetchone();print("LAST_GA_STATE",last)
   except Exception as e:print("LAST_GA_STATE_ERROR",type(e).__name__)
  conn.close()
 except Exception as e:print("CANDIDATE_FAIL",ip,type(e).__name__,str(e)[:125].replace(params["password"],"[REDACTED]") if params["password"] else str(e)[:90])
