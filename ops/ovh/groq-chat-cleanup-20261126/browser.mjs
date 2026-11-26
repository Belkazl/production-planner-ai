import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {transformChatCleanup,css,script} from "./patch-cleanup.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-groq-test/node_modules/playwright-core");
const base="https://app.liftorbit.app";
const live=process.env.GROQ_CLEANUP_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
let phase="bootstrap";
try{
 const page=await browser.newPage({viewport:{width:1366,height:768}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const email="groq-composer-qa-"+randomUUID()+"@liftorbit.invalid",password=randomBytes(25).toString("base64url");
 assert.equal(await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic composer QA"})})).status,{email,password}),200);
 const id="prj_composer_"+randomUUID().replaceAll("-","").slice(0,13);
 const model={scheduler_mode:"resource",start:"2026-11-25T08:00:00",quantity_unit:"pcs",orders:[{id:"O1",quantity:200,area:200,unit:"pcs",technical_process_id:"TP1"}],equipment:[{id:"M1",name:"Invented workstation",kind:"pressing",capacity:200,capacity_unit:"pcs",timing_profile:{timing_mode:"throughput",throughput_per_hour:60}}],employees:[{id:"E1",name:"Invented operator",role:"Operator",shift:"day"}],shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},materials:[],setup_rules:[],technical_processes:[{id:"TP1",name:"Invented process",operations:[{id:"OP1",name:"Invented work",sequence:1,duration_min:1,resource_requirements:[{resource_type:"equipment",resource_ref:"M1",resource_refs:["M1"],match_mode:"specific",quantity:1,unit:"pcs",consumption_rule:"during_operation"},{resource_type:"employee",resource_ref:"E1",resource_refs:["E1"],match_mode:"specific",quantity:1,consumption_rule:"during_operation"}]}]}]};
 const projects=JSON.stringify([{id,name:"Synthetic composer QA",model,revision:1}]);
 assert.equal(await page.evaluate(async({id,projects})=>(await fetch("/api/db-storage",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({storage:{"prodplan.projects.v2":projects,"prodplan.project.active.v2":id}})})).status,{id,projects}),200);
 if(!live){
  await page.route("**/",async route=>{
   if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
   const response=await route.fetch();const html=await response.text();
   const output=transformChatCleanup(html,css,script);
   assert(output.includes('id="ppGroqChatCleanupV1"'),"HTML_SOURCE_ANCHOR");
   await route.fulfill({response,body:output,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
  });
 }
 phase="planner";
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>typeof model==="object"&&model?.orders?.length===1,{},{timeout:20000});
 assert.equal(await page.locator("#ppGroqChatCleanupV1").count(),1);
 if(!await page.locator("#chatInput").isVisible()){const nav=page.getByText(/^(Planning|Планирование)$/).first();if(await nav.isVisible())await nav.click()}
 if(!await page.locator("#chatInput").isVisible()){const nav=page.getByText(/^(Chat|Чат)$/).first();if(await nav.isVisible())await nav.click()}
 await page.locator("#chatInput").waitFor({state:"visible",timeout:12000});
 const snapshot=()=>page.evaluate(()=>{let p=JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]").find(x=>x.id===localStorage.getItem("prodplan.project.active.v2"));return {id:p?.id,model:p?.model,lastPlan:p?.lastPlan??null,revision:p?.revision}});
 const before=await snapshot();assert.equal(before.id,id);
 phase="legacy_cleanup";
 const toggle=page.locator("#mobileAiToggle");
 assert.equal(await toggle.count(),1);
 assert.equal(await toggle.isVisible(),false);
 await page.evaluate(()=>{
  const box=document.getElementById("messages");
  const notice='Demo “Керамика” loaded: 14 machines, 6 orders totaling 12 900 m², and a process with 7 operations. Batches are sized at 600 m² with a remainder when needed. Optimization is ready to start.';
  for(const [id,text,classes,role] of [
   ["legacy-en",notice,"bubble",""],
   ["legacy-ru","Демо «Керамика» загружено: 14 станков, 6 заказов. Оптимизация готова к запуску.","bubble",""],
   ["keep-real",notice,"bubble","assistant"],
   ["keep-user",notice,"bubble user",""],
   ["keep-other","Actual assistant reply about a project.","bubble",""]]){
    const div=document.createElement("div");div.id=id;div.className=classes;div.textContent=text;if(role)div.dataset.groqMessage=role;box.appendChild(div);
  }
  document.body.classList.add("ai-collapsed-mobile");
 });
 await page.waitForFunction(()=>!document.getElementById("legacy-en")&&!document.getElementById("legacy-ru")&&!document.body.classList.contains("ai-collapsed-mobile"));
 for(const id of ["keep-real","keep-user","keep-other"])assert.equal(await page.locator("#"+id).count(),1);
 assert.equal(await page.locator("#chatInput").isEditable(),true);
 assert.deepEqual(await snapshot(),before);
 console.log("GROQ_CHAT_CLEANUP_LEGACY_ONLY_PASS");
 phase="long_gantt_and_chat";
 await page.evaluate(()=>{
  const tall=document.createElement("div");tall.id="synthetic-tall-gantt";tall.style.height="2200px";document.querySelector(".main").appendChild(tall);
  for(let i=0;i<60;i++){const msg=document.createElement("div");msg.className="bubble";msg.textContent="Synthetic long conversation line "+i;document.getElementById("messages").appendChild(msg)}
 });
 const check=async(w,h,scroll)=>{
  await page.setViewportSize({width:w,height:h});
  await page.evaluate(y=>window.scrollTo(0,y),scroll);
  await page.waitForTimeout(200);
  const metrics=await page.evaluate(()=>{
   const i=document.getElementById("chatInput"),r=i.getBoundingClientRect(),b=document.getElementById("chatSend").getBoundingClientRect(),a=document.querySelector(".assist"),m=document.getElementById("messages");
   const target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
   return {top:Math.round(r.top),bottom:Math.round(r.bottom),sendBottom:Math.round(b.bottom),height:innerHeight,disabled:i.disabled,readonly:i.readOnly,hit:target===i,position:getComputedStyle(a).position,scroll:Math.round(scrollY),messageScroll:m.scrollHeight>m.clientHeight};
  });
  console.log("GROQ_CHAT_CLEANUP_GEOMETRY",JSON.stringify({w,h,scroll,...metrics}));
  assert(metrics.top>=0&&metrics.bottom<=h+1&&metrics.sendBottom<=h+1&&metrics.hit&&!metrics.disabled&&!metrics.readonly);
 };
 await check(1366,768,0);
 await check(1366,768,1000);
 await check(1920,1080,0);
 await check(1024,640,0);
 phase="draft_while_waiting";
 await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>window.scrollTo(0,0));
 let resolve,started;
 const ready=new Promise(r=>{started=r});
 await page.route("**/api/assistant",async route=>{
  started();
  await new Promise(r=>{resolve=r});
  await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:"assistant_provider_unavailable"})});
 });
 await page.locator("#chatInput").fill("First question");
 await page.locator("#chatSend").click();
 await ready;
 assert(await page.locator("#chatInput").isEditable());
 assert(await page.locator("#chatSend").isDisabled());
 await page.locator("#chatInput").fill("Second draft");
 resolve();
 await page.waitForFunction(()=>!document.getElementById("chatSend").disabled);
 assert.equal(await page.locator("#chatInput").inputValue(),"Second draft");
 await page.unroute("**/api/assistant");
 assert.deepEqual(await snapshot(),before);
 phase="live_response";
 if(live){
  await page.locator("#chatInput").fill("Reply with exactly OK.");
  const answer=page.waitForResponse(r=>r.url().endsWith("/api/assistant")&&r.request().method()==="POST",{timeout:45000});
  await page.locator("#chatSend").click();
  const response=await answer;const body=await response.json();
  assert.equal(response.status(),200);assert.equal(body.ok,true);assert(body.reply.trim());
  await page.waitForFunction(()=>!document.getElementById("chatSend").disabled);
  assert(await page.locator("#chatInput").isEditable());assert.deepEqual(await snapshot(),before);
 }
 console.log("GROQ_CHAT_CLEANUP_BROWSER_PASS",live?"live":"candidate");
}catch(e){
 console.log("GROQ_CHAT_CLEANUP_BROWSER_FAILED",phase,e?.name==="AssertionError"?"AssertionError":e?.name==="TimeoutError"?"TimeoutError":"Error");
 process.exitCode=6;
}finally{await browser.close()}
