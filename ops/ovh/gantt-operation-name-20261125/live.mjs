import {chromium} from "playwright-core";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
const browser=await chromium.launch({headless:true,channel:"chrome"});
try{
 const page=await browser.newPage();
 await page.goto("https://app.liftorbit.app",{waitUntil:"domcontentloaded"});
 const status=await page.evaluate(async credentials=>(await fetch("/api/auth/register",{
   method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(credentials)
 })).status,{email:"gantt-name-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(28).toString("base64url"),company:"Gantt name QA"});
 assert.equal(status,200);
 await page.reload({waitUntil:"domcontentloaded"});
 await page.waitForFunction(()=>window.__PP_GANTT_BLOCK_DETAILS_V1__?.open);
 const select=page.locator("#ppLanguageSelect");
 await select.selectOption("en");
 const clickOperation=async(name,kind)=>page.evaluate(({name,kind})=>{
   const bar=document.createElement("button");
   bar.className="pg2-bar";
   bar.__ppOperation={operation_id:"OP_DRY",operation_name:name,order:"2604",batch:4};
   bar.__ppKind=kind;
   document.body.append(bar);
   bar.click();
 },{name,kind});
 for(const title of ["Сушка","Прессование"]){
   await clickOperation(title,"operation");
   await page.waitForFunction(()=>document.querySelector(".pgd-eyebrow")?.textContent.toLowerCase()==="production operation");
   assert.equal(await page.locator("#pgdTitle").textContent(),title);
   await select.selectOption("ru");
   await select.selectOption("en");
   await page.waitForFunction(()=>document.querySelector(".pgd-eyebrow")?.textContent.toLowerCase()==="production operation");
   assert.equal(await page.locator("#pgdTitle").textContent(),title);
 }
 await clickOperation("Сушка","setup");
 await page.waitForFunction(()=>/setup|changeover/i.test(document.querySelector("#pgdTitle")?.textContent));
 console.log("Localized labels, setup title and original project names verified.");
}finally{await browser.close()}
