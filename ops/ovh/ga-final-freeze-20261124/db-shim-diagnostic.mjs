import { chromium } from "playwright-core";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1300,height:800}});
 const resp=await page.goto("https://app.liftorbit.app",{waitUntil:"domcontentloaded",timeout:45000});
 assert.equal(resp.status(),200);
 const email="ga-db-shim-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid";
 const password=randomBytes(26).toString("base64url");
 assert.equal(await page.evaluate(async ({email,password})=>{
  const r=await fetch("/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({email,password,company:"Isolated persistence QA"})});return r.status;
 },{email,password}),200);
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 const htmlInfo=await page.evaluate(()=>{
  const s=document.getElementById("db-persistence-shim")?.textContent||"";
  const re=/sync\s*\(|\.open\(|XMLHttpRequest|send\(|setItem|fetch\(|queueMicrotask|setTimeout|async /g;
  const hits=[];
  for(const x of s.matchAll(re)){if(hits.length>=38)break;hits.push({term:x[0],at:x.index,around:s.slice(Math.max(0,x.index-190),x.index+230)})}
  return {bytes:s.length,hasShim:!!s,hasNonblocking:s.includes("debounce")||s.includes("queueMicrotask")||s.includes("setTimeout(doSync"),
   flags:Object.keys(window.__PP_DB_PERSISTENCE__||{}),starts:s.slice(0,1200),hits};
 });
 console.log("GA_DB_SHIM_CONTENT",JSON.stringify(htmlInfo).slice(0,14500));
 await page.evaluate(()=>{
  window.__gaStorageProbe={opens:[],sends:[]};
  const oldOpen=XMLHttpRequest.prototype.open,oldSend=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(method,url,async,...args){
   window.__gaStorageProbe.opens.push({method,url,async,at:Date.now()});
   return oldOpen.call(this,method,url,async,...args)
  };
  XMLHttpRequest.prototype.send=function(...args){
   const start=performance.now();
   try{return oldSend.apply(this,args)}
   finally{window.__gaStorageProbe.sends.push({ms:Math.round(performance.now()-start),at:Date.now()})}
  };
 });
 const perf=await Promise.race([
  page.evaluate(()=>{
   const prior=localStorage.getItem("prodplan.projects.v2")||"[]";
   const t=performance.now();localStorage.setItem("prodplan.projects.v2",prior);
   return {setItemMs:Math.round(performance.now()-t),calls:window.__gaStorageProbe,
    valueBytes:prior.length,modelCount:JSON.parse(prior).length};
  }),
  new Promise((_,reject)=>setTimeout(()=>reject(Error("STORAGE_WRITE_BLOCKED_OVER_12000_MS")),12000))
 ]);
 console.log("GA_DB_SHIM_SAVED_PLAN_WRITE",JSON.stringify(perf).slice(0,14000));
 await page.waitForTimeout(2000);
 console.log("GA_DB_SHIM_LATE",JSON.stringify(await page.evaluate(()=>window.__gaStorageProbe)).slice(0,4000));
}finally{await Promise.race([browser.close(),new Promise(r=>setTimeout(r,2500))])}
