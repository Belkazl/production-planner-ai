// Per-account model boundary: never consult the gateway's process-global model cache.
// A short import grace period handles asynchronous storage writes in the existing UI.
const ppAccountModelPending=new Map();
const ppAccountModelEmpty=()=>({orders:[],equipment:[],employees:[],materials:[],technical_processes:[],setup_rules:[]});
const ppAccountModelHash=m=>require("node:crypto").createHash("sha256").update(JSON.stringify(m)).digest("hex");
function ppAccountModelSession(req) {
 const cookie=req.headers.get("cookie")||"";
 if(!cookie||cookie.length>8192)throw Error("account_session_required");
 return ppSecureSessionKey(req);
}
function ppAccountModelFromStorage(data) {
 const storage=data&&typeof data.storage==="object"&&data.storage!==null?data.storage:{};
 let projects=storage["prodplan.projects.v2"]||"[]";
 if(typeof projects==="string")projects=JSON.parse(projects);
 if(!Array.isArray(projects))throw Error("account_project_list_invalid");
 const active=storage["prodplan.project.active.v2"];
 const entry=projects.find(p=>p&&p.id===active)||(projects.length===1?projects[0]:null);
 if(!entry||!entry.model)return ppAccountModelEmpty();
 if(typeof entry.model!=="object"||!Array.isArray(entry.model.orders))throw Error("account_model_invalid");
 return structuredClone(entry.model);
}
async function ppReadAccountModel(req) {
 const session=ppAccountModelSession(req);
 const res=await fetch(PP_AUTH_GATEWAY_ORIGIN+"/api/db-storage",{
  headers:{cookie:req.headers.get("cookie")||"",accept:"application/json"},
  redirect:"manual",cache:"no-store",signal:AbortSignal.timeout(20000)
 });
 if(res.status===401||res.status===403)throw Error("account_session_unauthorized");
 if(res.status!==200)throw Error("account_storage_unavailable");
 const data=await res.json();
 const stored=ppAccountModelFromStorage(data);
 const pending=ppAccountModelPending.get(session);
 if(pending&&Date.now()-pending.at<12000) {
  // Only prefer a just-accepted import while account storage has not caught up.
  if(!stored.orders.length||pending.hash!==ppAccountModelHash(stored))return structuredClone(pending.model);
 }
 ppAccountModelPending.delete(session);
 return stored;
}
function ppAccountPlanBelongsToModel(result,model) {
 const orders=new Set((model.orders||[]).map(o=>String(o.id)));
 const equipment=model.equipment||model.autoclaves||[];
 const employees=model.employees||[];
 const ids=new Set([...equipment,...employees].filter(Boolean).map(r=>String(r.id)));
 const names=new Set([...equipment,...employees].filter(Boolean).map(r=>String(r.name||"")).filter(Boolean));
 function checkPlan(plan){
  if(!plan||typeof plan!=="object")return true;
  const ops=plan.generic_operations?.length?plan.generic_operations:(plan.operations||[]);
  if(!Array.isArray(ops))return false;
  for(const operation of ops){
   if(operation.order!=null&&!orders.has(String(operation.order)))return false;
   for(const resource of operation.resources||[]){
    if(!["equipment","employee"].includes(resource.resource_type))continue;
    const id=String(resource.id??"");
    const name=String(resource.name||"");
    if(id&&!ids.has(id)&&!names.has(name))return false;
   }
  }
  for(const batch of plan.batches||[])if(batch.order!=null&&!orders.has(String(batch.order)))return false;
  return true;
 }
 return checkPlan(result)&&checkPlan(result.best_preview)&&checkPlan(result.candidate_preview)&&(result.variants||[]).every(v=>checkPlan(v?.plan||v));
}
function ppAlignOwnedResources(model,base){
 const own=structuredClone(model);
 const operations=base?.operations||base?.generic_operations||[];
 const orders=new Set((own.orders||[]).map(o=>String(o.id)));
 const maps={equipment:new Map(),employee:new Map()};
 for(const op of operations){
  if(op.order!=null&&!orders.has(String(op.order)))throw Error("account_plan_order_mismatch");
  for(const resource of op.resources||[]){
   const kind=resource.resource_type;if(!maps[kind])continue;
   const rows=kind==="equipment"?(own.equipment||own.autoclaves||[]):own.employees||[];
   if(rows.some(x=>String(x.id)===String(resource.id)))continue;
   const matching=rows.filter(x=>String(x.name||"")===String(resource.name||"")&&!!x.name);
   if(matching.length!==1)throw Error("account_plan_resource_mismatch");
   const source=String(matching[0].id),target=String(resource.id);
   if(maps[kind].has(source)&&maps[kind].get(source)!==target)throw Error("ambiguous_account_resource");
   maps[kind].set(source,target);
  }
 }
 const rewritten=(rows,kind)=>(rows||[]).map(x=>({...x,id:maps[kind].get(String(x.id))||x.id}));
 own.equipment=rewritten(own.equipment||own.autoclaves,"equipment");
 if(Array.isArray(own.autoclaves))own.autoclaves=rewritten(own.autoclaves,"equipment");
 own.employees=rewritten(own.employees,"employee");
 own.setup_rules=(own.setup_rules||[]).map(rule=>({...rule,equipment_ref:maps.equipment.get(String(rule.equipment_ref))||rule.equipment_ref,employee_ref:maps.employee.get(String(rule.employee_ref))||rule.employee_ref}));
 return own;
}
async function ppTenantAuthenticated(req){
 const path=new URL(req.url).pathname;
 if(path==="/__tenant_model_health"&&req.method==="GET")
  return Response.json({ok:true,release:"account-model-boundary-v3"},{headers:{"cache-control":"no-store","x-robots-tag":"noindex,nofollow"}});
 if(path==="/api/model"&&req.method==="GET"){
  try{
   if(!await ppVerifyLogin(req))return Response.json({error:"authentication_required"},{status:401,headers:{"cache-control":"no-store"}});
   const model=await ppReadAccountModel(req);
   return Response.json({ok:true,model,model_ready:!!model.orders?.length},{headers:{"cache-control":"no-store"}});
  }catch(e){
   console.warn("PP_OWN_MODEL_READ_FAILED",String(e).slice(0,90));
   return Response.json({error:"account_model_unavailable"},{status:503,headers:{"cache-control":"no-store"}});
  }
 }
 // The API must not expose another session's global optimizer progress.
 if(path==="/api/plan-progress"&&req.method==="GET"){
  const key=ppSecureSessionKey(req);
  if(!ppActiveObjectiveRuns.has(key)){
   const authenticated=await ppVerifyLogin(req).catch(()=>false);
   if(!authenticated)return Response.json({error:"authentication_required"},{status:401});
   return jsonifyBridge({ok:true,running:false,success:false,done:0,total:0,percent:0,phase:"idle",candidate_preview:null,best_preview:null});
  }
 }
 let imported=null;
 if(path==="/api/project/model/import"&&req.method==="POST"){
  try{
   const raw=await req.clone().text();
   if(raw.length<=2000000){
    const data=JSON.parse(raw);
    if(data?.model&&Array.isArray(data.model.orders))imported=data.model;
   }
  }catch{}
 }
 if(path==="/api/plan"&&req.method==="POST"&&!await ppVerifyLogin(req).catch(()=>false))
  return Response.json({error:"authentication_required"},{status:401,headers:{"cache-control":"no-store"}});
 const beforeModel=(path==="/api/plan"&&req.method==="POST")?await ppReadAccountModel(req).catch(()=>null):null;
 if(path==="/api/plan"&&req.method==="POST"&&(!beforeModel||!beforeModel.orders.length))
  return Response.json({ok:false,error:"account_model_not_ready"},{status:409,headers:{"cache-control":"no-store"}});
 const result=await ppAuthenticatedHandler(req);
 if(!result.ok)return result;
 const session=ppSecureSessionKey(req);
 if(imported){
  let next=imported;
  try{
   const body=await result.clone().json();
   if(body?.model&&Array.isArray(body.model.orders))next=body.model;
  }catch{}
  ppAccountModelPending.set(session,{at:Date.now(),hash:ppAccountModelHash(next),model:structuredClone(next)});
  if(ppAccountModelPending.size>128)ppAccountModelPending.delete(ppAccountModelPending.keys().next().value);
 }
 if(req.method==="POST"&&["/api/db-storage","/api/auth/logout","/api/project/model/clear","/api/chat"].includes(path))ppAccountModelPending.delete(session);
 if(path==="/api/plan"||path==="/api/plan-progress"||path==="/api/optimizer-stop"){
  let body;
  try{body=await result.clone().json()}catch{return result}
  if(body?.ok===true){
   try{
    const own=await ppReadAccountModel(req);
    if(beforeModel&&ppAccountModelHash(beforeModel)!==ppAccountModelHash(own))
     return jsonifyBridge({ok:false,error:"account_model_changed_during_run"},409);
    if(!ppAccountPlanBelongsToModel(body,own)){
     console.warn("PP_ACCOUNT_PLAN_REJECTED",path);
     return jsonifyBridge({ok:false,error:"account_plan_mismatch"},409);
    }
   }catch(e){
    return jsonifyBridge({ok:false,error:"account_model_validation_unavailable"},503);
   }
  }
 }
 return result;
}
