import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-groq-test/node_modules/playwright-core");
const base="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
let phase="bootstrap";
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 const errors=[];page.on("pageerror",e=>errors.push(e?.name||"Error"));
 const outgoing=[];page.on("request",r=>{if(r.method()==="POST")outgoing.push(new URL(r.url()).pathname)});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 phase="unauthenticated";
 const noLogin=await page.evaluate(async()=>{const r=await fetch("/api/assistant",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:"hello",history:[],includeProject:false})});return r.status});
 assert.equal(noLogin,401);
 phase="isolated_account";
 const email="groq-qa-"+randomUUID()+"@liftorbit.invalid",password=randomBytes(25).toString("base64url");
 assert.equal(await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic assistant QA"})})).status,{email,password}),200);
 const id="prj_groq_"+randomUUID().replaceAll("-","").slice(0,13);
 const model={scheduler_mode:"resource",start:"2026-11-25T08:00:00",quantity_unit:"pcs",orders:[{id:"O1",quantity:200,area:200,unit:"pcs",technical_process_id:"TP1"}],equipment:[{id:"M1",name:"Invented workstation",kind:"pressing",capacity:200,capacity_unit:"pcs",timing_profile:{timing_mode:"throughput",throughput_per_hour:60}}],employees:[{id:"E1",name:"Invented operator",role:"Operator",shift:"day"}],shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},materials:[],setup_rules:[],technical_processes:[{id:"TP1",name:"Invented process",operations:[{id:"OP1",name:"Invented work",sequence:1,duration_min:1,resource_requirements:[{resource_type:"equipment",resource_ref:"M1",resource_refs:["M1"],match_mode:"specific",quantity:1,unit:"pcs",consumption_rule:"during_operation"},{resource_type:"employee",resource_ref:"E1",resource_refs:["E1"],match_mode:"specific",quantity:1,consumption_rule:"during_operation"}]}]}]};
 const projects=JSON.stringify([{id,name:"Synthetic assistant QA",model,revision:1}]);
 assert.equal(await page.evaluate(async({id,projects})=>(await fetch("/api/db-storage",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({storage:{"prodplan.projects.v2":projects,"prodplan.project.active.v2":id}})})).status,{id,projects}),200);
 phase="actual_html";
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>typeof model==="object"&&model?.orders?.length===1,{},{timeout:20000});
 await page.locator("#ppGroqConsent").waitFor({state:"attached",timeout:10000});
 // Navigate through the real UI, if initial page is Projects.
 if(!await page.locator("#chatInput").isVisible()){
  const nav=page.getByText(/^(Planning|Планирование)$/).first();
  if(await nav.isVisible())await nav.click();
 }
 if(!await page.locator("#chatInput").isVisible()){
  const nav=page.getByText(/^(Chat|Чат)$/).first();
  if(await nav.isVisible())await nav.click();
 }
 phase="composer_visibility";
 await page.locator("#chatInput").waitFor({state:"visible",timeout:12000});
 await page.locator("#ppGroqConsent").waitFor({state:"visible",timeout:12000});
 assert.equal(await page.locator("#ppGroqConsent").isChecked(),false);
 console.log("GROQ_LIVE_UI_READY");
 const snapshot=()=>page.evaluate(()=>{let projects=JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]");let active=localStorage.getItem("prodplan.project.active.v2");let current=projects.find(x=>x.id===active);return {id:active,model:current?.model??null,lastPlan:current?.lastPlan??null,revision:current?.revision??null}});
 const before=await snapshot();assert.equal(before.id,id);assert.equal(before.model.orders.length,1);
 phase="provider_reply";
 outgoing.length=0;
 await page.locator("#chatInput").fill("Reply with exactly OK.");
 const answer=page.waitForResponse(r=>r.url().endsWith("/api/assistant")&&r.request().method()==="POST",{timeout:45000});
 await page.locator("#chatSend").click();
 const response=await answer;const body=await response.json();
 if(response.status()!==200){console.log("GROQ_LIVE_SAFE_HTTP",response.status(),["assistant_not_configured","assistant_provider_unavailable","assistant_rate_limit","assistant_empty_reply","assistant_context_unavailable","assistant_invalid_request","authentication_required","cross_origin_forbidden"].includes(body.error)?body.error:"other")}
 assert.equal(response.status(),200);
 assert.equal(body.ok,true);assert.equal(body.mode,"read_only");assert.equal(body.model,"openai/gpt-oss-120b");assert(body.reply.trim());
 await page.locator('[data-groq-message="assistant"]').last().waitFor({state:"visible",timeout:10000});
 assert.equal(await page.locator('[data-groq-message="assistant"]').last().textContent(),body.reply);
 assert.deepEqual(await snapshot(),before);
 assert(!outgoing.some(x=>["/api/chat","/api/plan","/api/project/model/import","/api/project/model/clear"].includes(x)));
 console.log("GROQ_LIVE_PROVIDER_AND_PLAN_PRESERVATION_PASS");
 phase="opt_in_context";
 await page.locator("#ppGroqConsent").check();
 await page.locator("#chatInput").fill("How many orders are in the shared anonymized project summary? Reply with the number only.");
 const reply=page.waitForResponse(r=>r.url().endsWith("/api/assistant")&&r.request().method()==="POST",{timeout:45000});
 await page.locator("#chatSend").click();
 const r=await reply;const d=await r.json();
 if(r.status()!==200)console.log("GROQ_LIVE_CONTEXT_SAFE_HTTP",r.status(),d.error==="assistant_context_unavailable"?d.error:"other");
 assert.equal(r.status(),200);assert.equal(d.ok,true);assert(/\b1\b|one/i.test(d.reply));assert.deepEqual(await snapshot(),before);
 console.log("GROQ_LIVE_OPT_IN_CONTEXT_PASS");
 console.log("GROQ_LIVE_BROWSER_PASS");
}catch(e){
 console.log("GROQ_LIVE_FAILED",phase,e?.name==="AssertionError"?"AssertionError":e?.name==="TimeoutError"?"TimeoutError":"Error");
 process.exitCode=6;
}finally{await browser.close()}
