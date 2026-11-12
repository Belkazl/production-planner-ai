// Browser regression for the actual OVH compatibility page: two distinct
// mid-run previews must render without changing the accepted or saved plan.
const assert=require("node:assert/strict");
const {chromium}=require("playwright");
const {randomUUID,randomBytes}=require("node:crypto");
const base="http://127.0.0.1:18082",ui="http://localhost:18082";
const headers={origin:"https://app.liftorbit.app","sec-fetch-site":"same-origin","content-type":"application/json"};
(async()=>{
 const email="live-preview-browser-"+randomUUID()+"@liftorbit.invalid";
 const r=await fetch(base+"/api/auth/register",{method:"POST",headers,body:JSON.stringify({
  email,password:randomBytes(32).toString("hex"),company:"Disposable live-preview QA"
 })});
 assert.equal(r.status,200);
 const cookie=(r.headers.get("set-cookie")||"").split(";")[0];assert(cookie);
 const eq="QA_MACHINE",emp="QA_EMPLOYEE";
 const req=(resource_type,id)=>({resource_type,resource_ref:id,resource_refs:[id],match_mode:"specific",quantity:1});
 const model={
  scheduler_mode:"resource",start:"2026-11-11T08:00:00",
  equipment:[{id:eq,name:"QA Machine",capacity:10,capacity_unit:"pcs",kind:"workstation"}],
  employees:[{id:emp,name:"QA Operator",shift:"day"}],
  shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},
  orders:[{id:"A",quantity:5,unit:"pcs",technical_process_id:"TP",parameters:{color:"a"}},
   {id:"B",quantity:5,unit:"pcs",technical_process_id:"TP",parameters:{color:"b"}}],
  technical_processes:[{id:"TP",name:"QA Press",operations:[{id:"O",name:"Press",duration_min:30,sequence:1,
   resource_requirements:[req("equipment",eq),req("employee",emp)]}]}],
  setup_rules:[],materials:[]
 };
 const project="qa-live-"+randomUUID();
 const initial=JSON.stringify([{id:project,name:"Disposable QA",revision:1,model}]);
 const store=async projects=>{
  const response=await fetch(base+"/api/db-storage",{method:"POST",headers:{...headers,cookie},
   body:JSON.stringify({storage:{"prodplan.projects.v2":projects,"prodplan.project.active.v2":project}})});
  assert.equal(response.status,200);
 };
 await store(initial);
 const start=await fetch(base+"/api/plan",{method:"POST",headers:{...headers,cookie},
  body:JSON.stringify({generations:2,population:4,seed:18,__pp_async_start:true})});
 assert.equal(start.status,202);
 let baseline=null;
 for(let i=0;i<25;i++){
  await new Promise(resolve=>setTimeout(resolve,700));
  const resp=await fetch(base+"/api/plan-progress",{headers:{...headers,cookie}});
  assert.equal(resp.status,200);
  const data=await resp.json();
  if(data.success&&data.result?.operations?.length){baseline=data.result;break}
  if(!data.running&&["failed","timed_out","invalid","interrupted"].includes(data.phase))
   throw Error("qa_model_generation_failed:"+String(data.error||data.phase));
 }
 assert(baseline?.operations?.length,"must generate a complete native plan for the Gantt");
 // A preview keeps the real optimizer's complete output schema: the native
 // renderPlan requires more than a simplified operations array.
 const buildPlan=(duration,shift)=>{
  const p=structuredClone(baseline);
  p.valid=true;p.ok=true;p.partial=false;p.duration_minutes=duration;
  p.operations=p.operations.map(o=>({...o,
   start_min:Number(o.start_min||0)+shift,end_min:Number(o.end_min||0)+shift}));
  return p;
 };
 const orig=JSON.stringify([{id:project,name:"Disposable QA",revision:1,model,lastPlan:baseline}]);
 await store(orig);
 console.log("LIVE_PREVIEW_NATIVE_FIXTURE_READY",JSON.stringify({operations:baseline.operations.length}));
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const ctx=await browser.newContext({viewport:{width:1510,height:990},extraHTTPHeaders:{
   cookie,origin:"https://app.liftorbit.app","sec-fetch-site":"same-origin"}});
  const page=await ctx.newPage(),errors=[];
  page.on("pageerror",e=>errors.push(String(e.message||e).slice(0,130)));
  let mockRequests=0,allowMock=false;
  await page.route("**/api/plan-progress*",async route=>{
   if(!allowMock){
    return route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({ok:true,running:false,phase:"idle",best_preview:null,candidate_preview:null})});
   }
   mockRequests++;
   const updated=mockRequests>=2;
   const data={ok:true,running:true,phase:"running",percent:updated?24:12,
    done:updated?24:12,total:100,best_preview:buildPlan(updated?110:125,updated?22:10),
    candidate_preview:buildPlan(updated?115:135,updated?32:15)};
   await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data)});
  });
  const res=await page.goto(ui+"/",{waitUntil:"domcontentloaded",timeout:60000});
  assert.equal(res.status(),200);
  await page.waitForTimeout(900);
  allowMock=true;
  await page.evaluate(()=>{
   const key=localStorage.getItem("prodplan.project.active.v2");
   const projects=JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]");
   const p=projects.find(x=>x.id===key);
   if(!p||!p.model||!p.lastPlan)throw Error("synthetic_project_not_loaded");
   if(typeof model!=="undefined")model=p.model;
   if(typeof modelReady!=="undefined")modelReady=true;
   if(typeof hasResult!=="undefined")hasResult=true;
   window.__ppOptimizerCommittedPlan=p.lastPlan;
   window.__ppTabPlan=p.lastPlan;window.__ppGenericPlan=p.lastPlan;
   if(typeof renderPlan==="function")renderPlan(p.lastPlan);
   window.dispatchEvent(new Event("pp:optimizer-started"));
  });
  try{
   await page.waitForFunction(()=>window.__PP_OVH_LIVE_PREVIEW_BRIDGE__?.getState()?.shown>=2,null,{timeout:14000});
  }catch(e){
   const detail=await page.evaluate(()=>({
    bridge:window.__PP_OVH_LIVE_PREVIEW_BRIDGE__?.getState?.()||null,
    renderType:typeof renderPlan,chartBars:document.querySelectorAll(".pg2-bar").length,
    acceptedDuration:window.__ppOptimizerCommittedPlan?.duration_minutes??null,
    status:document.getElementById("valid")?.textContent?.slice(0,40)
   }));
   console.log("LIVE_PREVIEW_BROWSER_DIAGNOSTIC",JSON.stringify({detail,errors}));
   throw e;
  }
  const state=await page.evaluate(()=>window.__PP_OVH_LIVE_PREVIEW_BRIDGE__.getState());
  console.log("LIVE_PREVIEW_BROWSER_STATE",JSON.stringify(state));
  assert.equal(state.active,true);
  assert.equal(state.acceptedUnchanged,true);
  assert.equal(state.intervalMs,2000);
  assert(state.shown>=2&&state.hasBest);
  assert(mockRequests>=2);
  // Candidate display is optional on real GA, but when provided it must be clickable.
  const candidate=page.locator('[data-mode="candidate"]').first();
  if(await candidate.count()){
   await candidate.click({timeout:8000});
   const mode=await page.evaluate(()=>window.__PP_OVH_LIVE_PREVIEW_BRIDGE__.getState().mode);
   assert.equal(mode,"candidate");
   assert((await page.evaluate(()=>window.__PP_OVH_LIVE_PREVIEW_BRIDGE__.getState().shown))>=3);
  }
  const banner=await page.locator("#ppOptimizerCandidateStatus").first().textContent();
  assert(/временный просмотр/.test(banner));
  await page.evaluate(()=>window.dispatchEvent(new Event("pp:optimizer-stopped")));
  const ended=await page.evaluate(()=>window.__PP_OVH_LIVE_PREVIEW_BRIDGE__.getState());
  assert.equal(ended.active,false);
  const database=await fetch(base+"/api/db-storage",{headers:{...headers,cookie}});
  assert.equal(database.status,200);
  const stored=(await database.json()).storage["prodplan.projects.v2"];
  assert.equal(stored,orig,"saved project and accepted plan must never be persisted as a preview");
  assert.deepEqual(errors,[],"no browser page errors");
  console.log("LIVE_PREVIEW_BROWSER_TWO_DISTINCT_GANTTS_AND_SAVED_PLAN_UNCHANGED_OK");
 }finally{await browser.close()}
})().catch(e=>{console.error("LIVE_PREVIEW_BROWSER_FAILED",String(e.stack||e).slice(0,600));process.exit(1)});
