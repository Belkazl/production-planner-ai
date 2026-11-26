import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {transformContextHtml,capture} from "./context-ui.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-groq-test/node_modules/playwright-core");
const base="https://app.liftorbit.app", live=process.env.GROQ_CONTEXT_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
let phase="bootstrap",started=false;
let page;
try{
 page=await browser.newPage({viewport:{width:1440,height:900}});
 const first=await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 assert.equal(first.status(),200);
 const email="groq-context-qa-"+randomUUID()+"@liftorbit.invalid",password=randomBytes(25).toString("base64url");
 const request=(path,method="GET",body)=>page.evaluate(async({path,method,body})=>{
  const r=await fetch(path,{method,credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json","Accept":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  let data={};try{data=await r.json()}catch{}
  return {status:r.status,data};
 },{path,method,body});
 assert.equal((await request("/api/auth/register","POST",{email,password,company:"Synthetic project context QA"})).status,200);
 const id="prj_context_"+randomUUID().replaceAll("-","").slice(0,13);
 const res=(type,ref)=>({resource_type:type,resource_ref:ref,resource_refs:[ref],match_mode:"specific",quantity:1,unit:type==="equipment"?"pcs":"чел.",consumption_rule:"during_operation"});
 const model={scheduler_mode:"resource",start:"2026-11-25T08:00:00",quantity_unit:"pcs",
  orders:[{id:"O1",quantity:200,area:200,unit:"pcs",technical_process_id:"TP1"}],
  equipment:[{id:"M1",name:"QA machine Alpha",kind:"pressing",capacity:200,capacity_unit:"pcs",timing_profile:{timing_mode:"throughput",throughput_per_hour:60}},
   {id:"M2",name:"QA machine Beta",kind:"packing",capacity:200,capacity_unit:"pcs",timing_profile:{timing_mode:"throughput",throughput_per_hour:120}},
   {id:"M3",name:"QA machine Idle",kind:"other",capacity:200,capacity_unit:"pcs",timing_profile:{timing_mode:"throughput",throughput_per_hour:60}}],
  employees:[{id:"E1",name:"Invented private employee",role:"Operator",shift:"day"}],shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},
  materials:[],setup_rules:[],technical_processes:[{id:"TP1",name:"Invented process",operations:[
   {id:"OP1",name:"Invented pressing",sequence:1,duration_min:1,resource_requirements:[res("equipment","M1"),res("employee","E1")]},
   {id:"OP2",name:"Invented packing",sequence:2,duration_min:1,resource_requirements:[res("equipment","M2"),res("employee","E1")]}]}]};
 const projects=JSON.stringify([{id,name:"Synthetic context QA",model,revision:1}]);
 assert.equal((await request("/api/db-storage","POST",{storage:{"prodplan.projects.v2":projects,"prodplan.project.active.v2":id}})).status,200);
 if(!live){
  await page.route("**/",async route=>{
   if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
   const response=await route.fetch(),html=await response.text();
   const output=transformContextHtml(html,capture);
   if(!output.includes("PP_GROQ_PROJECT_CONTEXT_V1"))console.log("GROQ_CONTEXT_CANDIDATE_ANCHOR_DRIFT");
   await route.fulfill({response,body:output,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
  });
 }
 phase="planner";
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>typeof model==="object"&&model?.orders?.length===1&&typeof ppGroqCaptureContext==="function",{},{timeout:25000});
 assert.equal(await page.locator("#ppGroqConsent").count(),0);
 assert.match(await page.locator("#ppGroqNotice").textContent(),/Groq/i);
 if(!await page.locator("#chatInput").isVisible()){const n=page.getByText(/^(Planning|Планирование)$/).first();if(await n.isVisible())await n.click()}
 if(!await page.locator("#chatInput").isVisible()){const n=page.getByText(/^(Chat|Чат)$/).first();if(await n.isVisible())await n.click()}
 await page.locator("#chatInput").waitFor({state:"visible",timeout:12000});
 // Use a real valid optimization result from this isolated synthetic account.
 phase="native_plan";
 let result=await request("/api/plan","POST",{generations:3,population:6,seed:1729,objective:"duration",continue:false,__pp_async_start:true});
 if(result.status===202){
  started=true;
  for(let i=0;i<90;i++){
   await page.waitForTimeout(1000);
   const p=await request("/api/plan-progress");
   if(p.data?.phase==="completed"||p.data?.success&&p.data?.running===false){result={status:200,data:p.data.result};started=false;break}
   if(["failed","timed_out","stale","cancelled","interrupted"].includes(p.data?.phase))throw Error("GA_"+p.data.phase);
  }
 }
 assert.equal(result.status,200);assert(result.data?.valid===true,"native result must be valid");
 const plan=result.data;
 await page.evaluate(p=>{
  window.__ppTabPlan=p;window.__ppOptimizerCommittedPlan=p;
  renderPlan(p);renderKpisWithDelta(p);
  if(typeof window.ppProjectAfterPlan==="function")window.ppProjectAfterPlan(p);
  window.__ppGenericPlan={...p,generic_schedule:true,generic_operations:p.generic_operations?.length?p.generic_operations:p.operations};
 },plan);
 // Wait for the normal project persistence pipeline; no changes to customer data.
 await page.waitForTimeout(1200);
 phase="resource_utilization";
 const tabs=page.locator("#planView .tabs > div");assert.equal(await tabs.count(),6);
 await tabs.nth(4).click();
 await page.waitForFunction(()=>{const c=ppGroqCaptureContext();return c.view==="resource_utilization"&&c.utilization.some(r=>r.name==="QA machine Alpha")&&c.utilization.some(r=>r.name==="QA machine Idle")},{},{timeout:15000});
 const view=await page.evaluate(()=>ppGroqCaptureContext());
 assert.equal(view.projectId,id);assert.equal(view.utilizationSource,"visible_resource_utilization");
 assert(view.utilization.length>=3);
 const expected=view.utilization.find(r=>r.name==="QA machine Alpha").percent;
 assert(Number(expected.replace("%","").replace(",","."))>0);
 assert.equal(Number(view.utilization.find(r=>r.name==="QA machine Idle").percent.replace("%","").replace(",",".")),0);
 const before=await page.evaluate(()=>localStorage.getItem("prodplan.projects.v2"));
 console.log("GROQ_CONTEXT_NATIVE_RENDERER_MATCH",JSON.stringify({view:view.view,rows:view.totalRows,alpha:expected,idle:view.utilization.find(r=>r.name==="QA machine Idle").percent}));
 phase="send_current_context";
 let captured;
 if(!live)await page.route("**/api/assistant",async route=>{
  captured=route.request().postDataJSON();
  await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true,reply:expected,mode:"read_only",model:"openai/gpt-oss-120b"})});
 });
 const response=page.waitForResponse(r=>r.url().endsWith("/api/assistant")&&r.request().method()==="POST",{timeout:45000});
 const question="What is the exact displayed Resource Utilization percentage for QA machine Alpha? Answer only the percentage shown in the current table.";
 await page.locator("#chatInput").fill(question);await page.locator("#chatSend").click();
 const r=await response;
 if(live)captured=r.request().postDataJSON();
 const answer=await r.json();
 if(r.status()!==200)console.log("GROQ_CONTEXT_SAFE_HTTP",r.status(),["assistant_context_unavailable","assistant_rate_limit","assistant_provider_unavailable","assistant_invalid_request"].includes(answer.error)?answer.error:"other");
 assert.equal(r.status(),200);assert.equal(answer.ok,true);
 assert.equal(captured.includeProject,true);
 assert.equal(captured.viewContext.view,"resource_utilization");
 assert.deepEqual(captured.viewContext.utilization,view.utilization);
 const percentages=[...answer.reply.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map(m=>Number(m[1].replace(",",".")));
 assert(percentages.includes(Number(expected.replace("%","").replace(",","."))),"actual provider must use displayed percentage");
 await page.waitForFunction(()=>!document.getElementById("chatSend").disabled);
 assert.equal(await page.evaluate(()=>localStorage.getItem("prodplan.projects.v2")),before);
 console.log("GROQ_CONTEXT_EXACT_ANSWER_PASS",live?"live":"candidate");
 phase="other_tab_same_renderer";
 await tabs.nth(0).click();
 await page.waitForFunction(()=>ppGroqCaptureContext().view==="equipment_gantt",{},{timeout:10000});
 const other=await page.evaluate(()=>ppGroqCaptureContext());
 assert.equal(other.utilizationSource,"same_resource_utilization_renderer");
 assert.equal(other.utilization.find(x=>x.name==="QA machine Alpha").percent,expected);
 assert.equal(await page.evaluate(()=>ppGroqCaptureContext().view),"equipment_gantt");
 console.log("GROQ_CONTEXT_OTHER_TAB_RENDERER_PASS");
 console.log("GROQ_CONTEXT_BROWSER_PASS",live?"live":"candidate");
}catch(e){
 console.log("GROQ_CONTEXT_BROWSER_FAILED",phase,e?.name==="AssertionError"?"AssertionError":e?.name==="TimeoutError"?"TimeoutError":"Error");
 if(e?.name==="AssertionError")console.log("GROQ_CONTEXT_ASSERTION",String(e.message).slice(0,140));
 process.exitCode=6;
}finally{
 if(started&&page)try{await page.evaluate(()=>fetch("/api/optimizer-stop",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}))}catch{}
 await browser.close();
}
