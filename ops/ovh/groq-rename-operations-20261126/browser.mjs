import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {source as oldSource} from "../groq-parameter-units-20261126/patch.mjs";
import {source} from "./actions-ui.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-groq-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.GROQ_ACTIONS_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const register=await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic parameter formatter QA"})})).status,{email:"parameter-unit-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url")});
 assert.equal(register,200);
 // Open a valid synthetic project, since the empty-account Projects screen
 // hides the planner chat until a project is active.
 const id="prj_units_"+randomUUID().replaceAll("-","").slice(0,13);
 const seeded=await page.evaluate(async id=>{
  const model={scheduler_mode:"resource",quantity_unit:"m2",start:"2026-11-25T00:00:00",
   equipment:[{id:"M1",name:"Synthetic machine",kind:"workstation",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:10}}],
   orders:[{id:"2601",quantity:600,area:600,unit:"m2",technical_process_id:"P",parameters:{color:"A"}}],
   employees:[],materials:[],shifts:{},constraints:[],setup_rules:[],
   technical_processes:[{id:"P",name:"Synthetic process",operations:[{id:"OP",name:"Прессование",sequence:1,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M1",resource_refs:["M1"],quantity:1,unit:"pcs",consumption_rule:"during_operation"}]},{id:"OP2",name:"Сушка",sequence:2,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M1",resource_refs:["M1"],quantity:1,unit:"pcs",consumption_rule:"during_operation"}]}]}]};
  const storage={"prodplan.projects.v2":JSON.stringify([{id,name:"Synthetic formatter QA",model,revision:1,lastPlan:null}]),"prodplan.project.active.v2":id};
  return (await fetch("/api/db-storage",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({storage})})).status;
 },id);
 assert.equal(seeded,200);
 if(!live)await page.route("**/",async route=>{
  if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
  const response=await route.fetch(),html=await response.text();
  assert.equal(html.split(oldSource).length,2,"exact installed universal helper");
  await route.fulfill({response,body:html.replace(oldSource,source),headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
 });
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>typeof ppGroqShowProposal==="function"&&typeof ppGroqActionDescription==="function"&&typeof model==="object"&&model?.orders?.length===1,{},{timeout:30000});
 if(!await page.locator("#chatInput").isVisible()){
  const planning=page.getByText(/^(Planning|Планирование)$/).first();if(await planning.isVisible())await planning.click();
 }
 if(!await page.locator("#chatInput").isVisible()){
  const chat=page.getByText(/^(Chat|Чат)$/).first();if(await chat.isVisible())await chat.click();
 }
 await page.locator("#chatInput").waitFor({state:"visible",timeout:12000});
 let imports=0;
 page.on("request",r=>{if(new URL(r.url()).pathname==="/api/project/model/import"&&r.method()==="POST")imports++});
 const args={kind:"rename_operations",scope:"all",renames:[{process_index:1,operation_index:1,name:"Pressing"},{process_index:1,operation_index:2,name:"Drying"}]};
 const snapshot=await page.evaluate(()=>ppGroqLocalEntry());
 assert.equal(snapshot.model.technical_processes[0].operations.length,2);
 if(!live){
  const result=await page.evaluate(args=>{
   const s=ppGroqLocalEntry(),{change}=ppGroqPrepareEdit(s.model,args);
   ppGroqShowProposal({action:{projectId:s.id,revision:s.revision,args,change}},s,"Translate operation names");
   const card=[...document.querySelectorAll('[data-groq-action="pending"]')].at(-1);
   if(!card)throw Error("missing proposal");
   const text=card.textContent,visible=card.getClientRects().length>0;
   card.querySelector("[data-groq-cancel]").click();
   return {text,visible,state:card.dataset.groqAction};
  },args);
  assert(result.visible);assert.equal(result.state,"cancelled");assert(result.text.includes("Прессование → Pressing"));assert(result.text.includes("Сушка → Drying"));assert.equal(imports,0);
  console.log("RENAME_BROWSER_CANDIDATE_PASS");
 }else{
  const wait=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/assistant"&&r.request().method()==="POST",{timeout:50000});
  await page.locator("#chatInput").fill("измени названия операций на английские слова");await page.locator("#chatSend").click();
  const response=await wait,d=await response.json();
  console.log("RENAME_PROVIDER",JSON.stringify({status:response.status(),mode:d.mode,error:d.error,kind:d.action?.args?.kind,count:d.action?.change?.renames?.length}));
  assert.equal(response.status(),200);assert.equal(d.mode,"edit_proposal",String(d.reply||"").slice(0,200));assert.equal(d.action.args.kind,"rename_operations");assert.equal(d.action.args.scope,"all");assert.equal(d.action.change.renames.length,2);
  for(const r of d.action.change.renames){assert(/[A-Za-z]/.test(r.after));assert(!/[\u0400-\u04ff]/u.test(r.after))}
  const card=page.locator('[data-groq-action="pending"]').last();await card.waitFor({state:"visible",timeout:12000});
  assert.deepEqual(await page.evaluate(()=>ppGroqLocalEntry().model),snapshot.model);
  const writes=imports;await card.locator('[data-groq-apply]').click();
  await page.waitForFunction(()=>!document.querySelector('[data-groq-action="pending"]'),{},{timeout:125000});
  const latest=page.locator('[data-groq-action]').last();assert.equal(await latest.getAttribute("data-groq-action"),"applied",String(await latest.textContent()).slice(0,400));
  assert.equal(imports,writes+1);
  const saved=await page.evaluate(()=>ppGroqLocalEntry().model);
  for(const p of saved.technical_processes)for(const o of p.operations){
   const old=snapshot.model.technical_processes.find(x=>x.id===p.id).operations.find(x=>x.id===o.id);
   assert(old);assert.equal(o.duration_min,old.duration_min);assert.equal(o.sequence,old.sequence);
   assert.equal(o.name,d.action.change.renames.find(x=>x.operationId===String(o.id)).after);
  }
  await page.reload({waitUntil:"domcontentloaded",timeout:45000});
  await page.waitForFunction(()=>typeof ppGroqLocalEntry==="function"&&ppGroqLocalEntry()?.model?.technical_processes?.[0]?.operations?.length===2,{},{timeout:30000});
  const persisted=await page.evaluate(()=>ppGroqLocalEntry().model);
  for(const r of d.action.change.renames)assert.equal(persisted.technical_processes.find(p=>String(p.id)===r.processId).operations.find(o=>String(o.id)===r.operationId).name,r.after);
  console.log("RENAME_LIVE_SAVED_AND_RELOADED_PASS");
 }
}finally{await browser.close()}
