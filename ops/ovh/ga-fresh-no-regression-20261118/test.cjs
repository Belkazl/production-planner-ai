const fs=require("node:fs");
const assert=require("node:assert/strict");
const {test}=require("node:test");
const path=require("node:path");
const root=process.argv[2];if(!root)throw Error("APP_ROOT_REQUIRED");
const source=fs.readFileSync(path.join(root,"baselines/2026-10-10/aps-setup-bridge/index.ts"),"utf8");
const i=source.indexOf("function ppFreshObjectiveFloorHtml("),j=source.indexOf("function ppLiveMotionHtml(",i);
assert(i>=0&&j>i,"fresh objective floor must be in bridge");
const install=new Function(source.slice(i,j)+"\nreturn ppFreshObjectiveFloorHtml;")();
const old="const ppOriginal=ppIncumbentCurrentPlan();const cont=hasResult||!!ppOriginal;";
const oldDec="const ppDec=cont&&ppInc?ppIncumbentDecision(d,ppInc):{accept:true};";
const revised=install(old+"const ppInc=ppOriginal?JSON.parse(JSON.stringify(ppOriginal)):null;"+oldDec);
assert(!revised.includes(old),"fresh must not continue through old incumbent branch");
assert(revised.includes("const cont=window.__ppFreshRestartPending?false:"));
const floorCode=revised.slice(0,revised.indexOf("const ppInc="));
const plan={ok:true,valid:true,partial:false,_revision:7,operations:[
 {order:"OWN-O",equipment_ids:["OWN-EQ"],employee_ids:["OWN-EMP"],is_setup:false}
],duration_minutes:4355,batch_count:118,operator_wait_minutes:412575,machine_idle_minutes:17461};
const model={orders:[{id:"OWN-O"}],equipment:[{id:"OWN-EQ"}],
 employees:[{id:"OWN-EMP"}],setup_rules:[{id:"COLOR",duration_min:10}]};
const ls={items:{"prodplan.project.active.v2":"P1",
 "prodplan.projects.v2":JSON.stringify([{id:"P1",revision:7,model}])},
 getItem(k){return this.items[k]??null}};
function ctx({fresh=true,planOverride=plan,project="P1",rev=7,hasResult=false,own=()=>null}={}){
 const w={__ppFreshRestartMode:fresh,__ppFreshRestartPending:fresh,
 __ppFreshRestartProject:project,__ppFreshDisplayBaseline:planOverride};
 const storage={getItem(k){
  if(k==="prodplan.projects.v2")return JSON.stringify([{id:"P1",revision:rev,model}]);
  return ls.getItem(k);
 }};
 return new Function("window","localStorage","model","ppIncumbentCurrentPlan","hasResult",
  floorCode+"return {original:ppOriginal,cont,floor:ppFreshFloor};")(w,storage,model,own,hasResult);
}
test("fresh new search retains comparable accepted same-model plan without becoming continuation",()=>{
 const s=ctx();
 assert.equal(s.cont,false);
 assert.equal(s.original.duration_minutes,4355);
 assert.equal(s.floor.duration_minutes,4355);
 assert(revised.includes("const ppDec=ppInc?ppIncumbentDecision(d,ppInc):{accept:true};"));
});
test("worse GA duration 9080 is rejected against 4355-minute accepted plan",()=>{
 const s=ctx();
 const candidate={...s.original,duration_minutes:9080,machine_idle_minutes:69048,
  operator_wait_minutes:420868};
 assert(candidate.duration_minutes>s.original.duration_minutes);
 assert.equal(candidate.duration_minutes<=s.original.duration_minutes+0.01,false);
 const improvement={...candidate,duration_minutes:4300};
 assert.equal(improvement.duration_minutes<s.original.duration_minutes,true);
});
test("restart baseline cannot be transferred to another project",()=>{
 assert.equal(ctx({project:"OTHER"}).original,null);
});
test("restart baseline cannot survive model revision change",()=>{
 assert.equal(ctx({rev:8}).original,null);
});
test("restart baseline cannot be imported from foreign order or machine",()=>{
 for(const key of ["order","equipment_ids","employee_ids"]){
  const changed=structuredClone(plan);changed.operations[0][key]=key==="order"?"OTHER":["FOREIGN"];
  assert.equal(ctx({planOverride:changed}).original,null);
 }
});
test("ordinary continuation keeps existing trusted incumbent",()=>{
 const old=()=>plan;
 const s=ctx({fresh:false,own:old,hasResult:true});
 assert.equal(s.cont,true);assert.equal(s.original.duration_minutes,4355);
});
test("no incumbent on a truly new account gives independent fresh search",()=>{
 const s=ctx({planOverride:null});
 assert.equal(s.original,null);assert.equal(s.cont,false);
});
test("changed project floor cannot accidentally continue with stale saved incumbent",()=>{
 const s=ctx({project:"OTHER",own:()=>plan});
 assert.equal(s.original,null);assert.equal(s.cont,false);
});
console.log("GA_FRESH_OPTIMIZATION_MONOTONIC_FLOOR_TESTS_PASS");
