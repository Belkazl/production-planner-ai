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
   technical_processes:[{id:"P",name:"Synthetic process",operations:[{id:"OP",name:"Synthetic work",sequence:1,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M1",resource_refs:["M1"],quantity:1,unit:"pcs"}]}]}]};
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
 const cases=[
 ["Create equipment named Synthetic mixer, kind mixer, capacity 200 m2, fixed processing time 10 minutes.",{kind:"manage_entity",entity:"equipment",verb:"create",name:"Synthetic mixer",equipment_kind:"mixer",capacity:200,unit:"m2",duration_minutes:10}],
 ["Create employee named Synthetic operator with role operator.",{kind:"manage_entity",entity:"employee",verb:"create",name:"Synthetic operator",role:"operator"}],
 ["Create material named Synthetic powder, initial stock 1000 kg.",{kind:"manage_entity",entity:"material",verb:"create",name:"Synthetic powder",stock:1000,unit:"kg"}],
 ["Create technical process named Synthetic mixing with one operation named Mix, duration 10 minutes, using one unit of Synthetic machine (equipment index 1), no other resources.",{kind:"manage_entity",entity:"process",verb:"create",name:"Synthetic mixing",operations:[{name:"Mix",duration_minutes:10,requirements:[{resource_type:"equipment",resource_index:1,quantity:1}]}]}]
 ];
 if(!live){
  const result=await page.evaluate(cases=>{
   const snapshot=ppGroqLocalEntry();
   return cases.map(([message,args])=>{
    const {change}=ppGroqPrepareEdit(snapshot.model,args);
    ppGroqShowProposal({action:{projectId:snapshot.id,revision:snapshot.revision,args,change}},snapshot,message);
    const card=[...document.querySelectorAll('[data-groq-action="pending"]')].at(-1);
    if(!card)throw Error("missing proposal");
    const visible=card.getClientRects().length>0,text=card.textContent;
    card.querySelector("[data-groq-cancel]").click();
    return {visible,text,state:card.dataset.groqAction};
   });
  },cases);
  for(const r of result){assert(r.visible);assert.equal(r.state,"cancelled");assert(r.text.includes("Synthetic"))}
  assert.equal(imports,0);console.log("ENTITY_BROWSER_CANDIDATE_PASS");
 }else{
  for(const [message,expected] of cases){
   const wait=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/assistant"&&r.request().method()==="POST",{timeout:50000});
   await page.locator("#chatInput").fill(message);await page.locator("#chatSend").click();
   const response=await wait,d=await response.json();
   assert.equal(response.status(),200);assert.equal(d.mode,"edit_proposal",String(d.reply||"").slice(0,200));
   assert.equal(d.action.args.kind,"manage_entity");assert.equal(d.action.args.entity,expected.entity);assert.equal(d.action.args.verb,"create");
   assert.equal(d.action.change.after.name,expected.name);
   const card=page.locator('[data-groq-action="pending"]').last();await card.waitFor({state:"visible",timeout:12000});
   const writes=imports;
   await card.locator('[data-groq-apply]').click();
   await page.waitForFunction(()=>!window.__ppGroqApplyingEdit,{},{timeout:120000});
   await page.waitForFunction(()=>!document.querySelector('[data-groq-action="pending"]'),{},{timeout:20000});
   const latest=page.locator('[data-groq-action]').last();
   assert.equal(await latest.getAttribute("data-groq-action"),"applied",String(await latest.textContent()).slice(0,400));
   assert.equal(imports,writes+1);
   const saved=await page.evaluate(()=>ppGroqLocalEntry().model);
   const key={equipment:"equipment",employee:"employees",material:"materials",process:"technical_processes"}[expected.entity];
   assert(saved[key].some(x=>x.name===expected.name));
  }
  console.log("ENTITY_LIVE_FOUR_CREATES_PASS");
 }
}finally{await browser.close()}
