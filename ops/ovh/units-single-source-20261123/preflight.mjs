import {chromium} from "playwright-core";
import {randomUUID,randomBytes} from "node:crypto";
import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";
const source=readFileSync("ops/ovh/units-single-source-20261123/resource-units-html.js","utf8");
const context={};vm.runInNewContext(source+";this.transform=ppResourceUnitsHtml;",context);
const transform=context.transform;
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1580,height:1000}});
 const errors=[];page.on("pageerror",e=>errors.push(String(e)));
 let r=await page.goto("https://app.liftorbit.app",{waitUntil:"domcontentloaded",timeout:45000});
 assert.equal(r.status(),200);
 const email="unit-single-qa-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid";
 const password=randomBytes(25).toString("base64url");
 const reg=await page.evaluate(async({email,password})=>{
  const r=await fetch("/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({email,password,company:"Unit source isolated QA"})});return r.status
 },{email,password});
 assert.equal(reg,200);
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 const body=await page.content();
 assert(body.includes("function rr(r){"),"full native Production editor source available");
 assert(body.includes("function renderMaterials(){"));
 const transformed=transform(body);
 assert(transformed.includes("function ppCanonicalRequirementUnit"));
 assert(transformed.includes("readonly aria-readonly=\"true\""));
 assert(transformed.includes("ppNormalizeRequirementUnits(next)"));
 assert(!transformed.includes("data-rf=\"unit\" value=\"'+esc(r.unit||"));
 assert.equal(transform("not the native production HTML"),"not the native production HTML");
 console.log("UNITS_ACTUAL_NATIVE_HTML_TRANSFORM_PASS",JSON.stringify({bytesBefore:body.length,bytesAfter:transformed.length,delta:transformed.length-body.length}));
 const id="prj_units_"+randomUUID().replaceAll("-").slice(0,13);
 const model={
  scheduler_mode:"resource",start:"2026-11-23T08:00:00",quantity_unit:"м²",
  orders:[{id:"2601",area:20,quantity:20,unit:"м²",technical_process_id:"TP-1",process_hours:1}],
  autoclaves:[{id:"EQ-1",name:"Press",kind:"pressing",capacity:500,capacity_unit:"м²"}],
  equipment:[{id:"EQ-1",name:"Press",kind:"pressing",capacity:500,capacity_unit:"м²"}],
  employees:[{id:"EMP-1",name:"Operator",role:"Press operator",shift:"day"}],
  shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},
  materials:[{id:"M1",name:"Powder",unit:"кг",initial_stock:185000,deliveries:[]},
    {id:"M2",name:"Boxes",unit:"шт.",initial_stock:1000,deliveries:[]}],
  technical_processes:[{id:"TP-1",name:"Ceramics",operations:[{
   id:"OP-1",sequence:1,name:"Pressing",duration_min:40,parallel_allowed:false,
   resource_requirements:[
    {id:"RR-M1",resource_type:"material",match_mode:"specific",resource_ref:"M1",quantity:18.5,unit:"шт.",consumption_rule:"per_m2"},
    {id:"RR-E",resource_type:"equipment",match_mode:"specific",resource_ref:"EQ-1",quantity:1,unit:"кг",consumption_rule:"during_operation"},
    {id:"RR-L",resource_type:"employee",match_mode:"specific",resource_ref:"EMP-1",quantity:1,unit:"кг",consumption_rule:"during_operation"}
   ]}]}],
  setup_rules:[]
 };
 const projects=JSON.stringify([{id,name:"Unit source QA",model,revision:1}]);
 const stored=await page.evaluate(async ({id,projects})=>{
  const r=await fetch("/api/db-storage",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({storage:{"prodplan.projects.v2":projects,"prodplan.project.active.v2":id}})});
  return r.status;
 },{id,projects});
 assert.equal(stored,200,"isolated project save");
 await page.route("**/","route" in {}?()=>{}:async route=>{
  if(route.request().isNavigationRequest()&&new URL(route.request().url()).pathname==="/"){
   const resp=await route.fetch();
   let html=await resp.text();
   if(html.includes("function rr(r){"))html=transform(html);
   return route.fulfill({response:resp,body:html,headers:{...resp.headers(),"content-type":"text/html; charset=utf-8"}});
  }
  return route.continue();
 });
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForTimeout(1250);
 const diag=await page.evaluate(()=>({
  active:localStorage.getItem("prodplan.project.active.v2"),
  projectCount:JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]").length,
  route:location.pathname,
  renderSectionType:typeof renderSection,
  modelDefined:typeof model,
  section:!!document.getElementById("sectionView"),
  unitPatch: [...document.scripts].some(x=>x.textContent?.includes("function ppCanonicalRequirementUnit")),
  nav:[...document.querySelectorAll("a,button,[role=tab],.nav-item")].filter(x=>/Производство|Материалы|Production|Materials/i.test(x.textContent||"")).map(x=>({text:x.textContent?.trim(),html:x.outerHTML.slice(0,180)})).slice(0,15)
 }));
 console.log("UNITS_PATCHED_BROWSER_CONTEXT",JSON.stringify(diag).slice(0,3000));
 assert(diag.unitPatch,"new unit source in loaded browser");
 assert.equal(errors.length,0,"modified HTML must not break browser scripts "+JSON.stringify(errors.slice(0,4)));
 console.log("UNITS_PATCHED_NATIVE_JS_EXECUTION_PASS");
}finally{await browser.close()}
