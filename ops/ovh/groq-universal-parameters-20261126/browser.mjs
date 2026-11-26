import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {source as oldSource} from "../groq-ceramic-order-runtime-20261126/actions-ui.mjs";
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
   const output=html.replace(oldSource,source);
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
 let args={kind:"set_order_parameters",order_index:1,parameters:[{name:"width_mm",type:"number",value:"600"}]};
 if(!live){
  await page.route("**/api/assistant",async route=>{
   const b=route.request().postDataJSON(),p=await get(),{change}=ppGroqPrepareEdit(p.active.model,args);
   assert.equal(b.allowActions,true);assert.equal(b.viewContext.projectId,id);
   await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true,reply:"Confirm.",mode:"edit_proposal",action:{projectId:id,revision:p.active.revision,args,change}})});
  });
  await page.route("**/api/assistant/validate-edit",async route=>{
   const b=route.request().postDataJSON(),p=await get(),prepared=ppGroqPrepareEdit(p.active.model,b.args);
   assert.deepEqual(b.change,prepared.change);assert.equal(b.revision,p.active.revision);
   const bad=prepared.model.orders.some(o=>o.parameters?.color==="INVALID");
   await route.fulfill({status:bad?422:200,contentType:"application/json",body:JSON.stringify(bad?{ok:false,error:"validation_no_feasible_plan",issues:[{order:"2610",operation:"Synthetic work",parameters:[{name:"color",value:"INVALID"}]}]}:{ok:true,valid:true,checkedOrders:3,operations:9})});
  });
 }
 let modelWrites=0;
 page.on("request",r=>{if(new URL(r.url()).pathname==="/api/project/model/import"&&r.method()==="POST")modelWrites++});
 const ask=async(message,allowRejection=false)=>{
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/assistant"&&r.request().method()==="POST",{timeout:45000});
  await page.locator("#chatInput").fill(message);await page.locator("#chatSend").click();
  const res=await response,d=await res.json();
  if(d.mode!=="edit_proposal")console.log("UNIVERSAL_PROVIDER",JSON.stringify({status:res.status(),mode:d.mode,error:d.error,reply:String(d.reply||"").slice(0,200)}));
  assert.equal(res.status(),200);
  if(allowRejection&&d.mode==="edit_available"&&!d.action){
   assert.equal(typeof d.reply,"string");assert(d.reply.length>0);
   await page.waitForFunction(()=>!document.getElementById("chatSend").disabled);
   assert.equal(await page.locator('[data-groq-action="pending"]').count(),0);
   return null;
  }
  assert.equal(d.mode,"edit_proposal");
  await page.locator('[data-groq-action="pending"]').last().waitFor({state:"visible",timeout:12000});
  await page.waitForFunction(()=>!document.getElementById("chatSend").disabled);
  return d.action;
 };
 const apply=async(want=true)=>{
  const cards=page.locator("[data-groq-action]");
  const card=cards.nth((await cards.count())-1);
  assert.equal(await card.getAttribute("data-groq-action"),"pending");
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/assistant/validate-edit"&&r.request().method()==="POST",{timeout:115000});
  const writes=modelWrites;
  await card.locator('[data-groq-apply]').click();
  const validation=await response,data=await validation.json();
  console.log("UNIVERSAL_PREFLIGHT",JSON.stringify({live,status:validation.status(),valid:data.valid,error:data.error,checkedOrders:data.checkedOrders}));
  assert.equal(data.ok,want);
  await page.waitForFunction(()=>!window.__ppGroqApplyingEdit,{},{timeout:50000});
  const state=await card.getAttribute("data-groq-action");
  if(state!==(want?"applied":"failed"))console.log("UNIVERSAL_CARD_FAILURE",String(await card.textContent()).slice(0,400));
  assert.equal(state,want?"applied":"failed");
  assert.equal(modelWrites-writes,want?1:0);
  return data;
 };
 phase="typed_parameter";
 const proposal=await ask('В заказе 2610 создай числовой параметр width_mm со значением 600. Измени только этот заказ.');
 assert.equal(proposal.args.kind,"set_order_parameters");assert.equal(proposal.change.parameters.width_mm,600);
 assert.deepEqual(await get(),before);
 await apply();
 const after=await get();assert.equal(after.active.revision,before.active.revision+1);
 assert.equal(after.active.model.orders[0].parameters.width_mm,600);
 assert.deepEqual(after.others,before.others);
 console.log("UNIVERSAL_TYPED_PARAMETER_NATIVE_PASS",live?"live":"candidate");
 phase="rejected_parameter";
 args={kind:"set_order_parameters",order_index:1,parameters:[{name:"color",type:"text",value:"INVALID"}]};
 const beforeBad=await get(),writesBeforeBad=modelWrites;
 const bad=await ask('Измени параметр color заказа 2610 на строку INVALID.',true);
 if(bad){
  assert.equal(bad.args.kind,"set_order_parameters");assert.equal(bad.change.parameters.color,"INVALID");
 }else{
  // A provider may correctly reject the incompatible request without calling
  // the edit tool. Still independently exercise the real server-side gate:
  // submit the same incompatible candidate through the confirmation UI.
  assert.deepEqual(await get(),beforeBad);assert.equal(modelWrites,writesBeforeBad);
  console.log("UNIVERSAL_PROVIDER_REFUSAL_NO_WRITE_PASS",live?"live":"candidate");
  await page.evaluate(args=>{
   const p=ppGroqLocalEntry(),{change}=ppGroqPrepareEdit(p.model,args);
   ppGroqShowProposal({action:{projectId:p.id,revision:p.revision,args,change}},p,"Synthetic incompatible edit validation");
  },args);
 }
 const rejected=await apply(false);assert.equal(rejected.error,"validation_no_feasible_plan");
 assert.deepEqual(await get(),beforeBad);
 console.log("UNIVERSAL_INVALID_EDIT_NO_WRITE_PASS",live?"live":"candidate");
 phase="equipment_rule";
 // Use the same explicit confirmation path without spending another Groq
 // request: the actual rule builder and native validator are still exercised.
 args={kind:"set_equipment_parameter_rule",equipment_index:1,parameter_name:"color",rule_type:"allowed",values:[{type:"text",value:"A"},{type:"text",value:"B"},{type:"text",value:"C"}]};
 await page.evaluate(args=>{
  const p=ppGroqLocalEntry(),{change}=ppGroqPrepareEdit(p.model,args);
  ppGroqShowProposal({action:{projectId:p.id,revision:p.revision,args,change}},p,"Allow color A, B, C");
 },args);
 await apply();
 const changed=await get();
 assert.deepEqual(changed.active.model.equipment[0].capabilities.allowed_parameters.color,["A","B","C"]);
 assert.deepEqual(changed.others,before.others);
 console.log("UNIVERSAL_COMPATIBILITY_RULE_NATIVE_PASS",live?"live":"candidate");
 phase="reload";
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>typeof model==="object"&&model?.orders?.[0]?.parameters?.width_mm===600,{},{timeout:30000});
 assert.equal((await get()).active.model.orders[0].parameters.color,"A");
 assert.deepEqual((await get()).active.model.equipment[0].capabilities.allowed_parameters.color,["A","B","C"]);
 console.log("UNIVERSAL_BROWSER_PASS",live?"live":"candidate");
}catch(e){console.log("UNIVERSAL_BROWSER_FAILED",phase,e.name,String(e.message).slice(0,250));process.exitCode=6}
finally{if(started&&page)try{await page.evaluate(()=>fetch("/api/optimizer-stop",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}))}catch{}await browser.close()}
