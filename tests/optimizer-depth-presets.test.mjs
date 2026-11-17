import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {JSDOM} from "jsdom";

const stopSource=readFileSync("stop-ui.js","utf8");
const restartSource=readFileSync("restart-optimizer-ui.js","utf8");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(pred,max=2500){const end=Date.now()+max;while(Date.now()<end){if(pred())return;await sleep(15)}throw Error("DEPTH_WAIT_EXPIRED")}
function fixture({defer=false}={}){
 const html=[
 '<!doctype html><html><head></head><body><div id="ppProtectedAccount"></div>',
 '<select id="ppLanguageSelect"><option value="en">English</option><option value="ru">Русский</option></select>',
 '<span id="meta">Saved optimization · 15.10.26</span><span id="valid">Ready to optimize</span>',
 '<div id="validator"></div><div id="ppOptimizerCandidateStatus"></div>',
 '<div id="planView"><div class="toolbar"><label>Optimize for: <select><option>Duration</option></select></label>',
 '<button data-mode="best">Best found</button><button data-mode="candidate">Candidate plan</button></div></div>',
 '<button id="opt" type="button">Continue optimization</button></body></html>'
 ].join("");
 const dom=new JSDOM(html,{url:"https://app.liftorbit.app/",runScripts:"outside-only",pretendToBeVisual:true});
 const w=dom.window,doc=w.document,btn=doc.getElementById("opt");
 w.Response=Response;w.Request=Request;w.AbortController=AbortController;
 w.__PP_LANGUAGE__={current:"en"};
 w.eval("var model={orders:[{id:'QA1'}],equipment:[{id:'EQ1'}]};var modelReady=true;var hasResult=true;var busy=false;");
 w.renderPlan=()=>{};w.renderKpisWithDelta=()=>{};w.clearPlan=()=>{};
 w.localStorage.setItem("prodplan.project.active.v2","project1");
 w.localStorage.setItem("prodplan.projects.v2",JSON.stringify([{id:"project1",model:{orders:[{id:"QA1"}]},revision:1}]));
 const calls={plan:[],reset:0,stop:0};let pending=null;
 w.fetch=async (input,init={})=>{
  const raw=typeof input==="string"?input:input.url;
  const path=new URL(raw,"https://app.liftorbit.app").pathname;
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
  if(path==="/api/plan-progress")return reply({ok:true,running:false,phase:"idle"});
  if(path==="/api/optimizer-reset"){calls.reset++;return reply({ok:true,reset:true})}
  if(path==="/api/optimizer-stop"){calls.stop++;return reply({ok:true,stopped:true,best_preview:null,variants:[]})}
  if(path==="/api/plan"){
   calls.plan.push(JSON.parse(init.body));
   if(defer)return new Promise(resolve=>pending=resolve);
   return reply({ok:true,valid:true,operations:[{order:"QA1",start_min:0,end_min:5}],duration_minutes:100});
  }
  throw Error("UNEXPECTED_PATH "+path);
 };
 btn.onclick=async()=>{
  btn.disabled=true;
  try{return (await w.fetch("/api/plan",{method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({generations:60,population:32,continue:!w.__ppFreshRestartPending,
    objective:"duration",resume_plan:{order_sequence:["QA1"]}})})).json()}
  finally{btn.disabled=false}
 };
 w.eval(stopSource);
 w.eval(restartSource);
 return {
  w,doc,dom,btn,calls,
  get control(){return doc.getElementById("ppOptimizerDepthSelect")},
  get fresh(){return doc.getElementById("ppOptimizerStartOver")},
  get stop(){return doc.getElementById("ppStopOptimizer")},
  get depth(){return w.__PP_OPTIMIZER_DEPTH__.get()},
  async ready(){await until(()=>w.__PP_STOP_DEBUG__()?.reconnecting===false)},
  choose(mode){this.control.value=mode;this.control.dispatchEvent(new w.Event("change",{bubbles:true}))},
  finish(){if(!pending)throw Error("NO_PENDING_PLAN");pending(new Response(JSON.stringify({ok:true}),{status:200}))},
  close(){dom.window.close()}
 };
}
test("setting is visible in Gantt toolbar, baseline 60x32 preserved, explanation and modes provided",async()=>{
 const q=fixture();try{
  await q.ready();
  assert(q.doc.querySelector("#planView .toolbar #ppOptimizerDepth"));
  assert.deepEqual([...q.control.options].map(o=>o.value),["quick","standard","thorough","maximum"]);
  assert.equal(q.depth.mode,"standard");
  assert.equal(q.depth.generations,60);assert.equal(q.depth.population,32);
  assert.match(q.doc.getElementById("ppOptimizerDepthLabel").textContent,/Optimization depth/);
  assert.match(q.doc.getElementById("ppOptimizerDepthDetail").textContent,/60 generations × 32 candidates/);
  assert.match(q.doc.getElementById("ppOptimizerDepthHelpText").textContent,/not guaranteed/);
  q.choose("maximum");
  assert.equal(q.depth.generations,360);assert.equal(q.depth.population,64);
  assert.match(q.doc.getElementById("ppOptimizerDepthDetail").textContent,/23,040 evaluations/);
  assert.equal(q.w.localStorage.getItem("pp.optimizer.depth.v1.project1"),"maximum");
  console.log("DEPTH_DEFAULT_EXPLANATION_AND_PERSISTENCE_PASS");
 }finally{q.close()}
});
test("each UI continuation sends selected generation and population numbers to existing GA",async()=>{
 const q=fixture();try{
  await q.ready();
  for(const [mode,gens,pop] of [["quick",30,24],["standard",60,32],["thorough",180,48],["maximum",360,64]]){
   q.choose(mode);await q.btn.onclick({type:"click"});
   const args=q.calls.plan.at(-1);
   assert.equal(args.generations,gens);assert.equal(args.population,pop);
   assert.equal(args.continue,true);assert.equal(args.objective,"duration");
   assert.deepEqual(args.resume_plan.order_sequence,["QA1"]);
  }
  assert.equal(q.calls.plan.length,4);assert.equal(q.calls.reset,0);
  console.log("DEPTH_UI_TO_GA_PARAMS_ALL_MODES_PASS");
 }finally{q.close()}
});
test("Start optimization again preserves project state but applies chosen depth",async()=>{
 const q=fixture();try{
  await q.ready();q.choose("thorough");
  const before=q.w.localStorage.getItem("prodplan.projects.v2");
  await q.fresh.onclick();
  assert.equal(q.calls.reset,1);
  assert.equal(q.calls.plan.length,1);
  assert.equal(q.calls.plan[0].generations,180);
  assert.equal(q.calls.plan[0].population,48);
  assert.equal(q.calls.plan[0].continue,false);
  assert.equal(q.w.localStorage.getItem("prodplan.projects.v2"),before);
  console.log("DEPTH_FRESH_START_REUSES_SERVER_RESET_PASS");
 }finally{q.close()}
});
test("per-project preferences and English/Russian translations",async()=>{
 const q=fixture();try{
  await q.ready();q.choose("thorough");
  q.w.localStorage.setItem("prodplan.project.active.v2","project2");
  q.w.dispatchEvent(new q.w.Event("focus"));assert.equal(q.control.value,"standard");
  q.choose("quick");
  q.w.localStorage.setItem("prodplan.project.active.v2","project1");
  q.w.dispatchEvent(new q.w.Event("focus"));assert.equal(q.control.value,"thorough");
  q.w.__PP_LANGUAGE__.current="ru";q.doc.getElementById("ppLanguageSelect").value="ru";
  q.w.dispatchEvent(new q.w.CustomEvent("pp:language-changed",{detail:{language:"ru"}}));
  assert.equal(q.doc.getElementById("ppOptimizerDepthLabel").textContent,"Тщательность оптимизации");
  assert.match(q.doc.getElementById("ppOptimizerDepthDetail").textContent,/180 поколений × 48 вариантов/);
  q.w.__PP_LANGUAGE__.current="en";q.doc.getElementById("ppLanguageSelect").value="en";
  q.w.dispatchEvent(new q.w.CustomEvent("pp:language-changed",{detail:{language:"en"}}));
  assert.equal(q.doc.getElementById("ppOptimizerDepthLabel").textContent,"Optimization depth");
  console.log("DEPTH_PROJECT_SCOPE_RU_EN_PASS");
 }finally{q.close()}
});
test("Stop remains active with a deferred job, choice locked during GA",async()=>{
 const q=fixture({defer:true});try{
  await q.ready();q.choose("thorough");
  const started=q.btn.onclick({type:"click"});
  await until(()=>q.calls.plan.length===1);
  assert.equal(q.calls.plan[0].generations,180);
  assert.equal(q.control.disabled,true);
  assert.equal(q.fresh.disabled,true);
  assert.equal(q.stop.disabled,false);
  q.choose("maximum");assert.equal(q.depth.mode,"thorough");
  await q.stop.onclick();
  assert.equal(q.calls.stop,1);
  q.finish();await started;
  assert.equal(q.depth.mode,"thorough");
  console.log("DEPTH_STOP_AND_RUNNING_LOCK_PASS");
 }finally{q.close()}
});
test("direct API plan requests cannot be silently rewritten by the UI preference",async()=>{
 const q=fixture();try{
  await q.ready();q.choose("maximum");
  await q.w.fetch("/api/plan",{method:"POST",body:JSON.stringify({generations:7,population:5})});
  assert.equal(q.calls.plan[0].generations,7);
  assert.equal(q.calls.plan[0].population,5);
  assert.equal(q.depth.lastRun,null);
  console.log("DEPTH_DIRECT_API_UNCHANGED_PASS");
 }finally{q.close()}
});