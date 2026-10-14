import postgres from "postgres";
import {createHash} from "node:crypto";
const sql=postgres(Bun.env.DATABASE_URL,{max:1,connect_timeout:14,idle_timeout:3});
const sha=x=>createHash("sha256").update(x).digest("hex");
const unwrap=x=>{for(let i=0;i<5&&typeof x==="string";i++){try{x=JSON.parse(x)}catch{break}}return x};
const check=(x,name)=>{if(!x)throw Error("VERIFY_FAILED:"+name)};
try{
 const rows=await sql`SELECT storage FROM pp_tenant_storage LIMIT 5`;
 check(rows.length===1,"tenants_unchanged");
 const store=rows[0].storage,raw=store["prodplan.projects.v2"],projects=unwrap(raw);
 check(Array.isArray(projects)&&projects.length===2,"projects_unchanged");
 const p=projects.find(x=>x.id==="prj_mugww6lr_kanzz5"),other=projects.find(x=>x.name==="Покраска");
 check(p?.name==="Керамика"&&other&&String(unwrap(store["prodplan.project.active.v2"]))===p.id,"correct_active_project");
 const mat=p.model.materials||[],ops=p.model.technical_processes?.[0]?.operations||[];
 const expected=["M_BODY","M_ENGOBE","M_GLAZE","M_INK","M_CARTONS","M_PALLETS"];
 check(p.revision===52&&mat.length===6&&expected.every(x=>mat.some(m=>m.id===x)),"six_materials_revision");
 check(mat.every(m=>m.deliveries?.length===1&&Number.isFinite(Number(m.initial_stock))),"stocks_and_deliveries");
 const reqs=ops.flatMap(op=>(op.resource_requirements||[]).filter(r=>r.resource_type==="material").map(r=>({op:op.id,...r})));
 check(reqs.length===6&&reqs.every(r=>expected.includes(r.resource_ref)&&r.consumption_rule==="per_m2"&&Number(r.quantity)>0),"six_per_m2_requirements");
 check(p.model.orders.length===12&&p.model.orders.map(o=>Number(o.id)).sort((a,b)=>a-b).every((x,i)=>x===2601+i),"original_orders");
 check(p.model.orders.reduce((x,o)=>x+Number(o.area||0),0)===23100,"area_23100");
 check(p.model.setup_rules?.length===8,"setup_rules");
 check(Array.isArray(p.savedPlans)&&p.savedPlans.length===5,"saved_plans");
 check(p.lastPlan===null,"old_plan_invalidated");
 const b=await sql`SELECT project_id,original_project_storage,source_sha256,previous_revision,material_revision
                    FROM pp_ceramic_materials_backup_20261014 LIMIT 3`;
 check(b.length===1&&b[0].project_id===p.id&&b[0].previous_revision===51&&b[0].material_revision===52,"snapshot");
 check(sha(b[0].original_project_storage)===b[0].source_sha256&&b[0].source_sha256==="3774a5f2fec826e8a5d720defb8de9ca5d12df3e318585ff97f4eecabb3c8dde","snapshot_integrity");
 const before=unwrap(b[0].original_project_storage);
 const original=before.find(q=>q.id===p.id);
 check(original?.revision===51&&original.lastPlan&&original.model.materials.length===0,"snapshot_original");
 for(const fld of ["orders","equipment","employees","shifts","setup_rules","constraints"]){
  check(JSON.stringify(original.model[fld])===JSON.stringify(p.model[fld]),"model_preserved_"+fld);
 }
 for(const fld of ["history","messages","savedPlans"]){
  check(JSON.stringify(original[fld])===JSON.stringify(p[fld]),"project_preserved_"+fld);
 }
 check(JSON.stringify(before.find(q=>q.id!==p.id))===JSON.stringify(other),"painting_project_preserved");
 const info={orders:p.model.orders.length,materials:mat.length,requirements:reqs.length,setupRules:p.model.setup_rules.length,savedPlans:p.savedPlans.length,
  originalPlanStoredInBackup:true,activePlanReset:true,otherProjectUnchanged:true,revision:p.revision,
  backingStoreHash:sha(raw),backupStoreHash:sha(b[0].original_project_storage)};
 console.log("PP_CERAMIC_MATERIALS_PRODUCTION_VERIFIED",JSON.stringify(info));
}catch(e){console.error("PP_CERAMIC_MATERIALS_PRODUCTION_VERIFY_FAILED",String(e?.message||e).slice(0,400));process.exitCode=1}
finally{await sql.end({timeout:3})}
