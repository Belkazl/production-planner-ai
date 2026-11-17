import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {JSDOM} from "jsdom";
const stop=readFileSync("stop-ui.js","utf8");
const fresh=readFileSync("restart-optimizer-ui.js","utf8");
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const best={ok:true,valid:true,partial:false,duration_minutes:4438,operator_wait_minutes:12000,
 machine_idle_minutes:800,batch_count:118,operations:[{order:"QA_2601",start_min:0,end_min:32}]};
async function until(f,ms=2400){const deadline=Date.now()+ms;while(Date.now()<deadline){
 if(f())return true;await sleep(12);}throw Error("WAIT_EXPIRED");}
function fixture({progressInitiallyFails=true,reset409=false,healthyAfterFailure=false}={}){
 const dom=new JSDOM('<!doctype html><html><body>'+
 '<div id="meta">Saved optimization · 15.10.26 · 07:43</div>'+
 '<span id="valid">Ready to optimize</span><div id="validator"></div>'+
 '<div id="planView"><div class="toolbar"></div><button data-mode="best">Best found</button>'+
 '<button data-mode="candidate">Candidate plan</button></div>'+
 '<button id="opt">Continue optimization</button>'+
 '<div id="ppOptimizerCandidateStatus"></div>'+
 '</body></html>',{url:"https://app.liftorbit.app/",runScripts:"outside-only",pretendToBeVisual:true});
 const w=dom.window;w.Response=Response;
 const nativeTimer=w.setTimeout.bind(w);
 // Clock acceleration only for this test fixture: three network retry delays
 // should not cause slow CI, but the reconnect decision and event ordering stay real.
 w.setTimeout=(fn,delay,...args)=>nativeTimer(fn,Math.min(delay||0,18),...args);
 let tries=0,resets=0,starts=0,stopRequests=0,allowHealthy=!progressInitiallyFails,progressRunning=healthyAfterFailure;
 w.__ppOptimizerCommittedPlan=best;w.__ppTabPlan=best;
 w.eval("var model={orders:[{id:'QA_2601'}],equipment:[{id:'EQ'}]};var modelReady=true;var busy=false;var hasResult=true;");
 w.renderPlan=()=>{};w.renderKpisWithDelta=()=>{};
 const btn=w.document.getElementById("opt");btn.onclick=async()=>{starts++};
 w.fetch=async(path,options={})=>{
  const p=String(path);
  if(p.includes("/api/plan-progress")){
   tries++;
   if(!allowHealthy)
    return new Response(JSON.stringify({ok:false,error:"ga_progress_unavailable"}),{status:503});
   return new Response(JSON.stringify({ok:true,running:progressRunning,phase:progressRunning?"running":"idle",
    percent:progressRunning?25:0,best_preview:progressRunning?best:null}),{status:200});
  }
  if(p.includes("/api/optimizer-reset")){
   resets++;
   return new Response(JSON.stringify(reset409
    ?{ok:false,error:"optimization_running_stop_first"}
    :{ok:true,reset:true,run:0,total_generations:0}),
    {status:reset409?409:200});
  }
  if(p.includes("/api/optimizer-stop")){
   stopRequests++;progressRunning=false;
   return new Response(JSON.stringify({ok:true,stopped:true,best_preview:best,variants:[{plan:best}]}),{status:200});
  }
  throw Error("UNEXPECTED_URL "+p);
 };
 w.eval(stop);w.eval(fresh);
 return{w,dom,btn,oldPlan:best,get fresh(){return w.document.getElementById("ppOptimizerStartOver")},
 get stop(){return w.document.getElementById("ppStopOptimizer")},
 get debug(){return w.__PP_STOP_DEBUG__()},
 get tries(){return tries},get resets(){return resets},get starts(){return starts},
 get stopRequests(){return stopRequests},
 allowHealthy(running=false){allowHealthy=true;progressRunning=running},
 close:()=>dom.window.close()
 };
}
test("Saved plan: failed progress checks unlock Start optimization again instead of permanent disabled button",async()=>{
 const q=fixture();
 try{
  assert.equal(q.fresh.disabled,true,"during initial read-only check restart may be gated");
  assert.equal(q.btn.textContent,"Continue optimization");
  await until(()=>q.debug.reconnecting===false);
  assert.equal(q.debug.remotePhase,"unavailable");
  assert.equal(q.debug.remoteFailureCount,3,"bounded retries");
  assert.equal(q.debug.running,false);
  assert.equal(q.fresh.disabled,false,"fresh optimization must not stay disabled after status failure");
  assert.equal(q.btn.disabled,false,"continue remains available, server is authoritative");
  assert.equal(q.btn.textContent,"Continue optimization");
  assert.equal(q.w.__ppOptimizerCommittedPlan.duration_minutes,4438,"existing saved plan must stay unchanged");
  assert.match(q.w.document.getElementById("valid").textContent,/status unavailable|состояние недоступно/);
  await q.fresh.onclick();
  assert.equal(q.resets,1,"new search must call the guarded reset endpoint");
  assert.equal(q.starts,1,"after server approves reset the primary action starts new GA");
  console.log("GA_RECONNECT_FAILURE_UNLOCKS_BOTH_ACTIONS_PASS");
 }finally{q.close();}
});
test("HTTP409 means GA still running: restart must not reset data and must reattach Stop and percent",async()=>{
 const q=fixture({reset409:true,healthyAfterFailure:true});
 try{
  await until(()=>q.debug.reconnecting===false);
  assert.equal(q.fresh.disabled,false);
  q.allowHealthy(true);
  await q.fresh.onclick();
  await until(()=>q.debug.running===true);
  assert.equal(q.resets,1);
  assert.equal(q.starts,0,"second GA must never start while server says active");
  assert.equal(q.btn.disabled,true);
  assert.equal(q.fresh.disabled,true);
  assert.equal(q.stop.disabled,false);
  assert.equal(q.stop.classList.contains("pp-on"),true);
  assert.equal(q.debug.remotePercent,25);
  assert.equal(q.w.__ppOptimizerCommittedPlan.duration_minutes,4438,"saved plan never removed by 409");
  console.log("GA_RESET_409_REATTACHES_RUNNING_JOB_PASS");
  await q.stop.onclick();
  assert.equal(q.stopRequests,1);
 }finally{q.close();}
});
test("normal idle status unlocks Start again without requiring failure fallback",async()=>{
 const q=fixture({progressInitiallyFails:false});
 try{
  await until(()=>q.debug.reconnecting===false);
  assert.equal(q.debug.remoteFailureCount,0);
  assert.equal(q.fresh.disabled,false);
  assert.equal(q.btn.disabled,false);
  assert.equal(q.debug.running,false);
  console.log("GA_IDLE_RECONNECT_UNLOCKS_SAVED_PLAN_RESTART_PASS");
 }finally{q.close();}
});
test("normal running status keeps Start again disabled and Stop available",async()=>{
 const q=fixture({progressInitiallyFails:false,healthyAfterFailure:true});
 try{
  await until(()=>q.debug.running===true);
  assert.equal(q.fresh.disabled,true);
  assert.equal(q.btn.disabled,true);
  assert.equal(q.stop.disabled,false);
  await q.fresh.onclick();
  assert.equal(q.resets,0);
  console.log("GA_ACTIVE_JOB_STILL_PROTECTS_RESET_PASS");
  await q.stop.onclick();
 }finally{q.close();}
});