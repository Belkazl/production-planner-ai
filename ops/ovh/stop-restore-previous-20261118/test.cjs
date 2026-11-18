const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const newRoot=process.argv[2],oldRoot=process.argv[3];
if(!newRoot||!oldRoot)throw Error("STOP_PREVIOUS_TEST_REQUIRES_NEW_AND_OLD_APP");
const name="restart-optimizer-ui.js";
const previous=fs.readFileSync(path.join(oldRoot,name),"utf8");
const current=fs.readFileSync(path.join(newRoot,name),"utf8");
const token="\n;(function ppStopRestorePreviousPlanV1(){";
const i=current.lastIndexOf(token);
assert(i>=0,"Stop restoration addon exists");
assert.equal(current.slice(0,i),previous,"every previous production UI byte unchanged");
assert.equal(current.split(token).length,2,"only one Stop addon");
const addon=current.slice(i+2);
for(const protectedFeature of [
 "ppSelectedPlanKpiReferenceV2","ppFixedFirstBestKpiDelta",
 "__PP_CONTINUATION_SEED_V2__","ppAutomaticIntermediatePreviewV1",
 "__PP_GA_OBJECTIVE_FLOOR_V1__",
 "quick:Object.freeze({generations:10,population:12})"
])assert(current.includes(protectedFeature),"must retain "+protectedFeature);
assert(!addon.includes("/api/plan"),"do not change optimizer POST");
assert(!addon.includes("/api/optimizer-stop"),"do not interfere with native cancellation");
assert(!addon.includes("/api/optimizer-reset"),"do not restart GA");
assert(addon.includes('keep.click()'),"native Keep previous plan handler used");
assert(addon.includes('button.pp-secondary'),"must never choose candidate");
function harness({hasModal=true,previousDuration=4405}={}){
 const events=[],styles=[],allObservers=[];
 const past={
  duration_minutes:previousDuration,
  batch_count:118,operator_wait_minutes:413124,machine_idle_minutes:16859,
  operations:[{order:"ORD-1"}],valid:true
 };
 const candidate={
  ...past,duration_minutes:4290,
  operations:[{order:"ORD-2"}]
 };
 const window={__ppOptimizerCommittedPlan:past,__ppTabPlan:candidate,__ppGenericPlan:candidate};
 const modal={
  isOpen:false,previousButton:null,
  classList:{contains(name){return name==="pp-open"&&modal.isOpen;}},
  querySelector(selector){
   return selector===".pp-actions button.pp-secondary"?modal.previousButton:null;
  }
 };
 const previousButton={
  disabled:false,clickCount:0,click(){
   this.clickCount++;
   // Actual native STOP "Leave previous plan" choice restores the plan
   // saved at the beginning of the optimization, not its candidate.
   window.__ppOptimizerCommittedPlan=past;
   window.__ppTabPlan=past;
   window.__ppGenericPlan=past;
   modal.isOpen=false;
   events.push("restored "+past.duration_minutes);
  }
 };
 modal.previousButton=previousButton;
 const seenStyles={};
 const document={
  head:{appendChild:s=>{styles.push(s);seenStyles[s.id]=s}},
  body:{},
  documentElement:{},
  getElementById:id=>id==="ppStopModal"&&hasModal?modal:seenStyles[id]||null,
  createElement:()=>({textContent:"",id:""})
 };
 class MutationObserver{
  constructor(onChange){this.onChange=onChange;allObservers.push(this)}
  observe(target,params){this.target=target;this.params=params}
  disconnect(){this.disconnected=true}
  trigger(){this.onChange([])}
 }
 const ctx={document,window,MutationObserver,console};
 vm.runInNewContext(addon,ctx,{timeout:2500});
 const restore=window.__PP_STOP_RESTORE_PREVIOUS_V1__;
 assert(restore?.installed);
 return {
  window,modal,previousButton,restore,styles,allObservers,events,
  selectOtherPlan:()=>{window.__ppTabPlan=candidate},
  openModal(){
   modal.isOpen=true;
   allObservers.filter(o=>o.target===modal&&!o.disconnected).forEach(o=>o.trigger());
  },
  modalAbsent:!hasModal
 };
}
{
 const h=harness();
 assert.equal(h.styles.length,1);
 assert.equal(h.styles[0].id,"ppStopRestorePreviousPlanStyle");
 assert(h.styles[0].textContent.includes("#ppStopModal.pp-open{display:none!important"));
 assert.equal(h.restore.restored,0);
 h.selectOtherPlan();
 assert.equal(h.window.__ppTabPlan.duration_minutes,4290);
 h.openModal();
 assert.equal(h.restore.restored,1,"first Stop restores previous accepted plan");
 assert.equal(h.restore.attempts,1);
 assert.equal(h.modal.isOpen,false,"selection dialog must not stay visible");
 assert.equal(h.previousButton.clickCount,1);
 assert.equal(h.window.__ppTabPlan.duration_minutes,4405);
 assert.equal(h.window.__ppOptimizerCommittedPlan.duration_minutes,4405);
 h.restore.sync();
 assert.equal(h.previousButton.clickCount,1,"no second click once dismissed");
 h.selectOtherPlan();
 h.openModal();
 assert.equal(h.restore.restored,2,"second Stop restores previous result too");
 assert.equal(h.previousButton.clickCount,2);
 assert.equal(h.window.__ppTabPlan.duration_minutes,4405);
 assert(h.events.every(x=>x.includes("restored 4405")));
 console.log("STOP_PREVIOUS_NO_MODAL_RESTORES_4405_AFTER_MULTIPLE_STOPS_PASS");
}
{
 const h=harness();
 h.modal.isOpen=true;
 h.previousButton.disabled=true;
 h.restore.sync();
 assert.equal(h.previousButton.clickCount,0,"never select an unavailable option");
 h.previousButton.disabled=false;
 h.restore.sync();
 assert.equal(h.previousButton.clickCount,1);
 h.modal.isOpen=false;
 console.log("STOP_PREVIOUS_NEVER_CHOOSE_CANDIDATE_AND_DISABLED_BYPASS_PASS");
}
{
 const h=harness({hasModal:false});
 assert.equal(h.restore.restored,0);
 assert.equal(h.styles.length,1);
 console.log("STOP_PREVIOUS_SAFE_BEFORE_MODAL_MOUNT_PASS");
}
console.log("STOP_RESTORE_PREVIOUS_AUTH_GANTT_KPI_ISOLATION_REGRESSION_PASS");
