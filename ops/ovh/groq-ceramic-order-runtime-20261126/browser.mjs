import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {source as oldSource} from "../groq-project-actions-20261126/actions-ui.mjs";
import {source} from "./actions-ui.mjs";
import {ppGroqPrepareEdit} from "./prepare.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-groq-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.GROQ_ACTIONS_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
let phase="register",page,started=false;
try{
 page=await browser.newPage({viewport:{width:1440,height:900}});
 const first=await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});assert.equal(first.status(),200);
 const request=(path,method="GET",body)=>page.evaluate(async({path,method,body})=>{
  const r=await fetch(path,{method,credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json","Accept":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  let data={};try{data=await r.json()}catch{}return {status:r.status,data};
 },{path,method,body});
 assert.equal((await request("/api/auth/register","POST",{email:"groq-param-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url"),company:"Synthetic order parameter QA"})).status,200);
 const id="prj_params_"+randomUUID().replaceAll("-","").slice(0,13),otherId=id+"_repair";
 // Exact proven integrated setup model, scaled to 600 m2 and
 // 200 m2 maximum capacity; the preceding native audit passed all 12 rows.
 const req={resource_type:"equipment",match_mode:"specific",resource_ref:"SYNTHETIC_MACHINE",resource_refs:["SYNTHETIC_MACHINE"],quantity:1,unit:"шт."};
 const model={scheduler_mode:"resource",quantity_unit:"m2",start:"2026-11-25T00:00:00",
  equipment:[{id:"SYNTHETIC_MACHINE",name:"Synthetic machine",kind:"workstation",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:10},capabilities:{allowed_parameters:{color:["A","B"]}}}],
  orders:[["2610","A"],["2611","B"],["2612","A"]].map(([id,color])=>({id,quantity:600,area:600,unit:"m2",technical_process_id:"SYNTHETIC_PROCESS",parameters:{color}})),
  employees:[],materials:[],shifts:{},constraints:[],
  setup_rules:[["A","B"],["B","A"]].map(([a,b])=>({id:"SYNTHETIC_SETUP_"+a+b,setup_parameter:"color",equipment_ref:"*",from_state:a,to_state:b,duration_min:15})),
  technical_processes:[{id:"SYNTHETIC_PROCESS",name:"Synthetic setup process",operations:[{id:"SYNTHETIC_WORK",name:"Synthetic work",sequence:1,duration_min:10,setup_parameter:"color",resource_requirements:[req]}]}]};
 const broken=structuredClone(model);broken.orders.push({id:2613,quantity:600,area:600,unit:"m2",technical_process_id:"SYNTHETIC_PROCESS",process_hours:1/6});
 const other={id:otherId,name:"Synthetic incomplete order QA",model:broken,revision:9,lastPlan:null};
 const records=[{id,name:"Synthetic complete order QA",model,revision:1,lastPlan:null},other];
 assert.equal((await request("/api/db-storage","POST",{storage:{"prodplan.projects.v2":JSON.stringify(records),"prodplan.project.active.v2":id}})).status,200);
 if(!live){
  await page.route("**/",async route=>{
   if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
   const response=await route.fetch(),html=await response.text();
   assert.equal(html.split(oldSource).length,2,"exact installed browser helper");
   assert.equal(html.split("installAssistantControls();").length,2,"exact install hook");
   const output=html.replace(oldSource,source).replace("installAssistantControls();","installAssistantControls();\nppGroqInstallRepairOffer();");
   await route.fulfill({response,body:output,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
  });
 }
 const get=()=>page.evaluate(()=>{
  const id=localStorage.getItem("prodplan.project.active.v2"),arr=JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]");
  return {id,active:arr.find(p=>p.id===id),others:arr.filter(p=>p.id!==id)};
 });
 phase="planner";
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>typeof model==="object"&&model?.orders?.length===3&&typeof ppGroqInstallRepairOffer==="function",{},{timeout:30000});
 if(!await page.locator("#chatInput").isVisible()){const n=page.getByText(/^(Planning|Планирование)$/).first();if(await n.isVisible())await n.click()}
 await page.locator("#chatInput").waitFor({state:"visible",timeout:12000});
 const before=await get();assert.equal(before.id,id);
 assert.equal((await request("/api/db-storage")).status,200);
 if(!live)await page.route("**/api/assistant",async route=>{
  const b=route.request().postDataJSON(),p=await get(),args={kind:"add_order",quantity:600};
  const {change}=ppGroqPrepareEdit(p.active.model,args);
  assert.equal(b.allowActions,true);assert.equal(b.viewContext.projectId,id);
  await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true,reply:"Confirm the production parameters.",mode:"edit_proposal",action:{projectId:id,revision:p.active.revision,args,change}})});
 });
 const apply=async()=>{
  const card=page.locator('[data-groq-action="pending"]').last();
  await card.waitFor({state:"visible",timeout:12000});
  assert.match(await card.textContent(),/color/i);
  await card.locator('[data-groq-apply]').click();
  await page.waitForFunction(()=>!window.__ppGroqApplyingEdit&&document.querySelector('[data-groq-action="applied"],[data-groq-action="failed"]'),{},{timeout:50000});
  const failed=page.locator('[data-groq-action="failed"]').last();
  if(await failed.count())console.log("ORDER_PARAMETER_NATIVE_FAILURE",String(await failed.textContent()).slice(0,350));
  assert.equal(await page.locator('[data-groq-action="applied"]').count(),1);
 };
 const optimize=async()=>{
  await page.waitForFunction(()=>window.__PP_STOP_DEBUG__?.().reconnecting===false,null,{timeout:25000});
  assert(await page.evaluate(()=>window.__PP_OPTIMIZER_DEPTH__.set("quick")));
  const post=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/plan"&&r.request().method()==="POST",{timeout:30000});
  await page.locator("#opt").click();
  const accepted=await post;assert.equal(accepted.status(),202);started=true;
  let final;
  for(let i=0;i<80;i++){
   await page.waitForTimeout(1000);
   const r=await request("/api/plan-progress"),p=r.data;
   if(!p.running&&["completed","failed","timed_out","cancelled","stale","interrupted"].includes(p.phase)){final=p;break}
  }
  if(final)started=false;
  console.log("ORDER_PARAMETER_REAL_GA",JSON.stringify({phase:final?.phase,error:final?.error,valid:final?.result?.valid,rows:final?.result?.operations?.length}));
  assert(final?.success===true&&final?.result?.valid===true,"actual native optimization must succeed after parameter edit");
  const rows=final.result.generic_operations?.length?final.result.generic_operations:final.result.operations;
  assert(rows.some(o=>String(o.order)==="2613"&&!o.is_setup),"the added/repaired order must be in the actual plan");
 };
 phase="new_order";
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/assistant"&&r.request().method()==="POST",{timeout:45000});
 await page.locator("#chatInput").fill("добавь ещё один заказ объёмом 600");await page.locator("#chatSend").click();
 const res=await response,d=await res.json();
 if(d.mode!=="edit_proposal")console.log("ORDER_PARAMETER_PROVIDER",JSON.stringify({status:res.status(),mode:d.mode,error:d.error,reply:String(d.reply||"").slice(0,200)}));
 assert.equal(res.status(),200);assert.equal(d.mode,"edit_proposal");assert.equal(d.action.args.kind,"add_order");
 assert(d.action.change.templateRecord);assert(d.action.change.parameters?.color);assert.equal(d.action.change.after,600);
 assert.deepEqual(await get(),before);
 await apply();
 const after=await get(),created=after.active.model.orders.find(o=>String(o.id)==="2613");
 assert.equal(after.active.model.orders.length,4);assert.equal(created.quantity,600);
 assert.deepEqual(created.parameters,d.action.change.parameters);assert.deepEqual(after.others,before.others);
 phase="new_order_optimization";await optimize();
 console.log("ORDER_PARAMETER_NEW_ORDER_NATIVE_PASS",live?"live":"candidate");
 phase="existing_incomplete_order";
 const db=await request("/api/db-storage");assert.equal(db.status,200);
 const all=JSON.parse(db.data.storage["prodplan.projects.v2"]);
 assert.equal((await request("/api/db-storage","POST",{storage:{...db.data.storage,"prodplan.projects.v2":JSON.stringify(all),"prodplan.project.active.v2":otherId}})).status,200);
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>typeof model==="object"&&model?.orders?.length===4&&typeof ppGroqInstallRepairOffer==="function",{},{timeout:30000});
 const repairBefore=await get();assert.equal(repairBefore.id,otherId);assert.equal(repairBefore.active.model.orders[3].parameters,undefined);
 const repair=page.locator('[data-groq-action="pending"]').last();
 await repair.waitFor({state:"visible",timeout:20000});
 assert.match(await repair.textContent(),/2613/);assert.match(await repair.textContent(),/2612/);
 assert.deepEqual(await get(),repairBefore);
 await apply();
 const repaired=await get();assert.equal(repaired.active.model.orders.length,4);assert.equal(repaired.active.model.orders[3].quantity,600);
 assert.deepEqual(repaired.active.model.orders[3].parameters,broken.orders[2].parameters);assert.deepEqual(repaired.others,repairBefore.others);
 phase="repaired_order_optimization";await optimize();
 console.log("ORDER_PARAMETER_EXISTING_REPAIR_NATIVE_PASS",live?"live":"candidate");
 console.log("ORDER_PARAMETER_BROWSER_PASS",live?"live":"candidate");
}catch(e){console.log("ORDER_PARAMETER_BROWSER_FAILED",phase,e.name,String(e.message).slice(0,250));process.exitCode=6}
finally{if(started&&page)try{await page.evaluate(()=>fetch("/api/optimizer-stop",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}))}catch{}await browser.close()}
