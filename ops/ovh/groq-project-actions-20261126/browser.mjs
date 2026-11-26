import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {transformActionsHtml,source} from "./actions-ui.mjs";
import {ppGroqPrepareEdit} from "./prepare.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-groq-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.GROQ_ACTIONS_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
let phase="register";
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const first=await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});assert.equal(first.status(),200);
 const request=(path,method="GET",body)=>page.evaluate(async({path,method,body})=>{
  const r=await fetch(path,{method,credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json","Accept":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  let data={};try{data=await r.json()}catch{}return {status:r.status,data};
 },{path,method,body});
 const email="groq-write-qa-"+randomUUID()+"@liftorbit.invalid",password=randomBytes(25).toString("base64url");
 assert.equal((await request("/api/auth/register","POST",{email,password,company:"Synthetic assistant write QA"})).status,200);
 const id="prj_actions_"+randomUUID().replaceAll("-","").slice(0,13),otherId=id+"_other";
 const req=(ref)=>({resource_type:"equipment",resource_ref:ref,resource_refs:[ref],match_mode:"specific",quantity:1,unit:"pcs",consumption_rule:"during_operation"});
 const model={scheduler_mode:"resource",start:"2026-11-25T08:00:00",quantity_unit:"pcs",
  orders:[{id:2606,quantity:900,area:900,unit:"pcs",technical_process_id:"TP1",process_hours:1},{id:2607,quantity:800,area:800,unit:"pcs",technical_process_id:"TP1",process_hours:1}],
  equipment:[{id:"M1",name:"Synthetic press",kind:"pressing",capacity:200,capacity_unit:"pcs",timing_profile:{timing_mode:"throughput",throughput_per_hour:60}}],
  employees:[],shifts:{},materials:[],setup_rules:[],technical_processes:[{id:"TP1",name:"Synthetic production process",operations:[{id:"OP1",name:"Synthetic pressing",sequence:1,duration_min:60,resource_requirements:[req("M1")]}]}]};
 const other={id:otherId,name:"Synthetic unrelated project",model:{...model,orders:[{id:999,quantity:987,area:987,unit:"pcs",technical_process_id:"TP1"}]},revision:9};
 const records=[{id,name:"Synthetic project edit QA",model,revision:1,lastPlan:null},other];
 const storage={"prodplan.projects.v2":JSON.stringify(records),"prodplan.project.active.v2":id};
 assert.equal((await request("/api/db-storage","POST",{storage})).status,200);
 if(!live){
  await page.route("**/",async route=>{
   if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
   const response=await route.fetch(),html=await response.text(),output=transformActionsHtml(html,source);
   if(!output.includes("PP_GROQ_ACTIONS_V1"))console.log("GROQ_ACTIONS_CANDIDATE_ANCHOR_DRIFT");
   await route.fulfill({response,body:output,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
  });
 }
 phase="planner";
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>typeof model==="object"&&model?.orders?.length===2&&typeof ppGroqShowProposal==="function",{},{timeout:30000});
 if(!await page.locator("#chatInput").isVisible()){const n=page.getByText(/^(Planning|Планирование)$/).first();if(await n.isVisible())await n.click()}
 if(!await page.locator("#chatInput").isVisible()){const n=page.getByText(/^(Chat|Чат)$/).first();if(await n.isVisible())await n.click()}
 await page.locator("#chatInput").waitFor({state:"visible",timeout:12000});
 const get=()=>page.evaluate(()=>{
  const id=localStorage.getItem("prodplan.project.active.v2"),arr=JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]");
  return {id,active:arr.find(p=>p.id===id),others:arr.filter(p=>p.id!==id)};
 });
 const before=await get();assert.equal(before.id,id);assert.equal(before.active.model.orders.length,2);
 assert(!/Read-only|Только чтение/i.test(await page.locator("#ppGroqNotice").textContent()));
 // Ensure the authenticated storage has caught up with native project opening.
 assert.equal((await request("/api/db-storage")).status,200);
 let nextArgs={kind:"add_order",quantity:600};
 if(!live)await page.route("**/api/assistant",async route=>{
  const b=route.request().postDataJSON(),p=await get(),{change}=ppGroqPrepareEdit(p.active.model,nextArgs);
  assert.equal(b.allowActions,true);assert.equal(b.viewContext.projectId,id);assert.equal(b.viewContext.revision,p.active.revision);
  await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true,reply:"Confirm the proposed change.",mode:"edit_proposal",action:{projectId:id,revision:p.active.revision,args:nextArgs,change}})});
 });
 const ask=async(message)=>{
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/assistant"&&r.request().method()==="POST",{timeout:45000});
  await page.locator("#chatInput").fill(message);await page.locator("#chatSend").click();
  const r=await response,d=await r.json();
  if(r.status()!==200||!d.action)console.log("GROQ_ACTIONS_PROVIDER_RESULT",JSON.stringify({status:r.status(),mode:d.mode,error:d.error,reply:String(d.reply||"").slice(0,200)}));
  assert.equal(r.status(),200);assert.equal(d.ok,true);assert.equal(d.mode,"edit_proposal");
  await page.locator('[data-groq-action="pending"]').last().waitFor({state:"visible",timeout:10000});
  await page.waitForFunction(()=>!document.getElementById("chatSend").disabled);
  return d.action;
 };
 phase="add_order_proposal";
 const action=await ask("добавь ещё один заказ объёмом 600");
 assert.equal(action.args.kind,"add_order");assert.equal(action.change.after,600);
 assert.equal(action.projectId,id);assert.equal(action.revision,before.active.revision);
 assert.deepEqual(await get(),before,"proposals must not write before the user confirms");
 console.log("GROQ_ACTIONS_PROPOSAL_NO_WRITE_PASS",live?"live":"candidate");
 phase="native_apply";
 const card=page.locator('[data-groq-action="pending"]').last();
 await card.locator('[data-groq-apply]').click();
 await page.waitForFunction(()=>!window.__ppGroqApplyingEdit&&document.querySelector('[data-groq-action="applied"],[data-groq-action="failed"]'),{},{timeout:50000});
 const failed=page.locator('[data-groq-action="failed"]').last();
 if(await failed.count())console.log("GROQ_ACTIONS_NATIVE_FAILURE",String(await failed.textContent()).slice(0,350));
 assert.equal(await page.locator('[data-groq-action="applied"]').count(),1);
 const after=await get();assert.equal(after.active.revision,before.active.revision+1);
 assert.equal(after.active.model.orders.length,3);assert.deepEqual(after.others,before.others);
 const created=after.active.model.orders.find(o=>String(o.id)===action.change.record);
 assert(created);assert.equal(Number(created.quantity),600);assert.equal(created.technical_process_id,"TP1");
 assert.equal(after.active.lastPlan,null);
 const db=await request("/api/db-storage");assert.equal(db.status,200);
 const persisted=JSON.parse(db.data.storage["prodplan.projects.v2"]);
 assert.equal(persisted.find(p=>p.id===id).model.orders.length,3);
 assert.deepEqual(persisted.find(p=>p.id===otherId),before.others[0]);
 console.log("GROQ_ACTIONS_NATIVE_SAVE_PASS",JSON.stringify({live,quantity:created.quantity,orderCount:3,revision:after.active.revision}));
 phase="cancel";
 nextArgs={kind:"update_order",order_index:1,quantity:700};
 const edit=await ask("Измени объём заказа 2606 на 700");
 assert.equal(edit.args.kind,"update_order");assert.equal(edit.change.after,700);
 await page.locator('[data-groq-action="pending"]').last().locator('[data-groq-cancel]').click();
 assert.deepEqual(await get(),after);
 console.log("GROQ_ACTIONS_CANCEL_PASS");
 phase="reload";
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>typeof model==="object"&&model?.orders?.length===3,{},{timeout:25000});
 assert.equal((await get()).active.model.orders.find(o=>String(o.id)===action.change.record).quantity,600);
 console.log("GROQ_ACTIONS_BROWSER_PASS",live?"live":"candidate");
}catch(e){
 console.log("GROQ_ACTIONS_BROWSER_FAILED",phase,e.name,String(e.message).slice(0,220));
 process.exitCode=6;
}finally{await browser.close()}
