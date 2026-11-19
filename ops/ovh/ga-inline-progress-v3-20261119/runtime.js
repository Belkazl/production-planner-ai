(function ppInlineOptimizerProgressV3(){
"use strict";
if(window.__PP_INLINE_GA_PROGRESS_V3__?.installed)return;
try{window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__?.dispose?.()}catch(_){}
try{window.__PP_GA_TERMINAL_100_V1__?.dispose?.()}catch(_){}
for(const id of ["ppGaProgressBusyV2","ppGaProgressFinalV2","ppGaTerminal100V1"])document.getElementById(id)?.remove();
const css=document.createElement("style");
css.id="ppInlineGaProgressV3Css";
css.textContent=
 "#opt.pp-ga-v3-active .pp-opt-progress-line{position:relative;overflow:hidden;transition:width 150ms linear!important}"+
 "#opt.pp-ga-v3-active .pp-opt-progress-line:after{content:'';position:absolute;inset:0;pointer-events:none;background:linear-gradient(100deg,transparent 5%,#ffffff77 50%,transparent 95%);transform:translateX(-120%);animation:ppGaV3Flow 1.7s linear infinite}"+
 "@keyframes ppGaV3Flow{to{transform:translateX(120%)}}"+
 "#opt.pp-ga-v3-final{position:relative!important;isolation:isolate}"+
 "#opt.pp-ga-v3-final:after{content:attr(data-pp-ga-v3-text);position:absolute;inset:0;z-index:20;pointer-events:none;display:flex;align-items:center;justify-content:center;border-radius:inherit;background:#2463e7;color:#fff;font:inherit;white-space:nowrap}"+
 "@media(prefers-reduced-motion:reduce){#opt.pp-ga-v3-active .pp-opt-progress-line:after{animation:none}}";
(document.head||document.documentElement).appendChild(css);
const percentRE=/\b(?:100|[1-9]?\d)\s*%/;
let button=null,observer=null,interval=null,active=false,shown=null,confirmed=null,lastNative=0,lastStep=0,stepMs=150,prefix="";
let token=0,finisher=null,finishHold=null,finishing=false,restoredDisabled=null,disposed=false;
let serverUpdates=0,finishedCount=0,last100Shown=false,highestShown=0,busyTicks=0,completionChecks=0;
const running=()=>!!button?.classList.contains("pp-opt-running");
const clamp=n=>Math.min(99,Math.max(0,Math.trunc(Number(n)||0)));
const isRu=()=>/[А-Яа-яЁё]/.test(prefix)||String(document.documentElement.lang||"").toLowerCase().startsWith("ru");
function node(){
 if(!button)return null;
 for(const n of button.childNodes){
  if(n.nodeType===3&&percentRE.test(n.nodeValue||""))return n;
  if(n.nodeType===1)for(const c of n.childNodes){
   if(c.nodeType===3&&percentRE.test(c.nodeValue||""))return c;
  }
 }
 return null;
}
function observe(){
 observer?.observe(button,{attributes:true,attributeFilter:["class"],characterData:true,childList:true,subtree:true});
}
function paint(){
 if(!active||!running()||shown==null||!button?.isConnected)return;
 const text=node();
 if(!text)return;
 const targetText=(text.nodeValue||"").replace(percentRE,shown+"%");
 if(targetText!==text.nodeValue){
  observer?.disconnect();
  try{text.nodeValue=targetText}finally{observe()}
 }
 const bar=button.querySelector(".pp-opt-progress-line");
 if(bar)bar.style.setProperty("width",shown+"%","important");
 button.setAttribute("aria-valuemin","0");
 button.setAttribute("aria-valuemax","100");
 button.setAttribute("aria-valuenow",String(shown));
 highestShown=Math.max(highestShown,shown);
}
function clearFinisher(){
 if(finisher!==null){clearInterval(finisher);finisher=null}
 if(finishHold!==null){clearTimeout(finishHold);finishHold=null}
 if(button){
  button.classList.remove("pp-ga-v3-final");
  button.removeAttribute("data-pp-ga-v3-text");
  if(restoredDisabled!==null){
   button.disabled=restoredDisabled;
   restoredDisabled=null;
  }
 }
 finishing=false;
}
function start(){
 token++;
 clearFinisher();
 active=true;shown=null;confirmed=null;lastNative=0;lastStep=Date.now();stepMs=150;prefix="";
 last100Shown=false;highestShown=0;
 button?.classList.add("pp-ga-v3-active");
 button?.setAttribute("aria-busy","true");
}
function paintFinish(pct){
 if(!button||!finishing)return;
 const localPrefix=prefix|| (isRu()?"Оптимизация ":"Optimization ");
 button.setAttribute("data-pp-ga-v3-text",localPrefix+pct+"%");
 highestShown=Math.max(highestShown,pct);
 if(pct===100)last100Shown=true;
}
function animateFinal(){
 if(!button?.isConnected||running()||disposed)return;
 clearFinisher();
 finishing=true;
 // The real server is already at 100%. Animate only *confirmed* remaining work.
 // Keep all intermediate numbers INSIDE the existing native button.
 restoredDisabled=button.disabled;
 button.disabled=true;
 button.classList.add("pp-ga-v3-final");
 let current=clamp(shown==null?0:shown);
 paintFinish(current);
 const delay=Math.max(25,Math.min(100,Math.round(2200/Math.max(1,100-current))));
 finisher=setInterval(()=>{
  if(disposed||running()||!button?.isConnected){clearFinisher();return}
  current=Math.min(100,current+1);
  paintFinish(current);
  if(current===100){
   clearInterval(finisher);finisher=null;
   finishedCount++;
   finishHold=setTimeout(()=>{finishHold=null;clearFinisher()},850);
  }
 },delay);
}
async function verifyCompleted(id){
 if(disposed||running()||id!==token)return;
 try{
  completionChecks++;
  const res=await fetch("/api/plan-progress",{method:"GET",credentials:"same-origin",cache:"no-store",signal:AbortSignal.timeout(16000)});
  if(!res.ok)return;
  const info=await res.json();
  if(id!==token||disposed||running()||!button?.isConnected)return;
  if(info?.phase!=="completed"||info.running!==false||info.success!==true||
    Number(info.percent)!==100||info.result?.valid===false||
    !Array.isArray(info.result?.operations)||!info.result.operations.length)return;
  animateFinal();
 }catch(_){/* Never report 100% on missing backend confirmation. */}
}
function finish(){
 if(!active)return;
 active=false;
 button?.classList.remove("pp-ga-v3-active");
 button?.removeAttribute("aria-busy");
 const id=++token;
 void verifyCompleted(id);
}
function capture(){
 if(disposed||!button?.isConnected)return;
 const nowRunning=running();
 if(nowRunning&&!active){start()}
 else if(!nowRunning&&active){finish();return}
 if(!nowRunning)return;
 const text=node();if(!text)return;
 const original=text.nodeValue||"";
 const match=percentRE.exec(original);
 if(!match)return;
 const incoming=clamp(Number.parseInt(match[0],10));
 const newPrefix=original.slice(0,match.index);
 if(newPrefix.trim())prefix=newPrefix;
 if(shown==null){
  shown=incoming;confirmed=incoming;lastNative=Date.now();lastStep=Date.now();
 }else if(incoming>confirmed){
  const stamp=Date.now();
  const elapsed=Math.max(800,lastNative?stamp-lastNative:2000);
  // Spread each authenticated server increment over the typical update period.
  const distance=Math.max(1,incoming-shown);
  const horizon=Math.min(16000,Math.max(2500,Math.round(elapsed*1.8)));
  stepMs=Math.min(720,Math.max(95,Math.round(horizon/distance)));
  confirmed=incoming;lastNative=stamp;serverUpdates++;
 }
 paint();
}
function attach(){
 if(disposed)return;
 const next=document.getElementById("opt");
 if(next===button)return;
 observer?.disconnect();observer=null;
 if(button&&button!==next)clearFinisher();
 button=next;
 if(!button)return;
 observer=new MutationObserver(capture);
 observe();
 if(running()&&!active)start();
 else if(!running()&&active)finish();
 capture();
}
interval=setInterval(()=>{
 if(disposed)return;
 attach();
 if(!active||!running()||shown==null)return;
 const t=Date.now();
 if(shown<confirmed&&t-lastStep>=stepMs){
  shown++;lastStep=t;paint();
 }else if(shown>=confirmed){busyTicks++}
},80);
window.addEventListener("pp:optimizer-started",()=>{
 if(disposed)return;
 if(active)start();
 queueMicrotask(()=>{attach();capture()});
});
window.addEventListener("pp:optimizer-reconnect-pending",()=>{attach();capture()});
attach();
window.__PP_INLINE_GA_PROGRESS_V3__={
 installed:true,get state(){return{
  active,shown,confirmed,serverUpdates,stepMs,highestShown,busyTicks,
  finishedCount,last100Shown,finishing,completionChecks
 }},
 refresh(){attach();capture()},
 dispose(){
  disposed=true;clearInterval(interval);observer?.disconnect();clearFinisher();button?.classList.remove("pp-ga-v3-active");css.remove()
 }
};
})();