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
  await log("PLANNER");
  for(const [i,name] of ["Заказы","Материалы","Оборудование","Сотрудники","Производство","Настройки"].entries()){
   try{
    await page.evaluate(name=>renderSection(name),name);
    await log("SECTION_"+i+"_"+name);
    if(name==="Оборудование")await page.screenshot({path:"i18n-sweep-equipment.png"});
   }catch(e){console.log("PP_I18N_SWEEP_SECTION_ERROR",name,String(e).slice(0,400))}
  }
  await page.evaluate(()=>{
   const valid=document.getElementById("valid");if(valid)valid.textContent="4338 минут · −39 мин (−0.9%)";
   const temp=document.createElement("div");temp.id="i18n-sweep-dynamic";temp.innerHTML=
    '<span>−39 мин (−0,9%)</span><span>0 цикла (0%)</span><span>−869 мин (−0,2%)</span><span>+256 мин (+1,4%)</span><span>882 операций · 56 переналадок · масштаб 100%</span><span>Переналадка — отдельная операция</span><span>Переналадка: Формат пресса</span><span>Всего проверено 240 поколений.</span>';
   document.body.appendChild(temp);
  });
  await log("METRIC_DYNAMIC");
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
  await page.screenshot({path:"i18n-sweep-setup-modal.png",fullPage:false});
  await page.locator("#ppGanttOperationDetails .pgd-close").click();
  try{
   await page.evaluate(()=>window.__PP_DOCUMENTS_TAB__?.open());
   await log("DOCUMENTS");
  }catch(e){console.log("PP_I18N_SWEEP_DOC_ERROR",String(e).slice(0,230))}
  const done=await page.evaluate(()=>({lang:window.__PP_LANGUAGE__?.current,changedModel:JSON.stringify(model)!==JSON.stringify(window.__i18nBaseline),modalState:document.getElementById("ppGanttOperationDetails")?.hidden}));
  console.log("PP_I18N_SWEEP_AUDIT_OK "+JSON.stringify({mode:done.lang,modalRu:modal.map(x=>x.text),browserErrors:errors,screenshots:["i18n-sweep-equipment.png","i18n-sweep-setup-modal.png"]}));
  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
