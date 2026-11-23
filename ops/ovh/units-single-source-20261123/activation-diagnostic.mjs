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
 const i=html.indexOf("function ppIncumbentCurrentPlan()");
 const j=html.indexOf("function rr(r){");
 console.log("UNITS_LIVE_HTML_FLAGS",JSON.stringify({status:r.status(),bytes:html.length,headers:r.headers(),
   flags,incumbentSource:i<0?"missing":html.slice(i,i+460),unitField:j<0?"missing":html.slice(j,j+2300)}).slice(0,7200));
}finally{await browser.close()}
