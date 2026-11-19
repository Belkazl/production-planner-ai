(function ppNativeOneOwnerProgressV4(){
"use strict";
if(window.__PP_GA_PROGRESS_V4__?.installed)return;
// Retire ALL prior progress decorators. Native app retains optimization,
// progress polling, Stop, account validation, and its original click handler.
for(const name of ["__PP_INLINE_GA_PROGRESS_V3__","__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__",
 "__PP_SMOOTH_VERIFIED_PROGRESS_V1__","__PP_GA_TERMINAL_100_V1__"]){
 try{window[name]?.dispose?.()}catch(_){}
}
try{window.__PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__?.stop?.()}catch(_){}
for(const id of ["ppGaProgressBusyV2","ppGaProgressFinalV2","ppGaTerminal100V1"]){
 document.getElementById(id)?.remove();
}
const css=document.createElement("style");
css.id="ppNativeOneOwnerProgressV4Css";
css.textContent=
 "#opt.pp-ga-v4-busy,#opt.pp-ga-v4-final{position:relative!important;isolation:isolate;overflow:hidden}"+
 "#opt.pp-ga-v4-busy:after,#opt.pp-ga-v4-final:after{content:attr(data-pp-ga-v4-label);position:absolute;inset:0;z-index:20;pointer-events:none;display:flex;align-items:center;justify-content:center;border-radius:inherit;background:#2869e8;color:white;font:600 11.5px/1.3 Inter,system-ui,Arial,sans-serif;white-space:nowrap;letter-spacing:-.1px}"+
 "#opt.pp-ga-v4-busy:after{background:linear-gradient(105deg,#2869e8,#5b96f3,#2869e8);background-size:220% 100%;animation:ppNativeGaV4Shimmer 1.7s linear infinite}"+
 "#opt.pp-opt-running .pp-opt-progress-line{transition:width 120ms linear!important}"+
 "@keyframes ppNativeGaV4Shimmer{from{background-position:100% 0}to{background-position:0 0}}"+
 "@media(prefers-reduced-motion:reduce){#opt.pp-ga-v4-busy:after{animation:none}}";
(document.head||document.documentElement).appendChild(css);
const regex=/\b(?:100|[1-9]?\d)\s*%/;
let button=null,observer=null,poller=null,wasRunning=false,shown=null,confirmed=null;
let lastNativeAt=0,lastStepAt=0,stepMs=125,prefix="",version=0;
let terminalTimer=null,retryTimer=null,finishing=false,finalDone=false,restoreDisabled=null;
let attempts=0,initialChecked=false,disposed=false,lastNativeLabel="";
let updates=0,busyCount=0,finalCount=0,verifiedCount=0,has100=false;
const active=()=>!!button?.classList.contains("pp-opt-running");
const clamp=n=>Math.min(99,Math.max(0,Math.floor(Number(n)||0)));
const isRu=()=>/[А-Яа-яЁё]/.test(prefix)||String(document.documentElement.lang||"").toLowerCase().startsWith("ru");
const isContinue=()=>/continue|продолж/i.test(String(button?.textContent||""));
function currentTextNode(){
 if(!button)return null;
 for(const n of button.childNodes){
  if(n.nodeType===3&&regex.test(n.nodeValue||""))return n;
  if(n.nodeType===1)for(const c of n.childNodes){
   if(c.nodeType===3&&regex.test(c.nodeValue||""))return c;
  }
 }
 return null;
}
function watchButton(){
 if(observer&&button)observer.observe(button,{childList:true,subtree:true,
  characterData:true,attributes:true,attributeFilter:["class"]});
}
function paintRunning(){
 if(!wasRunning||!active()||shown==null||!button?.isConnected)return;
 const node=currentTextNode();
 if(!node)return;
 const updated=(node.nodeValue||"").replace(regex,String(shown)+"%");
 if(updated!==node.nodeValue){
  observer?.disconnect();
  try{node.nodeValue=updated}finally{watchButton()}
 }
 const fill=button.querySelector(".pp-opt-progress-line");
 if(fill)fill.style.setProperty("width",shown+"%","important");
 button.setAttribute("aria-valuemin","0");
 button.setAttribute("aria-valuemax","100");
 button.setAttribute("aria-valuenow",String(shown));
}
function restoreButton(){
 if(!button)return;
 button.classList.remove("pp-ga-v4-final","pp-ga-v4-busy");
 button.removeAttribute("data-pp-ga-v4-label");
 if(restoreDisabled!==null){button.disabled=restoreDisabled;restoreDisabled=null}
}
function clearTimers(){
 if(terminalTimer!==null){clearInterval(terminalTimer);terminalTimer=null}
 if(retryTimer!==null){clearTimeout(retryTimer);retryTimer=null}
}
function reset(){
 version++;
 clearTimers();restoreButton();
 finishing=false;finalDone=false;wasRunning=false;
 shown=null;confirmed=null;lastNativeAt=0;lastStepAt=Date.now();stepMs=125;
 prefix="";attempts=0;initialChecked=false;has100=false;
}
function begin(){
 reset();wasRunning=true;lastNativeAt=Date.now();
 button?.setAttribute("aria-busy","true");
}
function handleNativeNumber(){
 const n=currentTextNode();if(!n)return;
 const source=n.nodeValue||"";
 const match=regex.exec(source);if(!match)return;
 const pct=clamp(Number.parseInt(match[0],10));
 const label=source.slice(0,match.index);
 if(label.trim())prefix=label;
 if(shown===null){
  shown=pct;confirmed=pct;lastNativeAt=Date.now();lastStepAt=Date.now();
 }else if(pct>confirmed){
  const stamp=Date.now();
  const elapsed=Math.max(500,stamp-lastNativeAt);
  const gap=Math.max(1,pct-shown);
  // Smooth 1-percent verified increments over a realistic short interval.
  stepMs=Math.min(700,Math.max(110,Math.round(Math.min(11500,elapsed*1.3)/gap)));
  confirmed=pct;lastNativeAt=stamp;updates++;
  button?.classList.remove("pp-ga-v4-busy");
  button?.removeAttribute("data-pp-ga-v4-label");
 }
 paintRunning();
}
function showBusyInsideButton(){
 if(!wasRunning||!active()||shown==null||!button?.isConnected)return;
 if(button.classList.contains("pp-ga-v4-busy"))return;
 button.classList.add("pp-ga-v4-busy");
 button.setAttribute("data-pp-ga-v4-label",
  (prefix.trim()|| (isRu()?"Оптимизация":"Optimization"))+" "+shown+"%");
 busyCount++;
}
function finishOverlay(number){
 if(!button?.isConnected)return;
 let text="";
 if(number===100){
  const native=String(button.textContent||"").trim();
  if(/continue|продолж/i.test(native))text=native+" · 100%";
  else text=isRu()?"Готово · 100%":"Complete · 100%";
  has100=true;
 }else text=(prefix.trim()||(isRu()?"Оптимизация":"Optimization"))+" "+number+"%";
 button.classList.add("pp-ga-v4-final");
 button.classList.remove("pp-ga-v4-busy");
 button.setAttribute("data-pp-ga-v4-label",text);
 button.setAttribute("aria-valuenow",String(number));
}
function completed(instant){
 if(disposed||active()||!button?.isConnected)return;
 clearTimers();restoreButton();
 finishing=true;finalDone=false;verifiedCount++;
 restoreDisabled=button.disabled;
 if(!instant)button.disabled=true;
 let n=instant?100:clamp(shown==null?0:shown);
 finishOverlay(n);
 if(instant||n===100){showDone();return}
 const ms=Math.min(145,Math.max(60,Math.round(6500/Math.max(1,100-n))));
 const begun=Date.now(),beginN=n;
 terminalTimer=setInterval(()=>{
  if(disposed||!button?.isConnected||active()){clearTimers();restoreButton();finishing=false;return}
  const elapsed=Math.max(0,Date.now()-begun);
  // Exact one-point increments in foreground; hidden tabs catch up on return.
  const expected=Math.min(100,beginN+Math.floor(elapsed/ms));
  n=Math.max(n,expected);
  finishOverlay(n);
  if(n===100){clearInterval(terminalTimer);terminalTimer=null;showDone()}
 },Math.min(ms,80));
}
function showDone(){
 if(!button)return;
 finishing=false;finalDone=true;
 finishOverlay(100);
 if(restoreDisabled!==null){button.disabled=restoreDisabled;restoreDisabled=null}
 finalCount++;
 // 100% is persistent in the SAME clickable Continue button. It is not
 // removed after 850ms: only a new run, Stop, reset or user click clears it.
}
async function verify(token,instant=false){
 if(disposed||token!==version||active()||!button?.isConnected)return;
 attempts++;lastNativeLabel=button.textContent||"";
 try{
  const r=await fetch("/api/plan-progress",{method:"GET",cache:"no-store",
   credentials:"same-origin",signal:AbortSignal.timeout(14000)});
  if(!r.ok)throw Error("GA_HTTP_"+r.status);
  const p=await r.json();
  if(disposed||token!==version||active()||!button?.isConnected)return;
  if(p.phase==="completed"&&p.running===false&&p.success===true&&
    Number(p.percent)===100&&p.result?.valid!==false&&
    Array.isArray(p.result?.operations)&&p.result.operations.length){
    completed(instant);return;
  }
  // Stop, failure or invalid result: never show completed 100.
  if(button.classList.contains("pp-ga-v4-final")&&!finalDone)restoreButton();
 }catch(_){
  if(disposed||token!==version||active())return;
  if(attempts<3){
   retryTimer=setTimeout(()=>{retryTimer=null;void verify(token,instant)},1250*attempts);
  }else if(!finalDone){restoreButton()}
 }
}
function end(){
 if(!wasRunning)return;
 wasRunning=false;
 button?.removeAttribute("aria-busy");
 const id=++version;
 // Native app may replace its label with Continue before the last
 // worker result is durable. Confirm first; then visibly finish to 100.
 void verify(id,false);
}
function capture(){
 if(disposed||!button?.isConnected)return;
 if(active()){
  if(!wasRunning)begin();
  handleNativeNumber();
 }else if(wasRunning){end()}
 else if(finishing||finalDone){
  // A separate reset may remove the saved result without starting a run.
  if(!isContinue()&&!finishing)reset();
 }else if(!initialChecked&&isContinue()){
  // Also show durable 100 on a fresh page or after a reconnect.
  initialChecked=true;
  const id=++version;
  void verify(id,true);
 }
}
function attach(){
 if(disposed)return;
 const candidate=document.getElementById("opt");
 if(button===candidate)return;
 observer?.disconnect();observer=null;
 reset();
 button=candidate;
 if(!button)return;
 button.addEventListener("click",()=>{
  if(finalDone){reset();} // Keep the ORIGINAL onclick and Continue action.
 },true);
 observer=new MutationObserver(capture);
 watchButton();
 capture();
}
poller=setInterval(()=>{
 if(disposed)return;
 attach();
 if(!button||!active()||!wasRunning||shown==null)return;
 const t=Date.now();
 if(shown<confirmed&&t-lastStepAt>=stepMs){
  shown++;lastStepAt=t;paintRunning();
 }else if(shown>=confirmed&&t-lastNativeAt>=4000){
  showBusyInsideButton();
 }
},65);
window.addEventListener("pp:optimizer-started",()=>{if(disposed)return;reset();queueMicrotask(()=>{attach();capture()})});
window.addEventListener("pp:optimizer-reconnect-pending",()=>{if(disposed)return;attach();capture()});
attach();
window.__PP_GA_PROGRESS_V4__={
 installed:true,mode:"one-button-real-terminal-persistent",
 get state(){return{running:wasRunning,shown,confirmed,updates,busyCount,
  finishing,finalDone,finalCount,has100,verifiedCount,attempts,
  visible:button?.getAttribute("data-pp-ga-v4-label")||null}},
 refresh(){attach();capture()},
 dispose(){disposed=true;clearTimers();clearInterval(poller);observer?.disconnect();restoreButton();css.remove()}
};
})();