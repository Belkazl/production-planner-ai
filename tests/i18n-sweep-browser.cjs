const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const fs=require("node:fs");
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const ctx=await browser.newContext({viewport:{width:1600,height:1000}});
  await ctx.addCookies([{name:"pp_demo_auth",value:"tenantA",url:"http://127.0.0.1:8080/",httpOnly:true}]);
  const page=await ctx.newPage();const errors=[];
  page.on("pageerror",e=>errors.push(String(e)));
  const response=await page.goto("http://127.0.0.1:8080/",{waitUntil:"domcontentloaded",timeout:45000});
  assert.equal(response.status(),200);
  await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed && window.__PP_GANTT_BLOCK_DETAILS_V1__?.installed,{timeout:16000});
  await page.locator("#ppLanguageSelect").selectOption("en");
  const fixture=JSON.parse(fs.readFileSync("/tmp/pp-ceramics-live-model.json","utf8")).model;
  await page.evaluate(m=>{model=m;modelReady=true;document.body.classList.remove("projects-mode");document.getElementById("planView").style.display="block";},fixture);
  const collect=()=>page.evaluate(()=>{
   const visible=node=>{let el=node.parentElement; if(!el)return false;const cs=getComputedStyle(el);if(cs.display==="none"||cs.visibility==="hidden"||el.closest("[hidden],script,style,noscript,svg,textarea,#messages,.pp-i18n-route-label"))return false;return !!el.getClientRects().length};
   const items=[];
   const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
   while(walker.nextNode()){
    const node=walker.currentNode,t=(node.nodeValue||"").trim();
    if(!t||!/[А-Яа-яЁё]/.test(t)||!visible(node)||t.length>280)continue;
    const el=node.parentElement;items.push({text:t.slice(0,210),tag:el.tagName,cls:String(el.className||"").slice(0,90),id:el.id||"",parent:el.parentElement?.id||""});
   }
   for(const el of document.querySelectorAll("[placeholder],[title],[aria-label]")){
    if(!el.getClientRects().length||el.closest(".pp-i18n-route-label"))continue;
    for(const name of ["placeholder","title","aria-label"]){
     const value=el.getAttribute(name);
     if(value&&/[А-Яа-яЁё]/.test(value)&&value.length<260)items.push({text:"@"+name+" "+value,tag:el.tagName,id:el.id||"",cls:String(el.className||"").slice(0,85)});
    }
   }
   return [...new Map(items.map(item=>[item.text+"|"+item.id,item])).values()].slice(0,200);
  });
  const log=async name=>{await page.waitForTimeout(150);const rem=await collect();console.log("PP_I18N_SWEEP_"+name+" "+JSON.stringify(rem).slice(0,12000));return rem};
  assert.deepEqual(await log("PLANNER"),[],"The planning screen still has untranslated static copy");
  for(const [i,name] of ["Заказы","Материалы","Оборудование","Сотрудники","Производство","Настройки"].entries()){
   try{
    await page.evaluate(name=>renderSection(name),name);
    const left=await log("SECTION_"+i+"_"+name);
    if(name==="Производство"){
      // Model-owned process name and job titles are intentionally preserved.
      // These are the user's production data, not localizable application copy.
      assert(left.every(x=>x.cls.includes("pp-proc-tab")||x.cls.includes("pp-mref-btn")),
       "Unexpected untranslated production UI label: "+JSON.stringify(left));
    }else assert.deepEqual(left,[],"Untranslated application strings in "+name);
    if(name==="Оборудование")await page.screenshot({path:"i18n-sweep-equipment.png"});
   }catch(e){console.log("PP_I18N_SWEEP_SECTION_ERROR",name,String(e).slice(0,400))}
  }
  // Render the real materials Gantt component and inspect its generated
  // captions, stock/delivery lines, axis and tooltip (no GA calls or data writes).
  await page.evaluate(()=>{
   const originalMaterials=model.materials;
   model.materials=[{id:"M_BODY",name:"M_BODY",unit:"kg",initial_stock:1000,
    deliveries:[{at:"2026-10-06T08:00:00",quantity:250}],consumption_per_unit:0.55,order_ids:[2601]}];
   const p={start:model.start,duration_minutes:2000,operations:[{
    order:2601,batch:1,operation_name:"Прессование",
    start_min:60,end_min:160,
    resources:[{resource_type:"material",id:"M_BODY",quantity:25}],
    equipment_ids:[],employee_ids:[]}],
    batches:[{order:2601,batch:1,start_min:60,quantity:400,area:400}]};
   const chart=window.__PP_SECONDARY_GANTTS_V3__.renderMode(2,p);
   const mount=document.createElement("div");mount.id="i18n-real-material-chart";
   // The real Gantt styles are scoped under #ppTabsView, so attach inside
   // that original component container rather than an unstyled body fragment.
   const tabs=document.getElementById("ppTabsView");
   document.getElementById("planView").style.display="block";
   document.getElementById("sectionView").style.display="none";
   tabs.style.display="block";tabs.appendChild(mount);mount.appendChild(chart);
   model.materials=originalMaterials;
  });
  await page.waitForTimeout(200);
  const ganttTexts=await page.locator("#i18n-real-material-chart").innerText();
  assert(ganttTexts.includes("Material Gantt")&&ganttTexts.includes("deliveries and consumption"),
   "Actual material Gantt needs translated headings and summary");
  // Include generated aria-label/title attributes in the global audit.
  assert.deepEqual(await log("ACTUAL_MATERIAL_GANTT"),[],
   "Material Gantt and its tooltips still contain untranslated interface labels");
  await page.screenshot({path:"i18n-sweep-material-gantt.png",fullPage:false});
  const materialBar=page.locator("#i18n-real-material-chart .pp3-bar.pp3-consumption").first();
  await materialBar.waitFor({state:"attached",timeout:5000});
  await materialBar.click();
  assert.deepEqual(await log("MATERIAL_EVENT_POPUP"),[],"Material event dialog not fully English");
  await page.locator("#ppGanttOperationDetails .pgd-close").click();

  await page.evaluate(()=>{
   const valid=document.getElementById("valid");if(valid)valid.textContent="4338 минут · −39 мин (−0.9%)";
   const temp=document.createElement("div");temp.id="i18n-sweep-dynamic";temp.innerHTML=
    '<span>−39 мин (−0,9%)</span><span>0 цикла (0%)</span><span>−869 мин (−0,2%)</span><span>+256 мин (+1,4%)</span><span>882 операций · 56 переналадок · масштаб 100%</span><span>Переналадка — отдельная операция</span><span>Переналадка: Формат пресса</span><span>Всего проверено 240 поколений.</span>'+
    '<span>GA: запуск 3 завершён</span><span>Остаток: 185000 кг</span><span>Ед.: шт.</span>'+
    '<span>Заказ 2612</span><span>Партия 1</span><span>+12 ч</span>'+
    '<span>Переналадка · Переналадка: Формат пресса · Заказ 2612 · Партия 1 · 60 мин</span>'+
    '<span>Тестируемый вариант: 4338 мин · Принятый план: 4438 мин · Временный просмотр, не сохранён</span>'+
    '<span>✓ 0 нарушений ограничений Всего проверено 240 поколений. Лучший план 4338 мин сохранён; следующая итерация продолжит поиск.</span>';
   document.body.appendChild(temp);
  });
  assert.deepEqual(await log("METRIC_DYNAMIC"),[],"Dynamic statistics or Gantt footer not localized");
  await page.evaluate(()=>{
   const bar=document.createElement("div");
   bar.id="i18n-sweep-setup";
   bar.className="pg2-bar pg2-setup";
   bar.__ppOperation={order:2612,batch:1,operation_name:"Переналадка: Формат пресса",start_min:95,end_min:155,setup_parameter:"Формат пресса",from_state:"200×1200",to_state:"600×600",operation_id:"qa-setup"};
   bar.__ppPlan={start:"2026-10-05T08:00:00Z"};
   bar.__ppResource={name:"SACMI PH3800 VELOCE"};
   bar.__ppResourceKind="equipment";
   bar.__ppKind="setup";
   document.body.appendChild(bar);
   window.__PP_GANTT_BLOCK_DETAILS_V1__.open(bar);
  });
  const modal=await log("SETUP_MODAL");
  assert.deepEqual(modal,[],"Setup dialog is not fully English");
  assert((await page.locator("#ppGanttOperationDetails").innerText()).includes("Setup: Press format"));
  assert((await page.locator("#ppGanttOperationDetails").innerText()).includes("Close: press Esc"));
  await page.screenshot({path:"i18n-sweep-setup-modal.png",fullPage:false});
  await page.locator("#ppGanttOperationDetails .pgd-close").click();
  try{
   await page.evaluate(()=>window.__PP_DOCUMENTS_TAB__?.open());
   assert.deepEqual(await log("DOCUMENTS"),[],"Documents screen has untranslated static copy");
  }catch(e){console.log("PP_I18N_SWEEP_DOC_ERROR",String(e).slice(0,230))}
  // Switching RU -> EN must round-trip every generated UI string without
  // modifying source production models or project-owned field values.
  const sourceBefore=await page.evaluate(()=>JSON.stringify(model));
  await page.locator("#ppLanguageSelect").selectOption("ru");
  await page.waitForTimeout(200);
  assert.equal(await page.locator("#i18n-sweep-dynamic span").first().innerText(),"−39 мин (−0,9%)");
  assert.equal(await page.locator("#ppLanguageControl").getAttribute("aria-label"),"Язык");
  await page.evaluate(()=>window.__PP_GANTT_BLOCK_DETAILS_V1__.open(document.getElementById("i18n-sweep-setup")));
  assert((await page.locator("#ppGanttOperationDetails").innerText()).includes("Закрыть: Esc"));
  await page.locator("#ppGanttOperationDetails .pgd-close").click();
  await page.locator("#ppLanguageSelect").selectOption("en");
  assert.equal(await page.locator("#ppLanguageControl").getAttribute("aria-label"),"Language");
  assert.deepEqual(await log("ROUNDTRIP_EN"),[],"Language switching left untranslated UI behind");
  assert.equal(await page.evaluate(()=>JSON.stringify(model)),sourceBefore,"Localization modified model data");
  const done=await page.evaluate(()=>({lang:window.__PP_LANGUAGE__?.current,modalState:document.getElementById("ppGanttOperationDetails")?.hidden}));
  console.log("PP_I18N_SWEEP_AUDIT_OK "+JSON.stringify({mode:done.lang,untranslatedApplicationCopy:0,sourceModelUnchanged:true,roundTrip:true,browserErrors:errors,screenshots:["i18n-sweep-equipment.png","i18n-sweep-setup-modal.png"]}));
  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
