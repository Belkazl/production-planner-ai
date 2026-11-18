import {chromium} from "playwright-core";
import {randomUUID,randomBytes} from "node:crypto";
const base="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1650,height:960}});
const errors=[];
page.on("pageerror",e=>errors.push(String(e?.message||e).slice(0,150)));
try{
 await page.goto(base,{waitUntil:"domcontentloaded",timeout:50000});
 const registered=await page.evaluate(async({email,password})=>{
  const r=await fetch("/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password,company:"Disposable account plan diagnostic"})});
  return r.status;
 },{email:"qa-account-plan-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid",password:randomBytes(32).toString("hex")});
 if(registered!==200)throw Error("QA_REGISTER_"+registered);
 await page.goto(base,{waitUntil:"domcontentloaded",timeout:50000});
 await page.waitForFunction(()=>window.__PP_STOP_DEBUG__?.().reconnecting===false,null,{timeout:40000});
 const state=await page.evaluate(async()=>{
   const read=async path=>{try{const r=await fetch(path,{credentials:"same-origin",headers:{accept:"application/json"},cache:"no-store"});const data=await r.json();return{code:r.status,data}}catch(e){return{error:String(e).slice(0,80)}}};
   const m=await read("/api/model");
   const progress=await read("/api/plan-progress");
   const local=JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]");
   const norm=x=>({orders:(x?.orders||[]).length,equipment:(x?.equipment||x?.autoclaves||[]).length,
     processes:(x?.technical_processes||[]).length,setupRules:(x?.setup_rules||[]).length,materials:(x?.materials||[]).length});
   return {model:{code:m.code,...norm(m.data?.model)},progress:{code:progress.code,phase:progress.data?.phase,error:progress.data?.error},localProjects:local.map(x=>({name:x.name,revision:x.revision,...norm(x.model)})),
    ui:{modelReady:typeof modelReady==="undefined"?null:modelReady,activeProject:localStorage.getItem("prodplan.project.active.v2"),
       optLabel:document.getElementById("opt")?.textContent?.slice(0,75)},
    pageErrors:[]};
 });
 console.log("QA_ACCOUNT_DEFAULT_MODEL",JSON.stringify(state));
 if(errors.length)console.log("QA_JS_ERRORS",JSON.stringify(errors.slice(0,4)));
}catch(e){console.log("QA_ACCOUNT_INSPECTION_FAILED",String(e?.stack||e).slice(0,1300));process.exitCode=1}
finally{await browser.close()}
