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
let generation=0,running=false,requestStop=false,prevPlan=null,items=[],timer=null,criterion="duration",originalBtn=btn.onclick,selectedPlan=null,modalShown=false,stoppedPlanAvailable=false;
const keys={duration:"duration_minutes",wait:"operator_wait_minutes",idle:"machine_idle_minutes",cycles:"batch_count"};
const label={duration:"Общее время",wait:"Ожидание оператора",idle:"Простой оборудования",cycles:"Число циклов"};
function key(){return keys[criterion]||keys.duration}
function valid(p){return !!(p&&p.valid!==false&&!p.partial&&Array.isArray(p.operations)&&p.operations.length&&Number.isFinite(Number(p[key()]))&&Number(p[key()])>=0)}
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
 stop.disabled=items.length===0;stop.title="Корректных вариантов: "+items.length;
}
async function poll(my){
 if(!running||requestStop||my!==generation)return;
 try{
  const response=await fetch("/api/plan-progress?stop_snapshot="+Date.now(),{cache:"no-store"});
  const data=await response.json();
  if(my===generation&&running&&!requestStop&&data&&data.ok){record(data.candidate_preview);record(data.best_preview)}
 }catch(e){console.warn("PP_STOP_PROGRESS",String(e))}
 if(my===generation&&running&&!requestStop)timer=setTimeout(()=>poll(my),1750);
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
btn.onclick=async function(event){
 if(running || btn.disabled)return;
 const my=++generation;
 running=true;requestStop=false;items=[];stop.disabled=true;selectedPlan=null;modalShown=false;stoppedPlanAvailable=false;window.__ppStopUiLocked=false;
 stop.textContent="Остановить оптимизацию";stop.classList.add("pp-on");
 criterion=(typeof window.ppOptimizerObjective==="function"?window.ppOptimizerObjective():null)||(typeof model!=="undefined"&&model?.objective)||"duration";
 prevPlan=window.__ppOptimizerCommittedPlan||window.__ppTabPlan||null;
 timer=setTimeout(()=>poll(my),600);
 try{return await originalBtn.call(this,event)}
 finally{
  if(my!==generation)return;
  running=false;clearTimeout(timer);stop.classList.remove("pp-on");
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
 }
};
stop.onclick=async function(){
 if(!running||requestStop||!items.length)return;
 stop.disabled=true;stop.textContent="Останавливаю...";
 try{
  const response=await fetch("/api/optimizer-stop",{method:"POST",cache:"no-store"});
  const data=await response.json();
  if(!response.ok||!data?.ok){
   stop.disabled=false;stop.textContent="Остановить оптимизацию";
   const s=document.getElementById("valid");if(s)s.textContent="GA: остановка пока недоступна";
   console.warn("PP_STOP_NOT_READY",data?.error);return;
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
  running=false;
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
window.__PP_STOP_DEBUG__=()=>({running,stopped:requestStop,variants:items.length,criterion,stoppedPlanAvailable,buttonText:btn.textContent});
})();