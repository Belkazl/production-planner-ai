;(function ppSingleServerProgressV5(){
"use strict";
// This module is the sole writer of the visible percentage and progress line.
// The native optimizer still owns job creation, Stop, persistence and completion.
if(window.__PP_GA_PROGRESS_V5__?.installed)return;
const style=document.createElement("style");
style.id="ppSingleServerProgressV5Css";
style.textContent=[
 "#opt.pp-ga-v5-visible{position:relative!important;isolation:isolate!important;overflow:hidden!important;color:transparent!important}",
 "#opt.pp-ga-v5-visible .pp-opt-progress-line{display:none!important}",
 "#opt.pp-ga-v5-visible .pp-ga-v5-caption{position:absolute!important;inset:0!important;z-index:11!important;",
 "display:flex!important;align-items:center!important;justify-content:center!important;padding:0 7px!important;",
 "white-space:nowrap!important;pointer-events:none!important;color:white!important;",
 "font:600 11.5px/1.3 Inter,system-ui,Arial,sans-serif!important;letter-spacing:-.1px!important}",
 "#opt.pp-ga-v5-visible .pp-ga-v5-track{position:absolute!important;left:0!important;right:0!important;bottom:0!important;",
 "height:4px!important;background:rgba(255,255,255,.22)!important;z-index:12!important;pointer-events:none!important}",
 "#opt.pp-ga-v5-visible .pp-ga-v5-fill{display:block!important;height:100%!important;background:#fff!important;",
 "transition:width 110ms linear!important;pointer-events:none!important}",
 "#opt.pp-ga-v5-stale .pp-ga-v5-track:after{content:'';position:absolute;inset:0;width:28%;pointer-events:none;",
 "background:linear-gradient(90deg,transparent,rgba(255,255,255,.88),transparent);",
 "animation:ppGaV5LiveSignal 1.9s ease-in-out infinite}",
 "@keyframes ppGaV5LiveSignal{from{transform:translateX(-100%)}to{transform:translateX(470%)}}",
 "@media(prefers-reduced-motion:reduce){#opt.pp-ga-v5-stale .pp-ga-v5-track:after{animation:none}}"
].join("");
(document.head||document.documentElement).appendChild(style);
let btn=null,caption=null,track=null,fill=null,mode="idle";
let shown=0,confirmed=0,latestPercent=0,lastStep=0,lastStatusAt=0;
let jobId=null,firstStage="queued",stale=false,finalDone=false,finishing=false,has100=false;
let attempts=0,updates=0,firstStagePaints=0,serverStageEvents=0,finalCount=0,verifiedCount=0;
let disposed=false,verifying=false,verifyNext=0,version=0,lastClickedAt=0;
let lastLabel="",lastRunningNative=false,reconnected=false;
const clamp=n=>Math.min(99,Math.max(0,Math.floor(Number(n)||0)));
const now=()=>Date.now();
const langRu=()=>/^ru/i.test(document.documentElement.lang||"")||
 /[А-Яа-яЁё]/.test(btn?.textContent||"");
const nativeRunning=()=>!!btn?.classList.contains("pp-opt-running")&&
 !/continue|продолж/i.test(btn?.textContent||"");
const preparation={
 queued:["Подготовка оптимизации","Preparing optimization"],
 loading_runtime:["Подготовка расчёта","Preparing calculation"],
 validating_model:["Проверка модели","Validating model"],
 installing_model:["Подготовка ресурсов","Preparing resources"],
 building_first_plan:["Формирование первого плана","Building the first plan"],
 optimizing:["Поиск лучшего плана","Optimizing candidate plans"],
 finalizing:["Проверка результата","Finalizing schedule"]
};
function elements(){
 const next=document.getElementById("opt");
 if(next!==btn){btn=next;caption=track=fill=null}
 if(!btn)return;
 if(!caption?.isConnected||caption.parentElement!==btn){
  caption=document.createElement("span");
  caption.className="pp-ga-v5-caption";caption.setAttribute("aria-hidden","true");
  btn.appendChild(caption);
 }
 if(!track?.isConnected||track.parentElement!==btn){
  track=document.createElement("span");
  track.className="pp-ga-v5-track";track.setAttribute("aria-hidden","true");
  fill=document.createElement("span");
  fill.className="pp-ga-v5-fill";track.appendChild(fill);btn.appendChild(track);
 }
 if(!fill?.isConnected||fill.parentElement!==track){
  fill=document.createElement("span");fill.className="pp-ga-v5-fill";track.appendChild(fill);
 }
}
function clearVisual(){
 if(btn){
  btn.classList.remove("pp-ga-v5-visible","pp-ga-v5-stale");
  btn.removeAttribute("data-pp-ga-v5");
  btn.removeAttribute("aria-valuenow");
  btn.removeAttribute("aria-valuemin");
  btn.removeAttribute("aria-valuemax");
  btn.removeAttribute("aria-busy");
 }
 caption?.remove();track?.remove();caption=track=fill=null;lastLabel="";
}
function reset(){
 version++;mode="idle";shown=confirmed=latestPercent=0;jobId=null;
 lastStep=lastStatusAt=0;firstStage="queued";stale=false;
 finalDone=finishing=has100=false;verifying=false;verifyNext=0;lastRunningNative=false;
 clearVisual();
}
function begin(reconnect=false){
 version++;mode="running";shown=confirmed=0;latestPercent=0;jobId=null;reconnected=!!reconnect;
 lastStep=now();lastStatusAt=0;firstStage="queued";
 finalDone=finishing=has100=false;verifying=false;verifyNext=0;stale=false;
 lastLabel="";lastRunningNative=nativeRunning();
 elements();paint();
}
function paint(){
 if(!btn||mode==="idle")return;
 elements();
 btn.classList.add("pp-ga-v5-visible");
 stale=mode==="running"&&(!lastStatusAt||now()-lastStatusAt>6000);
 btn.classList.toggle("pp-ga-v5-stale",stale);
 const ru=langRu();
 let label="";
 if(mode==="completed"){
  label=ru?"Продолжить оптимизацию · 100%":"Continue optimization · 100%";
 }else if(mode==="completing"){
  label=(ru?"Оптимизация ":"Optimization ")+shown+"%";
 }else if(shown<=1){
  const p=preparation[firstStage]||preparation.queued;
  label=(ru?p[0]:p[1])+(shown>0?" · "+shown+"%":"");
  firstStagePaints++;
 }else label=(ru?"Оптимизация ":"Optimization ")+shown+"%";
 if(label!==lastLabel){
  caption.textContent=label;lastLabel=label;
  btn.setAttribute("data-pp-ga-v5",label);
 }
 fill.style.width=shown+"%";
 btn.setAttribute("aria-valuemin","0");
 btn.setAttribute("aria-valuemax","100");
 btn.setAttribute("aria-valuenow",String(shown));
 btn.setAttribute("aria-busy",mode==="completed"?"false":"true");
}
function incomingProgress(p){
 if(disposed||!p||p.running!==true)return;
 if(mode==="idle"||mode==="completed")begin(true);
 if(mode!=="running")return;
 const id=p.job_id?String(p.job_id):null;
 if(id&&jobId&&id!==jobId)begin(true);
 if(id)jobId=id;
 if(typeof p.stage==="string"&&p.stage!==firstStage){
  firstStage=p.stage;serverStageEvents++;
 }
 const raw=Number(p.percent);
 if(Number.isFinite(raw)){
  const value=clamp(raw);
  if(value>confirmed){
   confirmed=value;updates++;
  }
  if(reconnected&&lastStatusAt===0)shown=value;
  reconnected=false;
  latestPercent=value;
 }
 const age=Number(p.snapshot_age_ms);
 lastStatusAt=now()-(Number.isFinite(age)?Math.max(0,age):0);
 paint();
}
async function verify(token){
 if(disposed||token!==version||verifying||mode==="idle"||mode==="completed")return;
 verifying=true;attempts++;
 try{
  const result=await fetch("/api/plan-progress?ppNoCache=1",{
   method:"GET",cache:"no-store",credentials:"same-origin",
   headers:{"accept":"application/json"},signal:AbortSignal.timeout(18000)
  });
  if(!result.ok)throw Error("terminal_http_"+result.status);
  const p=await result.json();
  if(disposed||token!==version)return;
  if(p.phase==="completed"&&p.success===true&&p.running===false&&
     Number(p.percent)===100&&p.result?.valid!==false&&
     Array.isArray(p.result?.operations)&&p.result.operations.length){
    verifiedCount++;mode="completing";finishing=true;
    confirmed=100;lastStatusAt=now();verifyNext=0;paint();return;
  }
  if(["cancelled","canceled","stopped","failed","idle"].includes(p.phase)){
   reset();return;
  }
  if(p.running===true){
   mode="running";finishing=false;lastStatusAt=now();
  }
 }catch(_){
  // A temporary error cannot discard an ongoing progress line.
 }finally{
  verifying=false;
  if(token===version&&mode!=="completed"&&mode!=="idle")verifyNext=now()+1900;
 }
}
function incomingStatus(p){
 if(disposed||!p)return;
 if(p.running===true){incomingProgress(p);return}
 if(mode==="idle"||mode==="completed")return;
 if(p.phase==="completed"||p.phase==="finalizing"){
  finishing=true;
  if(now()>verifyNext&&!verifying)void verify(version);
  return;
 }
 if(["cancelled","canceled","stopped","failed"].includes(p.phase)){reset();return}
 // A stale/unknown phase does not erase a progress indicator.
}
function tick(){
 if(disposed)return;
 const next=document.getElementById("opt");
 if(!btn||next!==btn){btn=next;caption=track=fill=null}
 if(!btn)return;
 const natural=nativeRunning();
 if(mode==="idle"&&natural)begin(true);
 if(mode==="completed"){
  if(!/continue|продолж/i.test(btn.textContent||"")&&
     !nativeRunning()&&now()-lastClickedAt>600)return;
  if(nativeRunning()&&now()-lastClickedAt<20000)begin(true);
 }
 if(mode==="running"||mode==="completing"){
  if(mode==="running"&&!natural&&lastStatusAt>0&&now()>verifyNext&&!verifying)
   void verify(version);
  if(mode==="running"&&shown<confirmed&&now()-lastStep>=110){
   shown++;lastStep=now();
  }
  if(mode==="completing"&&shown<100&&now()-lastStep>=85){
   shown++;lastStep=now();
  }
  if(mode==="completing"&&shown===100){
   mode="completed";finishing=false;finalDone=true;has100=true;finalCount++;
  }
  paint();
 }
 lastRunningNative=natural;
}
function operationDialogGuard(){
 const style=document.createElement("style");style.id="ppInterimNoDetailsV1Css";
 style.textContent=[
  "#ppGanttToolV2.pp-ga-interim-preview .pg2-bar{pointer-events:none!important;",
  "cursor:default!important}",
  "#ppGanttToolV2.pp-ga-interim-preview .pg2-bar::after{display:none!important}"
 ].join("");
 (document.head||document.documentElement).appendChild(style);
 let suppressed=0;
 function interim(){
  if(mode!=="running"||!nativeRunning())return false;
  const stage=document.getElementById("ppGanttToolV2");
  if(!stage||window.__PP_UNIFIED_GANTT_V2__?.activeMode!==0)return false;
  const n=stage.querySelectorAll(".pg2-bar").length;
  // Do not suppress details of a full baseline plan or a completed Gantt.
  return n>0&&n<=140&&!!window.__PP_FOUR_SECOND_PREVIEW__?.state?.lastRenderedAt;
 }
 const timer=setInterval(()=>{
  document.getElementById("ppGanttToolV2")?.classList.toggle(
   "pp-ga-interim-preview",interim());
 },150);
 const cancel=e=>{
  if(!interim())return;
  const bar=e.target?.closest?.("#ppGanttToolV2 .pg2-bar");
  if(bar){suppressed++;e.preventDefault();e.stopImmediatePropagation()}
 };
 for(const name of ["pointerdown","click","dblclick","keydown"]){
  document.addEventListener(name,cancel,true);
 }
 return{get suppressed(){return suppressed},
   dispose(){
    clearInterval(timer);
    document.getElementById("ppGanttToolV2")?.classList.remove("pp-ga-interim-preview");
    for(const name of ["pointerdown","click","dblclick","keydown"])
     document.removeEventListener(name,cancel,true);
    style.remove();
   }};
}
const dialog=operationDialogGuard();
const progressTimer=setInterval(tick,100);
const events=[
 ["pp:optimizer-started",()=>begin(false)],
 ["pp:optimizer-reconnect-pending",()=>{if(mode==="idle")begin(true)}],
 ["pp:optimizer-stopped",()=>reset()],
 ["pp:optimizer-finished",()=>{if(mode!=="idle"&&mode!=="completed"&&!verifying)void verify(version)}],
 ["pp:ga-light-progress",e=>incomingProgress(e.detail)],
 ["pp:ga-light-status",e=>incomingStatus(e.detail)]
];
for(const [name,handler] of events)window.addEventListener(name,handler);
const click=e=>{
 if(e.target?.closest?.("#opt")&&mode==="completed"){
  lastClickedAt=now();reset();
 }
};
document.addEventListener("click",click,true);
window.__PP_GA_PROGRESS_V5__={
 installed:true,mode:"single-real-server-percent-with-independent-progress-line",
 get state(){return{
  running:mode==="running",shown,confirmed,latestPercent,stage:firstStage,
  phase:mode,stale,jobId,updates,firstStage:firstStage,
  firstStagePaints,serverStageEvents,finalDone,finishing,has100,
  finalCount,verifiedCount,attempts,visible:lastLabel,
  lineVisible:!!track?.isConnected&&btn?.classList.contains("pp-ga-v5-visible"),
  interimDialogBlocked:document.getElementById("ppGanttToolV2")?.classList.contains("pp-ga-interim-preview"),
  suppressedDialogs:dialog.suppressed
 }},
 refresh:tick,
 dispose(){
  disposed=true;clearInterval(progressTimer);dialog.dispose();
  for(const [name,handler] of events)window.removeEventListener(name,handler);
  document.removeEventListener("click",click,true);
  clearVisual();style.remove();
 }
};
// Compatibility READ ONLY state for existing diagnostic tools, not a second writer.
window.__PP_GA_PROGRESS_V4__={
 installed:true,mode:"readonly-compat-v5",
 get state(){return window.__PP_GA_PROGRESS_V5__?.state},
 refresh:tick
};
tick();
})();
