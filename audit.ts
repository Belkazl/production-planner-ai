import postgres from "postgres";
const sql=postgres(Bun.env.DATABASE_URL,{max:1,connect_timeout:14,idle_timeout:3});
function unpack(x){for(let i=0;i<5&&typeof x==="string";i++){try{x=JSON.parse(x)}catch{break}}return x}
try{
 const rows=await sql`SELECT storage FROM pp_tenant_storage LIMIT 30`;
 console.log("PP_CERAMIC_ACCOUNT_STORAGE_ROWS",rows.length);
 for(let idx=0;idx<rows.length;idx++){
  const raw=rows[idx].storage||{},projects=unpack(raw["prodplan.projects.v2"]),active=unpack(raw["prodplan.project.active.v2"]);
  if(!Array.isArray(projects)){console.log("PP_CERAMIC_NOT_ARRAY",idx+1,typeof projects);continue}
  console.log("PP_CERAMIC_PROJECT_AUDIT",JSON.stringify({ordinal:idx+1,
  activeProject:projects.find(p=>String(p.id)===String(active))?.name||null,
  projects:projects.map(p=>{const m=p.model||{},orders=m.orders||[],ops=m.technical_processes?.[0]?.operations||[];
   return {id:p.id,name:p.name,revision:p.revision,projectKeys:Object.keys(p),modelKeys:Object.keys(m),
   orders:orders.length,orderIds:orders.map(o=>o.id),area:orders.reduce((a,o)=>a+Number(o.area||o.quantity||0),0),
   orderExamples:orders.slice(0,2).map(o=>({id:o.id,area:o.area,mass:o.parameters?.mass_kg_m2,keys:Object.keys(o.parameters||{})})),
   technicalProcesses:m.technical_processes?.map(t=>t.id),opRequirements:ops.map(o=>({id:o.id,requirements:(o.resource_requirements||[]).map(r=>({type:r.resource_type,ref:r.resource_ref,quantity:r.quantity,rule:r.consumption_rule}))})),
   materials:(m.materials||[]).map(z=>({id:z.id,name:z.name})),legacyMaterial:!!m.material,setupRules:m.setup_rules?.length,
   lastPlan:p.lastPlan?{duration:p.lastPlan.duration_minutes,operations:(p.lastPlan.operations||p.lastPlan.generic_operations||[]).length}:null,
   savedPlans:Array.isArray(p.savedPlans)?p.savedPlans.length:typeof p.savedPlans,modelStart:m.start,projectUpdatedAt:p.updatedAt}
  })}).slice(0,22000));
 }
 const schema=await sql`SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('pp_tenant_storage','pp_tenant_state','production_planner_state') ORDER BY table_name,ordinal_position`;
 console.log("PP_CERAMIC_SQL_SCHEMA",JSON.stringify(schema).slice(0,5000));
 console.log("PP_CERAMIC_DB_READ_ONLY_PASS");
}catch(e){console.error("PP_CERAMIC_AUDIT_ERROR",String(e?.message||e).slice(0,450));process.exitCode=1}
finally{await sql.end({timeout:3})}
