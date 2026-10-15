import postgres from "postgres";
import {createHash} from "node:crypto";

const DB=postgres(Bun.env.DATABASE_URL,{max:1,connect_timeout:14,idle_timeout:3});
const SNAPSHOT="production-2026-10-15-ceramic-materials-v1";
const CODE_SHA="1a6d4ae9ffb6978e064830c0aafd3ec92bb3422c";
const TARGET_PROJECT="prj_mugww6lr_kanzz5";
const SPEC=[
 ["M_BODY","OP_PRESS",18.5,"кг"],
 ["M_ENGOBE","OP_GLAZE",0.55,"кг"],
 ["M_GLAZE","OP_GLAZE",0.65,"кг"],
 ["M_INK","OP_DECOR",0.04,"кг"],
 ["M_CARTONS","OP_PACK",0.7,"шт."],
 ["M_PALLETS","OP_PACK",0.02,"шт."]
];
const hash=t=>createHash("sha256").update(t).digest("hex");
function unwrap(value){for(let i=0;i<5&&typeof value==="string";i++){try{value=JSON.parse(value)}catch{break}}return value}
function check(cond,label){if(!cond)throw Error("ETALON_GUARD:"+label)}

try{
 const output=await DB.begin(async tx=>{
  const tenants=await tx`SELECT tenant_id, storage FROM pp_tenant_storage FOR SHARE`;
  check(tenants.length===1,"single_tenant");
  const {tenant_id,storage}=tenants[0];
  const raw=storage["prodplan.projects.v2"];
  const projects=unwrap(raw);
  const active=unwrap(storage["prodplan.project.active.v2"]);
  check(typeof raw==="string"&&Array.isArray(projects)&&projects.length===2,"project_storage");
  const p=projects.find(x=>x.id===TARGET_PROJECT);
  check(p?.name==="Керамика"&&projects.some(x=>x.name==="Покраска"),"target_projects");
  check(String(active)===TARGET_PROJECT,"active_project");
  check(Number(p.revision)>=52,"has_materials_revision");
  const model=p.model||{},orders=model.orders||[],materials=model.materials||[];
  check(orders.length===12&&orders.reduce((s,x)=>s+Number(x.area||x.quantity||0),0)===23100,"ceramic_orders_area");
  check(orders.map(x=>Number(x.id)).sort((a,b)=>a-b).every((id,i)=>id===2601+i),"order_ids");
  check(materials.length===6,"six_materials");
  check((model.setup_rules||[]).length===8,"setup_rules");
  check(Array.isArray(p.savedPlans)&&p.savedPlans.length>=5,"saved_plans_preserved");
  const ops=model.technical_processes?.[0]?.operations||[];
  check(model.technical_processes?.length===1&&model.technical_processes[0].id==="TP_TILE","ceramic_process");
  const matReqs=ops.flatMap(op=>(op.resource_requirements||[]).filter(r=>r.resource_type==="material").map(r=>({operation:op.id,...r})));
  check(matReqs.length===6,"six_material_requirements");
  for(const [id,operation,rate,unit] of SPEC){
   const m=materials.find(x=>x.id===id),req=matReqs.find(x=>x.resource_ref===id);
   check(!!m&&!!req&&req.operation===operation,"mapping_"+id);
   check(Number(req.quantity)===rate&&req.consumption_rule==="per_m2"&&req.unit===unit,"rate_"+id);
   check(m.deliveries?.length===1&&Number(m.initial_stock)>0&&Number(m.deliveries[0].quantity)>0,"stock_"+id);
  }
  const contentHash=hash(raw);
  const notes={
   projectName:p.name,projectsCount:projects.length,ordersCount:orders.length,areaM2:23100,
   materialsCount:materials.length,materialRequirements:matReqs.length,setupRules:model.setup_rules.length,
   savedPlans:p.savedPlans.length,activePlanPresent:!!p.lastPlan,
   equipmentCount:(model.equipment||[]).length,employeesCount:(model.employees||[]).length,
   distinctOtherProject:projects.find(x=>x.id!==TARGET_PROJECT)?.name||null,
   modelStart:model.start,expectedCodeSha:CODE_SHA
  };
  // Immutable recovery copy in Postgres; never update tenant project data here.
  await tx`CREATE TABLE IF NOT EXISTS pp_production_etalon_snapshots (
   snapshot_name TEXT PRIMARY KEY,
   tenant_id TEXT NOT NULL,
   code_commit TEXT NOT NULL,
   project_id TEXT NOT NULL,
   project_revision INTEGER NOT NULL,
   projects_storage TEXT NOT NULL,
   active_project_id TEXT NOT NULL,
   storage_sha256 TEXT NOT NULL,
   metadata JSONB NOT NULL,
   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  const inserted=await tx`INSERT INTO pp_production_etalon_snapshots
   (snapshot_name,tenant_id,code_commit,project_id,project_revision,projects_storage,active_project_id,storage_sha256,metadata)
   VALUES (${SNAPSHOT},${tenant_id},${CODE_SHA},${TARGET_PROJECT},${p.revision},${raw},${String(active)},${contentHash},${JSON.stringify(notes)}::jsonb)
   ON CONFLICT (snapshot_name) DO NOTHING
   RETURNING snapshot_name`;
  const backup=await tx`SELECT snapshot_name,code_commit,project_id,project_revision,projects_storage,active_project_id,storage_sha256,metadata,created_at
                       FROM pp_production_etalon_snapshots WHERE snapshot_name=${SNAPSHOT}`;
  check(backup.length===1&&backup[0].code_commit===CODE_SHA,"pinned_code");
  check(backup[0].project_id===TARGET_PROJECT&&backup[0].active_project_id===String(active),"pinned_project");
  check(hash(backup[0].projects_storage)===backup[0].storage_sha256,"backup_hash");
  check(backup[0].storage_sha256===contentHash,"snapshot_matches_live");
  check(backup[0].project_revision===p.revision,"revision_matches_live");
  const saved=unwrap(backup[0].projects_storage);
  check(saved.length===2&&saved.find(x=>x.id===TARGET_PROJECT)?.model.materials.length===6,"snapshot_readback");
  return {saved:inserted.length===1,verified:true,name:SNAPSHOT,codeCommit:CODE_SHA,
   projectRevision:p.revision,storageSHA256:contentHash,orders:orders.length,materials:materials.length,
   materialRequirements:matReqs.length,setupRules:model.setup_rules.length,savedPlans:p.savedPlans.length,
   backupCreatedAt:backup[0].created_at,activePlanPresent:!!p.lastPlan,
   otherProjectPreserved:true,dbTable:"pp_production_etalon_snapshots",
   scope:"backup_only_no_project_mutations"};
 });
 console.log("PP_CERAMIC_20261015_ETALON_SNAPSHOT_SAVED",JSON.stringify(output));
}catch(error){console.error("PP_CERAMIC_20261015_ETALON_SNAPSHOT_FAILED",String(error?.message||error).slice(0,550));process.exitCode=1}
finally{await DB.end({timeout:3})}
