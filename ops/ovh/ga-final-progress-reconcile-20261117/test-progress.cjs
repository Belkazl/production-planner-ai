const fs=require("node:fs");
const assert=require("node:assert/strict");
const path=require("node:path");
const root=process.argv[2];
if(!root)throw Error("MODEL_ROOT_REQUIRED");
const source=fs.readFileSync(path.join(root,"baselines/2026-10-10/aps-setup-bridge/index.ts"),"utf8");
const start=source.indexOf("function ppReconcileSetupAwareTerminal(");
const end=source.indexOf("async function progress(req){",start);
assert(start>=0&&end>start,"GA_PROGRESS_HELPER_NOT_INSTALLED");
const isOwned=(plan,model)=>{
 const orders=new Set(model.orders.map(x=>x.id));
 const equipment=new Set(model.equipment.map(x=>x.id));
 const employees=new Set(model.employees.map(x=>x.id));
 const arr=plan.generic_operations?.length?plan.generic_operations:plan.operations;
 return arr.every(x=>orders.has(x.order)&&
   (x.equipment_ids||[]).every(id=>equipment.has(id))&&
   (x.employee_ids||[]).every(id=>employees.has(id)));
};
const reconcile=new Function("ppAccountPlanBelongsToModel","console",
 source.slice(start,end)+"\nreturn ppReconcileSetupAwareTerminal;")(isOwned,{warn:()=>{}});
const model={orders:[{id:"OWN-O"}],equipment:[{id:"OWN-EQ"}],
 employees:[{id:"OWN-EMP"}],setup_rules:[{id:"COLOR",duration_min:10}]};
const native=Array.from({length:1008},(_,i)=>({order:"OWN-O",
 operation_id:"native-"+i,equipment_ids:["OWN-EQ"],employee_ids:["OWN-EMP"],
 is_setup:false,phase:"process",start_min:i*2,end_min:i*2+2}));
const setups=Array.from({length:89},(_,i)=>({order:"OWN-O",
 operation_id:"setup-"+i,equipment_ids:["OWN-EQ"],employee_ids:["OWN-EMP"],
 is_setup:true,phase:"setup",start_min:i*2,end_min:i*2+2}));
const best={ok:true,valid:true,partial:false,
 operations:[...native,...setups],
 generic_operations:[...native,...setups],
 duration_minutes:4445,
 resume_state:{version:1,order_sequence:["OWN-O"]}};
const raw={ok:true,valid:true,operations:native,
 generic_operations:native,duration_minutes:4300,
 resume_state:{version:1,order_sequence:["OWN-O"],total_trials:4}};
const fresh=()=>({ok:true,success:true,running:false,
 result:structuredClone(raw),best_preview:structuredClone(best)});
let state=fresh();
assert.equal(reconcile(state,model),true,"valid setup-aware result should be chosen");
assert.equal(state.result.operations.length,1097);
assert.equal(state.result.operations.filter(x=>x.is_setup).length,89);
assert.equal(state.result.duration_minutes,4445);
assert.equal(state.result.resume_state.total_trials,4,"trusted native resume state preserved");
assert.equal(state.best_preview.operations.length,1097);
assert.equal(state.result.optimization_termination_reason,"reconciled_setup_aware_final");
const foreign=fresh();
foreign.best_preview.operations[1].order="FOREIGN";
foreign.best_preview.generic_operations[1].order="FOREIGN";
assert.equal(reconcile(foreign,model),false);
assert.equal(foreign.result.operations.length,1008,"foreign plans cannot become terminal");
const partial=fresh();partial.best_preview.partial=true;
assert.equal(reconcile(partial,model),false);
const running=fresh();running.running=true;
assert.equal(reconcile(running,model),false);
const noSetups=fresh();noSetups.best_preview.operations=native;
noSetups.best_preview.generic_operations=native;
assert.equal(reconcile(noSetups,model),false);
const noRules=fresh();assert.equal(reconcile(noRules,{...model,setup_rules:[]}),false);
const alreadySetup=fresh();alreadySetup.result.operations=[...native,...setups];
assert.equal(reconcile(alreadySetup,model),false);
console.log("GA_FINAL_PROGRESS_1097_89_AND_FOREIGN_ACCOUNT_BOUNDARY_PASS");
