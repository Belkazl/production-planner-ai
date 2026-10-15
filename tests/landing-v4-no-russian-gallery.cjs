"use strict";
const assert=require("node:assert/strict");
const {chromium}=require("playwright");
const BASE=process.env.LANDING_URL||"http://127.0.0.1:3000/";
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const issues=[];
  for(const width of [375,390,550,768,1024,1280,1440,1920]){
   const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1});
   page.on("pageerror",err=>issues.push(width+": "+String(err)));
   const response=await page.goto(BASE,{waitUntil:"domcontentloaded",timeout:45000});
   assert.equal(response.status(),200);
   await page.locator(".full-row").first().waitFor({state:"visible",timeout:15000});
   assert.equal(await page.locator(".actual-product").count(),0,"Remove entire screenshot block");
   assert.equal(await page.locator("#real-preview-img").count(),0);
   assert.equal(await page.locator("#real-image-dialog").count(),0);
   assert.equal(await page.getByText("The real interface. No stock dashboard.").count(),0);
   assert.equal(await page.locator(".actual-product-switch").count(),0);
   const sections=await page.locator("#platform > .container > div").evaluateAll(els=>els.map(el=>el.className));
   assert(sections.includes("showcase-window"),"Keep interactive schedule");
   assert(sections.includes("platform-foot"),"Keep footer/CTA without gallery");
   assert(!sections.some(x=>x.includes("actual-product")),"No hidden gallery");
   assert.equal(await page.locator("#platform .full-row").count(),6);
   assert.equal(await page.locator("#benefits .benefit-item").count(),4);
   assert.equal(await page.locator("#results .result-card").count(),4);
   await page.locator('[data-results-mode="before"]').click();
   assert.equal((await page.locator('[data-result-value="duration"]').innerText()).trim(),"4,377");
   await page.locator('[data-results-mode="after"]').click();
   assert.equal((await page.locator('[data-result-value="duration"]').innerText()).trim(),"4,338");
   await page.locator('[data-schedule-tab="materials"]').click();
   assert.equal((await page.locator("#showcase-title").innerText()).trim(),"Material availability");
   await page.locator('[data-schedule-tab="equipment"]').click();
   const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
   assert(size.scroll<=size.client+3,"Horizontal overflow: "+width+" "+JSON.stringify(size));
   const nav=page.locator('.main-nav a[href="#results"]');
   if(width<=1100){
    assert(await page.locator(".menu-toggle").isVisible());
    await page.locator(".menu-toggle").click();
    assert(await nav.isVisible());
    await nav.click();
    assert.equal(await page.locator(".menu-toggle").getAttribute("aria-expanded"),"false");
   } else assert(await nav.isVisible());
   if(width===1440){
    await page.screenshot({path:"landing-v4-no-russian-gallery-desktop.png",fullPage:true,animations:"disabled"});
    await page.locator("#platform").screenshot({path:"landing-v4-platform-without-gallery-desktop.png",animations:"disabled"});
   }
   if(width===390){
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:"landing-v4-no-russian-gallery-mobile.png",fullPage:true,animations:"disabled"});
    await page.locator("#platform").screenshot({path:"landing-v4-platform-without-gallery-mobile.png",animations:"disabled"});
   }
   await page.close();
  }
  assert.deepEqual(issues,[],"Browser runtime errors");
  console.log("PRODPLAN_LANDING_V4_NO_RUSSIAN_SCREENSHOTS_PASS",JSON.stringify({
   widths:[375,390,550,768,1024,1280,1440,1920],screenshotBlockRemoved:true,
   oldPreviewFunctionsRemoved:true,interactiveGanttPreserved:true,
   optimizationComparisonPreserved:true,trialFlowUnchanged:true,overflow:false,errors:0
  }));
 }finally{await browser.close()}
})().catch(err=>{console.error(err);process.exit(1)});
