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
let resetting=false;
const find=id=>document.getElementById(id);
const currentProject=()=>{try{return localStorage.getItem("prodplan.project.active.v2")}catch(_){return null}};
function isBusy(){
 // The stop controller is the authoritative source for a GA pass in progress.
 // The original opt.disabled and __ppOptimizationInFlight can remain stale
 // after a normal completion; neither should lock an independent restart.
 // The server also rejects a reset if a pass is still actually running.
 return resetting || window.__PP_STOP_DEBUG__?.().running===true;
}
function updateDisabled(){fresh.disabled=isBusy()}
const observer=new MutationObserver(updateDisabled);
observer.observe(btn,{attributes:true,attributeFilter:["disabled"]});
window.addEventListener("pp:optimizer-started",updateDisabled);
window.addEventListener("pp:optimizer-finished",updateDisabled);
window.addEventListener("pp:optimizer-stopped",updateDisabled);
function setText(id,text){
 const node=find(id);
 if(node)node.textContent=text;
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
  if(!response.ok||!data?.ok)throw Error(data?.error||"Не удалось сбросить оптимизацию");
  window.__ppFreshRestartMode=true;
  window.__ppFreshRestartPending=true;
  window.__ppFreshRestartProject=currentProject();
  window.__ppFreshReferencePlan=null;
  resetVisiblePlan();
  // Use the existing (stop + progress + original GA) click chain, not a second GA implementation.
  resetting=false;
  fresh.textContent=oldText;
  updateDisabled();
  try{
   if(typeof btn.onclick!=="function")throw Error("Управление оптимизацией ещё не готово");
   await btn.onclick({type:"click",target:btn,preventDefault(){}})
  }
  finally{finish()}
 }catch(err){
  if(window.__ppFreshRestartPending)finish();
  else{resetting=false;updateDisabled()}
  fresh.textContent=oldText;
  const text="Не удалось начать заново: "+String(err?.message||err);
  if(status)status.textContent=text;
  console.error("PP_FRESH_OPTIMIZER_START_ERROR",err);
 }
};
window.__PP_FRESH_OPTIMIZER_DEBUG__=()=>({
 installed:window.__ppFreshOptimizerUiInstalled,
 resetting,disabled:fresh.disabled,
 freshMode:!!window.__ppFreshRestartMode,
 pending:!!window.__ppFreshRestartPending,
 referenceDuration:window.__ppFreshReferencePlan?.duration_minutes??null,
 project:window.__ppFreshRestartProject??null
});
updateDisabled();
})();
