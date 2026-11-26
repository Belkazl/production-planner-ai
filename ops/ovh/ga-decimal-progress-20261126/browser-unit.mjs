import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-decimal-test/node_modules/playwright-core");
const source=readFileSync(process.argv[2],"utf8");
const start=source.indexOf(";(function ppOneSseProgressAndGantt(){");
const end=source.indexOf("\n})();",start)+6;
assert(start>=0&&end>start);
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage();
 await page.route("https://qa.example/",route=>route.fulfill({status:200,contentType:"text/html",body:'<!doctype html><html lang="en"><head></head><body><button id="opt" class="pp-opt-running">Optimize</button></body></html>'}));
 await page.goto("https://qa.example/");
 await page.evaluate(()=>{
   window.__testCalls=0;
   window.__testAllowFinal=false;
   window.fetch=async()=>{
     window.__testCalls++;
     await new Promise(resolve=>{window.__testRelease=resolve});
     return Response.json({success:true,phase:"completed",result:{valid:true,operations:[{start:0,end:10}]}});
   };
   window.EventSource=class {
     constructor(){this.listeners=new Map();this.readyState=1;window.__testStream=this;}
     addEventListener(name,fn){this.listeners.set(name,fn);}
     close(){this.readyState=2;}
     emit(name,data){this.listeners.get(name)?.({data:JSON.stringify(data)});}
   };
 });
 await page.addScriptTag({content:source.slice(start,end)});
 const state=()=>page.evaluate(()=>({text:document.querySelector(".pp-sse-label")?.textContent,percent:window.__PP_SSE_PROGRESS_V1__?.state.percent,completed:window.__PP_SSE_PROGRESS_V1__?.state.completed,calls:window.__testCalls,fill:document.querySelector(".pp-sse-fill")?.style.width}));
 const event=(name,data)=>page.evaluate(({name,data})=>window.__testStream.emit(name,data),{name,data});
 assert.equal((await state()).text,"0.00%");
 await event("progress",{job_id:"qa",percent:13.27,phase:"running"});
 assert.deepEqual(await state(),{text:"13.27%",percent:13.27,completed:false,calls:0,fill:"13.27%"});
 await page.waitForTimeout(500);
 assert.equal((await state()).percent,13.27,"no artificial timer advances");
 await event("progress",{job_id:"qa",percent:13.26,phase:"running"});
 assert.equal((await state()).percent,13.27,"stale update ignored");
 await event("progress",{job_id:"foreign",percent:98,phase:"running"});
 assert.equal((await state()).percent,13.27,"foreign job ignored");
 await page.evaluate(()=>document.documentElement.lang="ru");
 await event("progress",{job_id:"qa",percent:13.28,phase:"running"});
 assert.equal((await state()).text,"13,28%");
 await event("progress",{job_id:"qa",percent:100,phase:"completed"});
 assert.equal((await state()).percent,99.99);
 assert.equal((await state()).completed,false);
 await event("complete",{job_id:"qa",percent:100,verified:true});
 await page.waitForFunction(()=>typeof window.__testRelease==="function");
 assert.equal((await state()).percent,99.99);
 assert.equal((await state()).calls,1);
 await page.evaluate(()=>window.__testRelease());
 await page.waitForFunction(()=>window.__PP_SSE_PROGRESS_V1__.state.completed);
 assert.equal((await state()).text,"Продолжить · 100,00%");
 assert.equal((await state()).percent,100);
 assert.equal((await state()).calls,1);
 await page.evaluate(()=>{window.__PP_SSE_PROGRESS_V1__.stop();window.__PP_SSE_PROGRESS_V1__.start()});
 assert.equal((await state()).text,"0,00%");
 assert.equal((await state()).percent,0);
 console.log("DECIMAL_UI_EXACT_SSE_LOCALE_TERMINAL_PASS");
}finally{await browser.close()}
