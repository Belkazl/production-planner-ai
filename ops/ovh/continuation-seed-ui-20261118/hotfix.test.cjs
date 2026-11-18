const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const root=process.argv[2],previous=process.argv[3];
if(!root||!previous)throw Error("CONTINUE_SEED_TEST_REQUIRES_NEW_OLD_APP");
const current=fs.readFileSync(path.join(root,"restart-optimizer-ui.js"),"utf8");
const prior=fs.readFileSync(path.join(previous,"restart-optimizer-ui.js"),"utf8");
const marker="\n;(()=>{\n\"use strict\";\n// Augment only real Continue requests.";
const at=current.lastIndexOf(marker);
assert(at>=0,"last appended hook is in live UI file");
const appended=current.slice(at);
const begin="  const existing=body.resume_plan;";
const end="  if(!hint)return previousFetch.apply(this,arguments);";
const i0=prior.indexOf(begin),i1=prior.indexOf(end,i0);
const j0=current.indexOf("  // The native planner may attach a legacy resume_plan."),j1=current.indexOf(end,j0);
assert(i0>=0&&i1>i0&&j0>=0&&j1>j0,"hotfix legacy seed anchors");
assert.equal(current.slice(0,j0),prior.slice(0,i0));
assert.equal(current.slice(j1),prior.slice(i1));
assert(current.slice(j0,j1).includes("allowedIds.size===ownIds.length"));
assert(current.slice(j0,j1).includes("if(!hint)hint=seed();"));
const orderIds=Array.from({length:12},(_,i)=>"ORDER-"+i);
const model={
 orders:orderIds.map(id=>({id})),
 equipment:Array.from({length:14},(_,i)=>({id:"EQ-"+i,name:"Machine "+i})),
 employees:Array.from({length:4},(_,i)=>({id:"EMP-"+i,name:"Operator "+i}))
};
const ops=Array.from({length:903},(_,i)=>({
 order:orderIds[i%12],
 equipment_ids:["EQ-"+(i%14)],employee_ids:["EMP-"+(i%4)],
 operation_id:"OP-"+i,
 is_setup:i<77,phase:i<77?"setup":"process",
 start_min:i*4,end_min:i*4+4
}));
const saved={ok:true,valid:true,partial:false,_revision:9,
 operations:ops,generic_operations:ops,duration_minutes:4376,
 machine_idle_minutes:17688,operator_wait_minutes:419554};
function context({active="P1",rev=9,last=saved,shown=null}={}){
 const project={id:"P1",name:"Ceramic fixture",revision:rev,model,lastPlan:last};
 const kv={"prodplan.project.active.v2":active,
  "prodplan.projects.v2":JSON.stringify([project])};
 const seen=[],consoleMessages=[];
 const mock=async(input,init)=>{seen.push({input,init});return new Response(
   JSON.stringify({ok:true,started:true}),{status:202})};
 const window={location:{href:"https://app.liftorbit.app/",origin:"https://app.liftorbit.app"},
  fetch:mock,__ppOptimizerCommittedPlan:shown,__ppTabPlan:shown,__ppManualPlan:null};
 const box={window,localStorage:{getItem:k=>kv[k]??null},URL,Response,console:{
  info:(...args)=>consoleMessages.push(args.join(" ")),
  warn:(...args)=>consoleMessages.push(args.join(" "))
 }};
 vm.runInNewContext(appended,box,{timeout:2000});
 assert.equal(window.__PP_CONTINUATION_SEED_V2__.installed,true);
 async function post(body,url="/api/plan"){
  await window.fetch(url,{method:"POST",credentials:"same-origin",
   headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  return JSON.parse(seen.at(-1).init.body);
 }
 return {window,post,seen,project,consoleMessages};
}
test("user's 903-operation 77-setup plan resumes from all twelve valid orders",async()=>{
 const x=context();
 const out=await x.post({continue:true,generations:10,population:12,
  locked_operations:[{operation_id:"manual-a"}]});
 assert.equal(out.resume_plan.order_sequence.length,12);
 assert.deepEqual(new Set(out.resume_plan.order_sequence),new Set(orderIds));
 assert.equal(out.generations,10);
 assert.equal(out.population,12);
 assert.equal(out.continue,true);
 assert.deepEqual(out.locked_operations,[{operation_id:"manual-a"}]);
 assert(!Object.hasOwn(out.resume_plan,"duration_minutes"),
  "never use a browser-supplied score as trusted GA fitness");
 assert.equal(x.window.__PP_CONTINUATION_SEED_V2__.lastSeedLength,12);
});
test("continue_run alias also carries validated order hint",async()=>{
 const x=context();
 const out=await x.post({continue_run:true,generations:60,population:32});
 assert.equal(out.resume_plan.order_sequence.length,12);
});
test("existing native resume_plan keeps same-account order but drops untrusted score",async()=>{
 const x=context();const seed={order_sequence:["ORDER-1"],duration_minutes:15,total_generations:900000};
 const out=await x.post({continue:true,resume_plan:seed});
 assert.equal(out.resume_plan.order_sequence[0],"ORDER-1");
 assert.equal(out.resume_plan.order_sequence.length,12);
 assert(!Object.hasOwn(out.resume_plan,"duration_minutes"));
 assert(!Object.hasOwn(out.resume_plan,"total_generations"));
});
test("invalid legacy seed is replaced by verified saved plan's current owned orders",async()=>{
 const x=context();
 const out=await x.post({continue:true,resume_plan:{order_sequence:["FOREIGN"],
  duration_minutes:1}});
 assert.deepEqual(new Set(out.resume_plan.order_sequence),new Set(orderIds));
 assert.equal(out.resume_plan.duration_minutes,undefined);
});
test("valid same-model native seed is sanitized even without a stored plan",async()=>{
 const x=context({last:null});
 const out=await x.post({continue:true,resume_plan:{order_sequence:["ORDER-7"],duration_minutes:10}});
 assert.equal(out.resume_plan.order_sequence.length,12);
 assert.equal(out.resume_plan.order_sequence[0],"ORDER-7");
 assert(!("duration_minutes" in out.resume_plan));
});
test("ordinary new optimization never becomes continuation",async()=>{
 const x=context();const out=await x.post({continue:false,generations:10,population:12});
 assert(!("resume_plan" in out));
});
test("foreign project or changed model revision cannot seed old plan",async()=>{
 for(const opts of [{active:"OTHER"},{rev:10}]){
  const x=context(opts),out=await x.post({continue:true});
  assert.equal(out.resume_plan,undefined);
 }
});
test("foreign order or resource in previous result cannot seed worker",async()=>{
 for(const modify of [a=>a[1].order="FOREIGN",
  a=>a[2].equipment_ids=["FOREIGN-EQ"],
  a=>a[3].employee_ids=["FOREIGN-EMP"]]){
  const copy=structuredClone(saved);
  modify(copy.generic_operations);
  const x=context({last:copy}),out=await x.post({continue:true});
  assert.equal(out.resume_plan,undefined);
 }
});
test("when persisted plan absent, visible same-model valid plan can be recovered",async()=>{
 const x=context({last:null,shown:saved});
 const out=await x.post({continue:true});
 assert.equal(out.resume_plan.order_sequence.length,12);
});
test("stale visible plans are rejected if no persisted incumbent exists",async()=>{
 const stale={...saved,_revision:8};
 const x=context({last:null,shown:stale});
 const out=await x.post({continue:true});
 assert.equal(out.resume_plan,undefined);
});
test("unrelated routes, worker progress, stop and other origins remain untouched",async()=>{
 const x=context();for(const [route,body] of [
 ["/api/optimizer-reset",{continue:true}],
 ["/api/plan-progress",{continue:true}],
 ["https://other.invalid/api/plan",{continue:true}]]){
  const out=await x.post(body,route);
  assert.equal(out.resume_plan,undefined);
 }
});
console.log("CONTINUE_LEGACY_SEED_HOTFIX_903_OPERATIONS_77_SETUPS_TESTS_PASS");
