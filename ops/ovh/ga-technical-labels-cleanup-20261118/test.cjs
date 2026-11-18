const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const root=process.argv[2],oldRoot=process.argv[3];
if(!root||!oldRoot)throw Error("GA_LABELS_TEST_REQUIRES_OLD_AND_NEW_ROOT");
const name="restart-optimizer-ui.js";
const current=fs.readFileSync(path.join(root,name),"utf8");
const before=fs.readFileSync(path.join(oldRoot,name),"utf8");
const marker="\n;(function ppHideGaTechnicalLabelsV1(){";
const at=current.lastIndexOf(marker);
assert(at>=0,"appended cleanup installed");
assert.equal(current.slice(0,at),before,"production UI preserved byte-for-byte");
assert.equal(current.split(marker).length,2,"exactly one metadata cleanup");
const addon=current.slice(at+2);
for(const feature of [
 "ppStopRestorePreviousPlanV1","ppAutomaticIntermediatePreviewV1",
 "__PP_KPI_FIRST_BEST_V1__","__PP_CONTINUATION_SEED_V2__",
 "__PP_GA_OBJECTIVE_FLOOR_V1__","quick:Object.freeze({generations:10,population:12})"
])assert(current.includes(feature),"preserve existing feature: "+feature);
assert(!addon.includes("/api/plan"),"must not touch GA request");
assert(!addon.includes("renderPlan("),"must not repaint Gantt");
assert(!addon.includes("/api/optimizer-stop"),"must not affect Stop behavior");
function node(value,{children=[]}={}){
 const attributes={},css={};
 return {
  textContent:value,children,
  style:{setProperty:(k,v,imp)=>{css[k]=[v,imp]}},
  getAttribute:k=>attributes[k]??null,
  setAttribute:(k,v)=>{attributes[k]=v},
  get hidden(){return css.display?.[0]==="none"},
  get ariaHidden(){return attributes["aria-hidden"]},
  get highlighted(){return attributes["data-pp-ga-tech-hidden"]}
 };
}
function makeEnv(){
 const nodes=[
  node("GA core: 1.1.2"),
  node("GA: running · 30%"),
  node("GA: valid plan"),
  node("GA · 38760 generations total · run 181 · 89512 ms · улучшение NaN мин"),
  node("Optimization depth"),
  node("Up to 10 generations × 12 candidates (≈120 evaluations)"),
  node("Production Schedule"),
  node("Candidate plan: 4409 min · Temporary preview, not saved"),
  node("GA core: long text", {children:[node("nested")]})
 ];
 const styles=[];
 const document={
  getElementById:id=>id==="planView"?{querySelectorAll:()=>nodes}:styles.find(x=>x.id===id)||null,
  createElement:tag=>({tag,id:"",textContent:""}),
  head:{appendChild:x=>styles.push(x)}
 };
 const sched={intervals:[],callbacks:[]};
 const window={};
 const context={document,window,console,
  setInterval:(fn,ms)=>{sched.intervals.push(ms);sched.callbacks.push(fn);return 9},
  clearInterval:()=>{}};
 vm.runInNewContext(addon,context,{timeout:1000});
 return {nodes,styles,window,sched};
}
test("only exact GA pills hidden; no candidate preview or controls hidden",()=>{
 const e=makeEnv(),s=e.styles[0].textContent;
 assert.equal(e.styles.length,1);
 for(const selector of ["#meta","#valid","#ppOptimizerDepthDetail","#ppOptimizerDepthHelp"])
  assert(s.includes(selector+"{display:none!important}"),selector+" must be removed");
 for(const protectedSelector of ["#ppOptimizerDepthSelect","#opt","#ppOptimizerStop","#ppOptimizerCandidateStatus"])
  assert(!s.includes(protectedSelector+"{"),"preserve "+protectedSelector);
 assert.deepEqual(e.nodes.map(x=>x.hidden),[true,true,true,false,false,false,false,false,false]);
 assert.equal(e.nodes[0].ariaHidden,"true");
 assert.equal(e.window.__PP_HIDE_GA_TECHNICAL_LABELS_V1__.installed,true);
 assert.equal(e.window.__PP_HIDE_GA_TECHNICAL_LABELS_V1__.hiddenPills,3);
 assert.deepEqual(e.sched.intervals,[1500]);
 e.window.__PP_HIDE_GA_TECHNICAL_LABELS_V1__.refresh();
 assert.equal(e.window.__PP_HIDE_GA_TECHNICAL_LABELS_V1__.hiddenPills,3);
 e.nodes.push(node("GA core: 1.1.3"));
 e.sched.callbacks[0]();
 assert.equal(e.nodes.at(-1).hidden,true,"new async GA badge is hidden");
 assert.equal(e.window.__PP_HIDE_GA_TECHNICAL_LABELS_V1__.hiddenPills,4);
});
test("global GA metadata, status badge and depth help hidden by CSS",()=>{
 const {styles}=makeEnv();
 const css=styles[0].textContent;
 for(const id of ["meta","valid","ppOptimizerDepthDetail","ppOptimizerDepthHelp"])
  assert.match(css,new RegExp("#"+id+"\\{display:none!important\\}"));
});
console.log("GA_TECHNICAL_LABELS_REMOVED_CORE_STATUS_META_DEPTH_HELP_TESTS_PASS");
