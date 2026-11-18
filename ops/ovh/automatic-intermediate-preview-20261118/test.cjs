const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const newRoot=process.argv[2],oldRoot=process.argv[3];
if(!newRoot||!oldRoot)throw Error("AUTO_PREVIEW_REQUIRES_NEW_AND_OLD_ROOT");
const name="restart-optimizer-ui.js";
const after=fs.readFileSync(path.join(newRoot,name),"utf8");
const before=fs.readFileSync(path.join(oldRoot,name),"utf8");
const marker="\n;(function ppAutomaticIntermediatePreviewV1(){";
const index=after.lastIndexOf(marker);
assert(index>=0,"auto-preview script present");
assert.equal(after.slice(0,index),before,"all pre-existing frontend bytes preserved");
assert.equal(after.split(marker).length,2,"exactly one auto-preview install");
const injected=after.slice(index+2);
for(const required of [
 "__PP_OPTIMIZER_DEPTH__","__PP_GA_OBJECTIVE_FLOOR_V1__",
 "__PP_CONTINUATION_SEED_V2__","quick:Object.freeze({generations:10,population:12})",
 "PP_GA_WORSE_OBJECTIVE_REJECTED"
]){
 assert(after.includes(required),"existing protection preserved: "+required);
}
assert(injected.includes('style.textContent="#ppLivePreview{display:none!important}"'),
 "entire two-button wrapper must disappear visually");
assert(injected.includes('button[data-mode="candidate"]'),
 "live mode must force candidate instead of best");
assert(!injected.includes("/api/plan"),"must not change optimization request");
assert(!injected.includes("/api/optimizer-reset"),"must not reset worker or plans");

function harness(){
 const events={};
 const classSet=(...names)=>{
  const set=new Set(names);
  return {contains:k=>set.has(k),add:k=>set.add(k),remove:k=>set.delete(k)};
 };
 const best={classList:classSet("a"),dataset:{mode:"best"}};
 const candidate={classList:classSet(),dataset:{mode:"candidate"},disabled:true,clicks:0};
 let currentSelector={querySelector:q=>q.includes('candidate')?candidate:best};
 candidate.onclick=()=>{};
 candidate.click=()=>{
  candidate.clicks++;
  candidate.classList.add("a");
  best.classList.remove("a");
 };
 const styleNodes=[],watchers=[];
 class MutationObserver{
  constructor(fn){this.fn=fn;watchers.push(this);}
  observe(target,opts){this.target=target;this.opts=opts;}
  disconnect(){this.disconnected=true;}
  trigger(){this.fn();}
 }
 const window={
  __ppOptimizationInFlight:true,__ppStopUiLocked:false,
  __PP_STOP_DEBUG__:()=>({running:true}),
  addEventListener:(name,cb)=>{events[name]=cb;}
 };
 const doc={
  createElement:tag=>({tagName:tag}),
  head:{appendChild:x=>styleNodes.push(x)},
  body:{},
  getElementById:id=>id==="ppLivePreview"?currentSelector:
   id==="opt"?{classList:classSet("pp-opt-running")}:null
 };
 vm.runInNewContext(injected,{window,document:doc,MutationObserver,console},
  {timeout:1000});
 const ctrl=window.__PP_AUTO_INTERMEDIATE_PREVIEW_V1__;
 assert.equal(ctrl.installed,true);
 assert.equal(ctrl.selected,"candidate");
 return {window,doc,ctrl,candidate,best,styleNodes,watchers,events,
  replaceSelector:x=>{currentSelector=x;}};
}
{
 const x=harness();
 assert.equal(x.styleNodes.length,1);
 assert.equal(x.styleNodes[0].id,"ppAutoIntermediatePreviewCss");
 assert.match(x.styleNodes[0].textContent,/#ppLivePreview\{display:none!important\}/);
 assert.equal(x.candidate.clicks,0,"not ready candidate must not be forced");
 x.candidate.disabled=false;
 x.ctrl.refresh();
 assert.equal(x.candidate.clicks,1,"first valid candidate must auto-select");
 assert.equal(x.window.__ppLiveMode,"candidate");
 assert.equal(x.best.classList.contains("a"),false);
 assert.equal(x.candidate.classList.contains("a"),true);
 x.ctrl.refresh();
 assert.equal(x.candidate.clicks,1,"no duplicate click on every poll");
 x.candidate.classList.remove("a");
 x.best.classList.add("a");
 x.watchers[0].trigger();
 assert.equal(x.candidate.clicks,2,"new GA run resetting mode to Best must auto-switch to candidate");
 x.window.__ppOptimizationInFlight=false;
 x.window.__PP_STOP_DEBUG__=()=>({running:false});
 x.candidate.classList.remove("a");
 x.best.classList.add("a");
 x.ctrl.refresh();
 assert.equal(x.candidate.clicks,2,"do not touch completed saved Gantt");
 x.window.__ppOptimizationInFlight=true;
 x.window.__ppStopUiLocked=true;
 x.ctrl.refresh();
 assert.equal(x.candidate.clicks,2,"do not interfere with Stop UI");
 x.window.__ppStopUiLocked=false;
 x.events["pp:optimizer-started"]();
 assert.equal(x.candidate.clicks,3,"next optimization must show intermediate candidate automatically");
}
{
 const x=harness();
 x.candidate.disabled=false;
 x.ctrl.refresh();
 const buttons={
  candidate:{classList:{contains:()=>false},dataset:{mode:"candidate"},disabled:false,
   onclick:()=>{},click(){this.clicks=(this.clicks||0)+1}},
  best:{classList:{contains:()=>true},dataset:{mode:"best"}}
 };
 x.replaceSelector({querySelector:q=>q.includes('candidate')?buttons.candidate:buttons.best});
 x.ctrl.refresh();
 assert.equal(buttons.candidate.clicks,1,"recreated project toolbar works");
}
console.log("AUTO_INTERMEDIATE_PREVIEW_HIDE_SWITCHES_AND_SHOW_CANDIDATE_TESTS_PASS");
