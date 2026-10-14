import postgres from "postgres";
const sql=postgres(Bun.env.DATABASE_URL,{max:1});
const old=(await sql.unsafe("select storage->>'prodplan.projects.v2' as val from pp_tenant_storage limit 1"))[0].val;
let arr:any=old;let depth=0;while(typeof arr==="string"&&depth<5){arr=JSON.parse(arr);depth++;}
if(!Array.isArray(arr)||arr.length!==2||!arr.some((x:any)=>x.name==="Керамика")||!arr.some((x:any)=>x.name==="Покраска"))throw new Error("Safety mismatch");
const canonical=JSON.stringify(arr);
const updated=await sql.unsafe("update pp_tenant_storage set storage=jsonb_set(storage,'{prodplan.projects.v2}',to_jsonb($1::text),false) where storage->>'prodplan.projects.v2'=$2 returning storage->>'prodplan.projects.v2' as val",[canonical,old]);
if(updated.length!==1||updated[0].val!==canonical)throw new Error("Verification failed");
const parsed=JSON.parse(updated[0].val);
console.log("PROJECT_RESTORE_VERIFIED",JSON.stringify({depthBefore:depth,depthAfter:1,projects:parsed.map((x:any)=>({name:x.name,orders:x.model?.orders?.length,equipment:x.model?.equipment?.length,plan:x.lastPlan?.duration_minutes})),sameSemanticContent:JSON.stringify(parsed)===JSON.stringify(arr),storageChars:canonical.length}));
await sql.end();