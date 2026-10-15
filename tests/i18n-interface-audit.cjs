const {chromium}=require("playwright");
const fs=require("node:fs");

(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const context=await browser.newContext({viewport:{width:1600,height:1000}});
  const page=await context.newPage();
  const login=await page.goto("http://127.0.0.1:8080/",{waitUntil:"domcontentloaded",timeout:25000});
  const collect=async()=>page.evaluate(()=>{
   const out=new Set();
   const skip=n=>!!n.parentElement?.closest("script,style,noscript,svg,textarea,#messages,#ganttScroll");
   const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
   while(walker.nextNode()){
    const n=walker.currentNode,t=n.nodeValue?.replace(/\\s+/g," ").trim();
    if(t&&/[А-Яа-яЁё]/.test(t)&&t.length<=210&&!skip(n))out.add(t);
   }
   for(const el of document.querySelectorAll("[placeholder],[title],[aria-label]")){
    for(const attr of ["placeholder","title","aria-label"]){
     let t=el.getAttribute(attr);
     if(t&&/[А-Яа-яЁё]/.test(t)&&t.length<=210)out.add("@"+attr+" "+t);
    }
   }
   return [...out].sort((a,b)=>a.localeCompare(b,"ru")).slice(0,400);
  });
  console.log("PP_I18N_AUDIT_LOGIN "+JSON.stringify(await collect()));
  await context.addCookies([{name:"pp_demo_auth",value:"tenantA",url:"http://127.0.0.1:8080",httpOnly:true}]);
  await page.goto("http://127.0.0.1:8080/",{waitUntil:"domcontentloaded",timeout:30000});
  await page.waitForTimeout(200);
  console.log("PP_I18N_AUDIT_INITIAL "+JSON.stringify(await collect()));
  console.log("PP_I18N_AUDIT_NAV_MARKUP "+JSON.stringify(await page.evaluate(()=>({
   top:document.querySelector(".top .nav")?.outerHTML?.slice(0,2100),
   side:document.querySelector(".side")?.outerHTML?.slice(0,1600),
   ganttTabs:document.querySelector("#planView .tabs")?.outerHTML?.slice(0,1500)
  }))));
  console.log("PP_I18N_AUDIT_TEXT_DEPENDENCIES "+JSON.stringify(
   fs.readFileSync("/tmp/pp-gateway-fixture.html","utf8")
     .split("\\n").flatMap(line=>[...line.matchAll(/.{0,95}(?:textContent|innerText).{0,110}/g)]
     .map(m=>m[0]).filter(x=>/[А-Яа-яЁё]/.test(x)))
     .slice(0,110)
  ));
  const modelFixture=JSON.parse(fs.readFileSync("/tmp/pp-ceramics-live-model.json","utf8")).model;
  const sections=["Производство","Заказы","Материалы","Оборудование","Сотрудники","Настройки","Аналитика","Сценарии","Планирование"];
  await page.evaluate(data=>{model=data;modelReady=true;document.body.classList.remove("projects-mode");document.getElementById("planView").style.display="block";},modelFixture);
  for(const section of sections){
   try{
    await page.evaluate(section=>{if(typeof renderSection==="function")renderSection(section);},section);
    await page.waitForTimeout(30);
    console.log("PP_I18N_AUDIT_SECTION_"+sections.indexOf(section)+" "+JSON.stringify({section,texts:await collect()}));
   }catch(e){console.log("PP_I18N_AUDIT_SECTION_ERROR "+section+" "+String(e).slice(0,130))}
  }
  try{
   await page.evaluate(()=>window.__PP_DOCUMENTS_TAB__?.open());
   console.log("PP_I18N_AUDIT_DOCUMENTS "+JSON.stringify(await collect()));
  }catch(e){console.log("PP_I18N_AUDIT_DOCUMENTS_ERROR "+e.message)}
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
