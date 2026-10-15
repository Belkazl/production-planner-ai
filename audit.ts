import postgres from "postgres";
import {createHash} from "node:crypto";
const DB=postgres(Bun.env.DATABASE_URL,{max:1,connect_timeout:14,idle_timeout:3});
const N="production-2026-10-15-ceramic-materials-v1";
const SHA="27b200c93c39eb2f7830c82171e2d9dbb1d169ea70dfcb7307eb95aacef79d99";
const CODE="1a6d4ae9ffb6978e064830c0aafd3ec92bb3422c";
const hash=s=>createHash("sha256").update(s).digest("hex");
const unpack=s=>{for(let i=0;i<5&&typeof s==="string";i++){try{s=JSON.parse(s)}catch{break}}return s};
const check=(v,msg)=>{if(!v)throw Error("BACKUP_VERIFY_FAILED:"+msg)};
try{
 const rows=await DB`SELECT snapshot_name,project_id,project_revision,code_commit,projects_storage,active_project_id,
                         storage_sha256,metadata,created_at
                  FROM pp_production_etalon_snapshots WHERE snapshot_name=${N}`;
 check(rows.length===1,"found_snapshot");
 const s=rows[0];
 check(s.code_commit===CODE&&s.storage_sha256===SHA&&hash(s.projects_storage)===SHA,"code_sha_and_checksum");
 check(s.active_project_id===s.project_id&&s.project_id==="prj_mugww6lr_kanzz5","active_project_pointer");
 const projects=unpack(s.projects_storage);
 check(Array.isArray(projects)&&projects.length===2,"full_project_array");
 const p=projects.find(x=>x.id===s.project_id),other=projects.find(x=>x.name==="Покраска");
 check(p?.name==="Керамика"&&other&&p.revision===s.project_revision&&p.revision===52,"revision_and_both_projects");
 check(p.model.orders.length===12&&p.model.orders.reduce((sum,x)=>sum+Number(x.area||0),0)===23100,"twelve_orders");
 check(p.model.materials.length===6&&p.model.setup_rules.length===8,"materials_and_setups");
 check(p.model.technical_processes[0].operations.flatMap(o=>(o.resource_requirements||[]).filter(x=>x.resource_type==="material")).length===6,"six_consumption_rules");
 check(p.savedPlans.length===6&&!!p.lastPlan,"saved_and_current_plans");
 const older=await DB`SELECT source_sha256 FROM pp_ceramic_materials_backup_20261014 LIMIT 3`;
 check(older.length===1&&older[0].source_sha256==="3774a5f2fec826e8a5d720defb8de9ca5d12df3e318585ff97f4eecabb3c8dde","previous_backup_retained");
 const live=await DB`SELECT storage FROM pp_tenant_storage LIMIT 3`;
 check(live.length===1,"single_tenant_remains");
 const current=live[0].storage["prodplan.projects.v2"];
 const output={readOnly:true,verified:true,name:N,codeSha:CODE,dataSha:SHA,
  projectRevision:p.revision,orders:p.model.orders.length,materials:p.model.materials.length,
  rules:6,setupRules:p.model.setup_rules.length,savedPlans:p.savedPlans.length,activePlan:true,
  previousBackupRetained:true,otherProjectPreserved:true,createdAt:s.created_at,
  matchesCurrentLiveStorage:hash(current)===SHA,scope:"immutable_snapshot_and_integrity"};
 console.log("PP_CERAMIC_20261015_ETALON_INDEPENDENTLY_VERIFIED",JSON.stringify(output));
}catch(e){console.error("PP_CERAMIC_20261015_ETALON_VERIFY_ERROR",String(e?.message||e).slice(0,500));process.exitCode=1}
finally{await DB.end({timeout:3})}
