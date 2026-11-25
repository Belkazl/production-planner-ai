import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const [stop, html] = process.argv.slice(2).map(path => readFileSync(path, "utf8"));
const native = readFileSync("baselines/2026-10-10/aps-setup-bridge/index.ts","utf8");
const prefix = JSON.parse(native.split("\n").find(line =>
 line.trimStart().startsWith('"window.ppProjectAfterPlan=function(d)') && line.includes("PP_OPT_SAVE_REGRESSION_PREVENTED")).trim());
const transform = vm.runInNewContext(html + ";ppStartOverHtml");
const handler = transform("function ppIncumbentCurrentPlan(){let saved=null;}\n" +
 prefix + "x.lastPlan=d;});};");
const plan = duration => ({ok:true, valid:true, operations:[{}], duration_minutes:duration});
const project = {id:"A",revision:2,lastPlan:plan(100)};
const w = {__ppFreshRestartMode:true,__ppFreshRestartProject:"A"};
const ctx = {window:w, model:{},active:()=>project.id,find:()=>project,
 mutate:(id,fn)=>fn(project),document:{getElementById:()=>null},console:{warn(){}}};
vm.runInNewContext(handler,ctx);
for(const [candidate,expected] of [[16350,16350],[16050,16050],[16020,16020],[16350,16020]]) {
 w.ppProjectAfterPlan(plan(candidate));
 assert.equal(project.lastPlan.duration_minutes,expected);
 assert.equal(w.__ppFreshReferencePlan.duration_minutes,expected);
}
const previous=w.__ppFreshReferencePlan;
w.ppProjectAfterPlan({...plan(5),partial:true});
assert.equal(project.lastPlan,previous);
assert.equal(w.__ppOptimizerCommittedPlan,previous);
const stopCode=stop.slice(stop.indexOf("function acceptedBeforeStop("),stop.indexOf("function restore(plan){"));
const capture=vm.runInNewContext(stopCode+";acceptedBeforeStop",{window:w,key:()=>"duration_minutes",
 valid:p=>p?.valid===true&&!p.partial,localStorage:{getItem:k=>k.includes("active")?"A":JSON.stringify([project])}});
assert.equal(capture(plan(16350)),previous);
w.__ppFreshReferencePlan=null;
assert.equal(capture(plan(16020)),null);
w.__ppFreshRestartMode=false;
assert.equal(capture(plan(16350)).duration_minutes,16020);
assert.equal(capture(plan(15900)).duration_minutes,15900);
console.log("PASS: fresh reset, two improvements, worse and partial results, stop snapshot");
