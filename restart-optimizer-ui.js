(function(){
"use strict";
if(window.__ppFreshOptimizerUiInstalled)return;
const btn=document.getElementById("opt");
if(!btn)return;
window.__ppFreshOptimizerUiInstalled=true;
const fresh=document.createElement("button");
fresh.type="button";
fresh.id="ppOptimizerStartOver";
fresh.textContent="Начать оптимизацию заново";
fresh.title="Сбросить показатели текущего поиска и получить новый исходный план. Сохранённые планы останутся без изменений.";
fresh.setAttribute("aria-label","Начать оптимизацию заново");
// Keep restart immediately BEFORE the primary optimizer action, which is right-aligned.
// Inserting it after the main action can push the restart button beyond the viewport.
btn.insertAdjacentElement("beforebegin",fresh);
function placeFreshNextToPrimary(){
 const parent=btn.parentNode;
 if(parent&&fresh.parentNode===parent&&fresh.nextElementSibling!==btn)parent.insertBefore(fresh,btn);
}
const layoutObserver=btn.parentNode?new MutationObserver(()=>queueMicrotask(placeFreshNextToPrimary)):null;
if(layoutObserver)layoutObserver.observe(btn.parentNode,{childList:true});
setTimeout(placeFreshNextToPrimary,0);
setTimeout(placeFreshNextToPrimary,300);
let resetting=false;
const find=id=>document.getElementById(id);
const currentProject=()=>{try{return localStorage.getItem("prodplan.project.active.v2")}catch(_){return null}};
function isBusy(){
 // The stop controller is the authoritative source for a GA pass in progress.
 // The original opt.disabled and __ppOptimizationInFlight can remain stale
 // after a normal completion; neither should lock an independent restart.
 // The server also rejects a reset if a pass is still actually running.
 return resetting || window.__PP_STOP_DEBUG__?.().running===true || window.__PP_STOP_DEBUG__?.().reconnecting===true;
}
function updateDisabled(){fresh.disabled=isBusy()}
function restoreSavedPlanReadiness(){
 const meta=find("meta"),status=find("valid");
 const saved=/Сохранённая оптимизация|Saved optimization/i.test(meta?.textContent||"");
 if(!saved||isBusy())return false;
 let ready=false,shown=null;
 try{
  ready=typeof model!=="undefined"&&!!model&&Array.isArray(model.orders)&&model.orders.length>0;
  if(ready&&typeof model_ready==="function")ready=!!model_ready(model);
  shown=window.__ppTabPlan||window.__ppOptimizerCommittedPlan||null;
 }catch(_){}
 const ops=shown&&(shown.operations||shown.generic_operations||[]);
 if(!ready||!shown||shown.valid===false||!Array.isArray(ops)||!ops.length)return false;
 try{modelReady=true;hasResult=true}catch(_){}
 window.__ppOptimizerCommittedPlan=shown;
 btn.disabled=false;
 btn.textContent="Продолжить оптимизацию";
 if(status&&/Нужны данные|Data required|Ожидаю данные|Waiting for data/i.test(status.textContent||""))
  status.textContent="Готово к расчёту";
 return true;
}
function releaseStalePrimaryGuard(){
 // The upstream UI can leave its lexical "busy" guard stuck after a failed
 // pre-flight save/import while later wrappers visually re-enable the button.
 // Only release it when the stop controller confirms no real GA pass is running.
 if(window.__PP_STOP_DEBUG__?.().running===true || window.__PP_STOP_DEBUG__?.().reconnecting===true)return false;
 try{if(typeof busy!=="undefined")busy=false}catch(_){}
 try{
  if(typeof modelReady!=="undefined"&&typeof model!=="undefined"&&model&&Array.isArray(model.orders)&&model.orders.length)
   modelReady=true;
 }catch(_){}
 window.__ppOptimizationInFlight=false;
 btn.disabled=false;
 return true;
}
btn.addEventListener("click",()=>{
 if(!isBusy())releaseStalePrimaryGuard();
},true);
const observer=new MutationObserver(updateDisabled);
observer.observe(btn,{attributes:true,attributeFilter:["disabled"]});
window.addEventListener("pp:optimizer-started",updateDisabled);
window.addEventListener("pp:optimizer-finished",updateDisabled);
window.addEventListener("pp:optimizer-reconnect-pending",updateDisabled);
window.addEventListener("pp:optimizer-stopped",updateDisabled);
const savedReadyObserver=new MutationObserver(()=>queueMicrotask(()=>{restoreSavedPlanReadiness();updateDisabled()}));
const savedMeta=find("meta"),savedStatus=find("valid");
if(savedMeta)savedReadyObserver.observe(savedMeta,{childList:true,subtree:true,characterData:true});
if(savedStatus)savedReadyObserver.observe(savedStatus,{childList:true,subtree:true,characterData:true});
setTimeout(restoreSavedPlanReadiness,0);
setTimeout(restoreSavedPlanReadiness,250);
function setText(id,text){
 const node=find(id);
 if(node)node.textContent=text;
}
function storedLastPlan(){
 try{
  const id=currentProject();
  const list=JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]");
  const project=Array.isArray(list)?list.find(x=>x&&x.id===id):null;
  const p=project?.lastPlan;
  const ops=p&&(p.operations||p.generic_operations||[]);
  return p&&p.valid!==false&&Array.isArray(ops)&&ops.length?p:null;
 }catch(_){return null}
}
function showFreshDisplayBaseline(){
 const p=window.__ppFreshDisplayBaseline;
 const ops=p&&(p.operations||p.generic_operations||[]);
 if(!p||p.valid===false||!Array.isArray(ops)||!ops.length)return false;
 try{
  if(typeof renderPlan==="function")renderPlan(p);
  if(typeof renderKpisWithDelta==="function")renderKpisWithDelta(p);
 }catch(e){console.warn("PP_FRESH_BASELINE_RENDER",String(e));return false}
 // This is display-only. Do not let the previous plan turn the new search into
 // a continuation or become the accepted incumbent.
 window.__ppOptimizerCommittedPlan=null;
 window.__ppTabPlan=null;
 window.__ppGenericPlan=null;
 window.__ppManualPlan=null;
 try{if(typeof hasResult!=="undefined")hasResult=false}catch(_){}
 btn.disabled=false;
 btn.textContent="Запустить оптимизацию";
 const status=find("validator");
 if(status)status.textContent="Показан предыдущий валидный план как временная база. Идёт новый поиск; первый новый Best found заменит его автоматически.";
 const badge=find("valid");
 if(badge)badge.textContent="GA: новый поиск · ожидаем первый новый план";
 return true;
}
function resetVisiblePlan(){
 // clearPlan is the original app's reset; it clears all four KPIs and the Gantt.
 try{if(typeof clearPlan==="function")clearPlan()}catch(e){console.warn("PP_FRESH_RESET_GANTT",String(e))}
 for(const id of ["dur","cycles","waitKpi","idleKpi"])setText(id,"—");
 for(const id of ["durDelta","cyclesDelta","waitDelta","idleDelta"]){
  const node=find(id);if(node){node.textContent="";node.className="kpi-delta"}
 }
 try{if(typeof previousKpiMetrics!=="undefined")previousKpiMetrics=null}catch(_){}
 try{if(typeof hasResult!=="undefined")hasResult=false}catch(_){}
 window.__ppOptimizerCommittedPlan=null;
 window.__ppTabPlan=null;
 window.__ppGenericPlan=null;
 window.__ppManualPlan=null;
 window.__ppKpiBaselinePlan=null;
 window.__ppResumeSavedPlan=null;
 window.__ppSavedResumeInfo=null;
 window.__ppOptimizerObjectiveAtStart=null;
 window.__ppOptimizationInFlight=false;
 window.__ppStopUiLocked=false;
 window.__PP_LIVE_MOTION_STATE__=null;
 const preview=find("ppOptimizerCandidateStatus");
 if(preview){preview.textContent="";preview.style.display="none"}
 setText("meta","Новый поиск · всего 0 поколений · запуск 0");
 const badge=find("valid");
 if(badge){badge.className="pill";badge.textContent="GA: новый поиск · 0/240"}
 setText("validator","Новый расчёт: выбираем первый лучший план. Предыдущие результаты сброшены.");
 btn.classList.remove("pp-opt-running");
 btn.disabled=false;
 btn.textContent="Запустить оптимизацию";
}
function finish(){
 resetting=false;
 // The first successful new plan must become the reference, never the old saved plan.
 if(window.__ppFreshRestartMode && !window.__ppFreshReferencePlan){
  const result=window.__ppOptimizerCommittedPlan;
  if(result&&result.valid!==false&&!result.partial&&
     Array.isArray(result.operations)&&result.operations.length)
   window.__ppFreshReferencePlan=result;
 }
 window.__ppFreshRestartPending=false;
 updateDisabled();
}
fresh.onclick=async function(){
 if(isBusy())return;
 const status=find("validator");
 resetting=true;updateDisabled();
 const oldText=fresh.textContent;
 fresh.textContent="Сбрасываю предыдущий поиск…";
 try{
  const response=await fetch("/api/optimizer-reset",{
   method:"POST",cache:"no-store",credentials:"same-origin",
   headers:{"Content-Type":"application/json"},body:"{}"
  });
  const data=await response.json();
  if(!response.ok||!data?.ok){
   if(data?.error==="optimization_running_stop_first"){
    // Stale browser state is not proof that the server has stopped GA.
    // Preserve all project and plan data, reconnect instead of resetting.
    window.__PP_GA_RECHECK__?.();
    const e=new Error("GA is still running; restoring current progress");
    e.ppReconnecting=true;
    throw e;
   }
   throw Error(data?.error||"Не удалось сбросить оптимизацию");
  }
  const previous=window.__ppOptimizerCommittedPlan||window.__ppTabPlan||window.__ppManualPlan||storedLastPlan();
  try{window.__ppFreshDisplayBaseline=previous?JSON.parse(JSON.stringify(previous)):null}catch(_){window.__ppFreshDisplayBaseline=previous||null}
  window.__ppFreshRestartMode=true;
  window.__ppFreshRestartPending=true;
  window.__ppFreshRestartProject=currentProject();
  window.__ppFreshReferencePlan=null;
  resetVisiblePlan();
  showFreshDisplayBaseline();
  // Use the existing (stop + progress + original GA) click chain, not a second GA implementation.
  resetting=false;
  fresh.textContent=oldText;
  updateDisabled();
  try{
   if(typeof btn.onclick!=="function")throw Error("Управление оптимизацией ещё не готово");
   releaseStalePrimaryGuard();
   await btn.onclick({type:"click",target:btn,preventDefault(){}})
  }
  finally{finish()}
 }catch(err){
  if(window.__ppFreshRestartPending)finish();
  else{resetting=false;updateDisabled()}
  fresh.textContent=oldText;
  const english=window.__PP_LANGUAGE__?.current==="en";
  const text=err?.ppReconnecting
   ?(english?"GA is already running. Reconnecting to the current search…"
     :"GA уже выполняется. Восстанавливаем текущий расчёт…")
   :("Не удалось начать заново: "+String(err?.message||err));
  if(status)status.textContent=text;
  if(!err?.ppReconnecting)console.error("PP_FRESH_OPTIMIZER_START_ERROR",err);
 }
};

// Production optimization depth: display-only preference controls; never
// mutate project orders, worker isolation, Gantt or saved GA plans.
// The existing account-scoped POST /api/plan remains the single way to start.
(function installOptimizerDepth(){
 if(window.__PP_OPTIMIZER_DEPTH__?.installed)return;
 const modes=Object.freeze({
  quick:Object.freeze({generations:30,population:24}),
  standard:Object.freeze({generations:60,population:32}),
  thorough:Object.freeze({generations:180,population:48}),
  maximum:Object.freeze({generations:360,population:64})
 });
 const modesList=Object.keys(modes);
 const preferenceKey="pp.optimizer.depth.v1.";
 const dbName="prodplan-ui-preferences";
 let scope="",selection="standard",revision=0,select=null,heading=null,note=null,help=null,helpSummary=null;
 const validMode=m=>Object.hasOwn(modes,m)?m:"standard";
 const projectKey=()=>String(currentProject()||"default").slice(0,160);
 const storageKey=key=>preferenceKey+key;
 const safeGet=(storage,key)=>{try{return storage.getItem(key)}catch(_){return null}};
 const read=key=>validMode(safeGet(sessionStorage,storageKey(key))||safeGet(localStorage,storageKey(key)));
 function storeInDb(key,mode){
  if(!("indexedDB" in window))return;
  try{
   const req=indexedDB.open(dbName,1);
   req.onupgradeneeded=()=>{
    const db=req.result;
    if(!db.objectStoreNames.contains("settings"))db.createObjectStore("settings");
   };
   req.onsuccess=()=>{
    const db=req.result;
    try{
     const tx=db.transaction("settings","readwrite");
     tx.objectStore("settings").put(mode,"optimizer-depth:"+key);
     tx.oncomplete=()=>db.close();
     tx.onerror=()=>db.close();
    }catch(_){db.close()}
   };
  }catch(_){}
 }
 function restoreFromDb(key,expectedRevision){
  if(!("indexedDB" in window))return;
  try{
   const req=indexedDB.open(dbName,1);
   req.onupgradeneeded=()=>{
    const db=req.result;
    if(!db.objectStoreNames.contains("settings"))db.createObjectStore("settings");
   };
   req.onsuccess=()=>{
    const db=req.result;
    try{
     const tx=db.transaction("settings","readonly");
     const get=tx.objectStore("settings").get("optimizer-depth:"+key);
     get.onsuccess=()=>{
      if(scope!==key||revision!==expectedRevision||!Object.hasOwn(modes,get.result))return;
      selection=get.result;render();
     };
     tx.oncomplete=()=>db.close();
     tx.onerror=()=>db.close();
    }catch(_){db.close()}
   };
  }catch(_){}
 }
 const locale=()=>document.getElementById("ppLanguageSelect")?.value||
  window.__PP_LANGUAGE__?.current||"en";
 const english=()=>locale()!=="ru";
 const labels={
  quick:["Быстрая","Quick"],
  standard:["Стандартная · рекомендуется","Standard · recommended"],
  thorough:["Тщательная","Thorough"],
  maximum:["Максимальная","Maximum"]
 };
 function textPair(ru,en){return english()?en:ru}
 function syncProject(){
  const key=projectKey();
  if(key===scope)return;
  scope=key;selection=read(key);
  const token=++revision;
  render();restoreFromDb(key,token);
 }
 function saveSelected(mode){
  selection=validMode(mode);revision++;
  const key=projectKey();
  if(scope!==key)scope=key;
  for(const storage of [sessionStorage,localStorage]){
   try{storage.setItem(storageKey(key),selection)}catch(_){}
  }
  storeInDb(key,selection);render();
  window.dispatchEvent(new CustomEvent("pp:optimizer-depth-changed",{
   detail:{mode:selection,...modes[selection],project:key}
  }));
 }
 function depthBusy(){
  return isBusy()||window.__PP_STOP_DEBUG__?.().running===true;
 }
 function render(){
  if(!select)return;
  const en=english(),config=modes[selection];
  heading.textContent=textPair("Тщательность оптимизации","Optimization depth");
  for(const option of select.options){
   const lbl=labels[option.value];
   if(lbl)option.textContent=lbl[en?1:0];
  }
  select.value=selection;
  select.setAttribute("aria-label",textPair("Тщательность оптимизации","Optimization depth"));
  select.title=textPair("Выберите, насколько тщательно искать лучшее расписание.",
   "Choose how thoroughly to search for a better schedule.");
  const amount=(config.generations*config.population).toLocaleString(en?"en-US":"ru-RU");
  note.textContent=textPair(
   "До "+config.generations+" поколений × "+config.population+" вариантов (≈"+amount+" оценок)",
   "Up to "+config.generations+" generations × "+config.population+" candidates (≈"+amount+" evaluations)"
  );
  const details=textPair(
   "Более тщательный поиск проверяет больше вариантов и может занять заметно дольше. Улучшение плана не гарантировано. Настройка действует для следующего запуска или продолжения; текущий расчёт не меняется. Остановить можно в любой момент.",
   "Higher depth evaluates more alternatives and may take considerably longer. A better plan is not guaranteed. This setting applies to the next start or continuation, not the running job. You can stop at any time."
  );
  help.textContent=details;
  helpSummary.title=details;
  helpSummary.setAttribute("aria-label",textPair("Как это работает","How optimization depth works"));
  select.disabled=depthBusy();
 }
 function mount(){
  if(select?.isConnected)return true;
  const toolbar=document.querySelector("#planView .toolbar");
  if(!toolbar)return false;
  const container=document.createElement("div");
  container.id="ppOptimizerDepth";
  container.style.cssText="display:inline-flex;align-items:center;gap:7px;flex-wrap:wrap;padding:4px 8px;border:1px solid #dce6f1;border-radius:9px;background:#f8fbff;box-sizing:border-box;color:#233650;max-width:100%;font:500 12px/1.4 system-ui,sans-serif;";
  heading=document.createElement("label");
  heading.id="ppOptimizerDepthLabel";heading.htmlFor="ppOptimizerDepthSelect";
  heading.style.cssText="white-space:nowrap;font-weight:600;";
  select=document.createElement("select");
  select.id="ppOptimizerDepthSelect";
  select.style.cssText="min-height:30px;border:1px solid #ccdaea;border-radius:7px;background:white;color:#243954;padding:5px 6px;max-width:170px;font:500 12px system-ui,sans-serif;";
  for(const key of modesList){
   const option=document.createElement("option");option.value=key;select.append(option);
  }
  select.addEventListener("change",()=>{
   if(depthBusy()){select.value=selection;return}
   saveSelected(select.value);
  });
  note=document.createElement("small");note.id="ppOptimizerDepthDetail";
  note.style.cssText="color:#70829b;font-size:10px;white-space:nowrap;";
  const info=document.createElement("details");
  info.id="ppOptimizerDepthHelp";
  info.style.cssText="position:relative;display:inline-block;";
  helpSummary=document.createElement("summary");
  helpSummary.textContent="?";
  helpSummary.style.cssText="list-style:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:1px solid #a5b7ce;border-radius:50%;font-size:11px;font-weight:700;color:#4e6788;user-select:none;";
  help=document.createElement("div");
  help.id="ppOptimizerDepthHelpText";
  help.style.cssText="position:absolute;top:24px;left:-240px;z-index:1200;width:290px;max-width:calc(100vw - 42px);padding:12px;border:1px solid #cbd9ec;border-radius:9px;background:#fff;color:#263c59;box-shadow:0 8px 25px #243f6426;font-size:12px;line-height:1.5;font-weight:400;white-space:normal;";
  info.append(helpSummary,help);
  container.append(heading,select,note,info);
  const mode=toolbar.querySelector('[data-mode="best"]')||toolbar.querySelector('[data-mode="candidate"]');
  // The real production Gantt nests mode buttons inside a separate wrapper;
  // insertBefore requires a direct child of toolbar, not a descendant.
  let anchor=mode;
  while(anchor?.parentElement&&anchor.parentElement!==toolbar){
   anchor=anchor.parentElement;
  }
  if(anchor?.parentElement===toolbar)toolbar.insertBefore(container,anchor);
  else toolbar.append(container);
  syncProject();render();
  return true;
 }
 // Safe same-account launch decoration: the original transport, Stop and GA
 // request are untouched except two numeric optimization parameters.
 const previousFetch=window.fetch.bind(window);
 window.fetch=function(input,init){
  try{
   const target=typeof input==="string"?input:input?.url||"";
   const path=new URL(target,location.href).pathname;
   const method=String(init?.method||(typeof Request!=="undefined"&&input instanceof Request?input.method:"GET")).toUpperCase();
   // Restrict to a real UI run initiated by the original Stop controller.
   // Synthetic API calls, resets, progress polling and saved-plan endpoints
   // bypass the preference wrapper completely.
   if(path==="/api/plan"&&method==="POST"&&
      window.__PP_STOP_DEBUG__?.().running===true&&typeof init?.body==="string"){
    const body=JSON.parse(init.body);
    if(body&&typeof body==="object"&&!Array.isArray(body)){
     syncProject();
     const config=modes[selection];
     const updated={...body,generations:config.generations,population:config.population};
     window.__PP_OPTIMIZER_DEPTH_LAST_RUN__={
      mode:selection,generations:config.generations,population:config.population,
      continued:!!(body.continue||body.continue_run)
     };
     return previousFetch(input,{...init,body:JSON.stringify(updated)});
    }
   }
  }catch(error){console.warn("PP_OPTIMIZER_DEPTH_BYPASS",String(error).slice(0,70))}
  return previousFetch(input,init);
 };
 const refresh=()=>{syncProject();if(!select?.isConnected)mount();render()};
 window.addEventListener("pp:optimizer-started",refresh);
 window.addEventListener("pp:optimizer-finished",refresh);
 window.addEventListener("pp:optimizer-stopped",refresh);
 window.addEventListener("pp:optimizer-reconnect-pending",refresh);
 window.addEventListener("pp:language-changed",refresh);
 window.addEventListener("storage",refresh);
 window.addEventListener("focus",refresh);
 // Project navigation can replace project storage without a full reload.
 setInterval(()=>{if(projectKey()!==scope)syncProject();if(select&&!select.isConnected)mount()},2000);
 window.__PP_OPTIMIZER_DEPTH__={
  installed:true,
  get:()=>({project:projectKey(),mode:selection,...modes[selection],
   disabled:select?select.disabled:false,
   lastRun:window.__PP_OPTIMIZER_DEPTH_LAST_RUN__||null}),
  set:mode=>{if(depthBusy())return false;saveSelected(mode);return true}
 };
 mount();setTimeout(mount,150);setTimeout(mount,900);
})();

window.__PP_FRESH_OPTIMIZER_DEBUG__=()=>({
 installed:window.__ppFreshOptimizerUiInstalled,
 resetting,disabled:fresh.disabled,
 freshMode:!!window.__ppFreshRestartMode,
 pending:!!window.__ppFreshRestartPending,
 referenceDuration:window.__ppFreshReferencePlan?.duration_minutes??null,
 displayBaselineDuration:window.__ppFreshDisplayBaseline?.duration_minutes??null,
 project:window.__ppFreshRestartProject??null,
 upstreamBusy:(()=>{try{return typeof busy!=="undefined"?!!busy:null}catch(_){return null}})(),
 modelReady:(()=>{try{return typeof modelReady!=="undefined"?!!modelReady:null}catch(_){return null}})()
});
updateDisabled();
})();
