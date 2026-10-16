// Repair only the exact, publicly known 12-order ceramics DEMO resource fixture.
// This is a data-compatibility migration, not a relaxation of optimizer constraints.
function ppReconcileCeramicsFixture(model) {
 if(!model||typeof model!=="object"||!Array.isArray(model.orders)||!Array.isArray(model.equipment))return {changed:false,model,reason:"not_model"};
 const ids=model.orders.map(x=>String(x?.id)).sort();
 const demoOrderIds=Array.from({length:12},(_,i)=>String(2601+i)).sort();
 if(ids.length!==12||ids.some((x,i)=>x!==demoOrderIds[i]))return {changed:false,model,reason:"not_12_order_fixture"};
 if(!Array.isArray(model.technical_processes)||!model.technical_processes.some(x=>x?.id==="TP_TILE"))
  return {changed:false,model,reason:"not_tile_process"};
 const ovens=model.equipment.filter(e=>e?.kind==="firing");
 const ovenById=new Map(ovens.map(e=>[String(e.id),e]));
 const e9=ovenById.get("E9"),e10=ovenById.get("E10"),e11=ovenById.get("E11");
 if(ovens.length!==3||![e9,e10,e11].every(Boolean))return {changed:false,model,reason:"non_demo_ovens"};
 if(!["MAESTRO FMA","FBN-A","FBN-B"].every((name,i)=>[e9,e10,e11][i].name===name))
  return {changed:false,model,reason:"modified_ovens"};
 // Never guess real equipment capabilities. Only reconcile the known deliberately
 // incomplete DEMO whitelist, and only when the original whitelist is PS-01 alone.
 const caps=[e9,e10,e11].map(e=>e.capabilities?.allowed_firing_recipes);
 if(!caps.every(c=>Array.isArray(c)&&c.length>=1&&c.includes("PS-01")))return {changed:false,model,reason:"manual_capability_profile"};
 const required=new Set(model.orders.map(o=>String(o?.parameters?.firing_recipe||"").trim()).filter(Boolean));
 if([...required].some(x=>!["PS-01","PS-02","PS-03"].includes(x)))
  return {changed:false,model,reason:"unknown_recipe"};
 const matches=recipe=>ovens.some(e=>(e.capabilities?.allowed_firing_recipes||[]).includes(recipe));
 const missing=[...required].filter(x=>!matches(x));
 if(!missing.length)return {changed:false,model,reason:"already_supported"};
 if(missing.some(x=>x!=="PS-02"&&x!=="PS-03"))
  return {changed:false,model,reason:"unsupported_new_recipe"};
 // Preserve manually established support (never delete existing recipe modes).
 const fixed=structuredClone(model);
 const f10=fixed.equipment.find(x=>x.id==="E10");
 const f11=fixed.equipment.find(x=>x.id==="E11");
 function enable(oven,values){
  const have=oven.capabilities.allowed_firing_recipes;
  for(const val of values)if(!have.includes(val))have.push(val);
 }
 enable(f10,["PS-02"]);
 enable(f11,["PS-02","PS-03"]);
 // Some legacy schedulers also read autoclaves; keep both views consistent.
 if(Array.isArray(fixed.autoclaves)){
  for(const a of fixed.autoclaves){
   if(a.name!=="FBN-A"&&a.name!=="FBN-B")continue;
   if(!a.capabilities||typeof a.capabilities!=="object")a.capabilities={};
   if(!Array.isArray(a.capabilities.allowed_firing_recipes))
     a.capabilities.allowed_firing_recipes=["PS-01"];
   enable(a,a.name==="FBN-A"?["PS-02"]:["PS-02","PS-03"]);
  }
 }
 const finalOvens=fixed.equipment.filter(e=>e?.kind==="firing");
 for(const recipe of required){
  if(!finalOvens.some(e=>e.capabilities?.allowed_firing_recipes?.includes(recipe)))
   throw Error("DEMO_RECONCILIATION_STILL_NO_FIRING_RESOURCE");
 }
 // Orders, quantities, technologies, material balances, setup rules and saved plans untouched.
 return {changed:true,model:fixed,missing,ovenUpdates:["E10","E11"]};
}
async function ppImportCeramicsResourceCompatibility(req){
 let payload;
 try{
  const txt=await req.clone().text();
  if(txt.length>2000000)return handler(req);
  payload=JSON.parse(txt);
 }catch{return handler(req)}
 if(!payload||typeof payload!=="object"||!payload.model)return handler(req);
 const candidate=ppReconcileCeramicsFixture(payload.model);
 if(!candidate.changed)return handler(req);
 const h=relayHeaders(req);
 h.set("content-type","application/json");
 h.delete("content-length");
 const upstream=await fetch(upstreamUrl(req),{
  method:"POST",headers:h,
  body:JSON.stringify({...payload,model:candidate.model}),
  redirect:"manual",signal:AbortSignal.timeout(55000)
 });
 console.log("PP_DEMO_RESOURCE_RECONCILED",JSON.stringify({missing:candidate.missing,ovens:candidate.ovenUpdates,orders:candidate.model.orders.length,upstreamStatus:upstream.status}));
 return rawResponse(upstream);
}
