import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-decimal-test/node_modules/playwright-core");
const base="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
let page,started=false,phase="register";
try{
 page=await browser.newPage({viewport:{width:1440,height:900}});
 const baseline=process.env.DECIMAL_BASELINE==="1";
 const cdp=await page.context().newCDPSession(page);
 await cdp.send("Network.enable");
 const samples=[],streamIds=new Set(),responses=[],errors=[];
 page.on("pageerror",e=>errors.push(e.name||"Error"));
 cdp.on("Network.requestWillBeSent",e=>{if(new URL(e.request.url).pathname==="/api/plan-events")streamIds.add(e.requestId)});
 cdp.on("Network.responseReceived",e=>{if(streamIds.has(e.requestId))responses.push(e.response.status)});
 cdp.on("Network.eventSourceMessageReceived",e=>{
  if(!streamIds.has(e.requestId)||e.eventName!=="progress")return;
  try{const p=JSON.parse(e.data);if(Number.isFinite(p.percent))samples.push({source:p.percent,phase:p.phase,t:e.timestamp})}catch{}
 });
 const first=await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 assert.equal(first.status(),200);
 const request=(path,method="GET",body)=>page.evaluate(async({path,method,body})=>{
  const r=await fetch(path,{method,credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json","Accept":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  let data={};try{data=await r.json()}catch{}
  return {status:r.status,data};
 },{path,method,body});
 const email="decimal-progress-qa-"+randomUUID()+"@liftorbit.invalid",password=randomBytes(25).toString("base64url");
 assert.equal((await request("/api/auth/register","POST",{email,password,company:"Synthetic decimal GA QA"})).status,200);
 const id="prj_decimal_"+randomUUID().replaceAll("-","").slice(0,13);
 const resource=(kind,id)=>({resource_type:kind,resource_ref:id,resource_refs:[id],match_mode:"specific",quantity:1});
 const names=["QA Press A","QA Press B","QA Dryer A","QA Dryer B","QA Glaze A","QA Glaze B","QA Decoration A","QA Decoration B","QA Firing A","QA Firing B","QA Firing C","QA Sorting","QA Packing A","QA Packing B"];
 const kinds=["pressing","pressing","drying","drying","glazing","glazing","decoration","decoration","firing","firing","firing","sorting","packaging","packaging"];
 const equipment=names.map((name,i)=>({id:"EQ-"+i,name,kind:kinds[i],capacity:110,capacity_unit:"m2"}));
 const opEquipment=[0,2,4,6,8,11,12];
 const model={scheduler_mode:"resource",start:"2026-11-17T08:00:00",quantity_unit:"m2",
  equipment,employees:Array.from({length:6},(_,i)=>({id:"EMP-"+i,name:"Operator "+i,shift:"day"})),shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},
  orders:[900,780,660,950,830,720].map((quantity,i)=>({id:"O"+(i+1),quantity,unit:"m2",technical_process_id:"CERAMIC_7_STAGES",parameters:{color:String(i%4)}})),
  technical_processes:[{id:"CERAMIC_7_STAGES",name:"Seven synthetic ceramic stages",operations:Array.from({length:7},(_,i)=>({id:"STAGE-"+i,name:kinds[opEquipment[i]],sequence:i+1,duration_min:10,resource_requirements:[resource("equipment","EQ-"+opEquipment[i]),resource("employee","EMP-"+(i%6))]}))}],
  materials:[],setup_rules:[{id:"CERAMIC_COLOR",equipment_ref:"*",setup_parameter:"color",from_state:"*",to_state:"*",duration_min:10,employee_count:0}]};
 const projects=JSON.stringify([{id,name:"Synthetic decimal progress QA",model,revision:1}]);
 await page.evaluate(({id,projects})=>{localStorage.setItem("prodplan.projects.v2",projects);localStorage.setItem("prodplan.project.active.v2",id)},{id,projects});
 assert.equal((await request("/api/db-storage","POST",{storage:{"prodplan.projects.v2":projects,"prodplan.project.active.v2":id}})).status,200);
 phase="planner";
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>typeof model==="object"&&model?.orders?.length===6&&window.__PP_SSE_PROGRESS_V1__?.installed&&window.__PP_OPTIMIZER_DEPTH__?.installed&&document.getElementById("opt"),{},{timeout:30000});
 await page.waitForFunction(()=>window.__PP_STOP_DEBUG__?.().reconnecting===false,null,{timeout:25000});
 const initial=await request("/api/plan-progress");assert.equal(initial.status,200);assert.equal(initial.data.running,false);
 let progressGets=0,streams=0,posts=0;
 page.on("request",r=>{try{const p=new URL(r.url()).pathname;if(p==="/api/plan-progress")progressGets++;if(p==="/api/plan-events")streams++;if(p==="/api/plan"&&r.method()==="POST")posts++}catch{}});
 await page.evaluate(()=>{
  if(!window.__PP_OPTIMIZER_DEPTH__.set("quick"))throw Error("QUICK_MODE_BLOCKED");
 });
 // Capture actual rendered percent from before the native click: the POST
 // handshake can complete after several real SSE events have arrived.
 if(!await page.locator("#opt").isVisible()){
  const planning=page.getByText(/^(Planning|Планирование)$/).first();
  if(await planning.isVisible())await planning.click();
 }
 if(!await page.locator("#opt").isVisible()){
  const plan=page.getByText(/^(Plan|План)$/).first();
  if(await plan.isVisible())await plan.click();
 }
 await page.locator("#opt").waitFor({state:"visible",timeout:10000});
 await page.evaluate(()=>{
  window.__decimalRendered=[];
  let last="";
  const record=(frame)=>{
   const s=window.__PP_SSE_PROGRESS_V1__?.state,label=document.querySelector("#opt .pp-sse-label");
   if(!label||!s||(!s.active&&!s.completed))return;
   const text=label.textContent,shown=label.getClientRects().length>0&&getComputedStyle(label).visibility!=="hidden";
   const key=[s.percent,s.serverTarget,text,shown,frame].join("|");
   if(key===last||window.__decimalRendered.length>=10000)return;
   last=key;
   window.__decimalRendered.push({percent:s.percent,target:s.serverTarget,text,shown,frame,t:performance.now()});
  };
  const observer=new MutationObserver(()=>record(false));
  observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:["aria-valuenow"],childList:true});
  const tick=()=>{record(true);if(!window.__PP_SSE_PROGRESS_V1__?.state.completed)requestAnimationFrame(tick);else observer.disconnect()};
  requestAnimationFrame(tick);
 });
 phase="native_button_click";
 const post=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/plan"&&r.request().method()==="POST",{timeout:30000});
 await page.evaluate(()=>{
  // Same synthetic-account native readiness setup as previously accepted live QA.
  if(typeof modelReady!=="undefined")modelReady=true;
  if(typeof busy!=="undefined")busy=false;
  const b=document.getElementById("opt");b.disabled=false;b.click();
 });
 const accepted=await post;const posted=accepted.request().postDataJSON();
 assert.equal(posted.generations,3);assert.equal(posted.population,6);assert.equal(accepted.status(),202);
 started=true;console.log("DECIMAL_LIVE_JOB_ACCEPTED",JSON.stringify({generations:3,population:6}));
 phase="native_stream";
 const visible=[];
 try{
  const stop=Date.now()+150000;
  while(Date.now()<stop){
   const s=await page.evaluate(()=>({state:window.__PP_SSE_PROGRESS_V1__?.state,text:document.querySelector("#opt .pp-sse-label")?.textContent}));
   if(s.state?.active||s.state?.completed)visible.push({percent:s.state.percent,target:s.state.serverTarget,text:s.text});
   if(s.state?.completed)break;
   await page.waitForTimeout(200);
  }
  const state=await page.evaluate(()=>window.__PP_SSE_PROGRESS_V1__?.state);
  assert(state?.completed,"native SSE completion");
 }catch(e){
  const state=await page.evaluate(()=>window.__PP_SSE_PROGRESS_V1__?.state);
  const status=await page.context().request.get(base+"/api/plan-progress",{headers:{Accept:"application/json"},timeout:10000});
  const body=await status.json().catch(()=>({}));
  console.log("DECIMAL_LIVE_TIMEOUT_DIAGNOSTICS",JSON.stringify({state,streams,responses,posts,errors,events:samples.slice(-6),http:status.status(),worker:{phase:body.phase,running:body.running,percent:body.percent,success:body.success}}));
  throw e;
 }
 phase="verified_result";
 const final=await page.evaluate(async()=>{
  const state=window.__PP_SSE_PROGRESS_V1__.state;
  const r=await fetch("/api/plan-progress");const p=await r.json();
  return {state,valid:p.success===true&&p.result?.valid===true,operations:p.result?.operations?.length,evaluated:p.result?.joint_minibatch?.evaluated??null,text:document.querySelector("#opt .pp-sse-label")?.textContent,rendered:window.__decimalRendered||[]};
 });
 started=false;
 assert(final.valid&&final.operations>0);assert.equal(final.state.percent,100);assert.equal(final.state.networkFinalGets,1);assert(streams>=1);assert.equal(posts,1);
 const running=samples.filter(p=>p.phase!=="completed"&&p.source>0&&p.source<99.99);
 console.log("DECIMAL_RENDER_TRACE",JSON.stringify({server:running.map(x=>({p:x.source,t:Math.round((x.t-(running[0]?.t||0))*1000)})),rendered:final.rendered.filter(x=>x.frame&&x.shown).filter((x,i,a)=>i===0||x.percent!==a[i-1].percent).slice(0,40),observed:final.rendered.filter(x=>!x.frame).filter((x,i,a)=>i===0||x.percent!==a[i-1].percent).slice(0,40),afterPost:visible.filter((x,i,a)=>i===0||x.percent!==a[i-1].percent).slice(0,30)}));
 assert(running.length>0,"observed native running progress");
 const fractional=running.filter(p=>!Number.isInteger(p.source));
 assert.equal(final.evaluated,18,"unchanged Quick candidate slots");
 if(!baseline){
  assert.match(final.text,/100[.,]00%$/);assert(fractional.length>0,"native worker must emit fractional values");
  const allowed=new Set(Array.from({length:18},(_,i)=>Math.min(9999,Math.floor((i+1)*10000/18))/100));
  assert(running.every(p=>allowed.has(p.source)),"every progress event is a real native candidate fraction");
  const observed=final.rendered.filter(v=>v.shown&&v.percent>0&&v.percent<99.99);
  assert(observed.some(v=>v.frame&&!Number.isInteger(v.percent)),"fractional percent actually visible on rendered frame");
  assert(observed.every(v=>v.percent===v.target&&Math.abs(Number(v.text.replace("%","").replace(",","."))-v.percent)<1e-8&&/\d+[.,]\d{2}%$/.test(v.text)),"visible labels match confirmed targets");
  assert(running.every((p,i)=>i===0||p.source>=running[i-1].source),"progress monotonic");
  assert(progressGets<=4,"no repeated status polling");
 }
 console.log(baseline?"DECIMAL_BASELINE_NATIVE_CLICK_PASS":"DECIMAL_LIVE_NATIVE_SSE_PASS",JSON.stringify({events:samples.length,running:running.length,fractional:fractional.length,first:fractional[0]?.source,visible:final.rendered.filter(v=>v.frame&&v.shown&&!Number.isInteger(v.percent)).length,evaluated:final.evaluated,final:final.text,valid:final.valid,streams,progressGets,responses,errors}));
}catch(e){
 console.log("DECIMAL_LIVE_FAILED",phase,e?.name==="AssertionError"?"AssertionError":e?.name==="TimeoutError"?"TimeoutError":"Error");
 if(e?.name==="AssertionError")console.log("DECIMAL_LIVE_ASSERTION",String(e.message).slice(0,180));
 process.exitCode=6;
}finally{
 if(started&&page)try{await page.evaluate(()=>fetch("/api/optimizer-stop",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}))}catch{}
 await browser.close();
}
