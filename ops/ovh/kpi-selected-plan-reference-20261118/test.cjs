const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const root=process.argv[2],previousRoot=process.argv[3];
if(!root||!previousRoot)throw Error("KPI_SELECTED_TEST_REQUIRES_OLD_AND_NEW_APP");
const file="restart-optimizer-ui.js";
const old=fs.readFileSync(path.join(previousRoot,file),"utf8");
const updated=fs.readFileSync(path.join(root,file),"utf8");
const newMarker="\n;(function ppSelectedPlanKpiReferenceV2(){";
const oldMarker="\n;(function ppFixedFirstBestKpiDelta(){";
const start=updated.lastIndexOf(newMarker),previousKpiStart=old.lastIndexOf(oldMarker);
assert(start>=0&&previousKpiStart>=0,"both KPI hooks must be installed");
assert.equal(updated.slice(0,start),old,"original live app preserved byte-for-byte");
assert.equal(updated.split(newMarker).length,2,"exactly one selection addon");
const newest=updated.slice(start+2),original=old.slice(previousKpiStart+2);
for(const req of [
 "__PP_OPTIMIZER_DEPTH__","__PP_GA_OBJECTIVE_FLOOR_V1__",
 "__PP_CONTINUATION_SEED_V2__","ppAutomaticIntermediatePreviewV1",
 "quick:Object.freeze({generations:10,population:12})",
 "PP_GA_WORSE_OBJECTIVE_REJECTED"])
 assert(updated.includes(req),"must preserve "+req);
const orderIds=Array.from({length:12},(_,i)=>"ORD-"+i);
const model={orders:orderIds.map(id=>({id})),equipment:[{id:"EQ"}],employees:[{id:"EM"}]};
const makePlan=(duration,wait=413124,idle=16859,revision=7)=>({
 valid:true,partial:false,_revision:revision,
 operations:Array.from({length:915},(_,i)=>({
  order:orderIds[i%12],is_setup:i<89,phase:i<89?"setup":"process",
  equipment_ids:["EQ"],employee_ids:["EM"]
 })),
 duration_minutes:duration,batch_count:118,
 operator_wait_minutes:wait,machine_idle_minutes:idle
});
function createStore(){
 return {
  "prodplan.project.active.v2":"P1",
  "prodplan.projects.v2":JSON.stringify([
   {id:"P1",revision:7,model,lastPlan:null},
   {id:"P2",revision:7,model:{...model,orders:[{id:"OTHER"}]},lastPlan:null}
  ])
 };
}
function env(storage){
 const events={},styles=[],classSet=new Set(),nodes={};
 const deltaIds=["durDelta","cyclesDelta","waitDelta","idleDelta"];
 for(const id of deltaIds)nodes[id]={textContent:"",className:"kpi-delta"};
 const button={
  disabled:false,textContent:"Start optimization",callbacks:{},
  addEventListener(event,fn){this.callbacks[event]=fn},
  click(label){this.textContent=label;this.callbacks.click?.()}
 };
 let modalOpen=false;
 const actionBtns=[{},{}];
 const actions={
  querySelectorAll:()=>actionBtns,
  contains:x=>actionBtns.includes(x)
 };
 const modal={
  classList:{contains:name=>name==="pp-open"&&modalOpen},
  contains:x=>x===actions
 };
 for(const btn of actionBtns){
  btn.closest=selector=>selector.includes("ppStopModal")?btn:selector===".pp-actions"?actions:null;
 }
 const document={
  createElement:()=>({}),
  head:{appendChild:v=>styles.push(v)},
  documentElement:{classList:{
   contains:name=>classSet.has(name),
   toggle:(name,on)=>{if(on)classSet.add(name);else classSet.delete(name)}
  }},
  getElementById:name=>name==="opt"?button:name==="ppStopModal"?modal:nodes[name]||null,
  addEventListener:(name,fn)=>{events[name]=fn}
 };
 const localStorage={
  getItem:k=>Object.hasOwn(storage,k)?storage[k]:null,
  setItem:(k,v)=>{storage[k]=String(v)},
  removeItem:k=>{delete storage[k]}
 };
 const fetched=[];
 const context={
  document,localStorage,URL,Response,console,
  location:{href:"https://app.liftorbit.app/",origin:"https://app.liftorbit.app"},
  addEventListener:(k,f)=>{events[k]=f},
  setInterval:()=>1,
  queueMicrotask:fn=>Promise.resolve().then(fn),
  fetch:async(url,init)=>{
   fetched.push({url,init});
   return Response.json({ok:true,started:true},{status:202});
  }
 };
 context.window=context;
 vm.createContext(context);
 const native=[
  "let previousKpiMetrics=null;",
  "function renderKpisWithDelta(d){",
  " const cur={duration:Number(d.duration_minutes),cycles:Number(d.batch_count),wait:Number(d.operator_wait_minutes),idle:Number(d.machine_idle_minutes)};",
  ' for(const [id,key] of [["durDelta","duration"],["cyclesDelta","cycles"],["waitDelta","wait"],["idleDelta","idle"]]){',
  "  const el=document.getElementById(id),prev=previousKpiMetrics?.[key];",
  "  el.textContent=prev==null?'':String(cur[key]-prev);",
  "  el.className='kpi-delta';",
  " }",
  " previousKpiMetrics=cur;",
  " return cur;",
  "}",
  "function ppProjectAfterPlan(d){",
  " const list=JSON.parse(localStorage.getItem('prodplan.projects.v2'));",
  " const active=localStorage.getItem('prodplan.project.active.v2');",
  " const p=list.find(x=>x.id===active);",
  " if(p)p.lastPlan={...d,_revision:p.revision};",
  " localStorage.setItem('prodplan.projects.v2',JSON.stringify(list));",
  "}"
 ].join("\n");
 vm.runInContext(native,context);
 vm.runInContext(original,context,{timeout:1000});
 vm.runInContext(newest,context,{timeout:1000});
 const kpi=context.__PP_KPI_FIRST_BEST_V1__,v2=context.__PP_KPI_SELECTED_REFERENCE_V2__;
 assert.equal(kpi.installed,true);assert.equal(v2.installed,true);
 return {
  context,storage,delta:nodes,button,modal,actions,actionBtns,events,styles,fetched,kpi,v2,
  hidden:()=>classSet.has("pp-kpi-no-reference"),
  save:plan=>context.ppProjectAfterPlan(plan),
  render:plan=>context.renderKpisWithDelta(plan),
  async stopChoice(plan,index=0){
   modalOpen=true;
   // The actual STOP modal does a synchronous restore in its onclick handler.
   events.click({target:actionBtns[index]});
   context.__ppOptimizerCommittedPlan=plan;
   context.__ppTabPlan=plan;
   modalOpen=false;
   await Promise.resolve();
   await Promise.resolve();
  },
  async continue(useContinue=true){
   return context.fetch("/api/plan",{method:"POST",body:JSON.stringify({
    continue:useContinue,generations:10,population:12
   })});
  },
  reset:()=>context.fetch("/api/optimizer-reset",{method:"POST",body:"{}"})
 };
}
async function main(){
 const data=createStore(),x=env(data);
 x.save(makePlan(4338,412568,18706));
 assert.equal(x.kpi.snapshot.metrics.duration,4338);
 x.button.click("Continue optimization");
 assert.equal(x.kpi.snapshot.compare,true);
 x.render(makePlan(4405));
 assert.equal(x.delta.durDelta.textContent,"67","reproduce reported WRONG +67");
 const selected=makePlan(4405);
 await x.stopChoice(selected);
 assert.equal(x.kpi.snapshot.metrics.duration,4405,"Stop selection replaces OLD 4338 anchor");
 assert.equal(x.kpi.snapshot.metrics.wait,413124,"all four metrics from selected plan");
 assert.equal(x.kpi.snapshot.metrics.idle,16859);
 assert.equal(x.kpi.snapshot.compare,false,"no comparison until next Continue");
 assert.equal(x.hidden(),true,"selected plan immediately hides old +67");
 assert.equal(x.delta.durDelta.textContent,"","selected plan must not show old +67");
 await x.continue();
 assert.equal(x.kpi.snapshot.compare,true,"Continue after Stop starts selected comparison");
 assert.equal(x.fetched.at(-1).init.body.includes('"generations":10'),true);
 x.render(makePlan(4375,411000,17000));
 assert.equal(x.delta.durDelta.textContent,"-30","compare 4375 to chosen 4405");
 assert.equal(x.delta.cyclesDelta.textContent,"0");
 assert.equal(x.delta.waitDelta.textContent,"-2124");
 assert.equal(x.delta.idleDelta.textContent,"141");
 x.render(makePlan(4350,409000,16600));
 assert.equal(x.delta.durDelta.textContent,"-55","later preview still compares to chosen 4405");
 assert.equal(x.kpi.snapshot.metrics.duration,4405,"candidate preview must never rebase");
 x.save(makePlan(4350,409000,16600));
 assert.equal(x.kpi.snapshot.metrics.duration,4405,"optimizer result cannot silently override manual choice");
 const reload=env(data);
 reload.render(makePlan(4340));
 assert.equal(reload.delta.durDelta.textContent,"-65","chosen Stop reference persists after reload");
 assert.equal(reload.hidden(),false);
 await reload.stopChoice(makePlan(4300,408000,15000));
 assert.equal(reload.kpi.snapshot.metrics.duration,4300,"second explicit choice rebases");
 assert.equal(reload.hidden(),true);
 await reload.continue();
 reload.render(makePlan(4280,407000,15050));
 assert.equal(reload.delta.durDelta.textContent,"-20");
 await reload.stopChoice(makePlan(4340,405000,15900),1);
 assert.equal(reload.kpi.snapshot.metrics.duration,4340,"Keep previous plan is another explicit choice");
 await reload.continue();
 reload.render(makePlan(4335));
 assert.equal(reload.delta.durDelta.textContent,"-5");
 const snapshot=reload.kpi.snapshot;
 const foreign=makePlan(4100);foreign.operations[2].order="FOREIGN";
 await reload.stopChoice(foreign);
 assert.deepEqual(reload.kpi.snapshot,snapshot,"reject foreign-order plan");
 const wrongRevision=makePlan(4200,400000,14000,8);
 await reload.stopChoice(wrongRevision);
 assert.deepEqual(reload.kpi.snapshot,snapshot,"reject stale model revision");
 await reload.reset();
 assert.equal(reload.kpi.snapshot,null,"Start again erases previous selected anchor");
 assert.equal(reload.hidden(),true);
 data["prodplan.project.active.v2"]="P2";
 reload.kpi.sync();
 assert.equal(reload.kpi.snapshot,null,"project isolation");
 assert.equal(reload.hidden(),true);
 data["prodplan.project.active.v2"]="P1";
 const projects=JSON.parse(data["prodplan.projects.v2"]);
 projects[0].revision=9;data["prodplan.projects.v2"]=JSON.stringify(projects);
 reload.kpi.sync();
 assert.equal(reload.kpi.snapshot,null,"revision isolation");
 assert.equal(reload.hidden(),true);
 console.log("KPI_SELECTED_STOP_915_OPERATIONS_89_SETUPS_REBASE_CONTINUE_RELOAD_RESET_TESTS_PASS");
}
main().catch(err=>{console.error(err);process.exitCode=1});
