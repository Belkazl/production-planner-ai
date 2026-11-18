(function ppTruthfulSmoothGaPercentV1(){
"use strict";
if(window.__PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__?.installed)return;
let element=null,observer=null,interval=null,shown=null,target=null,hasRun=false,updates=0;
const clamp=n=>Math.max(0,Math.min(99,Math.floor(n)));
const intervalMs=85;
const progressText=el=>{
 const raw=(el?.textContent||"").trim();
 const match=raw.match(/^(.*?)(\d{1,3})\s*%\s*$/);
 if(!match||!el.classList.contains("pp-opt-running"))return null;
 const value=Number(match[2]);
 if(!Number.isFinite(value)||value<0||value>100)return null;
 return {prefix:match[1],percent:clamp(value)};
};
let prefix="";
const observe=()=>observer?.observe(element,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["class"]});
function paint(){
 if(!element||!element.isConnected||!element.classList.contains("pp-opt-running"))return;
 if(shown==null)return;
 if(!observer)return;
 observer.disconnect();
 try{
  const text=prefix+shown+"%";
  if(element.textContent.trim()!==text.trim()||!element.querySelector(".pp-opt-progress-line")){
   element.textContent=text;
   const bar=document.createElement("span");
   bar.className="pp-opt-progress-line";
   bar.style.width=shown+"%";
   bar.style.transition="width 85ms linear";
   element.appendChild(bar);
  }else{
   const bar=element.querySelector(".pp-opt-progress-line");
   if(bar)bar.style.width=shown+"%";
  }
 }finally{observe()}
}
function reset(){
 shown=null;target=null;hasRun=false;prefix="";
}
function readNative(){
 if(!element)return;
 if(!element.isConnected)return;
 const result=progressText(element);
 if(!result){
  if(hasRun&&!element.classList.contains("pp-opt-running"))reset();
  return;
 }
 // The native button receives a percentage that was confirmed by the server.
 // Our counter never estimates beyond this number.
 const incoming=result.percent;
 prefix=result.prefix;
 if(!hasRun){
  shown=incoming;target=incoming;hasRun=true;
  paint();
  return;
 }
 if(incoming<shown&&incoming<=5){
  // A brand-new Start again, unlike an out-of-order progress response.
  shown=incoming;target=incoming;
 }else if(incoming>target){
  target=incoming;updates++;
 }
 // Restore the still-current displayed percentage immediately if the
 // application's native renderer wrote a ten-point leap.
 paint();
}
function frame(){
 if(!element||!element.isConnected){attach();return}
 if(!element.classList.contains("pp-opt-running")){
  if(hasRun)reset();
  return;
 }
 if(shown==null||target==null)return;
 if(shown<target){
  shown+=1;
  paint();
 }
}
function attach(){
 const btn=document.getElementById("opt");
 if(!btn)return;
 if(btn===element){readNative();return}
 observer?.disconnect();
 element=btn;reset();
 observer=new MutationObserver(readNative);
 observe();
 readNative();
}
attach();
interval=setInterval(()=>{if(document.getElementById("opt")!==element)attach();frame()},intervalMs);
window.__PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__={
 installed:true,
 get shown(){return shown},
 get confirmedTarget(){return target},
 get serverUpdates(){return updates},
 get intervalMs(){return intervalMs},
 sync:readNative,
 stop(){
  if(interval!=null){clearInterval(interval);interval=null}
  observer?.disconnect();
 }
};
})();