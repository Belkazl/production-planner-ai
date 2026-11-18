const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const oldRoot=process.argv[2],newRoot=process.argv[3];
if(!oldRoot||!newRoot)throw Error("SOURCE_AND_PATCHED_APP_ROOT_REQUIRED");
const file="tenant-model-runtime.js";
const before=fs.readFileSync(path.join(oldRoot,file),"utf8");
const after=fs.readFileSync(path.join(newRoot,file),"utf8");
const oldHash='const ppAccountModelHash=m=>require("node:crypto").createHash("sha256").update(JSON.stringify(m)).digest("hex");';
const newHash='// Gantt mutates equipment with __ppid while rendering. It is UI metadata, not a production model revision.\n'+
'const ppAccountModelHash=m=>require("node:crypto").createHash("sha256").update(JSON.stringify(m,(key,value)=>key==="__ppid"?undefined:value)).digest("hex");';
assert.equal(before.split(oldHash).length,2,"single legacy hash anchor");
assert.equal(after,before.replace(oldHash,newHash),"entire account isolation source preserved except canonical hash");
const oldIndex=path.join(oldRoot,"index.ts"),newIndex=path.join(newRoot,"index.ts");
if(fs.existsSync(oldIndex)&&fs.existsSync(newIndex)){
 const compiledOld=fs.readFileSync(oldIndex,"utf8"),compiledNew=fs.readFileSync(newIndex,"utf8");
 assert.equal(compiledNew,compiledOld.includes(oldHash)?compiledOld.replace(oldHash,newHash):compiledOld,"generated Bun entrypoint matches canonical hash patch");
}
const line=after.match(/^const ppAccountModelHash=.*$/m)?.[0];
assert(line&&line.includes('key==="__ppid"?undefined:value'));
const hash=Function("require",line+"\nreturn ppAccountModelHash")(require);
const model={
 scheduler_mode:"resource",start:"2026-11-18T08:00:00",
 equipment:[{id:"M1",name:"Machine",capacity:600,kind:"workstation"}],
 employees:[{id:"E1",name:"Worker",shift:"day"}],
 orders:[{id:"O1",quantity:1200,technical_process_id:"T1"}],
 shifts:{day:[["08:00","12:00"]]},
 technical_processes:[{id:"T1",operations:[{id:"P1",duration_min:40,resource_requirements:[{resource_type:"equipment",resource_ref:"M1",quantity:1}]}]}],
 setup_rules:[{id:"S1",duration_min:10}],
 materials:[{id:"GLZ",quantity:900}],
 locked_operations:[{id:"LOCK",start_min:0}]
};
const first=hash(model);
const painted=structuredClone(model);
painted.equipment[0].__ppid="M1";
painted.employees[0].__ppid="E1";
painted.orders[0].__ppid="O1";
assert.equal(hash(painted),first,"Gantt metadata must NOT mark model stale");
for(const mutate of [
 m=>m.equipment[0].capacity+=1,
 m=>m.orders[0].quantity+=1,
 m=>m.employees[0].shift="night",
 m=>m.setup_rules[0].duration_min+=1,
 m=>m.technical_processes[0].operations[0].duration_min+=1,
 m=>m.materials[0].quantity+=1,
 m=>m.locked_operations[0].start_min+=20
]){
 const changed=structuredClone(painted);mutate(changed);
 assert.notEqual(hash(changed),first,"Actual production changes must invalidate a running job");
}
for(const marker of ["ppAccountPlanBelongsToModel","function checkPlan(plan)","account_plan_mismatch","account_model_changed_during_run"]){
 assert(after.includes(marker),"Ownership guard must remain: "+marker);
}
console.log("ACCOUNT_MODEL_HASH_GANTT_METADATA_ONLY_TEST_PASS");
