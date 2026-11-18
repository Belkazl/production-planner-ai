const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const newer=process.argv[2],older=process.argv[3];
if(!newer||!older)throw Error("SMOOTH_GA_TEST_NEEDS_OLD_AND_NEW_APP");
const name="restart-optimizer-ui.js";
const before=fs.readFileSync(path.resolve(older,name),"utf8");
const after=fs.readFileSync(path.resolve(newer,name),"utf8");
const marker="\n;(function ppSmoothVerifiedProgressV1(){";
const pos=after.lastIndexOf(marker);
assert(pos>0,"new verified-progress hook attached");
assert.equal(after.slice(0,pos),before,"original production UI completely preserved");
assert.equal(after.split(marker).length,2,"only one addon");
const addon=after.slice(pos+2);
for(const token of [
 "ppUnifiedGanttV2","ppStopRestorePreviousPlanV1","ppHideGaTechnicalLabelsV1",
 "ppAutomaticIntermediatePreviewV1","__PP_KPI_FIRST_BEST_V1__",
 "__PP_CONTINUATION_SEED_V2__","quick:Object.freeze({generations:10,population:12})"
])assert(after.includes(token),"existing behavior must survive: "+token);
for(const x of ["/api/plan","/api/optimizer-reset","/api/optimizer-stop"])
 assert(!addon.includes(x),"frontend must not change GA HTTP request: "+x);
assert(!addon.includes("fetch("),"does not issue additional heavy progress requests");
assert(addon.includes("mode:\"confirmed-only\""),"cannot invent percent");

function makeButton(label="Start optimization"){
 const text={nodeType:3,nodeValue:label};
 const bar={style:{width:"0%",setProperty(k,v){this[k]=v}}};
 const attributes={};
 const classSet=new Set();
 const button={
  isConnected:true,childNodes:[text],classList:{contains:k=>classSet.has(k)},
  querySelector:key=>key===".pp-opt-progress-line"?bar:null,
  setAttribute:(k,v)=>{attributes[k]=v},
  getAttribute:k=>attributes[k]
 };
 return {button,text,bar,classSet,attributes};
}
function createEnvironment(){
 let current=makeButton(),seq=1;
 const callbacks=new Map(),intervals=new Map(),styles=[],events={};
 const document={
  createElement:tag=>({tag,id:"",textContent:""}),
  head:{appendChild:x=>styles.push(x)},
  documentElement:{},
  getElementById:id=>id==="opt"?current.button:styles.find(x=>x.id===id)||null
 };
 class MutationObserver{
  constructor(onchange){this.onchange=onchange}
  observe(){}
  disconnect(){}
 }
 const context={document,window:{},MutationObserver,
  queueMicrotask:fn=>fn(),
  setInterval:(cb,ms)=>{const id=seq++;intervals.set(id,{cb,ms});return id},
  clearInterval:id=>{intervals.delete(id)},
  console};
 context.window.addEventListener=(name,cb)=>{events[name]=cb};
 vm.createContext(context);
 vm.runInContext(addon,context,{timeout:1000});
 const api=context.window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__;
 assert.equal(api.installed,true);
 const next=(target)=>{
  current.classSet.add("pp-opt-running");
  current.text.nodeValue="Optimization "+target+"%";
  current.bar.style.width=target+"%";
  api.refresh();
  return api.state;
 };
 const runTick=()=>{
  const timers=[...intervals.values()].filter(t=>t.ms===75);
  for(const t of timers)t.cb();
 };
 const all=()=>[...intervals.values()].map(t=>t.ms);
 return {api,styles,all,next,runTick,events,
  current:()=>current,
  changeButton(label){
   current=makeButton(label);
   api.refresh();
  },
  end(){
   current.classSet.delete("pp-opt-running");
   current.text.nodeValue="Continue optimization";
   api.refresh();
  }
 };
}
const env=createEnvironment();
assert.equal(env.api.mode,"confirmed-only");
assert.deepEqual(env.api.state,{active:false,displayed:0,confirmed:0});
assert.deepEqual(env.all(),[550]);
let snap=env.next(10);
assert.equal(snap.displayed,10,"first actual progress is displayed instantly");
assert.equal(snap.confirmed,10);
assert.equal(env.current().text.nodeValue,"Optimization 10%");
snap=env.next(20);
assert.equal(snap.displayed,10,"display lags server without prediction");
assert.equal(snap.confirmed,20,"target is confirmed by server");
assert.equal(env.current().text.nodeValue,"Optimization 10%");
assert.equal(env.current().bar.style.width,"10%");
const seen=[];
for(let i=0;i<7;i++){
 env.runTick();seen.push(env.api.state.displayed);
}
assert.deepEqual(seen,[11,12,13,14,15,16,17],"percent visibly increments by one point");
assert.equal(env.current().attributes["aria-valuenow"],"17");
snap=env.next(30);
assert.equal(snap.confirmed,30);
assert.equal(snap.displayed,17);
for(let i=0;i<20;i++)env.runTick();
assert.equal(env.api.state.displayed,30);
assert.equal(env.current().text.nodeValue,"Optimization 30%");
assert.equal(env.current().bar.style.width,"30%");
snap=env.next(12);
assert.equal(snap.displayed,30,"out-of-order stale poll cannot reduce progress");
assert.equal(snap.confirmed,30);
snap=env.next(99);
for(let i=0;i<150;i++)env.runTick();
assert.equal(env.api.state.displayed,99,"running state cannot claim finished");
assert.equal(env.api.state.confirmed,99);
snap=env.next(100);
assert.equal(snap.confirmed,99,"100% must be controlled by true terminal event");
env.end();
assert.equal(env.api.state.active,false);
assert.deepEqual(env.api.state,{active:false,displayed:0,confirmed:0});
assert.equal(env.current().text.nodeValue,"Continue optimization");
env.changeButton("Optimization 45%");
env.next(45);
assert.equal(env.api.state.displayed,45,"page reload must not animate from fabricated zero");
env.api.dispose();
assert(!env.all().includes(75));
assert(!env.all().includes(550));
assert(env.styles[0].textContent.includes("transition:width 75ms"));
console.log("SMOOTH_GA_CONFIRMED_ONLY_10_TO_11_TO_17_TO_30_AND_RESET_PASS");
console.log("SMOOTH_GA_PRESERVES_GA_STOP_CONTINUE_GANTT_AND_NO_NEW_REQUESTS_PASS");
