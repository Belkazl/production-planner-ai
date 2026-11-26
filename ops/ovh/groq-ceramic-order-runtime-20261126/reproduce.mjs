import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-groq-test/node_modules/playwright-core");
const base="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
let page,phase="register",started=false;
try{
 page=await browser.newPage({viewport:{width:1600,height:960}});
 await page.goto(base,{waitUntil:"domcontentloaded",timeout:45000});
 const request=(path,method="GET",body)=>page.evaluate(async({path,method,body})=>{
  const r=await fetch(path,{method,credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json","Accept":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  let data={};try{data=await r.json()}catch{}return {status:r.status,data};
 },{path,method,body});
 assert.equal((await request("/api/auth/register","POST",{email:"ceramic-add-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url"),company:"Synthetic ceramic addition QA"})).status,200);
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>typeof ppGroqPrepareEdit==="function"&&!!window.__PP_OPTIMIZER_DEPTH__?.installed,{},{timeout:25000});
 phase="demo";
 const inspect=()=>page.evaluate(()=>{
  const p=JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]");
  const id=localStorage.getItem("prodplan.project.active.v2");
  return {projects:p.map(x=>({name:x.name,id:x.id,count:x.model?.orders?.length||0})),active:id,buttons:[...document.querySelectorAll("button,a,[role=button]")].filter(e=>e.getClientRects().length).map(e=>({id:e.id||"",label:(e.textContent||e.title||"").trim().slice(0,80)})).filter(e=>e.label).slice(0,100),keys:Object.keys(window).filter(k=>/demo|ceram|sample/i.test(k))};
 });
 let info=await inspect();console.log("CERAMIC_DISCOVERY",JSON.stringify(info));
 // Only use an actual built-in demo action in the isolated account.
 if(!info.projects.some(p=>p.count===6)){
  const nav=page.getByText(/^(Projects|Проекты)$/).first();
  if(await nav.isVisible())await nav.click();
  await page.waitForTimeout(500);
  info=await inspect();console.log("CERAMIC_PROJECTS_UI",JSON.stringify(info));
  const candidates=page.locator("button,a,[role=button]").filter({hasText:/^(?:Load |Create |Try |Загрузить |Создать )?(?:Demo|Демо|Керамика|Ceramics|Ceramic production)(?: project| production| проекта|.*пример)?$/i});
  if(await candidates.count()){
   for(let i=0;i<await candidates.count();i++){if(await candidates.nth(i).isVisible()){await candidates.nth(i).click();break}}
   await page.waitForTimeout(1600);
  }
  info=await inspect();console.log("CERAMIC_AFTER_DEMO_CLICK",JSON.stringify(info));
 }
 const found=info.projects.find(p=>p.count===6&&/керамик|ceramic/i.test(p.name))||info.projects.find(p=>p.count===6);
 if(!found){
  const hints=await page.evaluate(()=>[...document.scripts].flatMap(t=>{const s=t.textContent||"";return [...s.matchAll(/.{0,90}(?:loadDemo|demoModel|demoProject|demoCeramic|Керамика|12 900|12900|\\/api\\/demo|demo-ceramic).{0,110}/gi)].slice(0,10).map(x=>x[0])}).slice(0,35));
  console.log("CERAMIC_DEMO_HINTS",JSON.stringify(hints));
  throw Error("native_demo_not_found");
 }
 if(info.active!==found.id){
  const open=page.getByText(found.name,{exact:true}).first();
  if(await open.isVisible())await open.click();
  await page.waitForTimeout(1000);
 }
 await page.waitForFunction(()=>typeof model==="object"&&model?.orders?.length===6,{},{timeout:25000});
 const before=await page.evaluate(()=>structuredClone(model));
 console.log("CERAMIC_MODEL",JSON.stringify({orders:before.orders,processes:before.technical_processes?.map(p=>({id:p.id,keys:Object.keys(p),operations:p.operations?.map(o=>({id:o.id,keys:Object.keys(o),duration:o.duration_min,requirements:o.resource_requirements?.map(r=>({keys:Object.keys(r),type:r.resource_type,match:r.match_mode,parameter:r.parameter}))}))})),setupRules:before.setup_rules,parameters:before.parameters,orderParameters:before.order_parameters,quantityUnit:before.quantity_unit,equipment:before.equipment?.map(e=>({id:e.id,keys:Object.keys(e),capacity:e.capacity,unit:e.capacity_unit,kind:e.kind,timing:e.timing_profile}))}));
 // Use the real chat and confirmed edit path; no changes to any customer project.
 phase="assistant";
 if(!await page.locator("#chatInput").isVisible()){const chat=page.getByText(/^(Chat|Чат)$/).first();if(await chat.isVisible())await chat.click()}
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/assistant"&&r.request().method()==="POST",{timeout:45000});
 await page.locator("#chatInput").fill("добавь ещё один заказ объёмом 600");
 await page.locator("#chatSend").click();
 const res=await response,d=await res.json();console.log("CERAMIC_PROPOSAL",JSON.stringify({status:res.status(),mode:d.mode,action:d.action,reply:d.reply}));
 assert.equal(d.mode,"edit_proposal");
 await page.locator("[data-groq-apply]").last().click();
 await page.waitForFunction(()=>!window.__ppGroqApplyingEdit&&document.querySelector('[data-groq-action="applied"],[data-groq-action="failed"]'),{},{timeout:50000});
 assert.equal(await page.locator('[data-groq-action="applied"]').count(),1);
 const after=(await request("/api/model")).data.model;
 console.log("CERAMIC_NEW_ORDER",JSON.stringify(after.orders.at(-1)));
 phase="optimization";
 await page.waitForFunction(()=>window.__PP_STOP_DEBUG__?.().reconnecting===false,null,{timeout:25000});
 assert(await page.evaluate(()=>window.__PP_OPTIMIZER_DEPTH__.set("quick")));
 const post=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/plan"&&r.request().method()==="POST",{timeout:30000});
 await page.locator("#opt").click();
 const accepted=await post,posted=accepted.request().postDataJSON();
 console.log("CERAMIC_START",JSON.stringify({status:accepted.status(),generations:posted.generations,population:posted.population}));
 started=accepted.status()===202;
 if(!started){const d=await accepted.json();console.log("CERAMIC_START_REJECTED",JSON.stringify({error:d.error,diagnostic:d.diagnostic}));throw Error("native_start_rejected")}
 let final;
 for(let i=0;i<80;i++){
  await page.waitForTimeout(1500);
  const r=await request("/api/plan-progress");const p=r.data;
  if(i%12===0||!p.running)console.log("CERAMIC_PROGRESS",JSON.stringify({status:r.status,phase:p.phase,percent:p.percent,error:p.error,diagnostic:p.diagnostic,success:p.success}));
  if(!p.running&&["completed","failed","timed_out","cancelled","stale","interrupted"].includes(p.phase)){final=p;break}
 }
 if(final)started=false;
 assert(final?.success===true&&final?.result?.valid===true,"ceramic edit must support real native calculation");
 const rows=final.result.generic_operations?.length?final.result.generic_operations:final.result.operations;
 assert(rows.some(o=>String(o.order)===String(after.orders.at(-1).id)&&!o.is_setup));
 console.log("CERAMIC_ADDED_ORDER_PLAN_PASS",JSON.stringify({orders:after.orders.length,operations:rows.length,duration:final.result.duration_minutes}));
}catch(e){console.log("CERAMIC_DIAGNOSTIC_FAILED",phase,e.name,String(e.message).slice(0,300));process.exitCode=1}
finally{if(started&&page)try{await page.evaluate(()=>fetch("/api/optimizer-stop",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}))}catch{}await browser.close()}
