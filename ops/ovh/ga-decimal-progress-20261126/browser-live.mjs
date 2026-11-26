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
 const model={scheduler_mode:"resource",start:"2026-11-25T08:00:00",quantity_unit:"pcs",
  orders:[173,214,265,189,248,223].map((quantity,i)=>({id:"O"+(i+1),quantity,area:quantity,unit:"pcs",technical_process_id:"TP1"})),
  equipment:[{id:"M1",name:"QA press",kind:"pressing",capacity:100,capacity_unit:"pcs",timing_profile:{timing_mode:"throughput",throughput_per_hour:120}},
   {id:"M2",name:"QA pack",kind:"packing",capacity:100,capacity_unit:"pcs",timing_profile:{timing_mode:"throughput",throughput_per_hour:180}}],
  employees:[{id:"E1",name:"Invented operator",role:"Operator",shift:"day"}],shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},
  materials:[],setup_rules:[],technical_processes:[{id:"TP1",name:"Invented process",operations:[
   {id:"OP1",name:"Pressing",sequence:1,duration_min:1,resource_requirements:[res("equipment","M1"),res("employee","E1")]},
   {id:"OP2",name:"Packing",sequence:2,duration_min:1,resource_requirements:[res("equipment","M2"),res("employee","E1")]}]}]};
 assert.equal((await request("/api/db-storage","POST",{storage:{"prodplan.projects.v2":JSON.stringify([{id,name:"Synthetic decimal progress QA",model,revision:1}]),"prodplan.project.active.v2":id}})).status,200);
 phase="planner";
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>typeof model==="object"&&model?.orders?.length===6&&window.__PP_SSE_PROGRESS_V1__?.installed&&document.getElementById("opt"),{},{timeout:25000});
 await page.evaluate(()=>{document.documentElement.lang="en";if(window.__PP_LANGUAGE__?.current==="ru")document.documentElement.lang="ru"});
 let progressGets=0,streams=0;
 page.on("request",r=>{try{const p=new URL(r.url()).pathname;if(p==="/api/plan-progress")progressGets++;if(p==="/api/plan-events")streams++}catch{}});
 phase="native_run";
 const result=await page.evaluate(async()=>{
  window.__PP_SSE_PROGRESS_V1__.start();
  const r=await fetch("/api/plan",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({generations:19,population:7,seed:1729,objective:"duration",continue:false,__pp_async_start:true})});
  let data={};try{data=await r.json()}catch{}
  return {status:r.status,accepted:data.started===true};
 });
 assert.equal(result.status,202);assert.equal(result.accepted,true);started=true;
 await page.waitForFunction(()=>window.__PP_SSE_PROGRESS_V1__?.state.completed===true,{},{timeout:180000});
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
