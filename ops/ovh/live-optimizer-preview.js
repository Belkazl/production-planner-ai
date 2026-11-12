(function(){
"use strict";
// OVH fallback: live plans are ephemeral display data, never saved or accepted.
// The upstream live-panel controller is not present in the authenticated
// compatibility HTML, so it cannot update the restored Gantt on GA progress.
if(window.__PP_OVH_LIVE_PREVIEW_BRIDGE__)return;
const opt=document.getElementById("opt");
const planView=document.getElementById("planView");
if(!opt||!planView)return;
let active=false,inflight=false,seq=0,timer=null,mode="best",best=null,candidate=null;
let lastPaint="",shown=0,polls=0,failures=0,lastPercent=0,base=null,timeLimitReached=false;
const valid=p=>{
 if(!p||p.valid===false||p.partial||!Array.isArray(p.operations)||!p.operations.length)return false;
 if(!Number.isFinite(Number(p.duration_minutes)))return false;
 try{
  if(typeof model!=="undefined"&&Array.isArray(model?.orders)&&model.orders.length){
   const owned=new Set(model.orders.map(o=>String(o.id)));
   if(p.operations.some(o=>o&&!o.is_setup&&o.order!=null&&!owned.has(String(o.order))))return false;
  }
 }catch{return false}
 return true;
};
function fingerprint(p){
 // Include the complete timeline, not just score; candidate variants can have
 // the same duration but different equipment placement.
 let n=2166136261;
 const push=s=>{s=String(s);for(let i=0;i<s.length;i++){n^=s.charCodeAt(i);n=Math.imul(n,16777619)}};
 push(p.duration_minutes);push(p.operations.length);
 for(const o of p.operations){push(o.order||"");push(o.start_min||0);push(o.end_min||0);
  for(const e of o.equipment_ids||[])push(e)}
 return String(n>>>0);
}
function note(){
 let el=document.getElementById("ppOptimizerCandidateStatus");
 if(el)return el;
 el=document.createElement("div");el.id="ppOptimizerCandidateStatus";el.setAttribute("role","status");
 el.style.cssText="display:none;padding:8px 12px;margin:8px 0;border:1px solid #b7cee9;border-radius:9px;background:#f1f7ff;color:#24436c;font:600 12px/1.5 system-ui,sans-serif";
 const toolbar=planView.querySelector(".toolbar")||planView.firstElementChild;
 if(toolbar)toolbar.insertAdjacentElement("afterend",el);
 return el;
}
function hidden(){const el=document.getElementById("ppOptimizerCandidateStatus");if(el)el.style.display="none"}
function updateButtons(){
 const selected=mode==="candidate"&&valid(candidate)?"candidate":"best";
 for(const b of planView.querySelectorAll('[data-mode]')){
  if(b.dataset.mode==="candidate"){
   b.disabled=active&&!valid(candidate);
   b.setAttribute("aria-disabled",String(b.disabled));
   b.title=active&&!valid(candidate)?"GA пока не передал тестируемый вариант":"";
  }
  if(active&&(b.dataset.mode==="best"||b.dataset.mode==="candidate"))
   b.classList.toggle("a",b.dataset.mode===selected);
 }
}
function pick(){
 return mode==="candidate"&&valid(candidate)?candidate:best;
}
function display(){
 if(!active||window.__ppStopUiLocked)return;
 const p=pick();if(!valid(p))return;
 const hash=mode+":"+fingerprint(p);
 if(hash===lastPaint)return;
 if(typeof renderPlan!=="function")return;
 // Preserve the accepted incumbent, which belongs to the native optimizer and
 // saved plans. A preview is not an editable/committed plan.
 const committed=window.__ppOptimizerCommittedPlan;
 const tab=window.__ppTabPlan,generic=window.__ppGenericPlan;
 let previous=null,hasPrevious=false;
 try{
  if(typeof previousKpiMetrics!=="undefined"){
   hasPrevious=true;previous=previousKpiMetrics&&typeof previousKpiMetrics==="object"?{...previousKpiMetrics}:previousKpiMetrics;
  }
 }catch(_){}
 try{
  renderPlan(p);
  if(typeof renderKpisWithDelta==="function")renderKpisWithDelta(p);
  const el=note();
  el.textContent=(mode==="candidate"&&valid(candidate)?"Тестируемый вариант":"Лучший найденный")
   +": "+Math.round(Number(p.duration_minutes))+" мин · временный просмотр, не сохранён";
  el.style.display="block";
  lastPaint=hash;shown++;
 }catch(e){console.warn("PP_LIVE_PREVIEW_RENDER",String(e).slice(0,100))}
 finally{
  window.__ppOptimizerCommittedPlan=committed;
  window.__ppTabPlan=tab;window.__ppGenericPlan=generic;
  try{if(hasPrevious)previousKpiMetrics=previous}catch(_){}
 }
}
function acceptProgress(data){
 if(!data?.ok)return;
 if(data.running===true){
  if(!active)start(false);
  const percent=Number(data.percent);
  if(Number.isFinite(percent))lastPercent=Math.max(0,Math.min(99,percent));
  if(valid(data.best_preview))best=data.best_preview;
  if(valid(data.candidate_preview))candidate=data.candidate_preview;
  // Avoid painting a stale plan after a stop, but keep accepted plan intact.
  updateButtons();display();
 }
}
async function tick(my){
 if(!active||inflight||my!==seq||window.__ppStopUiLocked)return;
 inflight=true;polls++;
 try{
  const response=await fetch("/api/plan-progress",{method:"GET",credentials:"same-origin",cache:"no-store",
   headers:{accept:"application/json"}});
  if(response.ok){
   const data=await response.json();
   if(my===seq){
    if(data?.running===false&&["completed","failed","cancelled","interrupted","timed_out","stale"].includes(String(data.phase||""))){
     finish(data);return;
    }
    acceptProgress(data);
   }
  }else failures++;
 }catch(e){failures++}
 finally{inflight=false;if(active&&my===seq)schedule(my)}
}
function schedule(my){clearTimeout(timer);timer=setTimeout(()=>tick(my),2000)}
function start(scheduleFirst=true){
 if(active)return;
 active=true;seq++;mode="best";best=null;candidate=null;lastPaint="";lastPercent=0;base=window.__ppOptimizerCommittedPlan||null;timeLimitReached=false;hidden();
 updateButtons();
 if(scheduleFirst)schedule(seq);
}
function finish(data){
 if(data?.result?.optimization_time_limit_reached)timeLimitReached=true;
 if(!active&&!timeLimitReached)return;
 active=false;seq++;clearTimeout(timer);timer=null;inflight=false;
 updateButtons();
 if(timeLimitReached){
  const el=note();
  el.textContent="GA time limit reached. The best independently validated plan was preserved; you can continue optimizing.";
  el.style.display="block";
 }else hidden();
 best=null;candidate=null;lastPaint="";
 // The original optimizer owns the final accepted result and any unsaved
 // choice after Stop. Do not restore an outdated baseline here.
}
planView.addEventListener("click",event=>{
 const el=event.target?.closest?.('[data-mode]');
 if(!el||!planView.contains(el))return;
 mode=el.dataset.mode||"best";lastPaint="";
 queueMicrotask(()=>{updateButtons();display()});
},true);
window.addEventListener("pp:optimizer-started",()=>start());
window.addEventListener("pp:ga-async-started",()=>start());
window.addEventListener("pp:optimizer-finished",finish);
window.addEventListener("pp:optimizer-stopped",finish);
window.addEventListener("pagehide",finish);
// On reload, rejoin a running job without starting or mutating it.
setTimeout(async()=>{
 if(active||window.__ppStopUiLocked)return;
 try{
  const r=await fetch("/api/plan-progress",{method:"GET",credentials:"same-origin",cache:"no-store",
   headers:{accept:"application/json"}});
  if(r.ok){const data=await r.json();if(data?.running===true){start(false);acceptProgress(data);schedule(seq)}}
 }catch(_){}
},350);
window.__PP_OVH_LIVE_PREVIEW_BRIDGE__={
 getState:()=>({installed:true,active,mode,shown,polls,failures,lastPercent,hasBest:valid(best),
   hasCandidate:valid(candidate),acceptedUnchanged:window.__ppOptimizerCommittedPlan===base,
   lastPaint,timeLimitReached,intervalMs:2000})
};
})();
