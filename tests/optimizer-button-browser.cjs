const {chromium}=require("playwright");
const assert=require("node:assert/strict");
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const page=await browser.newPage({viewport:{width:1370,height:800}});
  const errors=[];page.on("pageerror",e=>errors.push(String(e)));
  await page.setContent('<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>body{font:14px Arial,sans-serif;background:#f4f7fc;padding:50px;color:#2a3951}#container{border:1px solid #dbe3ef;background:white;padding:28px;border-radius:13px;max-width:1000px}.toolbar{display:flex;gap:18px;align-items:center}#opt{font:700 14px Arial;color:white;background:#2065e5;border:0;padding:15px 20px;border-radius:9px;min-width:230px;cursor:pointer}#valid{background:#e9f8ee;color:#16844f;padding:13px 18px;border-radius:9px}#validator{margin-top:18px}</style></head><body><div id="container"><h2>Производственный план</h2><div class="toolbar"><span id="valid">GA: модель готова</span><button id="opt">Запустить оптимизацию</button></div><div id="validator"></div></div></body></html>');
  await page.evaluate(()=>{
   const btn=document.getElementById("opt");
   window.__ppAppShowCalls=0;window.__ppAppKpiCalls=0;
   window.renderPlan=()=>window.__ppAppShowCalls++;
   window.renderKpisWithDelta=()=>window.__ppAppKpiCalls++;
   const best={valid:true,partial:false,duration_minutes:4335,operator_wait_minutes:12,machine_idle_minutes:0,batch_count:65,operations:[{id:"operation",order:2601,start:0,end:10}]};
   window.fetch=async(url)=>{
    if(String(url).includes("/api/optimizer-stop"))return new Response(JSON.stringify({ok:true,stopped:true,best_preview:best,variants:[{plan:best}]}),{status:200,headers:{"content-type":"application/json"}});
    if(String(url).includes("/api/plan-progress"))return new Response(JSON.stringify({ok:true,running:true,best_preview:best,candidate_preview:best}),{status:200,headers:{"content-type":"application/json"}});
    throw Error("Unexpected URL "+url);
   };
   window.__ppStarts=0;
   btn.onclick=async()=>{
    window.__ppStarts++;
    btn.disabled=true;
    btn.textContent="Оптимизация 22%";
    await new Promise(r=>{window.__ppEndRun=()=>{btn.textContent="Оптимизация остановлена";btn.disabled=false;r()}});
   };
  });
  await page.addScriptTag({path:"stop-ui.js"});
  await page.screenshot({path:"before-optimization.png"});
  assert.equal(await page.locator("#opt").innerText(),"Запустить оптимизацию");
  await page.locator("#opt").click();
  await page.locator("#ppStopOptimizer").waitFor({state:"visible",timeout:5000});
  assert.equal(await page.locator("#opt").innerText(),"Оптимизация 22%","progress display must survive");
  assert.equal(await page.locator("#ppStopOptimizer").innerText(),"Остановить оптимизацию","running action must be stop");
  await page.locator("#ppStopOptimizer").waitFor({state:"visible"});
  await page.waitForFunction(()=>document.getElementById("ppStopOptimizer")?.disabled===false,null,{timeout:5000});
  await page.screenshot({path:"during-optimization.png"});
  await page.locator("#ppStopOptimizer").click();
  await page.waitForFunction(()=>document.getElementById("opt").textContent==="Продолжить оптимизацию",null,{timeout:7000});
  const status=await page.locator("#valid").innerText();
  assert(status.includes("остановлено"),"GA badge must show status");
  await page.locator("#ppStopModal.pp-open .pp-actions button").first().click({timeout:5000});
  assert.equal(await page.locator("#opt").innerText(),"Продолжить оптимизацию");
  assert.equal(await page.locator("#ppStopModal.pp-open").count(),0);
  const renderCalls=await page.evaluate(()=>window.__ppAppShowCalls);
  assert(renderCalls>0,"selected plan must be painted on Gantt");
  await page.evaluate(()=>window.__ppEndRun());
  await page.waitForFunction(()=>document.getElementById("opt").disabled===false,null,{timeout:5000});
  assert.equal(await page.locator("#opt").innerText(),"Продолжить оптимизацию","delayed GA cleanup reverted label");
  await page.screenshot({path:"after-optimization.png"});
  await page.locator("#opt").click();
  await page.waitForFunction(()=>window.__ppStarts===2);
  assert.equal(await page.locator("#ppStopOptimizer").isVisible(),true,"stop button should reappear after continue");
  await page.evaluate(()=>window.__ppEndRun());
  await page.waitForTimeout(100);
  assert.deepEqual(errors,[],"uncaught browser errors");
  console.log("OPTIMIZER_ACTION_LABELS_BROWSER_PASS",JSON.stringify({initial:"Запустить оптимизацию",running:"Остановить оптимизацию",stopped:"Продолжить оптимизацию",progressPreserved:true,badgeStatusOnly:true,bestPlanShown:true,repeatRunStarts:true,unhandledErrors:0}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
