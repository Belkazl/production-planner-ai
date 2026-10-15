const assert=require("node:assert/strict");
const fs=require("node:fs");
const {chromium}=require("playwright");

(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const context=await browser.newContext({viewport:{width:1600,height:950}});
  const page=await context.newPage();
  const errors=[];page.on("pageerror",e=>errors.push(String(e)));

  // First visit without a saved preference must be English, even when browser
  // language or login-page source defaults to Russian.
  let response=await page.goto("http://127.0.0.1:8080/",{waitUntil:"domcontentloaded",timeout:30000});
  assert.equal(response.status(),200);
  await page.locator("#ppLanguageSelect").waitFor({state:"visible",timeout:10000});
  assert.equal(await page.locator("#ppLanguageSelect").inputValue(),"en");
  assert.equal(await page.locator("#loginTab").innerText(),"Sign in");
  assert.equal(await page.locator('label[for="password"]').innerText(),"Password");
  assert.equal(await page.evaluate(()=>document.documentElement.lang),"en");
  assert.equal(await page.title(),"Sign in — PlanTrick");
  await page.screenshot({path:"language-login-english.png"});

  // Both languages must be available without page reload.
  await page.locator("#ppLanguageSelect").selectOption("ru");
  assert.equal(await page.locator("#loginTab").innerText(),"Войти");
  assert.equal(await page.locator('label[for="password"]').innerText(),"Пароль");
  assert.equal(await page.title(),"Вход — PlanTrick");
  await page.reload({waitUntil:"domcontentloaded"});
  assert.equal(await page.locator("#ppLanguageSelect").inputValue(),"ru");
  assert.equal(await page.locator("#loginTab").innerText(),"Войти");

  await context.addCookies([{name:"pp_demo_auth",value:"tenantA",url:"http://127.0.0.1:8080",httpOnly:true}]);
  response=await page.goto("http://127.0.0.1:8080/",{waitUntil:"domcontentloaded",timeout:30000});
  assert.equal(response.status(),200);
  await page.locator("#ppLanguageSelect").waitFor({state:"visible",timeout:10000});
  console.log("PP_LANGUAGE_CROSS_AUTH_STATE",JSON.stringify(await page.evaluate(()=>({
   url:location.href,stored:localStorage.getItem("prodplan.ui.language.v1"),
   lang:document.documentElement.lang,chosen:document.getElementById("ppLanguageSelect")?.value,
   current:window.__PP_LANGUAGE__?.current,installed:window.__PP_LANGUAGE__?.installed
  }))));
  assert.equal(await page.locator("#ppLanguageSelect").inputValue(),"ru");
  assert.equal(await page.locator("#ppProtectedLogout").count(),1);
  const projectsText=await page.locator(".top .nav > span").first().textContent();
  assert.equal(projectsText.trim(),"Проекты");
  const modelFixture=JSON.parse(fs.readFileSync("/tmp/pp-ceramics-live-model.json","utf8")).model;
  await page.evaluate(data=>{
   model=data;modelReady=true;
   document.body.classList.remove("projects-mode");
   document.getElementById("planView").style.display="block";
   document.getElementById("sectionView").style.display="none";
   window.__i18nBefore=JSON.stringify(model);
   localStorage.setItem("prodplan.projects.v2",JSON.stringify([{id:"i18n-qa",name:"Керамика",savedPlans:[{id:"qa-saved"}]}]));
   localStorage.setItem("prodplan.project.active.v2","i18n-qa");
   document.getElementById("opt").disabled=false;
  },modelFixture);
  await page.locator("#ppLanguageSelect").selectOption("en");
  assert.equal(await page.locator("#ppLanguageSelect").inputValue(),"en");
  assert.equal(await page.locator("#ppProtectedLogout").innerText(),"Log out");
  assert.equal(await page.locator(".titlebar h1").first().count()>0,true);
  const route=await page.evaluate(()=>({
   original:[...document.querySelectorAll(".top .nav > span")].map(e=>e.textContent.trim()),
   visual:[...document.querySelectorAll(".top .nav > span")].map(e=>
    getComputedStyle(e.querySelector(".pp-i18n-route-label"),"::after").content),
   tabs:[...document.querySelectorAll("#planView .tabs > div")].map(e=>({
    original:e.textContent.trim(),
    en:getComputedStyle(e.querySelector(".pp-i18n-route-label"),"::after").content
   })),
   side:[...document.querySelectorAll(".side > .item")].map(e=>({
    original:e.textContent.trim(),
    en:getComputedStyle(e.querySelector(".pp-i18n-route-label"),"::after").content
   }))
  }));
  assert(route.original.includes("Планирование"),"internal route labels must remain intact");
  assert(route.original.includes("Документы"),"Documents handler must keep its original route");
  assert(route.visual.some(s=>s.includes("Planning")),"English planning nav must be visible");
  assert(route.visual.some(s=>s.includes("Documents")),"English docs nav must be visible");
  assert(route.side.some(s=>s.original==="Заказы"&&s.en.includes("Orders")));
  assert(route.tabs.some(s=>s.original==="Гантт оборудования"&&s.en.includes("Equipment Gantt")));
  assert.equal(await page.locator(".titlebar h1").first().innerText(),"Production Schedule");
  await page.screenshot({path:"language-planner-english.png"});

  // TextContent-dependent navigation still works under the English overlays.
  await page.locator(".top .nav > span").filter({hasText:"Документы"}).click();
  await page.locator("#ppDocumentsView").waitFor({state:"visible",timeout:8000});
  assert.equal(await page.locator(".pp-doc-head h1").innerText(),"Documents");
  assert.equal(await page.locator(".pp-doc-card h2").innerText(),"Import data");
  assert.equal(await page.locator("#ppImportBtn").count(),1);
  await page.locator(".top .nav > span").filter({hasText:"Планирование"}).click();
  await page.locator("#planView").waitFor({state:"visible",timeout:8000});

  const orderNav=page.locator(".side > .item").filter({hasText:"Заказы"});
  await orderNav.click();
  await page.locator("#sectionView").waitFor({state:"visible",timeout:8000});
  console.log("PP_EN_ORDER_SECTION",JSON.stringify(await page.evaluate(()=>({text:document.getElementById("sectionView").innerText.slice(0,600),active:[...document.querySelectorAll(".side > .item.active")].map(x=>x.textContent.trim()),language:window.__PP_LANGUAGE__?.current}))));
  // Selecting a project in the live application normally loads its model from
  // the account database. Our browser fixture has no saved project, so inject
  // the read-only ceramic fixture before exercising the editor itself.
  console.log("PP_EN_ORDERS_RENDER_PROBE",JSON.stringify(await page.evaluate(data=>{
   model=data;modelReady=true;renderSection("Заказы");
   return {modelOrders:model?.orders?.length||0,
    text:document.getElementById("sectionView")?.innerText?.slice(0,600),
    html:document.getElementById("sectionView")?.innerHTML?.slice(0,400)};
  },modelFixture)));
  // The observer must translate new rows without a manual refresh.
  await page.waitForFunction(()=>
   !/\d+\s+параметр(?:ов|а)?/.test(document.getElementById("sectionView")?.innerText||""),
   null,{timeout:8000});
  const autoTranslation=await page.locator("#sectionView").innerText();
  assert(!/\d+\s+параметр(?:ов|а)?/.test(autoTranslation),
   "Dynamic parameter counts must auto-translate into English");
  await page.evaluate(()=>window.__PP_LANGUAGE__.refresh());
  const afterRefresh=await page.locator("#sectionView").innerText();
  console.log("PP_EN_ORDERS_TRANSLATION_PROBE",JSON.stringify({
   auto:autoTranslation.slice(0,450),refreshed:afterRefresh.slice(0,450)
  }));
  // A demo fixture loads the real orders editor; an empty account displays
  // the no-model message. Validate either state without assuming an expanded row.
  const orderText=await page.locator("#sectionView").innerText();
  const editorLoaded=orderText.includes("Edit orders");
  assert(editorLoaded||orderText.includes("No model created yet"),
   "English Orders view must show its translated editor or empty state");
  assert(!orderText.includes("Редактирование заказов")&&
   !orderText.includes("Модель ещё не создана"),
   "Orders editor and empty-state headings must be translated");
  if(editorLoaded){
   assert(orderText.includes("Production parameters"),
    "Production parameter section must be translated");
   assert(!/\d+\s+параметр(?:ов|а)?/.test(orderText),
    "Collapsed parameter counters still show Russian in English mode");
  }
  await page.locator(".side > .item").filter({hasText:"Оборудование"}).click();
  assert.equal(await page.locator(".side > .item.active").textContent().then(x=>x.trim()),"Оборудование");
  const equipmentText=await page.locator("#sectionView").innerText();
  assert(equipmentText.includes("Equipment")||equipmentText.includes("No model created yet")||
   equipmentText.includes("Оборудование"),"equipment route must still respond");

  // Dynamic status texts are emitted in Russian by the existing GA; translate
  // them as they change without touching the optimizer or server payload.
  await page.evaluate(()=>{
   document.getElementById("valid").textContent="GA: план валиден";
   document.getElementById("meta").textContent="GA · всего 240 поколений · запуск 2 · 97938 мс · улучшение 0 мин";
  });
  await page.waitForFunction(()=>document.getElementById("valid").textContent==="GA: valid plan"&&
   document.getElementById("meta").textContent.includes("240 generations total"),null,{timeout:8000});
  assert((await page.locator("#meta").textContent()).includes("run 2"));
  const noMutation=await page.evaluate(()=>({
   modelUntouched:JSON.stringify(model)===window.__i18nBefore,
   projects:JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]"),
   langSaved:localStorage.getItem("prodplan.ui.language.v1")
  }));
  assert(noMutation.modelUntouched,"language must never change project model");
  assert.equal(noMutation.projects[0].savedPlans.length,1);
  assert.equal(noMutation.langSaved,"en");
  await page.locator("#ppLanguageSelect").selectOption("ru");
  await page.waitForFunction(()=>document.getElementById("valid").textContent==="GA: план валиден",null,{timeout:8000});
  assert.equal(await page.locator(".pp-doc-head h1").innerText(),"Документы");
  await page.locator("#ppLanguageSelect").selectOption("en");
  await page.waitForFunction(()=>document.getElementById("valid").textContent==="GA: valid plan",null,{timeout:8000});

  // Preference must survive a refresh and logout (other personal project data
  // can be cleared on sign-out as before).
  await page.reload({waitUntil:"domcontentloaded"});
  await page.locator("#ppLanguageSelect").waitFor({state:"visible",timeout:10000});
  assert.equal(await page.locator("#ppLanguageSelect").inputValue(),"en");
  await page.locator("#ppProtectedLogout").click();
  await page.locator("#loginTab").waitFor({state:"visible",timeout:12000});
  assert.equal(await page.locator("#ppLanguageSelect").inputValue(),"en");
  assert.equal(await page.locator("#loginTab").innerText(),"Sign in");
  assert.equal(await page.evaluate(()=>localStorage.getItem("prodplan.ui.language.v1")),"en");
  assert.deepEqual(errors,[],"UI must not throw browser errors");

  console.log("PP_LANGUAGE_BROWSER_PASS",JSON.stringify({
   languages:["en","ru"],default:"en",persisted:true,login:true,authenticated:true,
   routeKeysPreserved:true,docsNav:true,ordersNav:true,equipmentNav:true,ganttTabs:true,
   dynamicGAStatus:true,modelUntouched:true,savedPlansPreserved:true,logoutPersists:true,
   runtimeErrors:0
  }));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
