(function(){
"use strict";
if(window.__ppStopOptimizerInstalled)return;
window.__ppStopOptimizerInstalled=true;
const btn=document.getElementById("opt");
if(!btn || typeof btn.onclick!=="function")return;
const stop=document.createElement("button");
stop.type="button";stop.id="ppStopOptimizer";
stop.textContent="Остановить оптимизацию";
stop.disabled=true;
btn.insertAdjacentElement("afterend",stop);
const modal=document.createElement("div");
modal.id="ppStopModal";modal.setAttribute("role","presentation");
modal.style.display="none";document.body.appendChild(modal);
const style=document.createElement("style");
style.id="ppStopOptimizerStyles";
style.textContent="#ppStopOptimizer{display:none;align-items:center;justify-content:center;border:1px solid #e49a95;background:#fff2f0;color:#af2f24;padding:11px 15px;border-radius:10px;cursor:pointer;min-height:42px;font:700 14px/1.2 system-ui;max-width:100%}#ppStopOptimizer.pp-on{display:inline-flex}#ppStopOptimizer:disabled{opacity:.55;cursor:wait}#ppStopModal{position:fixed;inset:0;z-index:2147483600;padding:16px;align-items:center;justify-content:center;background:rgba(8,27,55,.62);box-sizing:border-box}#ppStopModal.pp-open{display:flex!important}#ppStopModal .pp-box{max-width:580px;width:100%;max-height:88vh;overflow-y:auto;box-sizing:border-box;background:#fff;border-radius:16px;padding:20px;color:#223752;box-shadow:0 18px 70px #14253f40;font:14px/1.45 system-ui,sans-serif}#ppStopModal h3{font-size:20px;margin:0 0 8px}#ppStopModal p{color:#5a6c84;margin:0 0 15px}#ppStopModal .pp-choice{display:flex;gap:10px;align-items:center;padding:12px;margin-bottom:8px;border:1px solid #d2dce9;border-radius:9px;cursor:pointer}#ppStopModal .pp-choice:has(input:checked){border-color:#3377d8;background:#eff5ff}#ppStopModal .pp-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}#ppStopModal button{background:#2566cc;color:#fff;border:0;border-radius:9px;padding:11px 14px;font:700 14px system-ui;cursor:pointer}#ppStopModal button.pp-secondary{background:#eef1f7;color:#33445e}";
document.head.appendChild(style);
let generation=0,running=false,requestStop=false,prevPlan=null,items=[],timer=null,criterion="duration",originalBtn=btn.onclick,selectedPlan=null,modalShown=false,stoppedPlanAvailable=false,candidateAvailable=false;
let reconnecting=true,recoveredSession=false,remotePercent=0,remotePhase="checking",remoteFailureCount=0;
const keys={duration:"duration_minutes",wait:"operator_wait_minutes",idle:"machine_idle_minutes",cycles:"batch_count"};
const label={duration:"Общее время",wait:"Ожидание оператора",idle:"Простой оборудования",cycles:"Число циклов"};
function key(){return keys[criterion]||keys.duration}
function valid(p){return !!(p&&p.valid!==false&&!p.partial&&Array.isArray(p.operations)&&p.operations.length&&Number.isFinite(Number(p[key()]))&&Number(p[key()])>=0)}
function liveModeButton(mode){
 return document.querySelector('#planView [data-mode="'+mode+'"]')||document.querySelector('[data-mode="'+mode+'"]');
}
function preferBestLivePreview(){
 const best=liveModeButton("best");
 if(best&&typeof best.click==="function")best.click();
 const candidate=liveModeButton("candidate");
 if(candidate){
  candidate.disabled=running&&!candidateAvailable;
  candidate.setAttribute("aria-disabled",String(running&&!candidateAvailable));
  candidate.title=running&&!candidateAvailable?"Current isolated GA exposes the best intermediate plan during this run.":"";
 }
}
function hasContinuablePlan(){
 if(stoppedPlanAvailable||valid(selectedPlan)||valid(prevPlan))return true;
 if(valid(window.__ppOptimizerCommittedPlan)||valid(window.__ppTabPlan))return true;
 return typeof hasResult!=="undefined"&&hasResult===true;
}
function setActionAfterStop(){
 btn.classList.remove("pp-opt-running");
 btn.title="";
 btn.textContent=hasContinuablePlan()?"Продолжить оптимизацию":"Запустить оптимизацию";
}
function record(p){
 if(!running || !valid(p))return;
 const score=Number(p[key()]);
 if(items.some(x=>Math.abs(x.score-score)<.0001))return;
 try{items.push({score,plan:JSON.parse(JSON.stringify(p))})}catch(e){return}
 items.sort((a,b)=>a.score-b.score);
 if(items.length>16)items.length=16;
 stop.disabled=false;stop.title="Корректных вариантов: "+items.length;
}
// The GA belongs to the account on the server and survives a browser reload.
// The public progress API is read-only. A reload must JOIN it, not reset/start.
function ppRecoveredProgressLabel(data){
 const pct=Number(data?.percent);
 remotePercent=Number.isFinite(pct)?Math.min(100,Math.max(0,Math.round(pct))):remotePercent;
 remotePhase=String(data?.phase||"running");
 const status=document.getElementById("valid");
 if(status)status.textContent="GA: оптимизация · "+remotePercent+"%";
 const metadata=document.getElementById("meta");
 if(metadata)metadata.textContent="GA: оптимизация · "+remotePercent+"%";
 btn.disabled=true;
 btn.textContent="Оптимизация "+remotePercent+"%";
 stop.disabled=false;
 stop.textContent="Остановить оптимизацию";
 if(!stop.classList.contains("pp-on"))stop.classList.add("pp-on");
}
function ppFinishRecoveredJob(data){
 if(!recoveredSession)return;
 recoveredSession=false;reconnecting=false;running=false;requestStop=false;
 clearTimeout(timer);timer=null;candidateAvailable=false;
 stop.classList.remove("pp-on");stop.disabled=false;
 const candidate=liveModeButton("candidate");
 if(candidate){candidate.disabled=false;candidate.removeAttribute("aria-disabled");candidate.title=""}
 window.__ppOptimizationInFlight=false;
 window.__ppStopUiLocked=false;
 const result=data?.success===true&&valid(data?.result)?data.result:null;
 if(result){
  restore(result);
  try{if(typeof hasResult!=="undefined")hasResult=true}catch(_){}
  selectedPlan=result;stoppedPlanAvailable=true;
  const status=document.getElementById("valid"),meta=document.getElementById("meta");
  if(status)status.textContent="GA: расчёт завершён";
  if(meta)meta.textContent="GA: расчёт завершён";
  const note=document.getElementById("validator");
  if(note)note.textContent="План показан на Ганте";
 }else if(data?.phase==="cancelled"||data?.stopped===true){
  const status=document.getElementById("valid");if(status)status.textContent="GA: остановлено · выбери вариант";
  const note=document.getElementById("validator");
  if(note)note.textContent="Остановлено пользователем. Выбери найденный вариант. Сохранённые планы не изменены.";
 }else if(data?.error){
  const status=document.getElementById("valid");if(status)status.textContent="Ошибка GA";
  const note=document.getElementById("validator");if(note)note.textContent=String(data.error).slice(0,140);
 }
 btn.disabled=false;setActionAfterStop();
 window.dispatchEvent(new Event("pp:optimizer-finished"));
}
function ppAttachRecoveredJob(data){
 if(running||!data||data.ok!==true||data.running!==true)return false;
 reconnecting=false;recoveredSession=true;remoteFailureCount=0;
 const my=++generation;
 running=true;requestStop=false;items=[];selectedPlan=null;modalShown=false;
 stoppedPlanAvailable=false;candidateAvailable=false;window.__ppStopUiLocked=false;
 criterion=(typeof window.ppOptimizerObjective==="function"?window.ppOptimizerObjective():null)||
  (typeof model!=="undefined"&&model?.objective)||"duration";
 prevPlan=window.__ppOptimizerCommittedPlan||window.__ppTabPlan||window.__ppFreshDisplayBaseline||null;
 window.__ppOptimizationInFlight=true;
 ppRecoveredProgressLabel(data);
 record(data.best_preview);record(data.candidate_preview);
 window.dispatchEvent(new Event("pp:optimizer-started"));
 timer=setTimeout(()=>poll(my),1800);
 return true;
}
async function ppRecoverRunningGaFromAccount(){
 // Until the first authoritative response, never offer a destructive restart.
 if(!reconnecting||running)return;
 try{
  const response=await fetch("/api/plan-progress?ppReconnect="+Date.now(),{
   method:"GET",cache:"no-store",credentials:"same-origin",
   headers:{accept:"application/json"}
  });
  if(!response.ok)throw Error("HTTP "+response.status);
  const status=await response.json();
  if(!status||status.ok!==true)throw Error("unavailable");
  reconnecting=false;remoteFailureCount=0;
  if(status.running===true){
   ppAttachRecoveredJob(status);
  }else{
   remotePhase=String(status.phase||"idle");
   // A result already completed during reload must be shown without
   // sending POST /api/plan. Do not write or change saved plans.
   if(status.success===true&&valid(status.result)){
    recoveredSession=true;
    ppFinishRecoveredJob(status);
   }else window.dispatchEvent(new Event("pp:optimizer-finished"));
  }
 }catch(error){
  remoteFailureCount++;
  console.warn("PP_GA_RECONNECT_RETRY",remoteFailureCount,String(error).slice(0,70));
  if(remoteFailureCount<8&&reconnecting){
   setTimeout(ppRecoverRunningGaFromAccount,Math.min(3500,400*remoteFailureCount));
  }else if(reconnecting){
   // Fail closed: if we cannot read the account's running status, do NOT
   // offer a fresh search that would hit optimization_running_stop_first.
   const note=document.getElementById("validator");
   if(note)note.textContent="Не удалось проверить активную оптимизацию. Обновите страницу для повторного подключения.";
   const status=document.getElementById("valid");
   if(status)status.textContent="GA: подключение недоступно";
  }
 }
}
async function poll(my){
 if(!running||requestStop||my!==generation)return;
 try{
  const response=await fetch("/api/plan-progress?stop_snapshot="+Date.now(),{cache:"no-store"});
  const data=await response.json();
  if(my===generation&&running&&!requestStop&&data&&data.ok){
   candidateAvailable=valid(data.candidate_preview);
   if(!candidateAvailable&&valid(data.best_preview))preferBestLivePreview();
   record(data.candidate_preview);record(data.best_preview);
   if(recoveredSession){
    if(data.running===false){ppFinishRecoveredJob(data);return;}
    ppRecoveredProgressLabel(data);
   }
  }
 }catch(e){console.warn("PP_STOP_PROGRESS",String(e))}
 if(my===generation&&running&&!requestStop){stop.disabled=false;timer=setTimeout(()=>poll(my),1750);}
}
function restore(plan){
 if(!plan)return;
 window.__ppOptimizerCommittedPlan=plan;window.__ppTabPlan=plan;window.__ppGenericPlan=plan;
 try{if(typeof renderPlan==="function")renderPlan(plan)}catch(e){console.warn("PP_STOP_RESTORE",e)}
 try{if(typeof renderKpisWithDelta==="function")renderKpisWithDelta(plan)}catch(e){}
}
function choose(plan){
 if(!valid(plan))return;
 selectedPlan=plan;stoppedPlanAvailable=true;
 if(window.__ppFreshRestartMode){window.__ppFreshReferencePlan=plan;try{window.__ppFreshReferenceProject=localStorage.getItem("prodplan.project.active.v2")}catch(_){}}
 restore(plan);
 setActionAfterStop();
 try{
  if(typeof hasResult!=="undefined")hasResult=true;
  const tab=[...document.querySelectorAll(".tabs > div")].find(e=>e.classList.contains("a"))?.textContent.trim();
  if(tab&&typeof overrideSecondary==="function")overrideSecondary(tab);
 }catch(e){console.warn("PP_STOP_SECONDARY",e)}
 const validStatus=document.getElementById("valid"),note=document.getElementById("validator");
 if(validStatus)validStatus.textContent="GA: остановлено · план выбран";
 if(note)note.textContent="Выбран вариант "+Math.round(Number(plan.duration_minutes))+" мин. План показан на Ганте и ещё не сохранён.";
 const preview=document.getElementById("ppOptimizerCandidateStatus");if(preview)preview.style.display="none";
}
function showModal(){
 if(modalShown)return;
 modalShown=true;
 const candidates=items.filter(x=>valid(x.plan)).sort((a,b)=>a.score-b.score);
 if(!candidates.length){restore(prevPlan);stoppedPlanAvailable=valid(prevPlan);setActionAfterStop();const status=document.getElementById("valid");if(status)status.textContent="GA: остановлено, нет готовых вариантов";return}
 const box=document.createElement("div");box.className="pp-box";box.setAttribute("role","dialog");box.setAttribute("aria-modal","true");box.setAttribute("aria-label","Выбор плана после остановки");
 const heading=document.createElement("h3");heading.textContent="Оптимизация остановлена";
 const hint=document.createElement("p");hint.textContent="Выбери найденный вариант. Лучший по критерию «"+(label[criterion]||"Общее время")+"» отмечен автоматически. Прежний план не будет перезаписан, пока ты не выберешь новый.";
 box.append(heading,hint);
 candidates.slice(0,12).forEach((row,index)=>{
  const wrap=document.createElement("label");wrap.className="pp-choice";
  const radio=document.createElement("input");radio.type="radio";radio.name="ppPlanStopChoice";radio.value=String(index);radio.checked=index===0;
  const span=document.createElement("span");
  span.textContent=(index===0?"Лучший найденный":"Вариант "+(index+1))+" — "+Math.round(Number(row.plan.duration_minutes))+" мин · "+(label[criterion]||"Цель")+": "+Number(row.score).toLocaleString("ru-RU",{maximumFractionDigits:2});
  wrap.append(radio,span);box.append(wrap)
 });
 const actions=document.createElement("div");actions.className="pp-actions";
 const select=document.createElement("button");select.textContent="Выбрать и показать на Ганте";
 select.onclick=()=>{
  const n=Number(box.querySelector("input[name=ppPlanStopChoice]:checked")?.value||0);
  choose(candidates[n]?.plan||candidates[0].plan);
  modal.classList.remove("pp-open");modal.style.display="none";
 };
 const old=document.createElement("button");old.textContent="Оставить прежний план";old.className="pp-secondary";
 old.onclick=()=>{
  restore(prevPlan);
  selectedPlan=valid(prevPlan)?prevPlan:null;stoppedPlanAvailable=!!selectedPlan;
  setActionAfterStop();
  const status=document.getElementById("valid");if(status)status.textContent="GA: остановлено · прежний план сохранён";
  modal.classList.remove("pp-open");modal.style.display="none";
 };
 actions.append(select,old);box.append(actions);modal.replaceChildren(box);modal.style.display="flex";modal.classList.add("pp-open");
}

async function ppConfirmStoppedAfterAmbiguousResponse(){
 // A cancellation can succeed in the isolated GA worker while the older
 // bridge sees a completed legacy run and returns HTTP 409. Only a cancelled
 // state from this same authenticated account confirms the stop.
 try{
  const response=await fetch("/api/plan-progress?ppStopConfirm="+Date.now(),{
   method:"GET",cache:"no-store",credentials:"same-origin"
  });
  if(!response.ok)return null;
  const status=await response.json();
  if(status?.ok===true&&status.running===false&&
     (status.phase==="cancelled"||status.stopped===true||
      status.error==="optimization_stopped")){
   return {ok:true,stopped:true,best_preview:status.best_preview||null,
      variants:[],confirmed_by:"account_scoped_progress"};
  }
 }catch(e){console.warn("PP_STOP_CONFIRM_UNAVAILABLE",String(e).slice(0,80))}
 return null;
}
function ppReconcileStoppedUi(expectedGeneration){
 if(expectedGeneration!==generation||!requestStop||running||
    window.__ppFreshRestartPending)return;
 stop.classList.remove("pp-on");
 stop.disabled=false;
 stop.textContent="Остановить оптимизацию";
 window.__ppOptimizationInFlight=false;
 btn.disabled=false;
 setActionAfterStop();
 const status=document.getElementById("valid");
 if(status&&(/GA error|^Error|Ошибка GA|failed|ошибка|stopped|остановлено/i.test(status.textContent||"")||
    /running|оптимизация|optimization/i.test(status.textContent||"")))
  status.textContent=selectedPlan?"GA: остановлено · план выбран":"GA: остановлено · выбери вариант";
 const note=document.getElementById("validator");
 if(note&&/optimization_stopped|ga_worker_cancelled|ga_client_wait_timeout|AbortError|^ga_error$/i.test(note.textContent||""))
  note.textContent=selectedPlan
   ?"Остановлено пользователем. Выбранный план показан на Ганте и пока не сохранён."
   :"Остановлено пользователем. Выбери найденный вариант. Сохранённые планы не изменены.";
 if(!modalShown)showModal();
}
function ppScheduleStopReconciliation(expectedGeneration){
 // The legacy /api/plan Promise can settle AFTER the stop endpoint returns.
 // Its old finalizer must not overwrite a confirmed user cancellation.
 for(const delay of [0,75,250,700,1500,3000]){
  setTimeout(()=>ppReconcileStoppedUi(expectedGeneration),delay);
 }
}

btn.onclick=async function(event){
 if(reconnecting||running||btn.disabled)return;
 const my=++generation;
 running=true;requestStop=false;items=[];stop.disabled=false;selectedPlan=null;modalShown=false;stoppedPlanAvailable=false;candidateAvailable=false;window.__ppStopUiLocked=false;
 preferBestLivePreview();
 // Make the restart control unavailable immediately, even before the original
 // GA handler updates the primary button's disabled attribute.
 window.dispatchEvent(new Event("pp:optimizer-started"));
 stop.textContent="Остановить оптимизацию";stop.classList.add("pp-on");
 criterion=(typeof window.ppOptimizerObjective==="function"?window.ppOptimizerObjective():null)||(typeof model!=="undefined"&&model?.objective)||"duration";
 prevPlan=window.__ppOptimizerCommittedPlan||window.__ppTabPlan||window.__ppFreshDisplayBaseline||null;
 timer=setTimeout(()=>poll(my),600);
 try{return await originalBtn.call(this,event)}
 finally{
  if(my!==generation){if(requestStop){ppReconcileStoppedUi(generation);ppScheduleStopReconciliation(generation)}return;}
  running=false;clearTimeout(timer);stop.classList.remove("pp-on");candidateAvailable=false;
  const candidate=liveModeButton("candidate");if(candidate){candidate.disabled=false;candidate.removeAttribute("aria-disabled");candidate.title=""}
  if(requestStop){
   window.__ppOptimizationInFlight=false;
   const finished=document.getElementById("valid");
   if(selectedPlan){
    restore(selectedPlan);
    if(finished)finished.textContent="GA: остановлено · план выбран";
   }else if(finished)finished.textContent="GA: остановлено · выбери вариант";
   setActionAfterStop();
   if(!modalShown)setTimeout(showModal,30);
  }
  // Completed normally or failed: running has just become false. The restart
  // control must update independently from historical progress/inFlight flags.
  window.dispatchEvent(new Event("pp:optimizer-finished"));
 }
};
stop.onclick=async function(){
 if(!running||requestStop)return;
 stop.disabled=true;stop.textContent="Останавливаю...";
 try{
  let response=null,data=null;
  try{
   response=await fetch("/api/optimizer-stop",{
    method:"POST",cache:"no-store",credentials:"same-origin"
   });
   data=await response.json();
  }catch(e){console.warn("PP_STOP_RESPONSE_UNAVAILABLE",String(e).slice(0,80))}
  if(!response?.ok||!data?.ok){
   const confirmed=await ppConfirmStoppedAfterAmbiguousResponse();
   if(confirmed)data=confirmed;
   else{
    stop.disabled=false;stop.textContent="Остановить оптимизацию";
    const s=document.getElementById("valid");
    if(s)s.textContent="GA: остановка не подтверждена · повтори Stop";
    console.warn("PP_STOP_NOT_READY",data?.error||response?.status||"network");
    return;
   }
  }
  for(const variant of data.variants||[])record(variant.plan);
  record(data.best_preview);
  requestStop=true;
  stoppedPlanAvailable=items.some(x=>valid(x.plan))||valid(prevPlan);
  window.__ppStopUiLocked=true;
  // The stop API has confirmed the server-side run is complete. Release the
  // client-side running guard immediately, without waiting for the cancelled
  // /api/plan request's delayed promise/finalizers. Invalidate stale polls.
  generation++;
  running=false;candidateAvailable=false;
  const candidate=liveModeButton("candidate");if(candidate){candidate.disabled=false;candidate.removeAttribute("aria-disabled");candidate.title=""}
  clearTimeout(timer);
  try{window.__ppCurrentOptimizationAbort?.abort("stopped_by_user")}catch(e){}
  window.__ppOptimizationInFlight=false;
  btn.disabled=false;
  stop.classList.remove("pp-on");
  stop.textContent="Остановить оптимизацию";
  setActionAfterStop();
  // The fresh-start control also depends on stop state (not only the disabled
  // attribute of the primary button). Make that transition explicit.
  window.dispatchEvent(new Event("pp:optimizer-stopped"));
  const status=document.getElementById("valid");if(status)status.textContent="GA: остановлено · выбери вариант";
  ppScheduleStopReconciliation(generation);
  setTimeout(showModal,40);
 }catch(e){
  console.error("PP_STOP_REQUEST_ERROR",e);
  stop.disabled=false;stop.textContent="Остановить оптимизацию";
 }
};
const ppFetchOriginal=window.fetch.bind(window);
window.fetch=function(input,init){
 const url=typeof input==="string"?input:input?.url||"";
 if(window.__ppStopUiLocked&&url.includes("/api/plan-progress")){
  return Promise.resolve(new Response(JSON.stringify({ok:true,running:false,success:false,stopped:true,percent:0}),{status:200,headers:{"content-type":"application/json"}}));
 }
 if(url.includes("/api/plan")&&!url.includes("/api/plan-progress")&&!(init?.signal)){
  const controller=new AbortController();window.__ppCurrentOptimizationAbort=controller;
  return ppFetchOriginal(input,{...(init||{}),signal:controller.signal}).finally(()=>{if(window.__ppCurrentOptimizationAbort===controller)window.__ppCurrentOptimizationAbort=null});
 }
 return ppFetchOriginal(input,init);
};
window.__PP_STOP_DEBUG__=()=>({running,reconnecting,recoveredSession,remotePercent,remotePhase,remoteFailureCount,stopped:requestStop,variants:items.length,criterion,stoppedPlanAvailable,buttonText:btn.textContent});
setTimeout(ppRecoverRunningGaFromAccount,80);
})();