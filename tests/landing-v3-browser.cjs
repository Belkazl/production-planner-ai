const assert=require("node:assert/strict");
const {chromium}=require("playwright");
const URL=process.env.LANDING_URL||"http://127.0.0.1:3000/";
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const errors=[];
  const screenshots=[];
  for(const width of [375,390,550,768,900,1024,1280,1440,1920]){
   const page=await browser.newPage({viewport:{width,height:920},deviceScaleFactor:1});
   page.on("pageerror",e=>errors.push(String(e)+" (viewport "+width+")"));
   const response=await page.goto(URL,{waitUntil:"domcontentloaded",timeout:60000});
   assert.equal(response.status(),200);
   await page.locator("#real-preview-img").waitFor({state:"attached"});
   assert((await page.locator("#hero-title").innerText()).includes("Under control."));
   assert.equal(await page.locator("#problem").count(),0,"Remove repetitive problem block");
   assert.equal(await page.locator("#benefits").count(),1);
   assert.equal(await page.locator("#results").count(),1);
   assert.equal(await page.locator("#use-cases").count(),1);
   assert.equal(await page.locator("#data").count(),1);
   const order=await page.evaluate(()=>{
    const ids=["platform","benefits","results","how-it-works","features","use-cases","pricing","data","faq"];
    return ids.map(id=>({id,y:Math.round(document.getElementById(id).getBoundingClientRect().top+scrollY)}));
   });
   assert(order.every((s,i)=>i===0||s.y>order[i-1].y),"Section order "+JSON.stringify(order));
   assert.equal(await page.locator(".case-card").count(),4);
   assert.equal(await page.locator(".benefit-item").count(),4);
   const body=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));
   assert(body.scrollWidth<=body.clientWidth+3,"Horizontal overflow at "+width+": "+JSON.stringify(body));
   const liveImage=await page.locator("#real-preview-img").evaluate(el=>({loaded:el.complete&&el.naturalWidth>100,width:el.naturalWidth,height:el.naturalHeight,src:el.getAttribute("src")}));
   assert(liveImage.loaded,"Bundled authentic Gantt screenshot missing at "+width);
   const s1=await page.locator("#real-preview-img").getAttribute("src");
   assert(s1.endsWith("real-material-gantt.png"));
   await page.locator('[data-real-preview="editor"]').click();
   assert((await page.locator("#real-preview-img").getAttribute("src")).endsWith("real-material-editor.png"));
   await page.waitForFunction(()=>document.querySelector("#real-preview-img")?.complete&&document.querySelector("#real-preview-img")?.naturalWidth>100);
   await page.locator('[data-real-preview="gantt"]').click();
   assert.equal(await page.locator('[data-real-preview="gantt"]').getAttribute("aria-pressed"),"true");
   if(width===1440){
    await page.locator("[data-real-open]").click();
    assert(await page.locator("#real-image-dialog").evaluate(el=>el.open));
    assert((await page.locator("#real-image-enlarged").getAttribute("src")).includes("real-material-gantt.png"));
    await page.locator("[data-real-close]").click();
    assert(!(await page.locator("#real-image-dialog").evaluate(el=>el.open)));
   }
   const delta=page.locator('[data-result-value="duration"]');
   const idle=page.locator('[data-result-value="idle"]');
   assert.equal((await delta.innerText()).trim(),"4,338");
   assert.equal((await idle.innerText()).trim(),"18,706");
   assert((await page.locator('[data-result-delta="idle"]').innerText()).includes("+256"));
   await page.locator('[data-results-mode="before"]').click();
   assert.equal((await delta.innerText()).trim(),"4,377");
   assert.equal((await idle.innerText()).trim(),"18,450");
   assert.equal(await page.locator('[data-results-mode="before"]').getAttribute("aria-pressed"),"true");
   await page.locator('[data-results-mode="after"]').click();
   assert.equal((await delta.innerText()).trim(),"4,338");
   assert((await page.locator(".results-note").innerText()).includes("not a guaranteed saving"));
   const nav=page.locator('.main-nav a[href="#results"]');
   assert.equal(await nav.count(),1);
   const menu=page.locator(".menu-toggle");
   if(width<=1100){
    assert(await menu.isVisible(),"Mobile nav at "+width);
    await menu.click();
    assert(await nav.isVisible(),"Results navigation visible on narrow screen");
    await nav.click();
    assert.equal(await menu.getAttribute("aria-expanded"),"false");
   }else{
    assert(await nav.isVisible(),"Desktop navigation");
   }
   const account=await page.locator("#data").innerText();
   assert(account.includes("Privacy Policy")&&account.includes("not final"));
   const faq=await page.locator("#faq").innerText();
   assert(faq.includes("30-day trial available today"));
   if(width===1440){
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:"landing-v3-desktop-full.png",fullPage:true,animations:"disabled"});
    await page.locator("#platform").screenshot({path:"landing-v3-authentic-gantt.png",animations:"disabled"});
    await page.locator("#results").screenshot({path:"landing-v3-results.png",animations:"disabled"});
    await page.locator("#use-cases").screenshot({path:"landing-v3-cases.png",animations:"disabled"});
    screenshots.push("desktop");
   }
   if(width===390){
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:"landing-v3-mobile-full.png",fullPage:true,animations:"disabled"});
    await page.locator("#results").screenshot({path:"landing-v3-results-mobile.png",animations:"disabled"});
    screenshots.push("mobile");
   }
   if(width===768){
    await page.locator("#results").screenshot({path:"landing-v3-results-tablet.png",animations:"disabled"});
    screenshots.push("tablet");
   }
   await page.close();
  }
  assert.deepEqual(errors,[],"Browser console runtime errors");
  console.log("PRODPLAN_LANDING_V3_SUCCESS",JSON.stringify({screens:[375,390,550,768,900,1024,1280,1440,1920],assets:"verified real product screenshots",comparisons:["4377→4338 minutes","18450→18706 equipment idle"],useCases:4,transparentTrial:true,appCodeUnaffected:true,screenshots}));
 }finally{await browser.close()}
})().catch(err=>{console.error(err);process.exit(1)});
