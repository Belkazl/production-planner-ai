import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-utilization-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.PP_SOLAR_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const register=await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic utilization QA"})})).status,{email:"utilization-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url")});
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
  const storage={"prodplan.projects.v2":JSON.stringify([{id,name:"Synthetic utilization QA",model,revision:1,lastPlan:null}]),"prodplan.project.active.v2":id};
  return (await fetch("/api/db-storage",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({storage})})).status;
 },id);
 assert.equal(seeded,200);
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>typeof window.__ppGroqRenderResourceUtilization==="function"&&typeof model==="object"&&model?.orders?.length===1,{},{timeout:30000});
 const result=await page.evaluate(()=>{
  const fn=window.__ppGroqRenderResourceUtilization.toString();
  const allowed=fn.length<16000&&!/password|secret|credential|api[_-]?key|authorization|token/i.test(fn);
  // The only source emitted is the existing public browser-side metric renderer.
  const source=allowed?fn:"renderer omitted";
  const scripts=[...document.scripts].map(s=>s.textContent||"");
  const matches=[];
  const patterns=[/resource_ref.{0,90}role:/g,/resource_ref.{0,90}kind:/g,/match_mode.{0,70}specific/g,/\b(?:equipment_calendar|equipment_calendars|shift_calendars|employee_calendar|availability_windows|work_calendar|working_days)\b/g];
  for(const s of scripts)for(const p of patterns){p.lastIndex=0;for(const m of s.matchAll(p)){const line=s.slice(Math.max(0,m.index-80),Math.min(s.length,m.index+180)).replace(/\s+/g," ");if(!/password|secret|credential|api[_-]?key|authorization|token/i.test(line)&&!matches.includes(line)&&matches.length<25)matches.push(line)}}
  return {source,matches};
 });
 console.log("UTILIZATION_RENDERER_SOURCE",JSON.stringify(result));
}finally{await browser.close()}
