const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const root=process.argv[2];if(!root)throw Error("APP_ROOT_REQUIRED");
const src=fs.readFileSync(path.join(root,"restart-optimizer-ui.js"),"utf8");
const start=src.lastIndexOf("\n;(function ppGaQualityFloorV1");
assert(start>0,"fresh objective floor must be appended to actual UI");
const injected=src.slice(start);
const model={
 orders:[{id:"OWN"}],
 equipment:[{id:"EQ",name:"Own machine"}],
 employees:[{id:"EMP",name:"Own employee"}],
 setup_rules:[]
};
const operations=[{order:"OWN",equipment_ids:["EQ"],employee_ids:["EMP"],is_setup:false}];
const existing={ok:true,valid:true,partial:false,_revision:7,operations,
 generic_operations:operations,duration_minutes:4355,batch_count:118,
 operator_wait_minutes:412575,machine_idle_minutes:17461};
const worse={...existing,duration_minutes:9080,
 machine_idle_minutes:69048,operator_wait_minutes:420868};
const better={...existing,duration_minutes:4000};
const jsonResponse=data=>new Response(JSON.stringify(data),{status:200,headers:{"content-type":"application/json"}});
function sandbox(raw,opts={}){
 const project={id:"MY_PROJECT",revision:opts.revision??7,model,
  lastPlan:opts.prior===undefined?structuredClone(existing):opts.prior};
 const values={"prodplan.project.active.v2":opts.active??"MY_PROJECT",
  "prodplan.projects.v2":JSON.stringify([project])};
 const localStorage={getItem:k=>values[k]??null};
 const warned=[];
 const window={
  fetch:async()=>jsonResponse(raw),
  location:{href:"https://app.liftorbit.app/"},
  __ppOptimizerObjectiveAtStart:opts.goal??"duration",
  __ppFreshRestartProject:"MY_PROJECT",
  __ppFreshDisplayBaseline:opts.fresh??null
 };
 const context=vm.createContext({window,localStorage,URL,Response,Headers,
  console:{warn:(...a)=>warned.push(a.join(" "))}});
 vm.runInContext(injected,context,{timeout:1000});
 assert.equal(window.__PP_GA_OBJECTIVE_FLOOR_V1__?.installed,true);
 return {window,warned};
}
test("worse 9080 minute plan cannot replace accepted 4355 minute plan",async()=>{
 const s=sandbox(worse);
 const response=await s.window.fetch("/api/plan",{method:"POST"});
 const result=await response.json();
 assert.equal(result.duration_minutes,4355);
 assert.equal(result.optimization_previous_best_preserved,true);
 assert.match(s.warned.join(" "),/PP_GA_WORSE_OBJECTIVE_REJECTED/);
});
test("best progress completion cannot regress and keeps response shape",async()=>{
 const s=sandbox({ok:true,success:true,phase:"completed",running:false,
  result:worse,best_preview:worse,percent:100});
 const r=await s.window.fetch("/api/plan-progress");
 const obj=await r.json();
 assert.equal(obj.result.duration_minutes,4355);
 assert.equal(obj.best_preview.duration_minutes,4355);
 assert.equal(obj.phase,"completed");
});
test("genuinely better 4000-minute candidate is not replaced",async()=>{
 const s=sandbox(better);
 assert.equal((await(await s.window.fetch("/api/plan",{method:"POST"})).json()).duration_minutes,4000);
});
test("equal cycles with 108 percent worse duration is rejected",async()=>{
 const s=sandbox(worse,{goal:"cycles"});
 assert.equal((await(await s.window.fetch("/api/plan",{method:"POST"})).json()).duration_minutes,4355);
});
test("an improved selected KPI may legitimately worsen another KPI",async()=>{
 const c={...worse,machine_idle_minutes:12000};
 const s=sandbox(c,{goal:"idle"});
 assert.equal((await(await s.window.fetch("/api/plan",{method:"POST"})).json()).duration_minutes,9080);
});
test("a changed model revision cannot inherit prior plan",async()=>{
 const s=sandbox(worse,{revision:8,fresh:null});
 assert.equal((await(await s.window.fetch("/api/plan",{method:"POST"})).json()).duration_minutes,9080);
});
test("other project cannot inherit incumbent",async()=>{
 const s=sandbox(worse,{active:"OTHER_PROJECT"});
 assert.equal((await(await s.window.fetch("/api/plan",{method:"POST"})).json()).duration_minutes,9080);
});
test("foreign resource in stored floor is rejected",async()=>{
 const invalid=structuredClone(existing);invalid.operations[0].equipment_ids=["FOREIGN_EQ"];
 invalid.generic_operations[0].equipment_ids=["FOREIGN_EQ"];
 const s=sandbox(worse,{prior:invalid});
 assert.equal((await(await s.window.fetch("/api/plan",{method:"POST"})).json()).duration_minutes,9080);
});
test("partial candidate is rejected in favor of complete verified baseline",async()=>{
 const s=sandbox({...worse,partial:true});
 assert.equal((await(await s.window.fetch("/api/plan",{method:"POST"})).json()).duration_minutes,4355);
});
test("async worker start and running previews remain untouched",async()=>{
 const s=sandbox({ok:true,started:true,phase:"queued"});
 assert.equal((await(await s.window.fetch("/api/plan",{method:"POST"})).json()).started,true);
 const t=sandbox({ok:true,running:true,success:false,best_preview:worse});
 assert.equal((await(await t.window.fetch("/api/plan-progress")).json()).best_preview.duration_minutes,9080);
});
test("no accepted previous plan never fabricates a new baseline",async()=>{
 const s=sandbox(worse,{prior:null});
 assert.equal((await(await s.window.fetch("/api/plan",{method:"POST"})).json()).duration_minutes,9080);
});
console.log("GA_ACTIVE_UI_FLOOR_4355_VS_9080_TESTS_PASS");
