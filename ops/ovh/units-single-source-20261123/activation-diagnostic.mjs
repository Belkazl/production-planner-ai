import {chromium} from "playwright-core";
import {randomUUID,randomBytes} from "node:crypto";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage();
 let r=await page.goto("https://app.liftorbit.app",{waitUntil:"domcontentloaded",timeout:45000});
 const email="unit-activation-audit-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid";
 const password=randomBytes(26).toString("base64url");
 const reg=await page.evaluate(async ({email,password})=>{
  const r=await fetch("/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({email,password,company:"Unit activation read-only"})});
  return r.status;
 },{email,password});
 if(reg!==200)throw Error("REG_"+reg);
 r=await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 const html=await page.content();
 const markers=["function rr(r){","function ppCanonicalRequirementUnit",
  "function ppNormalizeRequirementUnits","function ppIncumbentCurrentPlan(){let saved=null;",
  "function ppIncumbentCurrentPlan(){if(window.__ppFreshRestartPending",
  "window.__ppFreshReferencePlan=d","id=\"ppOptimizerStartOver\"",
  "PP_RESOURCE_UNITS","PP_START_OVER_INLINE","function renderMaterials(){"];
 const flags=Object.fromEntries(markers.map(x=>[x,html.includes(x)]));
 const routes=await page.evaluate(async()=>{
  const results=[];
  for(const path of ["/","/?ppGantt=legacy","/?ppGantt=equiponly","/?ppOptGuard=off","/__bridge_health"]){
   try{
    const response=await fetch(path,{credentials:"same-origin",cache:"no-store"});
    const body=await response.text();
    results.push({path,status:response.status,headers:Object.fromEntries(response.headers),
      length:body.length,marks:{
       native:body.includes("function rr(r){"),
       units:body.includes("function ppCanonicalRequirementUnit"),
       incumbent:body.includes("function ppIncumbentCurrentPlan(){let saved=null;"),
       freshHtml:body.includes("window.__ppFreshRestartPending"),
       restart:body.includes("pp-restart-optimizer-ui"),
       ganttScroll:body.includes('id="ganttScroll"'),
       ops:body.includes("function renderMaterials(){"),
       g2:body.includes('id="ppGanttToolV2"')
      },head:body.slice(0,120)});
   }catch(e){results.push({path,error:String(e).slice(0,160)})}
  }
  return results;
 });
 console.log("UNITS_ROUTE_DIAGNOSTIC",JSON.stringify(routes).slice(0,14000));
 const i=html.indexOf("function ppIncumbentCurrentPlan()");
 const j=html.indexOf("function rr(r){");
 console.log("UNITS_LIVE_HTML_FLAGS",JSON.stringify({status:r.status(),bytes:html.length,headers:r.headers(),
   flags,incumbentSource:i<0?"missing":html.slice(i,i+460),unitField:j<0?"missing":html.slice(j,j+2300)}).slice(0,7200));
}finally{await browser.close()}
