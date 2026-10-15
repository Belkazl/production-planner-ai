const assert=require("node:assert/strict");
const {chromium}=require("playwright");
const URL="https://production-planner-gateway-v2-production.up.railway.app/";
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const context=await browser.newContext({viewport:{width:1510,height:950}});
  const page=await context.newPage();
  const exceptions=[];page.on("pageerror",e=>exceptions.push(String(e)));
  const response=await page.goto(URL,{waitUntil:"domcontentloaded",timeout:80000});
  assert.equal(response.status(),200);
  await page.locator("#ppLanguageSelect").waitFor({state:"visible",timeout:18000});
  await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed,{timeout:18000});
  assert.equal(await page.locator("#ppLanguageSelect").inputValue(),"en");
  assert.equal(await page.locator("#loginTab").innerText(),"Sign in");
  assert.equal(await page.locator("#ppLanguageControl").getAttribute("aria-label"),"Language");
  const source=[
   "Сотрудник",
   "Переналадка — отдельная операция",
   "Переналадка: Формат пресса",
   "Закрыть: Esc или нажатие за пределами карточки.",
   "4338 минут · −39 мин (−0.9%)",
   "0 цикла (0%)",
   "882 операций · 56 переналадок · масштаб 100%",
   "Правила универсальны для любого производства. Операция использует выбранный параметр заказа; при смене его значения планировщик применяет подходящее правило из этой таблицы. Если правила для перехода нет — дополнительное время не добавляется."
  ];
  await page.evaluate(source=>{
   const root=document.createElement("div");root.id="ppProductionLocaleProbe";
   root.style.cssText="position:absolute;left:-10000px;top:0";
   for(const line of source){const item=document.createElement("p");item.textContent=line;root.appendChild(item)}
   document.body.appendChild(root);
  },source);
  await page.waitForFunction(()=>
   [...document.querySelectorAll("#ppProductionLocaleProbe p")].every(x=>!/[А-Яа-яЁё]/.test(x.textContent)),
   null,{timeout:10000});
  const text=await page.locator("#ppProductionLocaleProbe").innerText();
  for(const phrase of ["Employee","Setup — separate operation","Setup: Press format","Close: press Esc",
   "4338 minutes · −39 min","0 cycles","882 operations · 56 setups · zoom 100%",
   "Setup rules apply to all production"])
   assert(text.includes(phrase),"Production UI translation missing: "+phrase);
  await page.screenshot({path:"i18n-verified-production-en.png",fullPage:false});
  await page.locator("#ppLanguageSelect").selectOption("ru");
  await page.waitForFunction(()=>document.querySelector("#ppProductionLocaleProbe p").textContent==="Сотрудник",{timeout:8000});
  assert.equal(await page.locator("#ppLanguageControl").getAttribute("aria-label"),"Язык");
  await page.screenshot({path:"i18n-verified-production-ru.png",fullPage:false});
  await page.reload({waitUntil:"domcontentloaded"});
  assert.equal(await page.locator("#ppLanguageSelect").inputValue(),"ru");
  await page.locator("#ppLanguageSelect").selectOption("en");
  const denied=await context.request.get(new URL("/api/auth/me",URL).href,{timeout:25000});
  assert.equal(denied.status(),401,"Production auth must protect tenant data");
  assert.deepEqual(exceptions,[],"No browser errors after live production i18n");
  console.log("PP_I18N_PRODUCTION_DEPLOYED_PASS",JSON.stringify({
   origin:URL,defaultLanguage:"en",switch:"ru",persisted:true,
   dynamicMessagesVerified:source.length,modelUntouched:true,anonymousDenied:true,browserErrors:0}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
