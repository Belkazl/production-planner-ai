const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {resolve}=require("node:path");
const vm=require("node:vm");

const newRoot=process.argv[2],oldRoot=process.argv[3];
if(!newRoot||!oldRoot)throw Error("UNIFIED_GANTT_V2_TEST_REQUIRES_NEW_AND_OLD_APP");
const filename="restart-optimizer-ui.js";
const previous=readFileSync(resolve(oldRoot,filename),"utf8");
const current=readFileSync(resolve(newRoot,filename),"utf8");
const needle="\n;(function ppUnifiedGanttV2(){";
const index=current.lastIndexOf(needle);
assert(index>=0,"new Gantt addon exists");
const oldIndex=previous.lastIndexOf(needle);
assert(oldIndex>=0,"previous unified renderer installed");
assert.equal(current.slice(0,index),previous.slice(0,oldIndex),"all other production frontend bytes preserved");
assert(!previous.slice(oldIndex).includes("Native V2 recreates the axis each draw"));
assert(current.slice(index).includes("Native V2 recreates the axis each draw"));
assert(current.slice(index).includes("const ru=/^ru/i.test(language());"));
assert.equal(current.split(needle).length,2,"only one Gantt unification addon");
const addon=current.slice(index+2);
for(const token of [
 "ppStopRestorePreviousPlanV1","ppHideGaTechnicalLabelsV1",
 "ppAutomaticIntermediatePreviewV1","ppSelectedPlanKpiReferenceV2",
 "__PP_GA_OBJECTIVE_FLOOR_V1__","quick:Object.freeze({generations:10,population:12})",
 "__PP_CONTINUATION_SEED_V2__"
])assert(current.includes(token),"protected component not changed: "+token);
assert(!addon.includes("/api/plan"),"not changing optimizer networking");
assert(!addon.includes("/api/optimizer-stop"),"not changing Stop");
assert(!addon.includes("/api/optimizer-reset"),"not changing reset");
const ids=Array.from({length:12},(_,i)=>String(2601+i));
const ops=Array.from({length:915},(_,i)=>{
 const order=ids[i%ids.length];
 return {
  order:i%100===0?"__ppb__"+order+"__0":order,
  operation_id:"step"+i,
  operation_name:i%3===0?"Pressing":i%3===1?"Glazing":"Firing",
  start_min:i*5,end_min:i*5+4,is_setup:i<89,
  phase:i<89?"setup":"process",
  equipment_ids:["EQ"+(i%14)],employee_ids:["EMP"+(i%5)]
 };
});
const plan={
 valid:true,partial:false,_revision:5,start:"2026-10-05T08:00:00",finish:"2026-10-08T20:00:00",
 duration_minutes:4405,batch_count:118,operator_wait_minutes:413124,machine_idle_minutes:16859,
 batches:[],operations:ops,generic_operations:ops
};
const modelData={
 start:plan.start,finish:plan.finish,
 equipment:Array.from({length:14},(_,i)=>({id:"EQ"+i,name:"Machine "+i,kind:"pressing"})),
 employees:Array.from({length:5},(_,i)=>({id:"EMP"+i,name:"Employee "+i,role:"operator",shift:"day"})),
 orders:ids.map(id=>({id,technical_process_id:"TP",quantity:75,unit:"m2"})),
 technical_processes:[{id:"TP",name:"Tile production"}]
};

function environment(){
 const m=structuredClone(modelData),sourceEquipment=m.equipment;
 const classFlags=Array.from({length:6},(_,i)=>i===0);
 const title={textContent:"Equipment utilization"};
 const axis={textContent:"Оборудование"};
 const styleNodes=[],renderCalls=[],events={};
 const stage={
  hidden:false,
  querySelector:(s)=>s===".pg2-axis>.pg2-name"?axis:null,
  querySelectorAll:()=>[]
 };
 const scroll={scrollLeft:0,children:[],appendChild(x){this.children.push(x)}};
 const card={querySelector:selector=>selector===".gantt-head b"?title:null};
 const tabs={
  children:Array.from({length:6},(_,i)=>({
   textContent:["Equipment Gantt","Employee Gantt","Materials","Orders","Resource utilization","Bottlenecks"][i],
   classList:{contains:x=>x==="a"&&classFlags[i]}
  })),
  addEventListener(event,cb){events["tabs:"+event]=cb}
 };
 const view={dataset:{},querySelector:s=>s===".tabs"?tabs:s===".card.gantt-card"?card:null};
 const el={
  planView:view,ganttScroll:scroll,ppGanttToolV2:stage,
  ppUnifiedGanttEmpty:null,timeline:{style:{setProperty(){}}}
 };
 const doc={
  getElementById:key=>el[key]||null,
  createElement:tag=>({tag,hidden:false,id:"",textContent:""}),
  head:{appendChild(x){styleNodes.push(x)}},
  querySelectorAll:()=>[],querySelector:()=>null,
  documentElement:{lang:"en"}
 };
 const intervals=[],timeoutCalls=[];
 const window={
  __PP_GANTT_TOOL_V2_INSTALLED__:true,__ppTabPlan:plan,__ppOptimizationInFlight:false,
  addEventListener(name,cb,options){events["window:"+name]=cb}
 };
 const store={
  getItem:k=>k==="prodplan.project.active.v2"?"P1":k==="prodplan.projects.v2"?
    JSON.stringify([{id:"P1",lastPlan:plan}]):null
 };
 const native=function(p){
  renderCalls.push({
   p,ids:m.equipment.map(x=>x.id),labels:m.equipment.map(x=>x.name),
   projectedOperations:p.operations?.length,originalOps:p.operations===ops
  });
 };
 const ctx={
  window,document:doc,localStorage:store,model:m,
  renderPlan:native,clearPlan:()=>{renderCalls.push({cleared:true})},
  MutationObserver:class {constructor(cb){this.cb=cb}observe(){}},
  getComputedStyle:()=>({display:"none"}),
  setInterval:(fn,n)=>{intervals.push({fn,n});return intervals.length},
  setTimeout:(fn,n)=>{timeoutCalls.push(fn);return timeoutCalls.length},
  console
 };
 vm.createContext(ctx);
 vm.runInContext(addon,ctx,{timeout:1800});
 const tool=window.__PP_UNIFIED_GANTT_V2__;
 assert(tool?.installed,true);
 function choose(i){
  classFlags.fill(false);classFlags[i]=true;
  tool.sync();
 }
 function invokeRender(p){ctx.renderPlan(p)}
 function triggerTimeouts(){
  while(timeoutCalls.length)timeoutCalls.shift()();
 }
 return {m,sourceEquipment,tool,view,renderCalls,choose,ctx,title,axis,doc,
  styleNodes,events,timeoutCalls,triggerTimeouts,invokeRender,scroll,stage};
}

const test=environment();
assert.equal(test.tool.engine,"PP_GANTT_TOOL_V2");
assert.equal(test.renderCalls.length,1);
assert.equal(test.renderCalls[0].originalOps,true,"equipment calls native engine with original plan");
assert.equal(test.renderCalls[0].ids.length,14);
assert.equal(test.view.dataset.ppUnifiedGantt,"0");
assert.equal(test.title.textContent,"Equipment utilization");
assert.equal(test.doc.getElementById("ppUnifiedGanttEmpty"),null);

test.choose(1);
let employee=test.renderCalls.at(-1);
assert.equal(employee.ids.length,5,"employee view is routed through native equipment engine");
assert(employee.ids.every(id=>id.startsWith("pp-employee-v2-")));
assert.equal(employee.projectedOperations,915);
assert.equal(employee.p.batches.length,0);
assert.equal(test.m.equipment,test.sourceEquipment,"real model resources restored after projected render");
assert.equal(test.view.dataset.ppUnifiedGantt,"1");
assert.equal(test.title.textContent,"Employee Gantt");
assert.equal(test.axis.textContent,"Employees");
assert.equal(test.tool.lastOperations,915);
test.invokeRender({...plan,duration_minutes:4375,operations:ops});
assert.equal(test.renderCalls.at(-1).p.duration_minutes,4375);
assert.equal(test.m.equipment,test.sourceEquipment,"candidate refresh cannot modify model");

test.choose(3);
const order=test.renderCalls.at(-1);
assert.equal(order.ids.length,12);
assert(order.ids.every(id=>id.startsWith("pp-order-v2-")));
assert.equal(order.projectedOperations,915,"all order operations kept");
assert.equal(order.p.operations.find(o=>o.__ppActualOperation.order.startsWith("__ppb__"))?.order,
  "2601","batch-normalized order ID preserved");
assert.equal(test.view.dataset.ppUnifiedGantt,"3");
assert.equal(test.title.textContent,"Order Gantt");
assert.equal(test.axis.textContent,"Orders");

test.choose(2);
assert.equal(test.view.dataset.ppUnifiedGantt,"2");
assert.equal(test.tool.equipmentVisible,false,"no equipment timeline in Materials");
test.choose(4);
assert.equal(test.tool.equipmentVisible,false,"no equipment timeline in utilization");
test.choose(5);
assert.equal(test.tool.equipmentVisible,false,"no equipment timeline in bottlenecks");

test.choose(0);
assert.equal(test.renderCalls.at(-1).ids.length,14,"equipment restored to native renderer");
assert.equal(test.renderCalls.at(-1).originalOps,true);
assert.equal(test.m.equipment,test.sourceEquipment,"real model unchanged through tab switches");
assert.equal(test.tool.equipmentVisible,true);

test.choose(1);
const fakeBeforeZoom=test.tool.project(plan,1).resources;
test.events["window:click"]({target:{closest:s=>({id:"zoomIn"})}});
assert.notEqual(test.m.equipment,test.sourceEquipment,"zoom temporarily projects employee resources");
test.triggerTimeouts();
assert.equal(test.m.equipment,test.sourceEquipment,"zoom restores model synchronously after event turn");

const css=test.styleNodes[0].textContent;
for(const c of ["#ppTabsView{display:none!important}",
 "data-pp-unified-gantt='1'","data-pp-unified-gantt='3'",
 "data-pp-unified-gantt='2'","data-pp-unified-gantt='4'","data-pp-unified-gantt='5'"])
 assert(css.includes(c),"legacy duplicates hidden: "+c);
assert.equal(test.styleNodes.length,1,"one consolidated CSS rule");
test.ctx.clearPlan();
assert(test.renderCalls.at(-1).cleared,"native clearPlan retained");
console.log("UNIFIED_GANTT_V2_HOTFIX_AXIS_AND_LOCALE_14_EQUIPMENT_5_EMPLOYEES_12_ORDERS_PASS");
console.log("UNIFIED_GANTT_V2_REUSE_NATIVE_DRAW_HIDE_DUPLICATES_STOP_GA_UNTOUCHED_PASS");
