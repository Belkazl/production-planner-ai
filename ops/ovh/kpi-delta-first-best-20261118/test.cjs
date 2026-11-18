const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const root=process.argv[2],previousRoot=process.argv[3];
if(!root||!previousRoot)throw Error("KPI_TEST_ROOT_REQUIRED");
const before=fs.readFileSync(path.join(previousRoot,"restart-optimizer-ui.js"),"utf8");
const after=fs.readFileSync(path.join(root,"restart-optimizer-ui.js"),"utf8");
const marker="\n;(function ppFixedFirstBestKpiDelta(){";
const pos=after.lastIndexOf(marker);
assert(pos>0,"new KPI addon in deployed UI");
assert.equal(after.slice(0,pos),before,"entire old UI unchanged");
assert.equal(after.split(marker).length,2);
const code=after.slice(pos+2);
for(const marker of ["ppAutomaticIntermediatePreviewV1","__PP_CONTINUATION_SEED_V2__",
 "__PP_OPTIMIZER_DEPTH__","__PP_GA_OBJECTIVE_FLOOR_V1__",
 "quick:Object.freeze({generations:10,population:12})"])
 assert(after.includes(marker),"preserved "+marker);
const plan=(duration,wait=400000,idle=21000,cycles=118,revision=7)=>({
 valid:true,partial:false,_revision:revision,operations:[{order:"ONE"}],
 duration_minutes:duration,operator_wait_minutes:wait,machine_idle_minutes:idle,batch_count:cycles
});
function createStore(){
 return {
  "prodplan.project.active.v2":"P1",
  "prodplan.projects.v2":JSON.stringify([
   {id:"P1",revision:7,model:{orders:[{id:"ONE"}]},lastPlan:null},
   {id:"P2",revision:7,model:{orders:[{id:"TWO"}]},lastPlan:null}
  ])
 };
}
function env(storage){
 const events={},styles=[],classSet=new Set();
 const delta={};
 for(const name of ["durDelta","cyclesDelta","waitDelta","idleDelta"])
  delta[name]={textContent:"",className:""};
 const button={
  disabled:false,textContent:"Start optimization",callbacks:{},
  addEventListener(name,fn){this.callbacks[name]=fn},
  click(label){this.textContent=label;this.callbacks.click?.()}
 };
 const document={
  createElement:()=>({}),
  head:{appendChild:x=>styles.push(x)},
  documentElement:{classList:{
   contains:n=>classSet.has(n),
   toggle:(n,enabled)=>{if(enabled)classSet.add(n);else classSet.delete(n)}
  }},
  getElementById:n=>n==="opt"?button:delta[n]||null
 };
 const localStorage={
  getItem:n=>Object.hasOwn(storage,n)?storage[n]:null,
  setItem:(n,v)=>{storage[n]=String(v)},
  removeItem:n=>{delete storage[n]}
 };
 const world={
  document,localStorage,URL,Response,setInterval:()=>1,
  location:{href:"https://app.liftorbit.app/",origin:"https://app.liftorbit.app"},
  addEventListener:(n,cb)=>{events[n]=cb},
  console,
  fetch:async(url)=>new Response(JSON.stringify({ok:true}),{status:200})
 };
 world.window=world;
 vm.createContext(world);
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
  " const data=JSON.parse(localStorage.getItem('prodplan.projects.v2'));",
  " const active=localStorage.getItem('prodplan.project.active.v2');",
  " const p=data.find(x=>x.id===active);",
  " if(p)p.lastPlan={...d,_revision:p.revision};",
  " localStorage.setItem('prodplan.projects.v2',JSON.stringify(data));",
  "}"
 ].join("\n");
 vm.runInContext(native,world);
 vm.runInContext(code,world,{timeout:1000});
 const api=world.__PP_KPI_FIRST_BEST_V1__;
 assert.equal(api.installed,true);
 return {
  world,storage,button,styles,delta,api,
  display:d=>world.renderKpisWithDelta(d),
  save:d=>world.ppProjectAfterPlan(d),
  hidden:()=>document.documentElement.classList.contains("pp-kpi-no-reference"),
  reset:()=>world.fetch("/api/optimizer-reset",{method:"POST",body:"{}"})
 };
}
async function main(){
 const saved=createStore(),ui=env(saved);
 ui.display(plan(5000));ui.display(plan(4800));
 assert.equal(ui.hidden(),true);
 assert.deepEqual(Object.values(ui.delta).map(v=>v.textContent),["","","",""]);
 ui.save(plan(4800));
 assert.equal(ui.api.snapshot.metrics.duration,4800);
 assert.equal(ui.api.snapshot.compare,false);
 ui.display(plan(4750));
 assert.equal(ui.delta.durDelta.textContent,"");
 ui.button.click("Continue optimization");
 assert.equal(ui.hidden(),false);
 ui.display(plan(4775,398000,21600));
 assert.equal(ui.delta.durDelta.textContent,"-25");
 assert.equal(ui.delta.waitDelta.textContent,"-2000");
 assert.equal(ui.delta.cyclesDelta.textContent,"0");
 assert.equal(ui.delta.idleDelta.textContent,"600");
 ui.display(plan(4700,390000,23000));
 assert.equal(ui.delta.durDelta.textContent,"-100","not previous candidate");
 assert.equal(ui.delta.idleDelta.textContent,"2000");
 ui.save(plan(4700,390000,23000));
 assert.equal(ui.api.snapshot.metrics.duration,4800,"later saves do not overwrite baseline");
 const reloaded=env(saved);
 reloaded.display(plan(4660));
 assert.equal(reloaded.delta.durDelta.textContent,"-140","reload keeps first best");
 assert.equal(reloaded.hidden(),false);
 await reloaded.reset();
 assert.equal(reloaded.api.snapshot,null,"new start clears reference on successful reset");
 assert.equal(reloaded.hidden(),true);
 reloaded.display(plan(4600));
 assert.equal(reloaded.delta.durDelta.textContent,"","new fresh run has no comparison");
 reloaded.save(plan(4590));
 assert.equal(reloaded.api.snapshot.metrics.duration,4590);
 assert.equal(reloaded.api.snapshot.compare,false);
 reloaded.button.click("Continue optimization");
 reloaded.display(plan(4500));
 assert.equal(reloaded.delta.durDelta.textContent,"-90");
 saved["prodplan.project.active.v2"]="P2";
 reloaded.api.sync();
 assert.equal(reloaded.hidden(),true,"cannot show P1 baseline in P2");
 saved["prodplan.project.active.v2"]="P1";
 const projects=JSON.parse(saved["prodplan.projects.v2"]);
 projects[0].revision=8;
 saved["prodplan.projects.v2"]=JSON.stringify(projects);
 reloaded.api.sync();
 assert.equal(reloaded.hidden(),true,"model revision invalidates reference");
 assert.equal(reloaded.api.snapshot,null);
 assert(ui.styles[0].textContent.includes("#durDelta"));
 assert(!ui.styles[0].textContent.includes("#dur{"),"large KPI must not be hidden");
 console.log("KPI_FIRST_BEST_FRESH_HIDE_CONTINUE_FREEZE_RELOAD_PROJECT_SCOPE_PASS");
 const legacy=createStore();
 const list=JSON.parse(legacy["prodplan.projects.v2"]);
 list[0].lastPlan=plan(4355);
 legacy["prodplan.projects.v2"]=JSON.stringify(list);
 const existing=env(legacy);
 existing.button.click("Continue optimization");
 assert.equal(existing.api.snapshot.metrics.duration,4355,"legacy accepted best adopted");
 assert.equal(existing.api.snapshot.compare,true);
 existing.display(plan(4375));
 assert.equal(existing.delta.durDelta.textContent,"20");
 existing.display(plan(4300));
 assert.equal(existing.delta.durDelta.textContent,"-55");
 console.log("KPI_FIRST_BEST_LEGACY_INITIAL_ADOPTION_AND_MONOTONIC_DELTAS_PASS");
}
main().catch(e=>{console.error(e);process.exitCode=1});
