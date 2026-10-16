import {readFileSync,writeFileSync} from 'node:fs';
let s=readFileSync('index.ts','utf8');
const runtime=String.raw`
const ppAccountModels=new Map();
async function ppReadAccountModel(req){
 const key=ppSecureSessionKey(req),cached=ppAccountModels.get(key);
 if(cached&&Date.now()-cached.at<1800000)return structuredClone(cached.model);
 const r=await fetch(PP_AUTH_GATEWAY_ORIGIN+'/api/db-storage',{headers:{cookie:req.headers.get('cookie')||'',accept:'application/json'},cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('account_model_unavailable');
 const d=await r.json(),storage=d.storage||{};
 const list=JSON.parse(storage['prodplan.projects.v2']||'[]');
 if(!Array.isArray(list))throw Error('invalid_account_projects');
 const active=storage['prodplan.project.active.v2'];
 const p=list.find(p=>p.id===active)||(list.length===1?list[0]:null);
 return p?.model?structuredClone(p.model):{orders:[],equipment:[],employees:[],materials:[],technical_processes:[],setup_rules:[]};
}
function ppAlignOwnedResources(model,base){
 const result=structuredClone(model),maps={equipment:new Map(),employee:new Map()};
 const orders=new Set((model.orders||[]).map(o=>String(o.id)));
 const operations=base?.operations||base?.generic_operations||[];
 for(const op of operations){
  if(op.order!=null&&!orders.has(String(op.order)))throw Error('account_plan_order_mismatch');
  for(const resource of op.resources||[]){
   const type=resource.resource_type;if(!maps[type])continue;
   const rows=type==='equipment'?(result.equipment||result.autoclaves||[]):(result.employees||[]);
   const exact=rows.find(r=>String(r.id)===String(resource.id));
   if(exact)continue;
   const matching=rows.filter(r=>String(r.name||'')===String(resource.name||''));
   if(matching.length!==1)throw Error('account_plan_resource_mismatch');
   const source=String(matching[0].id),target=String(resource.id),previous=maps[type].get(source);
   if(previous&&previous!==target)throw Error('ambiguous_resource_identifier');
   maps[type].set(source,target);
  }
 }
 const rewrite=(rows,type)=>(rows||[]).map(r=>({...r,id:maps[type].get(String(r.id))||r.id}));
 result.equipment=rewrite(result.equipment||result.autoclaves,'equipment');
 result.autoclaves=rewrite(result.autoclaves||result.equipment,'equipment');
 result.employees=rewrite(result.employees,'employee');
 result.setup_rules=(result.setup_rules||[]).map(r=>({...r,equipment_ref:maps.equipment.get(String(r.equipment_ref))||r.equipment_ref,employee_ref:maps.employee.get(String(r.employee_ref))||r.employee_ref}));
 return result;
}
async function ppTenantAuthenticated(req){
 const path=new URL(req.url).pathname;
 if(path==='/__tenant_model_health'&&req.method==='GET')return Response.json({ok:true,release:'account-model-v2'},{headers:{'cache-control':'no-store','x-robots-tag':'noindex'}});
 if(path==='/api/model'&&req.method==='GET'){
  if(!await ppVerifyLogin(req))return Response.json({error:'authentication_required'},{status:401,headers:{'cache-control':'no-store'}});
  const model=await ppReadAccountModel(req);
  return Response.json({ok:true,model,model_ready:!!model.orders?.length},{headers:{'cache-control':'no-store'}});
 }
 let imported=null;
 if(path==='/api/project/model/import'&&req.method==='POST'){
  try{const payload=await req.clone().json();if(payload.model&&Array.isArray(payload.model.orders))imported=payload.model;}catch{}
 }
 const result=await ppAuthenticatedHandler(req);
 if(result.ok&&imported){const key=ppSecureSessionKey(req);ppAccountModels.set(key,{at:Date.now(),model:structuredClone(imported)});if(ppAccountModels.size>128)ppAccountModels.delete(ppAccountModels.keys().next().value);}
 if(result.ok&&req.method==='POST'&&['/api/auth/logout','/api/project/model/clear','/api/chat'].includes(path))ppAccountModels.delete(ppSecureSessionKey(req));
 return result;
}
`;
const matches=[...s.matchAll(/^async function loadModel\(req\)\{[^\n]*\}$/gm)];
if(matches.length!==1)throw Error('TENANT_MODEL_LOAD_ANCHOR_CHANGED');
s=s.replace(matches[0][0],runtime+'\nasync function loadModel(req){const model=await ppReadAccountModel(req);if(!model?.orders?.length)throw Error("model_not_ready");return model;}');
for(const head of ['export function scheduleWithSetup(base,model,options={}) {','export async function searchWithSetup(base,model, options={}, report=()=>{}) {','function convertOne(base,model,seed){']){
 if(s.split(head).length!==2)throw Error('RESOURCE_ADAPTER_ANCHOR_CHANGED');
 s=s.replace(head,head+'\nmodel=ppAlignOwnedResources(model,base);\n');
}
const anchor='handler:ppAuthenticatedHandler,verify:ppVerifyLogin';
if(s.split(anchor).length!==2)throw Error('TENANT_MODEL_ENTRY_ANCHOR_CHANGED');
s=s.replace(anchor,'handler:ppTenantAuthenticated,verify:ppVerifyLogin');
writeFileSync('index.ts',s);console.log('ACCOUNT_MODEL_BOUNDARY_INSTALLED: owned model and exact-name resource ID adapter');
