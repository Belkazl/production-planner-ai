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
 const req=(ref)=>({resource_type:"equipment",resource_ref:ref,resource_refs:[ref],match_mode:"specific",quantity:1,unit:"pcs",consumption_rule:"during_operation"});
 const model={scheduler_mode:"resource",start:"2026-11-25T08:00:00",quantity_unit:"m2",
  orders:[{id:2611,quantity:900,area:900,unit:"m2",technical_process_id:"TP1",process_hours:1,parameters:{color:"A",width:600}},
   {id:2612,quantity:800,area:800,unit:"m2",technical_process_id:"TP1",process_hours:1,parameters:{color:"B",width:1200}}],
  equipment:[{id:"M1",name:"Synthetic press",kind:"pressing",capacity:200,capacity_unit:"m2",capabilities:{allowed_parameters:{color:["A","B"]},max_parameters:{width:1300}},timing_profile:{timing_mode:"throughput",throughput_per_hour:600}}],
  employees:[],shifts:{},materials:[],setup_rules:[{id:"SET_AB",equipment_ref:"*",setup_parameter:"color",from_state:"A",to_state:"B",duration_min:5},{id:"SET_BA",equipment_ref:"*",setup_parameter:"color",from_state:"B",to_state:"A",duration_min:5}],
  technical_processes:[{id:"TP1",name:"Synthetic ceramic process",operations:[{id:"OP1",name:"Synthetic pressing",sequence:1,duration_min:10,setup_parameter:"color",resource_requirements:[req("M1")]}]}]};
 const broken=structuredClone(model);broken.orders.push({id:2613,quantity:600,area:600,unit:"m2",technical_process_id:"TP1",process_hours:1});
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
 await page.waitForFunction(()=>typeof model==="object"&&model?.orders?.length===2&&typeof ppGroqInstallRepairOffer==="function",{},{timeout:30000});
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
  assert.match(await card.textContent(),/width/i);
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
 assert.equal(after.active.model.orders.length,3);assert.equal(created.quantity,600);
 assert.deepEqual(created.parameters,d.action.change.parameters);assert.deepEqual(after.others,before.others);
 phase="new_order_optimization";await optimize();
 console.log("ORDER_PARAMETER_NEW_ORDER_NATIVE_PASS",live?"live":"candidate");
 phase="existing_incomplete_order";
 const db=await request("/api/db-storage");assert.equal(db.status,200);
 const all=JSON.parse(db.data.storage["prodplan.projects.v2"]);
 assert.equal((await request("/api/db-storage","POST",{storage:{...db.data.storage,"prodplan.projects.v2":JSON.stringify(all),"prodplan.project.active.v2":otherId}})).status,200);
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>typeof model==="object"&&model?.orders?.length===3&&typeof ppGroqInstallRepairOffer==="function",{},{timeout:30000});
 const repairBefore=await get();assert.equal(repairBefore.id,otherId);assert.equal(repairBefore.active.model.orders[2].parameters,undefined);
 const repair=page.locator('[data-groq-action="pending"]').last();
 await repair.waitFor({state:"visible",timeout:20000});
 assert.match(await repair.textContent(),/2613/);assert.match(await repair.textContent(),/2612/);
 assert.deepEqual(await get(),repairBefore);
 await apply();
 const repaired=await get();assert.equal(repaired.active.model.orders.length,3);assert.equal(repaired.active.model.orders[2].quantity,600);
 assert.deepEqual(repaired.active.model.orders[2].parameters,broken.orders[1].parameters);assert.deepEqual(repaired.others,repairBefore.others);
 phase="repaired_order_optimization";await optimize();
 console.log("ORDER_PARAMETER_EXISTING_REPAIR_NATIVE_PASS",live?"live":"candidate");
 console.log("ORDER_PARAMETER_BROWSER_PASS",live?"live":"candidate");
}catch(e){console.log("ORDER_PARAMETER_BROWSER_FAILED",phase,e.name,String(e.message).slice(0,250));process.exitCode=6}
finally{if(started&&page)try{await page.evaluate(()=>fetch("/api/optimizer-stop",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}))}catch{}await browser.close()}
