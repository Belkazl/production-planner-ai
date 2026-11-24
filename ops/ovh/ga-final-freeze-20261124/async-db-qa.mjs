import {chromium} from "playwright-core";
import {randomUUID,randomBytes} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import assert from "node:assert/strict";
const preview=process.env.PP_GA_ASYNC_PREVIEW==="1";
let transform=x=>x;
if(preview){
 const source=readFileSync(process.env.PP_LANGUAGE_BUILD,"utf8");
 const replacement=readFileSync(process.env.PP_ASYNC_DB_SHIM_PATH,"utf8");
 const from=source.indexOf("function ppNonBlockingDbSyncHtml(html:string)");
 const to=source.indexOf("\nconst asyncDbShim=",from);
 assert(from>=0&&to>from);
 const js=source.slice(from,to).replace("html:string","html");
 const ctx={PP_ASYNC_DB_SHIM:replacement};
 runInNewContext(js+";this.transform=ppNonBlockingDbSyncHtml;",ctx);
 transform=ctx.transform;
 assert.equal(transform("<html>login</html>"),"<html>login</html>");
}
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1500,height:900}});
 const errors=[],responses=[];
 page.on("pageerror",e=>errors.push(String(e).slice(0,240)));
 page.on("response",r=>{if(new URL(r.url()).pathname==="/api/db-storage")responses.push({method:r.request().method(),status:r.status(),at:Date.now()})});
 let r=await page.goto("https://app.liftorbit.app",{waitUntil:"domcontentloaded",timeout:45000});
 assert.equal(r.status(),200);
 const email="ga-final-db-fix-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid";
 const password=randomBytes(27).toString("base64url");
 const reg=await page.evaluate(async ({email,password})=>{
  const r=await fetch("/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({email,password,company:"Final GA async DB QA"})});return r.status;
 },{email,password});
 assert.equal(reg,200,"disposable test registration");
 if(preview){
  await page.route("**/",async route=>{
   if(route.request().isNavigationRequest()&&new URL(route.request().url()).pathname==="/"){
    const resp=await route.fetch();
    const old=await resp.text();
    if(!old.includes('id="db-persistence-shim"'))throw Error("AUTH_NATIVE_PERSISTENCE_SHIM_NOT_FOUND");
    const fixed=transform(old);
    if(fixed===old)throw Error("ASYNC_DB_PREVIEW_NOT_APPLIED");
    return route.fulfill({response:resp,body:fixed,headers:{...resp.headers(),"content-type":"text/html; charset=utf-8"}});
   }
   await route.continue();
  });
 }
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>window.__PP_ASYNC_DB_SYNC__===true,null,{timeout:20000});
 const code=await page.evaluate(()=>{
  const s=document.getElementById("db-persistence-shim")?.textContent||"";
  return {length:s.length,asyncMarker:window.__PP_ASYNC_DB_SYNC__===true,
    noSynchronousPost:!s.includes("x.open('POST','/api/db-storage',false)"),
    queuedFlush:s.includes("ppWaitForSaves")&&s.includes("ppFlushSave"),
    initialHydration:s.includes("x.open('GET','/api/db-storage',false)"),
    unitEditor:[...document.scripts].some(x=>x.textContent?.includes("function ppCanonicalRequirementUnit"))};
 });
 assert(code.asyncMarker&&code.noSynchronousPost&&code.queuedFlush&&code.initialHydration&&code.unitEditor,
  "all actual native UI and DB contract invariants "+JSON.stringify(code));
 console.log("GA_FINAL_ASYNC_NATIVE_HTML_PASS",JSON.stringify({preview,...code}));
 await page.evaluate(()=>{
  window.__gaAsyncDbProbe=[];
  const old=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url,async,...rest){
   window.__gaAsyncDbProbe.push({method,url,async});
   return old.call(this,method,url,async,...rest);
  };
 });
 const token="ga-final-async-"+randomUUID();
 const ops=Array.from({length:933},(_,i)=>({
  id:"QA_"+i,operation_id:"QA_"+i,order:String(2600+i%12),
  equipment_ids:["EQ_"+i%14],employee_ids:["EMP_"+i%7],
  start_min:i*5,end_min:i*5+25,is_setup:i%9===0,
  operation_name:"Test operation "+i,duration_min:25
 }));
 const target=JSON.stringify({token,revision:1,lastPlan:{duration_minutes:8290,operations:ops}});
 const responsePromise=page.waitForResponse(resp=>new URL(resp.url()).pathname==="/api/db-storage"&&
  resp.request().method()==="POST"&&resp.status()===200,{timeout:25000});
 const metrics=await page.evaluate(({token,target})=>{
  const t=performance.now();
  localStorage.setItem("pp.ga-final.nonblocking."+token,target);
  const ms=performance.now()-t;
  return {setItemMs:Math.round(ms),bytes:target.length,xhr:window.__gaAsyncDbProbe};
 },{token,target});
 assert(metrics.setItemMs<350,"localStorage write must not block on server "+JSON.stringify(metrics));
 assert(!metrics.xhr.some(x=>x.method==="POST"&&x.async===false),
  "there must be NO synchronous DB POST in native UI");
 await responsePromise;
 const stored=await page.evaluate(async token=>{
  const r=await fetch("/api/db-storage",{method:"GET",credentials:"same-origin",cache:"no-store"});
  const d=await r.json();
  return {status:r.status,match:d.storage?.["pp.ga-final.nonblocking."+token]?.includes('"revision":1')||false};
 },token);
 assert.equal(stored.status,200);assert(stored.match,"server must contain saved large final-plan payload");
 console.log("GA_FINAL_ASYNC_933_OPERATIONS_SAVED",JSON.stringify({...metrics,stored,responses:responses.slice(-8)}));
 const repeat=JSON.stringify({token,revision:2,lastPlan:{duration_minutes:8290,operations:ops}});
 const send2=page.waitForResponse(resp=>new URL(resp.url()).pathname==="/api/db-storage"&&resp.request().method()==="POST"&&resp.ok(),{timeout:25000});
 const fast=await page.evaluate(({token,repeat})=>{
  const t=performance.now();localStorage.setItem("pp.ga-final.nonblocking."+token,repeat);
  return Math.round(performance.now()-t);
 },{token,repeat});
 assert(fast<350,"second accepted plan save blocks browser");
 await send2;
 const result=await page.evaluate(async token=>{
  const r=await fetch("/api/db-storage",{cache:"no-store"});
  const d=await r.json();return {http:r.status,revision:JSON.parse(d.storage["pp.ga-final.nonblocking."+token]).revision};
 },token);
 assert.equal(result.revision,2);
 console.log("GA_FINAL_ASYNC_CONSECUTIVE_SAVE_ORDER_PASS",JSON.stringify({secondWriteMs:fast,...result}));
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 const hydrated=await page.evaluate(token=>JSON.parse(localStorage.getItem("pp.ga-final.nonblocking."+token)||"null")?.revision,token);
 assert.equal(hydrated,2,"saved result must survive reload");
 console.log("GA_FINAL_ASYNC_RELOAD_PERSISTENCE_PASS",JSON.stringify({hydrated,errors:errors.slice(0,6)}));
 console.log("GA_FINAL_ASYNC_BROWSER_TEST_PASS");
}finally{await Promise.race([browser.close(),new Promise(resolve=>setTimeout(resolve,2500))])}
