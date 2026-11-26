
// Read-only feasibility endpoint. The browser sends an action, not a model.
// Reconstruct the exact proposed change from the authenticated active model.
function ppGroqValidationStable(value){
 const visit=v=>Array.isArray(v)?v.map(visit):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).filter(k=>k!=="__ppid").sort().map(k=>[k,visit(v[k])])):v;
 return JSON.stringify(visit(value));
}
function ppGroqParameterIssues(model){
 const orders=Array.isArray(model.orders)?model.orders:[],processes=model.technical_processes||[],equipment=model.equipment?.length?model.equipment:model.autoclaves||[],out=[];
 const scalar=v=>typeof v==="string"||typeof v==="boolean"||typeof v==="number"&&Number.isFinite(v);
 for(const o of orders.slice(0,5000)){
  const p=processes.find(p=>String(p.id)===String(o.technical_process_id));
  if(!p)continue;
  const attrs=o.parameters||{};
  for(const op of p.operations||[]){
   for(const req of op.resource_requirements||[]){
    if(req.resource_type!=="equipment")continue;
    const ref=String(req.resource_ref||"");
    const candidates=equipment.filter(e=>req.match_mode==="specific"?(String(e.id)===ref||String(e.name)===ref):ref.startsWith("kind:")?String(e.kind||"").trim().toLowerCase()===ref.slice(5).trim().toLowerCase():true);
    if(!candidates.length)continue;
    const incompatible=e=>{
     const cap=e.capabilities||{},bad=[];
     for(const [k,values] of Object.entries(cap.allowed_parameters||{})){
      if(!Object.hasOwn(attrs,k)||attrs[k]==null||!(Array.isArray(values)?values:[values]).includes(attrs[k]))bad.push(k);
     }
     for(const [k,v] of Object.entries(cap.min_parameters||{}))if(!Object.hasOwn(attrs,k)||attrs[k]==null||!Number.isFinite(Number(attrs[k]))||Number(attrs[k])<Number(v))bad.push(k);
     for(const [k,v] of Object.entries(cap.max_parameters||{}))if(!Object.hasOwn(attrs,k)||attrs[k]==null||!Number.isFinite(Number(attrs[k]))||Number(attrs[k])>Number(v))bad.push(k);
     return bad;
    };
    const conflicts=candidates.map(incompatible);
    if(conflicts.every(a=>a.length)){
     const keys=[...new Set(conflicts.flat())].slice(0,8);
     out.push({order:String(o.id).slice(0,80),operation:String(op.name||op.id||"").slice(0,120),parameters:keys.map(k=>({name:k.slice(0,100),value:scalar(attrs[k])?attrs[k]:null}))});
     if(out.length>=8)return out;
    }
   }
  }
 }
 return out;
}
async function ppGroqValidateEdit(req){
 const reply=(data,status=200)=>ppGroqJson(data,status);
 if(req.method!=="POST")return reply({ok:false,error:"method_not_allowed"},405);
 if(!ppRequireSameOrigin(req))return reply({ok:false,error:"cross_origin_forbidden"},403);
 if(!await ppVerifyLogin(req).catch(()=>false))return reply({ok:false,error:"authentication_required"},401);
 let b,entry,model,prepared;
 try{
  const raw=await req.text();if(raw.length>240000)throw Error("invalid_action");
  b=JSON.parse(raw);
  if(!b||typeof b!=="object"||Array.isArray(b)||Object.keys(b).some(k=>!["projectId","revision","args","change"].includes(k))||typeof b.projectId!=="string"||b.projectId.length>200||!Number.isSafeInteger(b.revision)||b.revision<0)throw Error("invalid_action");
  const response=await fetch(PP_AUTH_GATEWAY_ORIGIN+"/api/db-storage",{headers:{cookie:req.headers.get("cookie")||"",accept:"application/json"},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(10000)});
  if(response.status!==200)return reply({ok:false,error:"validation_unavailable"},503);
  const data=await response.json(),storage=data?.storage||{};
  let projects=storage["prodplan.projects.v2"];if(typeof projects==="string")projects=JSON.parse(projects);
  if(storage["prodplan.project.active.v2"]!==b.projectId||!Array.isArray(projects))return reply({ok:false,error:"stale"},409);
  entry=projects.find(p=>p?.id===b.projectId);
  if(!entry?.model||Number(entry.revision)!==b.revision)return reply({ok:false,error:"stale"},409);
  model=await ppReadAccountModel(req);
  if(!model||!Array.isArray(model.orders))return reply({ok:false,error:"validation_model_not_ready"},409);
  prepared=ppGroqPrepareEdit(model,b.args);
  if(ppGroqValidationStable(prepared.change)!==ppGroqValidationStable(b.change))return reply({ok:false,error:"stale"},409);
 }catch{return reply({ok:false,error:"invalid_action"},400)}
 const validate=globalThis.__ppGroqNativeValidate;
 if(typeof validate!=="function")return reply({ok:false,error:"validation_unavailable"},503);
 const result=await validate(req,prepared.model);
 if(!result?.ok){
  return reply({ok:false,error:result?.error||"validation_unavailable",issues:result?.error==="validation_no_feasible_plan"?ppGroqParameterIssues(prepared.model):[]},result?.error==="validation_busy"?409:422);
 }
 // Never issue a validation for a different revision or a model changed
 // by another tab while the native worker was calculating.
 try{
  const response=await fetch(PP_AUTH_GATEWAY_ORIGIN+"/api/db-storage",{headers:{cookie:req.headers.get("cookie")||"",accept:"application/json"},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(10000)});
  if(response.status!==200)return reply({ok:false,error:"validation_unavailable"},503);
  const storage=(await response.json()).storage||{};let records=storage["prodplan.projects.v2"];if(typeof records==="string")records=JSON.parse(records);
  const current=Array.isArray(records)?records.find(p=>p?.id===b.projectId):null;
  if(storage["prodplan.project.active.v2"]!==b.projectId||Number(current?.revision)!==b.revision||ppGroqValidationStable(current?.model)!==ppGroqValidationStable(entry.model)||ppGroqValidationStable(await ppReadAccountModel(req))!==ppGroqValidationStable(model))return reply({ok:false,error:"stale"},409);
 }catch{return reply({ok:false,error:"validation_unavailable"},503)}
 return reply({ok:true,valid:true,checkedOrders:result.checkedOrders,operations:result.operations});
}
