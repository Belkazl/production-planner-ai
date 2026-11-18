const assert=require("node:assert/strict");
const vm=require("node:vm");
const fs=require("node:fs");
const path=require("node:path");
const newApp=process.argv[2],oldApp=process.argv[3];
if(!newApp||!oldApp)throw Error("PROGRESS_TEST_REQUIRES_NEW_OLD_ROOT");
const before=fs.readFileSync(path.join(oldApp,"restart-optimizer-ui.js"),"utf8");
const after=fs.readFileSync(path.join(newApp,"restart-optimizer-ui.js"),"utf8");
const marker="\n;(function ppTruthfulSmoothGaPercentV1(){";
const i=after.lastIndexOf(marker);
assert(i>=0,"must install new module");
assert.equal(after.slice(0,i),before,"every previous app byte preserved");
assert.equal(after.split(marker).length,2);
for(const feature of ["ppUnifiedGanttV2","ppStopRestorePreviousPlanV1","__PP_CONTINUATION_SEED_V2__",
"ppAutomaticIntermediatePreviewV1","ppHideGaTechnicalLabelsV1",
"quick:Object.freeze({generations:10,population:12})"])
 assert(after.includes(feature),"preserved "+feature);
const addon=after.slice(i+2);
assert(!addon.includes("/api/"),"never change API or real GA");
assert(!addon.includes("fetch("),"no extra polling");
assert(!addon.includes("localStorage"),"no account state changes");

function createHarness(){
 const observers=[],timers=[];
 class MockObserver{
  constructor(cb){this.cb=cb;this.armed=false;observers.push(this)}
  observe(el,opts){this.armed=true;this.el=el;this.opts=opts}
  disconnect(){this.armed=false}
 }
 class MockButton{
  constructor(){
   this.isConnected=true;this._text="";this.children=[];
   this.classList={running:false,contains:x=>x==="pp-opt-running"&&this.classList.running};
  }
  set textContent(s){this._text=String(s);this.children=[]}
  get textContent(){return this._text+this.children.map(x=>x.textContent||"").join("")}
  querySelector(query){return query===".pp-opt-progress-line"?
   this.children.find(x=>x.className==="pp-opt-progress-line")||null:null}
  appendChild(x){this.children.push(x)}
 }
 const button=new MockButton();
 const document={
  getElementById:name=>name==="opt"?button:null,
  createElement:()=>({className:"",textContent:"",style:{}})
 };
 const timersId=new Map();
 let id=0;
 const context={
  window:{},document,MutationObserver:MockObserver,
  setInterval:(fn,ms)=>{const n=++id;timersId.set(n,{fn,ms});timers.push(n);return n},
  clearInterval:n=>timersId.delete(n)
 };
 vm.createContext(context);
 vm.runInContext(addon,context,{timeout:1000});
 const api=context.window.__PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__;
 const mutate=()=>{
  for(const ob of observers){if(ob.armed&&ob.el===button)ob.cb([])}
 };
 const server=(pct,lang="Оптимизация")=>{
  button.classList.running=true;
  button.textContent=lang+" "+pct+"%";
  button.appendChild({className:"pp-opt-progress-line",textContent:"",style:{width:pct+"%"}});
  mutate();
 };
 const tick=()=>{for(const x of timersId.values())x.fn()};
 const stop=()=>{
  button.classList.running=false;button.textContent="Continue optimization";mutate();tick();
 };
 return {api,button,server,stop,tick,mutate,timersId};
}
{
 const x=createHarness();
 assert.equal(x.api.installed,true);
 assert.equal(x.api.intervalMs,85);
 x.server(10);
 assert.equal(x.api.shown,10);
 assert.equal(x.api.confirmedTarget,10);
 x.server(20);
 assert.equal(x.api.shown,10,"sudden server jump must not jump displayed number");
 assert.equal(x.api.confirmedTarget,20);
 const values=[];
 for(let i=0;i<10;i++){
  x.tick();values.push(x.api.shown);
  assert(x.api.shown<=x.api.confirmedTarget,"must not predict future progress");
 }
 assert.deepEqual(values,[11,12,13,14,15,16,17,18,19,20]);
 assert.equal(x.button.querySelector(".pp-opt-progress-line").style.width,"20%");
 x.server(30);
 for(let i=0;i<5;i++)x.tick();
 assert.equal(x.api.shown,25);
 x.server(22); // old out-of-order poll must never roll back confirmed percent
 assert.equal(x.api.confirmedTarget,30);
 assert.equal(x.api.shown,25);
 for(let i=0;i<10;i++)x.tick();
 assert.equal(x.api.shown,30);
 x.stop();
 assert.equal(x.api.shown,null);
 assert.equal(x.api.confirmedTarget,null);
 x.server(4,"Optimization");
 assert.equal(x.api.shown,4,"Start again restarts at actual server percentage");
 x.server(9,"Optimization");
 x.tick();assert.equal(x.api.shown,5);
 x.api.stop();
 assert.equal(x.timersId.size,0);
 console.log("GA_SMOOTH_PROGRESS_10_THROUGH_20_STOP_CONTINUE_RESTART_NO_OVERSHOOT_PASS");
}
{
 const x=createHarness();
 x.server(47,"Optimization");
 assert.equal(x.api.shown,47,"page reload reconnect should start from server truth");
 x.server(60,"Optimization");
 assert.equal(x.api.shown,47);
 for(let i=0;i<13;i++)x.tick();
 assert.equal(x.api.shown,60);
 assert.equal(x.api.serverUpdates,1);
 console.log("GA_SMOOTH_PROGRESS_ENGLISH_RECONNECT_AND_SERVER_TRUTH_PASS");
}
console.log("GA_SMOOTH_PROGRESS_NO_API_CHANGES_AND_QA_DONE");