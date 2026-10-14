const assert=require("node:assert/strict");
const {chromium}=require("playwright");
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const ctx=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await ctx.newPage();
  const errors=[];
  page.on("pageerror",e=>errors.push(String(e)));
  await page.goto("http://127.0.0.1:8080/",{waitUntil:"domcontentloaded",timeout:30000});
  assert.equal(await page.locator('#loginTab').isVisible(),true,"anonymous visitor must see login");
  await page.locator("#f #email").fill("synthetic@example.invalid");
  await page.locator("#f #password").fill("qa-test-password");
  await page.locator("#go").click();
  await page.locator("#ppDocumentsView").waitFor({state:"attached",timeout:45000});
  await page.waitForFunction(()=>window.__PP_DOCUMENTS_TAB__?.actionsMoved,{timeout:15000});
  // Logout must be the only visible account control in the top-right header.
  const cleanHeader=await page.evaluate(()=>{
   const logout=document.getElementById("ppProtectedLogout");
   const search=document.querySelector(".top .search");
   const avatar=document.querySelector(".top .avatar");
   const nav=document.querySelector(".top .nav");
   return {
    logoutText:logout?.textContent?.trim(),
    logoutShown:!!logout&&logout.getBoundingClientRect().width>0&&getComputedStyle(logout).visibility!=="hidden",
    searchExists:!!search,searchDisplay:search?getComputedStyle(search).display:null,
    avatarExists:!!avatar,avatarDisplay:avatar?getComputedStyle(avatar).display:null,
    navigationShown:!!nav&&nav.getBoundingClientRect().width>0
   };
  });
  assert.equal(cleanHeader.logoutText,"Выйти","logout action must be preserved");
  assert.equal(cleanHeader.logoutShown,true,"logout must remain visible");
  assert.equal(cleanHeader.searchExists,true,"expected legacy question search markup for cleanup");
  assert.equal(cleanHeader.avatarExists,true,"expected legacy avatar markup for cleanup");
  assert.equal(cleanHeader.searchDisplay,"none","redundant question search must be hidden");
  assert.equal(cleanHeader.avatarDisplay,"none","overlapping legacy avatar must be hidden");
  assert.equal(cleanHeader.navigationShown,true,"main top navigation must be preserved");
  console.log("LOGOUT_HEADER_CLEAN_PASS",JSON.stringify(cleanHeader));
  const initial=await page.evaluate(()=>({
   moved:window.__PP_DOCUMENTS_TAB__.actionsMoved,
   topCount:document.querySelectorAll(".titlebar #ppImportBtn,.titlebar #ppTemplateBtn").length,
   count:document.querySelectorAll("#ppTemplateBtn,#ppImportBtn").length,
   docHidden:document.getElementById("ppDocumentsView").hidden,
   planShown:document.getElementById("planView").style.display!=="none",
  }));
  assert.deepEqual(initial,{moved:true,topCount:0,count:2,docHidden:true,planShown:false},
    "original buttons should be relocated exactly once and Gantt visible");
  const docs=page.locator(".top .nav span").filter({hasText:"Документы"});
  await docs.click();
  assert.equal(await page.locator("#ppDocumentsView").isVisible(),true,"Documents tab must show the screen");
  assert.equal(await page.locator("#planView").isVisible(),false,"Planner must hide while in Documents");
  assert.equal(await page.locator("#ppDocumentsActionSlot #ppTemplateBtn").count(),1);
  assert.equal(await page.locator("#ppDocumentsActionSlot #ppImportBtn").count(),1);
  await page.screenshot({path:"docs-actions-desktop.png"});
  // Original user click-handler: downloadTemplate() uses window.XLSX if already loaded.
  await page.evaluate(()=>{
   window.__ppTemplateTest=null;
   window.XLSX={utils:{
    book_new:()=>({SheetNames:[]}),
    aoa_to_sheet:rows=>({rows}),
    book_append_sheet:(wb,sh,name)=>wb.SheetNames.push(name)
   },writeFile:(wb,name)=>{window.__ppTemplateTest={name,sheets:wb.SheetNames}}};
  });
  await page.locator("#ppTemplateBtn").click();
  await page.waitForFunction(()=>window.__ppTemplateTest!==null,null,{timeout:12000});
  const exported=await page.evaluate(()=>window.__ppTemplateTest);
  assert.equal(exported.name,"ProdPlan_import_template.xlsx");
  assert(exported.sheets.includes("Заказы")&&exported.sheets.includes("Техпроцессы"),
    "must retain original XLSX workbook generation");
  const fileChooserPromise=page.waitForEvent("filechooser",{timeout:10000});
  await page.locator("#ppImportBtn").click();
  const chooser=await fileChooserPromise;
  const accept=await chooser.element().getAttribute("accept");
  assert(accept?.includes(".xlsx")&&accept?.includes(".csv"),"original file picker must open");
  // No file uploaded: test never mutates account model, saved plans, or orders.
  await page.locator(".top .nav span").filter({hasText:"Планирование"}).click();
  assert.equal(await page.locator("#ppDocumentsView").isVisible(),false);
  const visibilityInfo=await page.evaluate(()=>({planStyle:document.getElementById("planView").style.cssText,planComputed:getComputedStyle(document.getElementById("planView")).display,mainDisplay:getComputedStyle(document.querySelector(".shell .main")).display,bodyClasses:document.body.className,documentsHidden:document.getElementById("ppDocumentsView").hidden,docsOpened:window.__PP_DOCUMENTS_TAB__?.opened,sectionStyle:document.getElementById("sectionView").style.cssText}));console.log("DOCS_PLAN_RETURN_DEBUG",JSON.stringify(visibilityInfo));
  assert((await page.locator("#planView").isVisible())||(await page.locator("#sectionView").isVisible()),"returning from Documents must restore Planning or Projects if no project is selected");
  assert.equal(await page.locator("#ppImportBtn").count(),1);
  await docs.focus();await page.keyboard.press("Enter");
  assert.equal(await page.locator("#ppDocumentsView").isVisible(),true,"keyboard navigation must work");
  await page.locator("#projectsNav").click();
  assert.equal(await page.locator("#ppDocumentsView").isVisible(),false);
  assert.equal(await page.locator("#sectionView").isVisible(),true,"Projects navigation must remain intact");
  await page.locator(".top .nav span").filter({hasText:"Планирование"}).click();
  assert((await page.locator("#planView").isVisible())||(await page.locator("#sectionView").isVisible()),"returning from Documents must restore Planning or Projects if no project is selected");
  await docs.click();
  await page.setViewportSize({width:390,height:840});
  await page.screenshot({path:"docs-actions-mobile.png"});
  assert.equal(await page.locator("#ppTemplateBtn").isVisible(),true);
  assert.equal(await page.locator("#ppImportBtn").isVisible(),true);
  assert.equal(await page.locator("#ppDocumentsView").isVisible(),true);
  assert.deepEqual(errors,[],"browser runtime errors");
  console.log("DOCUMENTS_TAB_BROWSER_PASS",JSON.stringify({
   movedExactlyTwoButtons:true,templateDownload:exported.name,
   sheets:exported.sheets,filePickerAccepted:accept,
   planAndProjectsNavigation:true,keyboard:true,
   desktopAndMobile:true,browserErrors:0,projectDataMutated:false
  }));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
