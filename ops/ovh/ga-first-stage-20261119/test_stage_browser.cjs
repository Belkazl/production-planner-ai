const assert=require("node:assert/strict");
const fs=require("node:fs");
const {chromium}=require("playwright-core");
(async()=>{
 const full=fs.readFileSync(process.argv[2],"utf8");
 const from=full.indexOf("(function ppNativeOneOwnerProgressV4(){");
 const to=full.indexOf("\n\n;(function ppLargeGaProgressLoadShedV1(){",from);
 if(from<0||to<0)throw Error("FIRST_STAGE_UI_RUNTIME_NOT_FOUND");
 const code=full.slice(from,to);
 const browser=await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox"]});
 const page=await browser.newPage();
 try{
  await page.route("https://app.liftorbit.app/",r=>r.fulfill({status:200,contentType:"text/html",
   body:'<!DOCTYPE html><html lang="en"><body><button id="opt" class="pp-opt-running">Optimization 1%<span class="pp-opt-progress-line"></span></button></body></html>'}));
  await page.goto("https://app.liftorbit.app/");
  await page.addScriptTag({content:code});
  await page.waitForFunction(()=>document.getElementById("opt")?.getAttribute("data-pp-ga-v4-label")?.includes("Preparing calculation"),null,{timeout:7000});
  const first=await page.locator("#opt").getAttribute("data-pp-ga-v4-label");
  assert(first.includes("1%"),first);
  console.log("FIRST_STAGE_UI_PREPARING_NO_STALE_ONE_PERCENT_PASS",first);
  await page.evaluate(()=>{
   const b=document.getElementById("opt");
   b.firstChild.nodeValue="Optimization 5%";
   window.__PP_GA_PROGRESS_V4__.refresh();
  });
  await page.waitForFunction(()=>window.__PP_GA_PROGRESS_V4__?.state.confirmed===5,null,{timeout:1000});
  await page.waitForFunction(()=>document.getElementById("opt")?.getAttribute("data-pp-ga-v4-label")?.includes("Building first plan"),null,{timeout:9000});
  const second=await page.locator("#opt").getAttribute("data-pp-ga-v4-label");
  assert(second.includes("5%"),second);
  console.log("FIRST_STAGE_UI_BUILDING_FIRST_PLAN_INSTEAD_OF_FROZEN_NUMBER_PASS",second);
 }finally{await browser.close()}
})().catch(e=>{console.error("FIRST_STAGE_UI_CHROME_FAILURE",e?.stack||String(e));process.exitCode=1});
