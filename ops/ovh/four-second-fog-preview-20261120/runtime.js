;(function ppFourSecondFogPreviewV1(){
"use strict";
if(window.__PP_FOUR_SECOND_PREVIEW__?.installed)return;
const oldFetch=window.fetch.bind(window);
const statusPath="/api/plan-progress";
const directSnapshotPath="/api/ga-candidate-snapshot";
const everyMs=4000;
const isRunning=()=>!!document.getElementById("opt")?.classList.contains("pp-opt-running");
const canonical=input=>{
 try{return new URL(typeof input==="string"?input:input?.url,location.href)}
 catch(_){return null}
};
const method=(input,init)=>String(init?.method||(input instanceof Request?input.method:"GET")).toUpperCase();
let previews=0,activity=0,light=0,errors=0,lastSerial=0,lastTick=0,lastJob=null,lastPercent=null,lastProbe=null;
let closed=false,pending=false,progressPending=false,wasRunning=false,overlay=null,layer=null;
const style=document.createElement("style");
style.id="ppFourSecondFogPreviewCss";
style.textContent=[
 "#ganttScroll.pp-preview-fog{position:relative!important;isolation:isolate}",
 "#ganttScroll .pp-fog-row{position:absolute;pointer-events:none;z-index:12;box-sizing:border-box;",
 "background:repeating-linear-gradient(110deg,rgba(208,224,246,.28) 0px,rgba(208,224,246,.28) 12px,rgba(231,238,248,.37) 12px,rgba(231,238,248,.37) 24px);",
 "backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);",
 "border-left:1px solid rgba(143,165,198,.2);",
 "mask-image:linear-gradient(90deg,transparent,black 18%);",
 "-webkit-mask-image:linear-gradient(90deg,transparent,black 18%)}",
 "#ganttScroll .pp-fog-row:after{content:'';position:absolute;inset:0;",
 "background:linear-gradient(90deg,transparent,rgba(230,238,248,.35));",
 "animation:pp-fog-breathe 2.6s ease-in-out infinite alternate}",
 "@keyframes pp-fog-breathe{from{opacity:.36}to{opacity:.86}}",
 "@media(prefers-reduced-motion:reduce){#ganttScroll .pp-fog-row:after{animation:none}}"
].join("");
(document.head||document.documentElement).appendChild(style);
function clearFog(){
 const scroll=document.getElementById("ganttScroll");
 scroll?.classList.remove("pp-preview-fog");
 if(layer){layer.remove();layer=null}
}
function paintFog(){
 if(closed||!isRunning())return;
 const scroll=document.getElementById("ganttScroll");
 const stage=document.getElementById("ppGanttToolV2");
 if(!scroll||!stage)return;
 clearFog();
 scroll.classList.add("pp-preview-fog");
 layer=document.createElement("div");
 layer.className="pp-fog-layer";
 layer.style.cssText="position:absolute;top:0;left:0;width:0;height:0;z-index:12;pointer-events:none";
 scroll.appendChild(layer);
 const sr=scroll.getBoundingClientRect();
 const rows=[...stage.querySelectorAll(".pg2-row")].filter(el=>el.getBoundingClientRect().height>12).slice(0,14);
 const bars=[...stage.querySelectorAll(".pg2-bar")];
 const add=(left,top,width,height)=>{
  if(width<12||height<8)return;
  const el=document.createElement("div");
  el.className="pp-fog-row";
  el.style.left=Math.max(0,left)+"px";
  el.style.top=Math.max(0,top)+"px";
  el.style.width=width+"px";
  el.style.height=height+"px";
  layer.appendChild(el);
 };
 if(!rows.length){
  add(scroll.scrollLeft+Math.round(scroll.clientWidth*.62),
   scroll.scrollTop+45,Math.round(scroll.clientWidth*.38),
   Math.max(30,scroll.clientHeight-55));
  return;
 }
 for(const row of rows){
  const rr=row.getBoundingClientRect();
  if(rr.bottom<=sr.top||rr.top>=sr.bottom)continue;
  const used=bars.filter(b=>{
   const br=b.getBoundingClientRect();
   const y=(br.top+br.bottom)/2;
   return y>=rr.top&&y<=rr.bottom&&br.right>=sr.left;
  });
  const edge=used.length?Math.max(...used.map(b=>b.getBoundingClientRect().right)):
   sr.left+Math.max(150,sr.width*.52);
  const cut=Math.max(sr.left+Math.min(185,sr.width*.32),Math.min(sr.right-30,edge));
  const left=cut-sr.left+scroll.scrollLeft;
  const top=rr.top-sr.top+scroll.scrollTop;
  add(left,top,sr.right-cut,rr.height);
 }
}
const emitMeta=p=>{
 if(typeof p?.stage==="string")
  window.dispatchEvent(new CustomEvent("pp:ga-server-stage",{detail:p.stage}));
 if(p?.running===true&&Number.isFinite(Number(p.percent))){
  lastPercent=Math.max(0,Math.min(99,Math.floor(Number(p.percent))));
  window.dispatchEvent(new CustomEvent("pp:ga-light-progress",{detail:{
    percent:lastPercent,stage:p.stage||null,job_id:p.job_id||null
  }}));
 }
};
window.fetch=function ppLeanPlanProgress(input,init){
 const u=canonical(input);
 if(closed||!u||u.origin!==location.origin||u.pathname!==statusPath||
  method(input,init)!=="GET"||!isRunning()||u.searchParams.has("ppNoCache")||
  u.searchParams.has("ppPreview")||u.searchParams.has("ppForce")||
  u.searchParams.has("ppLight")||u.searchParams.has("stop_snapshot")||
  u.searchParams.has("ppStopConfirm")||u.searchParams.has("ppReconnect"))return oldFetch(input,init);
 u.pathname=directSnapshotPath;
 u.searchParams.set("ppLight","1");
 u.searchParams.set("ppNoCache","1");
 light++;
 return oldFetch(u.toString(),init);
};
function renderCandidate(p){
 if(!p||p._pp_preview_limited!==true||p.partial!==true||
  !Array.isArray(p.operations)||p.operations.length>140||!p.operations.length)return false;
 if(typeof renderPlan!=="function")return false;
 // Gantt rendering is display-only. Do not write the candidate to committed
 // plan storage, selected best, optimization checkpoint, or localStorage.
 renderPlan(p);
 previews++;
 requestAnimationFrame(paintFog);
 return true;
}
async function snapshot(){
 if(closed||pending||!isRunning())return;
 pending=true;
 try{
  const r=await oldFetch(directSnapshotPath+"?ppPreview=1&ppNoCache=1",{
   method:"GET",cache:"no-store",credentials:"same-origin",
   signal:AbortSignal.timeout(9000),headers:{"accept":"application/json"}
  });
  if(!r.ok)throw Error("preview_http_"+r.status);
  const p=await r.json();
  if(closed||!isRunning()||p.running!==true)return;
  activity++;
  lastProbe=p.preview_probe||null;
  if(p.job_id&&lastJob&&p.job_id!==lastJob){lastSerial=0;clearFog()}
  if(p.job_id)lastJob=p.job_id;
  emitMeta(p);
  const serial=Math.max(0,Number(p.candidate_serial)||0);
  lastSerial=Math.max(lastSerial,serial);
  if(p.candidate_preview)renderCandidate(p.candidate_preview);
  else if(!layer)requestAnimationFrame(paintFog);
  lastTick=Date.now();
 }catch(_){errors++}
 finally{pending=false}
}
async function heartbeat(){
 if(closed||progressPending||!isRunning())return;
 progressPending=true;
 try{
  const r=await oldFetch(directSnapshotPath+"?ppLight=1&ppNoCache=1",{
   method:"GET",cache:"no-store",credentials:"same-origin",
   signal:AbortSignal.timeout(4500),headers:{"accept":"application/json"}
  });
  if(r.ok){
   const p=await r.json();
   if(isRunning())emitMeta(p);
  }
 }catch(_){errors++}
 finally{progressPending=false}
}
const ticks=setInterval(()=>{
 const on=isRunning();
 if(!on){
  if(wasRunning)clearFog();
  wasRunning=false;lastJob=null;lastSerial=0;
  return;
 }
 if(!wasRunning){wasRunning=true;void snapshot()}
},300);
const four=setInterval(()=>{if(isRunning())void snapshot()},everyMs);
const one=setInterval(()=>{if(isRunning())void heartbeat()},1000);
window.addEventListener("pp:optimizer-started",()=>{
 clearFog();lastJob=null;lastSerial=0;lastPercent=null;
});
window.addEventListener("pp:optimizer-reconnect-pending",()=>{lastJob=null;lastSerial=0});
window.__PP_FOUR_SECOND_PREVIEW__={
 installed:true,intervalMs:everyMs,rows:14,perRow:10,
 get state(){return{previews,activity,light,errors,lastSerial,lastTick,lastJob,
   lastPercent,lastProbe,active:isRunning(),fogRows:layer?.children.length||0}},
 refresh:snapshot,
 dispose(){closed=true;clearInterval(ticks);clearInterval(four);clearInterval(one);
  clearFog();style.remove();window.fetch=oldFetch}
};
})();