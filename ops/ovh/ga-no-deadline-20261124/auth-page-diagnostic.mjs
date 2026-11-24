import {chromium} from "playwright-core";
import {randomUUID,randomBytes} from "node:crypto";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage();
 await page.goto("https://app.liftorbit.app",{waitUntil:"domcontentloaded",timeout:45000});
 const email="ga-auth-diagnose-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid";
 const password=randomBytes(27).toString("base64url");
 const reg=await page.evaluate(async ({email,password})=>{
  const r=await fetch("/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({email,password,company:"Auth GA source QA"})});return r.status
 },{email,password});
 console.log("GA_AUTH_REGISTER",reg);
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForTimeout(2500);
 const data=await page.evaluate(async ()=>{
  const scripts=[...document.scripts].map(s=>({id:s.id||null,bytes:(s.textContent||"").length,
   markerGA:(s.textContent||"").includes("__PP_ASYNC_PLAN_TRANSPORT__"),
   markerUnits:(s.textContent||"").includes("ppCanonicalRequirementUnit"),
   markerSSE:(s.textContent||"").includes("__PP_SSE_PROGRESS_V1__"),
   markerRaw:(s.textContent||"").includes("ga_client_wait_timeout"),
   markerWait:(s.textContent||"").includes("function waitForPlan"),
   src:s.src||null})).slice(0,90);
  const resp=await fetch("/",{credentials:"same-origin",cache:"no-store"});
  const html=await resp.text();
  return {title:document.title,docLang:document.documentElement.lang,
    scripts,hasValidator:!!document.getElementById("validator"),
    hasValid:!!document.getElementById("valid"),
    htmlBytes:html.length,
    markers:{
     clientGlobal:window.__PP_ASYNC_PLAN_TRANSPORT__===true,
     clientSource:html.includes("__PP_ASYNC_PLAN_TRANSPORT__"),
     clientNew:html.includes("ppRouteGaDiagnosticsOutsideValidator"),
     clientOld:html.includes("ga_client_wait_timeout"),
     clientOldDeadline:html.includes("Date.now()+15*60*1000"),
     units:html.includes("ppCanonicalRequirementUnit"),
     sse:html.includes("ppOneSseProgressAndGantt")
    },
    headers:{UI:resp.headers.get("x-liftorbit-ui")},
    note:document.getElementById("validator")?.textContent?.slice(0,130)
   }
 });
 console.log("GA_AUTH_DELIVERED_PAGE_DIAG",JSON.stringify(data).slice(0,14500));
}finally{await browser.close()}
