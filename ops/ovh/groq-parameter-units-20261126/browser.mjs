import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {source as oldSource} from "../groq-universal-parameters-20261126/actions-ui.mjs";
import {source} from "./patch.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-groq-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.PARAMETER_UNITS_LIVE==="1";
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
 const results=await page.evaluate(()=>{
  const cases=[
   {unit:"m²",parameters:{width_mm:600,length_mm:600,thickness_mm:9,mass_kg_m2:18,product_code:"TILE-2601",finish:"matt",design_family:"White",firing_recipe:"PS-01"}},
   {unit:"kg",parameters:{flavor:"vanilla",fat_pct:12,freeze_temperature_c:-18,packaging:"cup",portion_g:100}}
  ];
  return cases.map((c,i)=>{
   const model={quantity_unit:c.unit,orders:[{id:2601,quantity:100,area:100,unit:c.unit,technical_process_id:"P",parameters:c.parameters}],technical_processes:[{id:"P",name:"Synthetic process",operations:[{id:"OP",duration_min:10}]}],equipment:[]};
   const snapshot={id:"synthetic-display-"+i,revision:1,model};
   const args={kind:"add_order",quantity:600},prepared=ppGroqPrepareEdit(model,args);
   const description=ppGroqActionDescription(prepared.change);
   ppGroqShowProposal({action:{projectId:snapshot.id,revision:1,args,change:prepared.change}},snapshot,"Synthetic display QA");
   const card=[...document.querySelectorAll('[data-groq-action="pending"]')].at(-1);
   if(!card)throw Error("proposal missing");
   const text=card.children[1].textContent,visible=card.getClientRects().length>0;
   card.querySelector("[data-groq-cancel]").click();
   return {unit:c.unit,parameters:c.parameters,text,description,visible,cancelled:card.dataset.groqAction};
  });
 });
 for(const c of results){
  assert(c.visible);assert.equal(c.cancelled,"cancelled");
  assert.equal(c.text,c.description);
  const lines=c.text.split("\n");
  assert(lines.includes("600 "+c.unit));
  assert.equal(lines.filter(x=>x.endsWith(" "+c.unit)).length,1);
  for(const [k,v] of Object.entries(c.parameters))assert(lines.includes(k+": "+v),k+" has incorrect unit");
 }
 assert.equal(imports,0);
 console.log("PARAMETER_UNITS_BROWSER_PASS",live?"live":"candidate");
}finally{await browser.close()}
