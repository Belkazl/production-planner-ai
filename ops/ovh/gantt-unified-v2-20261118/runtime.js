(function ppUnifiedGanttV2(){
"use strict";
if(window.__PP_UNIFIED_GANTT_V2__?.installed)return;
const planView=document.getElementById("planView");
const tabs=planView?.querySelector(".tabs");
const card=planView?.querySelector(".card.gantt-card");
const scroll=document.getElementById("ganttScroll");
const stage=document.getElementById("ppGanttToolV2");
if(!planView||!tabs||!card||!scroll||!stage||
   !window.__PP_GANTT_TOOL_V2_INSTALLED__||typeof renderPlan!=="function"){
 console.warn("PP_UNIFIED_GANTT_V2_PREREQUISITES_MISSING");return;
}
const sourceRender=renderPlan;
const sourceClear=typeof clearPlan==="function"?clearPlan:null;
const language=()=>String(document.querySelector("#languageSelect")?.value||
  document.querySelector("select[aria-label=Language]")?.value||"").toLowerCase();
const toString=v=>String(v==null?"":v).trim();
const finite=(v,d=0)=>{const n=Number(v);return Number.isFinite(n)?n:d};
const getMode=()=>[...tabs.children].findIndex(el=>el.classList.contains("a"));
const getModel=()=>typeof model!=="undefined"&&model?model:null;
const normalizeOrder=v=>toString(v).replace(/^__ppb__(.+?)__\d+$/,"$1");
const operationOrder=op=>{
 const from=normalizeOrder(op?.order??op?.order_id);
 if(from)return from;
 return normalizeOrder(toString(op?.batch_id).split(".")[0]);
};
const chooseOps=plan=>{
 const a=Array.isArray(plan?.operations)?plan.operations:[];
 const b=Array.isArray(plan?.generic_operations)?plan.generic_operations:[];
 return (a.some(op=>op&&op.is_setup===true)?a:b.length?b:a)
  .filter(op=>op&&finite(op.end_min)>finite(op.start_min));
};
const resourceIds=(op,kind)=>{
 const field=kind==="employee"?"employee_ids":"equipment_ids";
 let arr=Array.isArray(op?.[field])?op[field]:[];
 if(!arr.length&&kind==="employee"&&op?.employee_id!=null)arr=[op.employee_id];
 if(!arr.length&&Array.isArray(op?.resources))
  arr=op.resources.filter(r=>r?.resource_type===kind).map(r=>r.id??r.resource_ref??r.name);
 return arr.map(toString);
};
const orderNames=()=>{
 const m=getModel(),names=new Map();
 for(const x of (m?.technical_processes||[]))names.set(toString(x.id),toString(x.name||x.id));
 return names;
};
let lastReal=null,lastMode=-1,lastProjectId="",lastProjection=null,painting=false;
const positions=new Map(),originalHeading=card.querySelector(".gantt-head b")?.textContent||"Equipment utilization";
const heading=card.querySelector(".gantt-head b");
function getPlan(){
 if(window.__ppOptimizationInFlight===true&&lastReal)return lastReal;
 if(window.__ppTabPlan&&typeof window.__ppTabPlan==="object")return window.__ppTabPlan;
 if(window.__ppGenericPlan&&typeof window.__ppGenericPlan==="object")return window.__ppGenericPlan;
 if(window.__ppOptimizerCommittedPlan&&typeof window.__ppOptimizerCommittedPlan==="object")return window.__ppOptimizerCommittedPlan;
 if(lastReal)return lastReal;
 try{
  const id=localStorage.getItem("prodplan.project.active.v2");
  const projects=JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]");
  return Array.isArray(projects)?projects.find(p=>String(p.id)===String(id))?.lastPlan||null:null;
 }catch(_){return null}
}
function project(plan,mode){
 const m=getModel(),ops=chooseOps(plan),resources=[],assign=new Map();
 if(!m)return {resources,ops:[],plan:null};
 if(mode===1){
  for(const [i,e] of (Array.isArray(m.employees)?m.employees:[]).entries()){
   const sourceId=toString(e.id??e.__ppid??e.name);
   const id="pp-employee-v2-"+i;
   const row={id,name:toString(e.name||sourceId||"Employee "+(i+1)),
    kind:[e.role,e.shift].filter(Boolean).join(" · "),__ppActual:e};
   resources.push(row);
   for(const key of [sourceId,e.__ppid,e.name].map(toString).filter(Boolean))assign.set(key,id);
  }
 }else if(mode===3){
  const processNames=orderNames();
  for(const [i,o] of (Array.isArray(m.orders)?m.orders:[]).entries()){
   const sourceId=toString(o.id),id="pp-order-v2-"+i;
   const prefix=/заказ/i.test(toString(tabs.children[3]?.textContent))?"Заказ ":"Order ";
   const row={id,name:prefix+sourceId,
    kind:processNames.get(toString(o.technical_process_id))||
      toString(o.name||o.description||""),__ppActual:o};
   resources.push(row);
   assign.set(sourceId,id);
  }
 }
 const mapped=[];
 for(const op of ops){
  const ids=mode===1?resourceIds(op,"employee"):[operationOrder(op)];
  const targets=new Set(ids.map(x=>assign.get(x)).filter(Boolean));
  for(const target of targets)
   mapped.push({...op,order:operationOrder(op)||toString(op.order),
    equipment_ids:[target],__ppActualOperation:op});
 }
 const output={...plan,operations:mapped,generic_operations:mapped,
  batches:[],blocked_orders:[],
  start:plan.start||m.start,finish:plan.finish||m.finish};
 return {resources,ops:mapped,plan:output};
}
function refreshOperationDetails(mode,plan){
 const root=stage;
 const kind=mode===1?"employee":"order";
 const map=new Map((lastProjection?.resources||[]).map(e=>[e.id,e.__ppActual]));
 for(const bar of root.querySelectorAll(".pg2-bar")){
  const op=bar.__ppOperation;
  if(op?.__ppActualOperation){
   bar.__ppOperation=op.__ppActualOperation;
   bar.__ppPlan=plan;
   bar.__ppResourceKind=kind;
   bar.__ppResource=map.get(toString(bar.__ppResource?.id))||bar.__ppResource;
  }
 }
}
function setMode(mode){
 planView.dataset.ppUnifiedGantt=String(mode);
 if(heading)heading.textContent=mode===0?originalHeading:
  toString(tabs.children[mode]?.textContent)||(mode===1?"Employee Gantt":"Orders");
 const axis=stage.querySelector(".pg2-axis>.pg2-name");
 if(axis&&mode===1)axis.textContent=toString(tabs.children[1]?.textContent)||"Employees";
 if(axis&&mode===3)axis.textContent=toString(tabs.children[3]?.textContent)||"Orders";
}
function renderActive(p,mode=getMode()){
 if(painting||!p||!getModel())return;
 painting=true;
 try{
  if(lastMode>=0&&lastMode!==mode)positions.set(lastMode,scroll.scrollLeft);
  const previousMode=lastMode;lastMode=mode;
  setMode(mode);
  if(mode===1||mode===3){
   const m=getModel(),projection=project(p,mode);lastProjection=projection;
   const had=Object.prototype.hasOwnProperty.call(m,"equipment"),prior=m.equipment;
   m.equipment=projection.resources;
   try{sourceRender.call(this,projection.plan)}finally{
    if(had)m.equipment=prior;else delete m.equipment;
   }
   refreshOperationDetails(mode,p);
   if(!projection.ops.length){
    stage.hidden=true;
    document.getElementById("timeline")?.style.setProperty("display","none","important");
    const empty=document.getElementById("ppUnifiedGanttEmpty");
    if(empty)empty.textContent=mode===1?
      "No employee operations in this plan.":"No order operations in this plan.";
   }
  }else if(mode===0){
   lastProjection=null;
   sourceRender.call(this,p);
  }else {
   lastProjection=null;
  }
  const empty=document.getElementById("ppUnifiedGanttEmpty");
  if(empty)empty.hidden=(mode===0||!!lastProjection?.ops.length);
  if(mode!==previousMode)scroll.scrollLeft=positions.get(mode)||0;
 }catch(e){
  console.error("PP_UNIFIED_GANTT_RENDER_FAILED",String(e?.stack||e).slice(0,450));
 }finally{painting=false}
}
renderPlan=function(p){
 if(!p||typeof p!=="object")return sourceRender.apply(this,arguments);
 lastReal=p;
 const mode=getMode();
 if(mode===0||mode===1||mode===3){
  renderActive(p,mode);
  return;
 }
 // Non-Gantt tabs must never display the equipment chart.
 setMode(mode);
 return sourceRender.apply(this,arguments);
};
if(sourceClear)clearPlan=function(){
 lastReal=null;lastProjection=null;
 const empty=document.getElementById("ppUnifiedGanttEmpty");
 if(empty)empty.hidden=true;
 return sourceClear.apply(this,arguments);
};
const style=document.createElement("style");style.id="ppUnifiedGanttV2Css";
style.textContent=[
 "#planView[data-pp-unified-gantt='0'] #ppTabsView,",
 "#planView[data-pp-unified-gantt='1'] #ppTabsView,",
 "#planView[data-pp-unified-gantt='3'] #ppTabsView{display:none!important}",
 "#planView[data-pp-unified-gantt='2'] .card.gantt-card,",
 "#planView[data-pp-unified-gantt='4'] .card.gantt-card,",
 "#planView[data-pp-unified-gantt='5'] .card.gantt-card{display:none!important}",
 "#ppUnifiedGanttEmpty{padding:22px 16px;color:#627893;font-size:12px}"
].join("\n");
(document.head||document.documentElement).appendChild(style);
const empty=document.createElement("div");empty.id="ppUnifiedGanttEmpty";empty.hidden=true;
scroll.appendChild(empty);
function sync(){
 if(painting)return;
 const mode=getMode();
 let projectId="";
 try{projectId=localStorage.getItem("prodplan.project.active.v2")||""}catch(_){}
 const p=getPlan(),changed=mode!==lastMode||projectId!==lastProjectId;
 if(!changed)return;
 lastProjectId=projectId;
 if(p&&[0,1,3].includes(mode)){lastReal=p;renderActive(p,mode)}
 else {lastMode=mode;setMode(mode)}
}
let pending=false;
function schedule(){
 if(pending)return;
 pending=true;
 setTimeout(()=>{pending=false;sync()},0);
}
const obs=new MutationObserver(schedule);
obs.observe(tabs,{attributes:true,subtree:true,attributeFilter:["class"],childList:true});
tabs.addEventListener("click",schedule,true);
tabs.addEventListener("pointerup",schedule,true);
window.addEventListener("popstate",schedule);
window.addEventListener("pp:optimizer-started",schedule);
window.addEventListener("pp:optimizer-reconnect-pending",schedule);
setInterval(sync,950);
// Native Gantt V2 handles zoom inside a private closure. During its synchronous
// zoom redraw, supply the currently projected rows, then restore the real model
// before any other code can use the production model.
window.addEventListener("click",event=>{
 const target=event.target?.closest?.("#zoomIn,#zoomOut,#zoomLabel");
 if(!target||![1,3].includes(getMode())||!lastProjection)return;
 const m=getModel();if(!m)return;
 const had=Object.prototype.hasOwnProperty.call(m,"equipment"),prior=m.equipment;
 const temporary=lastProjection.resources;
 m.equipment=temporary;
 setTimeout(()=>{
  if(m.equipment===temporary){
   if(had)m.equipment=prior;else delete m.equipment;
  }
  refreshOperationDetails(getMode(),lastReal);
 },0);
},true);
window.__PP_UNIFIED_GANTT_V2__={
 installed:true,engine:"PP_GANTT_TOOL_V2",get activeMode(){return getMode()},
 get lastOperations(){return lastProjection?.ops.length||0},
 get equipmentVisible(){return [0,1,3].includes(getMode())},
 sync,project,
 get diagnostics(){return{
  tab:getMode(),rows:stage.querySelectorAll(".pg2-row").length,
  legacyVisible:!!document.querySelector("#ppTabsView .pp3-card")&&
    getComputedStyle(document.getElementById("ppTabsView")).display!=="none",
  mainVisible:getComputedStyle(card).display!=="none"
 }}
};
sync();
})();