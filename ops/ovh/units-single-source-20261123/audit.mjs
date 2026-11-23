import {chromium} from "playwright-core";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
const browser=await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1600,height:1100}});
 const r=await page.goto("https://app.liftorbit.app",{waitUntil:"domcontentloaded",timeout:45000});
 assert.equal(r.status(),200);
 const email="units-audit-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid";
 const password=randomBytes(28).toString("base64url");
 const reg=await page.evaluate(async ({email,password})=>{
  const r=await fetch("/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({email,password,company:"Units isolated audit"})});
  return r.status;
 },{email,password});
 assert.equal(reg,200,"register test account");
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForTimeout(2000);
 const diag=await page.evaluate(()=>{
   const scripts=[...document.scripts].map(x=>x.textContent||"");
   const text=scripts.join("\n");
   const terms=[
      "function collectAndSave(name)", "function materialRow(", "function operationRow(", "function rr(", "function eopts(", "function bindProd(", "function save(", "function mats(", "function procs(", "function reqs(",
      "function resourceRow(", "function requirementRow(", "function reqRow(",
      "function collectAndSave(", "data-f=\\\"unit\\\"","data-f=\"unit\"",
      "data-f=\\\"resource_type\\\"","resource_requirements",
      "Требования к ресурсам","Расход задаётся внутри операций","function renderEditor",
      "function materialsOf", "function renderProduction", "function resourceOptions",
      "function collectProduction", "function ppMaterial"
   ];
   const matches=[];
   for(const term of terms){
      let i=text.indexOf(term);
      if(i>=0)matches.push({term,index:i,count:text.split(term).length-1,
        before:text.slice(Math.max(0,i-500),i),after:text.slice(i,i+8000)});
   }
   const nav=[...document.querySelectorAll("button,a,[role=tab],.nav-item")].filter(x=>/Производство|Материалы|Production|Materials/.test(x.textContent||""))
     .map(x=>({text:x.textContent.trim().slice(0,50),html:x.outerHTML.slice(0,450)})).slice(0,24);
   return {scriptCount:scripts.length,chars:text.length,matches,nav};
 });
 console.log("UNITS_EDITOR_SOURCE_AUDIT",JSON.stringify(diag).slice(0,85000));
 const clickNav=async(text)=>{
  const clicked=await page.evaluate(t=>{
   const matches=[...document.querySelectorAll("button,a,[role=tab],.nav-item")].filter(x=>x.textContent?.trim()===t);
   const x=matches.find(x=>x.offsetWidth||x.offsetHeight) || matches[0];
   if(!x)return false;x.click();return true;
  },text);
  if(!clicked)throw Error("NAV_MISSING "+text);
  await page.waitForTimeout(550);
 };
 for(const tab of ["Производство","Материалы"]){
  try{await clickNav(tab)}catch(e){console.log("UNITS_NAV_ERROR",tab,String(e));continue}
  const pageInfo=await page.evaluate(()=>{
   const all=[...document.querySelectorAll("input,select,textarea")].filter(x=>x.getBoundingClientRect().width>0);
   return {title:document.title,inputs:all.slice(0,90).map(x=>({tag:x.tagName,outer:x.outerHTML.slice(0,500),
    parent:x.closest("tr,.pp-edit-row,.pp-edit-group,.pp-edit-card,.pp-editor-card")?.outerHTML.slice(0,1000)||x.parentElement?.outerHTML.slice(0,450)})),
    headings:[...document.querySelectorAll("h2,h3,th,legend")].filter(x=>x.getBoundingClientRect().width>0).map(x=>x.textContent?.trim()).slice(0,80)};
  });
  console.log("UNITS_VISIBLE_FORM_"+tab,JSON.stringify(pageInfo).slice(0,35000));
 }
}finally{await browser.close()}
