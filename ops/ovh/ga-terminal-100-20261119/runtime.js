(function ppGaTerminalHundredV1(){
"use strict";
if(window.__PP_GA_TERMINAL_100_V1__?.installed)return;
const id="ppGaTerminal100V1";
let button=null,observer=null,wasRunning=false,version=0,checks=0,confirmed=0,disposed=false;
let notice=null;
function clear(){
 version++;
 if(notice?.isConnected)notice.remove();
 notice=null;
}
function running(){return !!button?.classList.contains("pp-opt-running")}
function statusNode(){
 if(!button?.isConnected)return null;
 let node=document.getElementById(id);
 if(!node){
  node=document.createElement("span");
  node.id=id;
  node.setAttribute("role","status");
  node.setAttribute("aria-live","polite");
  node.style.cssText="display:inline-flex;align-items:center;gap:4px;margin-left:10px;font:600 12px/1.5 Inter,system-ui,Arial,sans-serif;color:var(--text-muted,#496582);white-space:nowrap";
  button.insertAdjacentElement("afterend",node);
 }
 return node;
}
async function confirmComplete(token){
 if(!button?.isConnected||running()||token!==version)return;
 try{
  const debug=window.__PP_STOP_DEBUG__?.();
  if(debug?.stopped===true)return;
 }catch(_){}
 try{
  checks++;
  // Exactly one terminal verification request; never poll during an active GA.
  const response=await fetch("/api/plan-progress",{method:"GET",cache:"no-store",
   credentials:"same-origin",signal:AbortSignal.timeout(12000)});
  if(!response.ok)return;
  const data=await response.json();
  if(token!==version||running()||!button?.isConnected)return;
  const ok=data?.phase==="completed"&&data.running===false&&
   data.success===true&&Number(data.percent)===100&&
   data.result?.valid!==false&&Array.isArray(data.result?.operations)&&
   data.result.operations.length>0;
  if(!ok)return;
  const node=statusNode();if(!node)return;
  const ru=/[А-Яа-яЁё]/.test(button.textContent||"")||
   String(document.documentElement.lang||"").toLowerCase().startsWith("ru");
  node.textContent=ru?"Завершено · 100%":"Completed · 100%";
  notice=node;confirmed++;
 }catch(_){/* A failed status check is never reported as success. */}
}
function scan(){
 if(disposed)return;
 const active=running();
 if(active){
  if(!wasRunning){clear();wasRunning=true}
 }else if(wasRunning){
  wasRunning=false;
  const token=++version;
  queueMicrotask(()=>{void confirmComplete(token)});
 }
}
function attach(){
 if(disposed)return;
 const found=document.getElementById("opt");
 if(found===button)return;
 const previousRunning=wasRunning;
 observer?.disconnect();observer=null;
 button=found;wasRunning=running();
 if(!button)return;
 observer=new MutationObserver(scan);
 observer.observe(button,{attributes:true,attributeFilter:["class"],
  childList:true,characterData:true,subtree:true});
 if(previousRunning&&!wasRunning){
  const token=++version;
  queueMicrotask(()=>{void confirmComplete(token)});
 }
}
const watcher=setInterval(attach,500);
attach();
window.addEventListener("pp:optimizer-started",()=>{clear();wasRunning=true;attach()});
window.__PP_GA_TERMINAL_100_V1__={
 installed:true,get state(){return {running:wasRunning,checks,confirmed,shown:!!notice?.isConnected}},
 refresh(){attach();scan()},
 dispose(){disposed=true;clear();clearInterval(watcher);observer?.disconnect()}
};
})();
