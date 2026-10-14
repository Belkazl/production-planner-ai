import postgres from "postgres";
import {createHash} from "node:crypto";
const SQL=postgres(Bun.env.DATABASE_URL,{max:1,connect_timeout:14,idle_timeout:3});
const APPLY=false;
const EXPECTED_SHA="";
const VERSION="ceramics-material-consumption-2026-10-14-v1";
const PROJECT_ID="prj_mugww6lr_kanzz5";
const SPECS=[
 ["M_BODY","Пресс-порошок для керамогранита","кг",18.50,"OP_PRESS",185000,265000,"2026-10-07T08:00:00"],
 ["M_ENGOBE","Ангоб","кг",0.55,"OP_GLAZE",8000,6000,"2026-10-08T09:00:00"],
 ["M_GLAZE","Глазурь базовая","кг",0.65,"OP_GLAZE",9000,7500,"2026-10-07T09:00:00"],
 ["M_INK","Краска для цифровой печати","кг",0.04,"OP_DECOR",400,600,"2026-10-08T09:00:00"],
 ["M_CARTONS","Коробки для плитки","шт.",0.70,"OP_PACK",10000,8000,"2026-10-07T08:00:00"],
 ["M_PALLETS","Палеты","шт.",0.02,"OP_PACK",250,250,"2026-10-08T08:00:00"]
];
const sha=x=>createHash("sha256").update(x).digest("hex");
const str=x=>JSON.stringify(x);
const requireTrue=(v,message)=>{if(!v)throw Error("GUARD_FAILED:"+message)};
function unwrap(x){for(let i=0;i<5&&typeof x==="string";i++){try{x=JSON.parse(x)}catch{break}}return x}
function prepare(projects,active){
 requireTrue(Array.isArray(projects)&&projects.length===2,"expected_two_projects");
 requireTrue(projects.map(p=>p.name).sort().join("|")==="Керамика|Покраска","project_names");
 const original=projects.find(p=>p.id===PROJECT_ID);
 requireTrue(original?.name==="Керамика"&&String(active)===PROJECT_ID,"active_ceramic_only");
 requireTrue(original.revision===51,"revision_51");
 requireTrue(Array.isArray(original.savedPlans)&&original.savedPlans.length===5,"five_saved_plans");
 requireTrue(original.lastPlan&&Number(original.lastPlan.duration_minutes)>4300&&Number(original.lastPlan.duration_minutes)<4400,"active_plan_snapshot");
 requireTrue((original.lastPlan.operations||original.lastPlan.generic_operations||[]).length>800,"active_plan_operations");
 const m=original.model;
 requireTrue(m&&!m.material&&Array.isArray(m.materials)&&m.materials.length===0,"empty_material_catalog");
 requireTrue(Array.isArray(m.technical_processes)&&m.technical_processes.length===1&&m.technical_processes[0].id==="TP_TILE","tech_process");
 requireTrue(Array.isArray(m.setup_rules)&&m.setup_rules.length===8,"eight_setup_rules");
 requireTrue(Array.isArray(m.orders)&&m.orders.length===12&&m.orders.map(o=>Number(o.id)).sort((a,b)=>a-b).every((id,i)=>id===2601+i),"twelve_orders");
 const area=m.orders.reduce((a,o)=>a+Number(o.area||o.quantity||0),0);
 requireTrue(area===23100&&m.start==="2026-10-05T08:00:00","ceramic_area_or_date");
 requireTrue(m.orders.every(o=>Number(o.parameters?.mass_kg_m2)===18),"mass_per_m2");
 const ops=m.technical_processes[0].operations;
 requireTrue(ops.length===7&&["OP_PRESS","OP_DRY","OP_GLAZE","OP_DECOR","OP_FIRE","OP_SORT","OP_PACK"].every(id=>ops.some(o=>o.id===id)),"seven_ops");
 requireTrue(ops.every(o=>(o.resource_requirements||[]).every(r=>r.resource_type!=="material")),"no_material_rules");
 const clone=structuredClone(projects),target=clone.find(p=>p.id===PROJECT_ID),model=target.model;
 model.materials=SPECS.map(([id,name,unit,rate,operation,stock,delivery,at])=>{
  requireTrue(stock+delivery>=area*rate,"stock_"+id);
  const op=model.technical_processes[0].operations.find(o=>o.id===operation);
  requireTrue(op,"operation_"+operation);
  op.resource_requirements.push({id:"RR_"+id,type:"material",resource_type:"material",match_mode:"specific",resource_ref:id,resource_refs:[id],quantity:rate,unit,consumption_rule:"per_m2"});
  return {id,name,unit,initial_stock:stock,deliveries:[{at,quantity:delivery}],consumption_per_unit:rate,order_ids:model.orders.map(o=>o.id),_demo_planned_demand:Math.round(area*rate*100)/100};
 });
 model._demo_materials_version=VERSION;
 target.revision=52;target.updatedAt=new Date().toISOString();
 // An old active plan cannot satisfy newly introduced material constraints.
 // It remains recoverable in the SQL backup. Existing savedPlans remain intact.
 target.lastPlan=null;
 for(const key of ["savedPlans","history","messages"]){requireTrue(str(target[key])===str(original[key]),"preserve_"+key)}
 for(const key of ["orders","equipment","employees","setup_rules","shifts","constraints"]){requireTrue(str(model[key])===str(m[key]),"preserve_"+key)}
 requireTrue(str(clone.find(p=>p.id!==PROJECT_ID))===str(projects.find(p=>p.id!==PROJECT_ID)),"preserve_other_project");
 return {clone,target,original,area};
}
try{
 const result=await SQL.begin(async tx=>{
  const rows=APPLY?await tx`SELECT tenant_id,storage FROM pp_tenant_storage FOR UPDATE`:await tx`SELECT tenant_id,storage FROM pp_tenant_storage`;
  requireTrue(rows.length===1,"only_one_tenant");
  const {tenant_id,storage}=rows[0],oldRaw=storage["prodplan.projects.v2"];
  const projects=unwrap(oldRaw),active=unwrap(storage["prodplan.project.active.v2"]);
  requireTrue(typeof oldRaw==="string","projects_text_storage");
  const {clone,target,original,area}=prepare(projects,active);
  const hash=sha(oldRaw),newValue=str(clone);
  console.log("PP_CERAMIC_MATERIAL_MIGRATION_CHECK",str({apply:APPLY,sourceSha256:hash,newSha256:sha(newValue),orders:12,area,materials:target.model.materials.map(x=>x.id),
   materialRequirementCount:6,savedPlans:target.savedPlans.length,setupRules:target.model.setup_rules.length,previousPlanMinutes:original.lastPlan.duration_minutes,
   revisionBefore:51,revisionAfter:52,otherProjectUnchanged:true,backupTable:"pp_ceramic_materials_backup_20261014"}));
  if(!APPLY)return {mode:"dry-run",sourceSha256:hash};
  requireTrue(hash===EXPECTED_SHA,"unexpected_source_change_after_dry_run");
  await tx`CREATE TABLE IF NOT EXISTS pp_ceramic_materials_backup_20261014
    (id BIGSERIAL PRIMARY KEY,tenant_id TEXT NOT NULL,project_id TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     original_project_storage TEXT NOT NULL,source_sha256 TEXT NOT NULL,previous_revision INTEGER NOT NULL,material_revision INTEGER NOT NULL,
     UNIQUE(tenant_id,project_id,previous_revision))`;
  const backup=await tx`INSERT INTO pp_ceramic_materials_backup_20261014
    (tenant_id,project_id,original_project_storage,source_sha256,previous_revision,material_revision)
    VALUES (${tenant_id},${PROJECT_ID},${oldRaw},${hash},51,52) ON CONFLICT DO NOTHING RETURNING id`;
  requireTrue(backup.length===1,"backup_new_row");
  const changed=await tx`UPDATE pp_tenant_storage
    SET storage=jsonb_set(storage,'{prodplan.projects.v2}',to_jsonb(${newValue}::text),false),updated_at=NOW()
    WHERE tenant_id=${tenant_id} AND storage->>'prodplan.projects.v2'=${oldRaw}
    RETURNING storage->>'prodplan.projects.v2' AS value`;
  requireTrue(changed.length===1&&changed[0].value===newValue,"atomic_cas_update");
  const updated=unwrap(changed[0].value),p=updated.find(q=>q.id===PROJECT_ID);
  requireTrue(p?.revision===52&&p.model.materials.length===6&&p.savedPlans.length===5&&p.lastPlan===null,"post_update_integrity");
  requireTrue(str(updated.find(q=>q.id!==PROJECT_ID))===str(projects.find(q=>q.id!==PROJECT_ID)),"other_project_integrity");
  return {mode:"applied",beforeHash:hash,afterHash:sha(newValue),backup:true,orders:12,materials:6,requirements:6,revision:52,saveCount:5};
 });
 console.log("PP_CERAMIC_MATERIALS_MIGRATION_RESULT",str(result));
}catch(e){console.error("PP_CERAMIC_MATERIALS_MIGRATION_ERROR",String(e?.message||e).slice(0,550));process.exitCode=1}
finally{await SQL.end({timeout:4})}
