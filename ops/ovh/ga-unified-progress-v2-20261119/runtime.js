(function ppUnifiedOptimizerProgressV2(){
"use strict";
if(window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__?.installed)return;
// Retire the three competing DOM writers before taking ownership of the
// already-existing authenticated native optimizer button. GA and Stop remain
// under the native application: this controller only displays progress.
try{window.__PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__?.stop?.()}catch(_){}
try{window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__?.dispose?.()}catch(_){}
try{window.__PP_GA_TERMINAL_100_V1__?.dispose?.()}catch(_){}
const percentRE=/\b(100|[1-9]?\d)\s*%/;
const style=document.createElement("style");
style.id="ppUnifiedOptimizerProgressV2Style";
style.textContent=
 "#opt.pp-opt-running .pp-opt-progress-line{position:relative;overflow:hidden;transition:width 140ms linear!important}"+
 "#opt.pp-opt-running .pp-opt-progress-line:after{content:'';position:absolute;inset:0;background:linear-gradient(100deg,transparent 0%,#ffffff66 45%,transparent 75%);animation:ppUnifiedGaSweep 1.65s linear infinite;pointer-events:none}"+
 "@keyframes ppUnifiedGaSweep{from{transform:translateX(-115%)}to{transform:translateX(115%)}}"+
 ".pp-ga-v2-status{display:inline-flex;align-items:center;gap:7px;margin-left:10px;font:600 12px/1.45 Inter,system-ui,Arial,sans-serif;color:#536680;white-space:nowrap;vertical-align:middle}"+
 ".pp-ga-v2-spin{width:12px;height:12px;border:2px solid #b9cce8;border-top-color:#3676d4;border-radius:50%;animation:ppUnifiedGaSpin .95s linear infinite;flex:none}"+
 "@keyframes ppUnifiedGaSpin{to{transform:rotate(360deg)}}"+
 "@media(prefers-reduced-motion:reduce){#opt.pp-opt-running .pp-opt-progress-line:after,.pp-ga-v2-spin{animation:none}}";
(document.head||document.documentElement).appendChild(style);
let button=null,observer=null,wasRunning=false,shown=null,confirmed=null;
let runToken=0,paintInProgress=false,prefix="",stepMs=250,lastStep=0,lastIncrease=0;
let lastNative=0,activity=null,terminal=null,terminalTicker=null,watch=null;
let serverUpdates=0,successfulFinishes=0,staleHints=0,completionChecks=0,disposed=false;
const now=()=>Date.now();
const running=()=>!!button?.classList.contains("pp-opt-running");
const clamp=(n,max=99)=>Math.min(max,Math.max(0,Math.trunc(Number(n)||0)));
const isRu=()=>/([А-Яа-яЁё])/.test(button?.textContent||"")||String(document.documentElement.lang||"").toLowerCase().startsWith("ru");
function textNode(){
 if(!button)return null;
 for(const item of button.childNodes){
  if(item.nodeType===3&&percentRE.test(item.nodeValue||""))return item;
  if(item.nodeType===1)for(const child of item.childNodes){
   if(child.nodeType===3&&percentRE.test(child.nodeValue||""))return child;
  }
 }
 return null;
}
function removeActivity(){if(activity){activity.remove();activity=null}}
function clearTerminal(){
 if(terminalTicker!==null){clearInterval(terminalTicker);terminalTicker=null}
 if(terminal){terminal.remove();terminal=null}
}
function begin(){
 runToken++;
 wasRunning=true;
 shown=null;confirmed=null;prefix="";stepMs=250;lastStep=0;lastNative=0;
 lastIncrease=now();
 removeActivity();clearTerminal();
 button?.setAttribute("aria-busy","true");
}
function end(){
 if(!wasRunning)return;
 wasRunning=false;button?.setAttribute("aria-busy","false");
 removeActivity();
 const token=++runToken;
 // The native UI often switches directly from 35-75% to "Continue".
 // Await a genuine terminal result; do not manufacture 100 on a stop/error.
 void verifyTerminal(token);
}
function paint(){
 if(disposed||!button?.isConnected||!running()||shown==null)return;
 const node=textNode();
 if(!node)return;
 const original=node.nodeValue||"";
 const updated=original.replace(percentRE,String(shown)+"%");
 if(updated!==original){
  observer?.disconnect();
  paintInProgress=true;
  try{node.nodeValue=updated}finally{paintInProgress=false;observe()}
 }
 const bar=button.querySelector(".pp-opt-progress-line");
 if(bar)bar.style.setProperty("width",String(shown)+"%","important");
 button.setAttribute("aria-valuemin","0");
 button.setAttribute("aria-valuemax","100");
 button.setAttribute("aria-valuenow",String(shown));
}
function capture(){
 if(disposed||paintInProgress||!button?.isConnected)return;
 const active=running();
 if(active&&!wasRunning)begin();
 if(!active&&wasRunning){end();return}
 if(!active)return;
 const node=textNode();
 if(!node)return;
 const text=node.nodeValue||"";
 const match=percentRE.exec(text);
 if(!match)return;
 const incoming=clamp(match[1]);
 const base=text.slice(0,match.index);
 if(base.trim())prefix=base;
 if(shown==null){
  // After a refresh, start at the already confirmed server value.
  shown=incoming;confirmed=incoming;lastNative=now();lastStep=now();
 }else if(incoming>confirmed){
  const at=now();
  const gap=lastNative?at-lastNative:2300;
  const distance=incoming-shown;
  const horizon=Math.max(3000,Math.min(9000,Math.round(gap*1.15)));
  stepMs=Math.max(120,Math.min(680,Math.round(horizon/Math.max(1,distance))));
  confirmed=incoming;lastNative=at;lastIncrease=at;
  serverUpdates++;removeActivity();
 }else if(incoming<shown){
  // It is an out-of-order/cached response; never regress a live run.
 }
 paint();
}
function observe(){
 if(!observer||!button)return;
 observer.observe(button,{attributes:true,attributeFilter:["class"],
  childList:true,characterData:true,subtree:true});
}
function attach(){
 if(disposed)return;
 const next=document.getElementById("opt");
 if(next===button)return;
 const oldRunning=wasRunning;
 observer?.disconnect();observer=null;button=next;
 if(!button)return;
 observer=new MutationObserver(()=>capture());
 observe();
 if(oldRunning&&!running())end();
 else if(running()&&!oldRunning)begin();
 capture();
}
function statusElement(kind){
 const el=document.createElement("span");
 el.className="pp-ga-v2-status";
 el.id=kind==="working"?"ppGaProgressBusyV2":"ppGaProgressFinalV2";
 el.setAttribute("role","status");
 if(button?.isConnected)button.insertAdjacentElement("afterend",el);
 return el;
}
function showActivity(){
 if(activity||!button?.isConnected||!running())return;
 activity=statusElement("working");
 activity.setAttribute("aria-live","off");
 const spinner=document.createElement("span");
 spinner.className="pp-ga-v2-spin";
 const label=document.createElement("span");
 label.textContent=isRu()?"Выполняется расчёт…":"Still calculating…";
 activity.append(spinner,label);
 staleHints++;
}
function finishAnimated(){
 if(terminalTicker!==null){clearInterval(terminalTicker);terminalTicker=null}
 if(terminal){terminal.remove();terminal=null}
 terminal=statusElement("complete");
 terminal.setAttribute("aria-live","off");
 const label=document.createElement("span");
 terminal.append(label);
 const ru=isRu();
 const start=clamp(shown==null?0:shown);
 let displayed=start;
 const distance=100-start;
 const perStep=Math.max(24,Math.min(115,Math.round(2400/Math.max(1,distance))));
 label.textContent=(ru?"Завершение · ":"Finishing · ")+displayed+"%";
 terminalTicker=setInterval(()=>{
  if(disposed||running()||!terminal?.isConnected){
   clearTerminal();return;
  }
  displayed=Math.min(100,displayed+1);
  if(displayed===100){
   clearInterval(terminalTicker);terminalTicker=null;
   label.textContent=ru?"Завершено · 100%":"Completed · 100%";
   terminal.setAttribute("aria-live","polite");
   successfulFinishes++;
  }else{
   label.textContent=(ru?"Завершение · ":"Finishing · ")+displayed+"%";
  }
 },perStep);
}
async function verifyTerminal(token){
 if(disposed||token!==runToken||running())return;
 try{
  completionChecks++;
  const response=await fetch("/api/plan-progress",{method:"GET",credentials:"same-origin",
   cache:"no-store",signal:AbortSignal.timeout(16000)});
  if(!response.ok)return;
  const data=await response.json();
  if(disposed||token!==runToken||running()||!button?.isConnected)return;
  if(data?.phase!=="completed"||data.running!==false||data.success!==true||
    Number(data.percent)!==100||data.result?.valid===false||
    !Array.isArray(data.result?.operations)||data.result.operations.length===0)return;
  finishAnimated();
 }catch(_){/* Network timeout or invalid JSON is not completion. */}
}
function tick(){
 if(disposed)return;
 attach();
 if(!button||!running())return;
 const time=now();
 if(shown!=null&&confirmed!=null&&shown<confirmed&&time-lastStep>=stepMs){
  shown+=1;lastStep=time;paint();
 }
 if(shown!=null&&shown>=confirmed&&time-lastIncrease>=5200)showActivity();
}
watch=setInterval(tick,80);
window.addEventListener("pp:optimizer-started",()=>{if(disposed)return;begin();queueMicrotask(()=>{attach();capture()})});
window.addEventListener("pp:optimizer-reconnect-pending",()=>{attach();capture()});
attach();
window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__={
 installed:true,mode:"verified-progress-with-activity",get state(){return{
  running:wasRunning,displayed:shown,confirmed,stepMs,serverUpdates,
  staleHints,completionChecks,successfulFinishes,
  busy:!!activity?.isConnected,final:terminal?.textContent||null
 }},
 refresh(){attach();capture()},
 dispose(){disposed=true;clearInterval(watch);observer?.disconnect();removeActivity();clearTerminal();style.remove()}
};
})();