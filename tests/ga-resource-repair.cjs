const assert=require("node:assert/strict");
const fs=require("node:fs");
const source=fs.readFileSync("ceramics-resource-repair.js","utf8");
const reconcile=new Function(source+";return ppReconcileCeramicsFixture;")();
const fixture=JSON.parse(fs.readFileSync("/tmp/pp-ceramics-live-model.json","utf8"));
const live=fixture.model??fixture;
assert.equal(live.orders.length,12);
// Live demo equipment may already have the compatibility repair applied.
// Reproduce the old bug in an isolated copy, never alter the live fixture.
const input=structuredClone(live);
for(const oven of input.equipment.filter(x=>["E9","E10","E11"].includes(x.id))){
 assert(oven.capabilities?.allowed_firing_recipes?.includes("PS-01"),"demo oven must support PS-01");
 oven.capabilities.allowed_firing_recipes=["PS-01"];
}
for(const oven of input.autoclaves||[]){
 if(["FBN-A","FBN-B"].includes(oven.name)){
  oven.capabilities=oven.capabilities||{};
  oven.capabilities.allowed_firing_recipes=["PS-01"];
 }
}
const prior=structuredClone(input);
const liveSnapshot=structuredClone(live);
const liveSupported=["PS-02","PS-03"].every(r=>
 live.equipment.some(e=>e.kind==="firing"&&e.capabilities?.allowed_firing_recipes?.includes(r)));
if(liveSupported){
 const current=reconcile(live);
 assert.equal(current.changed,false,"already repaired live demo must be idempotent");
 assert.deepEqual(live,liveSnapshot,"live fixture changed during a read-only check");
}
const primaryRecipes=[...new Set(input.orders.map(x=>x.parameters?.firing_recipe))].sort();
const ovens=input.equipment.filter(x=>x.kind==="firing");
const can=(m,recipe)=>m.equipment.some(e=>e.kind==="firing"&&e.capabilities?.allowed_firing_recipes?.includes(recipe));
assert(primaryRecipes.includes("PS-02")&&primaryRecipes.includes("PS-03"),"demo must cover recipes 2 & 3");
assert(!can(input,"PS-02")&&!can(input,"PS-03"),"original demo must reproduce resource validator bug");
const repaired=reconcile(input);
assert.equal(repaired.changed,true,JSON.stringify(repaired));
assert.deepEqual(repaired.missing,["PS-02","PS-03"]);
for(const r of primaryRecipes)assert(can(repaired.model,r),"still missing firing eligibility "+r);
assert.deepEqual(repaired.model.orders,prior.orders,"production orders/quantity/parameters altered");
assert.deepEqual(repaired.model.technical_processes,prior.technical_processes,"operation routing altered");
assert.deepEqual(repaired.model.setup_rules,prior.setup_rules,"changeovers altered");
assert.deepEqual(repaired.model.employees,prior.employees,"employees altered");
assert.deepEqual(repaired.model.shifts,prior.shifts,"shifts altered");
assert.deepEqual(repaired.model.constraints,prior.constraints,"constraints altered");
assert.deepEqual(input,prior,"synthetic unrepaired fixture mutated");
assert.deepEqual(live,liveSnapshot,"live model fixture mutated");
const next=reconcile(repaired.model);
assert.equal(next.changed,false,"migration must be idempotent");
const other=structuredClone(prior);
other.orders[0].id=99999;
assert.equal(reconcile(other).changed,false,"nonfixture customer models must never be rewritten");
const manual=structuredClone(prior);
manual.equipment.find(x=>x.id==="E10").capabilities.allowed_firing_recipes=["PS-04"];
assert.equal(reconcile(manual).changed,false,"custom manual recipe profile must never be overridden");
console.log("CERAMIC_RECIPE_RECONCILIATION_UNIT_PASS",JSON.stringify({orders:input.orders.length,equipment:input.equipment.length,recipes:primaryRecipes,added:repaired.missing,preserved:["orders","technical_processes","setup_rules","employees","shifts","constraints"],idempotent:true,nonDemoUntouched:true}));
