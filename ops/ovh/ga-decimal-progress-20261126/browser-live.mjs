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
 await page.addInitScript(()=>{
  window.__decimalSamples=[];
  const Original=window.EventSource;
  window.EventSource=class extends Original{
   constructor(...args){
    super(...args);
    if(new URL(args[0],location.href).pathname!=="/api/plan-events")return;
    this.addEventListener("progress",e=>{
     let p;try{p=JSON.parse(e.data)}catch{return}
     queueMicrotask(()=>{
      const state=window.__PP_SSE_PROGRESS_V1__?.state;
      if(!state?.active&&!state?.completed)return;
      window.__decimalSamples.push({source:p.percent,phase:p.phase,display:state.percent,text:document.querySelector("#opt .pp-sse-label")?.textContent});
     });
    });
   }
  };
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
 const res=(type,ref)=>({resource_type:type,resource_ref:ref,resource_refs:[ref],match_mode:"specific",quantity:1,unit:type==="equipment"?"pcs":"чел.",consumption_rule:"during_operation"});
 // Same bounded, machine-only model that passed the real native Quick diversity gate.
 const kind="synthetic_diversity_machine", process="SYNTHETIC_DIVERSITY_PROCESS";
 const model={scheduler_mode:"resource",quantity_unit:"шт.",start:"2026-11-25T00:00:00",
  employees:[],materials:[],setup_rules:[],shifts:{},constraints:[],
  equipment:Array.from({length:2},(_,i)=>({id:"SYNTHETIC_MACHINE_"+i,name:"Invented test machine "+i,kind,capacity:6,capacity_unit:"шт."})),
  orders:Array.from({length:6},(_,i)=>({id:"SYNTHETIC_ORDER_"+i,quantity:12,unit:"шт.",technical_process_id:process})),
  technical_processes:[{id:process,name:"Invented process",operations:[{id:"SYNTHETIC_STEP",name:"Invented step",sequence:1,duration_min:2,resource_requirements:[{resource_type:"equipment",match_mode:"any",resource_ref:"kind:"+kind,quantity:1,unit:"шт.",consumption_rule:"during_operation"}]}]}]};
 assert.equal((await request("/api/db-storage","POST",{storage:{"prodplan.projects.v2":JSON.stringify([{id,name:"Synthetic decimal progress QA",model,revision:1}]),"prodplan.project.active.v2":id}})).status,200);
 phase="planner";
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>typeof model==="object"&&model?.orders?.length===6&&window.__PP_SSE_PROGRESS_V1__?.installed&&document.getElementById("opt"),{},{timeout:25000});
 await page.evaluate(()=>{document.documentElement.lang="en";if(window.__PP_LANGUAGE__?.current==="ru")document.documentElement.lang="ru"});
 let progressGets=0,streams=0;
 page.on("request",r=>{try{const p=new URL(r.url()).pathname;if(p==="/api/plan-progress")progressGets++;if(p==="/api/plan-events")streams++}catch{}});
 phase="native_run";
 // APIRequestContext shares this isolated account's cookies, but bypasses
 // the browser's optimization-depth fetch wrapper. Submit exactly 35 slots.
 const posted={generations:5,population:7,seed:1729,objective:"duration",continue:false,__pp_async_start:true};
 await page.evaluate(()=>window.__PP_SSE_PROGRESS_V1__.start());
 const accepted=await page.context().request.post(base+"/api/plan",{data:posted,headers:{Origin:base,"Sec-Fetch-Site":"same-origin",Accept:"application/json"},timeout:30000});
 const data=await accepted.json();
 assert.equal(accepted.status(),202);assert.equal(data.started,true);started=true;
 console.log("DECIMAL_LIVE_JOB_ACCEPTED",JSON.stringify({generations:posted.generations,population:posted.population}));
 try{
  await page.waitForFunction(()=>window.__PP_SSE_PROGRESS_V1__?.state.completed===true,{},{timeout:100000});
 }catch(e){
  const state=await page.evaluate(()=>({active:window.__PP_SSE_PROGRESS_V1__?.state.active,connected:window.__PP_SSE_PROGRESS_V1__?.state.connected,percent:window.__PP_SSE_PROGRESS_V1__?.state.percent,phase:window.__PP_SSE_PROGRESS_V1__?.state.phase,reconnects:window.__PP_SSE_PROGRESS_V1__?.state.reconnects,events:window.__PP_SSE_PROGRESS_V1__?.state.events,samples:window.__decimalSamples.slice(-6)}));
  const status=await page.context().request.get(base+"/api/plan-progress",{headers:{Accept:"application/json"},timeout:10000});
  const body=await status.json().catch(()=>({}));
  console.log("DECIMAL_LIVE_TIMEOUT_DIAGNOSTICS",JSON.stringify({state,http:status.status(),worker:{phase:body.phase,running:body.running,percent:body.percent,success:body.success}}));
  throw e;
 }
 phase="verified_result";
 const final=await page.evaluate(async()=>{
  const s=window.__PP_SSE_PROGRESS_V1__.state;
  const r=await fetch("/api/plan-progress");
  const p=await r.json();
  return {state:s,valid:p.success===true&&p.result?.valid===true,operations:p.result?.operations?.length,evaluated:p.result?.joint_minibatch?.evaluated??null,text:document.querySelector("#opt .pp-sse-label")?.textContent,samples:window.__decimalSamples};
 });
 started=false;
 assert(final.valid&&final.operations>0,"valid final schedule");
 assert.equal(final.state.percent,100);
 assert.match(final.text,/100[.,]00%$/);
 assert.equal(final.state.networkFinalGets,1);
 assert(streams>=1);
 assert(progressGets<=3,"no repeated status polling");
 const running=final.samples.filter(p=>p.phase!=="completed"&&Number.isFinite(p.source)&&p.source>0&&p.source<99.99);
 const fractional=running.filter(p=>!Number.isInteger(p.source));
 assert(fractional.length>0,"real worker must emit fractional candidate progress");
 assert(running.every(p=>p.display===p.source&&Math.abs(Number(p.text.replace("%","").replace(",","."))-p.source)<1e-8&&/\d+[.,]\d{2}%$/.test(p.text)),"display must match actual SSE values");
 assert(running.every((p,i)=>i===0||p.source>=running[i-1].source),"progress must not go backwards");
 assert.equal(final.evaluated,35,"backend must use the requested 35 native candidate slots");
 if(Number.isInteger(final.evaluated)&&final.evaluated>0){
   const allowed=new Set(Array.from({length:final.evaluated},(_,i)=>Math.min(9999,Math.floor((i+1)*10000/final.evaluated))/100));
   assert(running.every(p=>allowed.has(p.source)),"progress must match actual evaluated candidate slots");
 }
 console.log("DECIMAL_LIVE_NATIVE_SSE_PASS",JSON.stringify({samples:running.length,fractional:fractional.length,first:fractional[0]?.source,last:running.at(-1)?.source,evaluated:final.evaluated,final:final.text,valid:final.valid,streams,progressGets}));
}catch(e){
 console.log("DECIMAL_LIVE_FAILED",phase,e?.name==="AssertionError"?"AssertionError":e?.name==="TimeoutError"?"TimeoutError":"Error");
 if(e?.name==="AssertionError")console.log("DECIMAL_LIVE_ASSERTION",String(e.message).slice(0,180));
 process.exitCode=6;
}finally{
 if(started&&page)try{await page.evaluate(()=>fetch("/api/optimizer-stop",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}))}catch{}
 await browser.close();
}
