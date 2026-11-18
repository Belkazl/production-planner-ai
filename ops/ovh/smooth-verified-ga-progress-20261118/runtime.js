(function ppSmoothVerifiedProgressV1(){
"use strict";
if(window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__?.installed)return;
// The only input is the already-confirmed GA percent painted by the native
// authenticated progress poll. Never estimate elapsed work or issue extra API
// requests. This renderer may lag the server, but can never run ahead of it.
const stepMs=75;
const percentRE=/\b(100|[1-9]?\d)\s*%/;
let button=null,observer=null,timer=null,active=false,shown=0,target=0;
let mutationQueued=false,painting=false;
const css=document.createElement("style");
css.id="ppSmoothVerifiedProgressCssV1";
css.textContent="#opt .pp-opt-progress-line{transition:width 75ms linear!important}";
(document.head||document.documentElement).appendChild(css);
function findText(){
 if(!button)return null;
 for(const n of button.childNodes){
  if(n.nodeType===3&&percentRE.test(n.nodeValue||""))return n;
  if(n.nodeType===1){
   for(const k of n.childNodes||[]){
    if(k.nodeType===3&&percentRE.test(k.nodeValue||""))return k;
   }
  }
 }
 return null;
}
function reset(){
 active=false;shown=0;target=0;
 if(timer!==null){clearInterval(timer);timer=null}
}
function paint(){
 if(!button?.isConnected)return;
 const node=findText();
 if(!node)return;
 const original=node.nodeValue;
 const updated=original.replace(percentRE,shown+"%");
 if(updated!==original){painting=true;node.nodeValue=updated;painting=false}
 const bar=button.querySelector(".pp-opt-progress-line");
 if(bar)bar.style.setProperty("width",shown+"%","important");
 button.setAttribute("aria-valuemin","0");
 button.setAttribute("aria-valuemax","100");
 button.setAttribute("aria-valuenow",String(shown));
}
function tick(){
 if(!active||!button?.isConnected||!button.classList.contains("pp-opt-running")){
  reset();return;
 }
 if(shown<target){shown+=1;paint()}
 if(shown>=target&&timer!==null){clearInterval(timer);timer=null}
}
function scheduleTicker(){
 if(timer===null&&active&&shown<target)timer=setInterval(tick,stepMs);
}
function capture(){
 if(painting||!button?.isConnected)return;
 const node=findText();
 if(!button.classList.contains("pp-opt-running")||!node){reset();return}
 const match=percentRE.exec(node.nodeValue||"");
 if(!match)return;
 const raw=Math.min(99,Math.max(0,Number(match[1])));
 if(!Number.isFinite(raw))return;
 if(!active){
  // On reload/reconnect show the latest CONFIRMED value immediately,
  // not an invented animation starting at zero.
  active=true;shown=raw;target=raw;paint();return;
 }
 if(raw>target){target=raw}
 // During a run, ignore stale/cached responses and our own text mutations.
 // A new run is detected by native removal of the running CSS class.
 paint();scheduleTicker();
}
function observeButton(){
 const current=document.getElementById("opt");
 if(current===button)return;
 if(observer){observer.disconnect();observer=null}
 reset();button=current;
 if(!button)return;
 observer=new MutationObserver(()=>{
  if(mutationQueued)return;
  mutationQueued=true;
  queueMicrotask(()=>{mutationQueued=false;capture()});
 });
 observer.observe(button,{childList:true,characterData:true,subtree:true,
  attributes:true,attributeFilter:["class"]});
 capture();
}
const watch=setInterval(observeButton,550);
observeButton();
window.addEventListener("pp:optimizer-started",()=>{reset();observeButton()});
window.addEventListener("pp:optimizer-reconnect-pending",observeButton);
window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__={
 installed:true,mode:"confirmed-only",stepMs,
 get state(){return {active,displayed:shown,confirmed:target}},
 refresh(){observeButton();capture()},
 dispose(){
  reset();clearInterval(watch);observer?.disconnect();observer=null
 }
};
})();