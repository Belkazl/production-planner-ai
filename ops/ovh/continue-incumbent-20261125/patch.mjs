import assert from "node:assert/strict";
import {readFileSync, writeFileSync} from "node:fs";

// The HTML transform runs against the native project manager served after login.
function replaceOnce(text, before, after) {
  assert.equal(text.split(before).length, 2, "unexpected runtime source: " + before);
  return text.replace(before, () => after);
}
const [stopFile, htmlFile, stopTarget, htmlTarget] = process.argv.slice(2);
let html = readFileSync(htmlFile, "utf8");
const fresh = "window.__ppFreshRestartMode===true&&window.__ppFreshRestartProject===id";
const oldSelection = "const entry=find(id),prev=entry&&entry.lastPlan;if(" + fresh +
  "&&!window.__ppFreshReferencePlan&&d&&d.valid!==false&&(d.operations||d.generic_operations||[]).length){window.__ppFreshReferencePlan=d;window.__ppFreshReferenceProject=id}const goal=";
html = replaceOnce(html, oldSelection,
  "const entry=find(id),freshRun=" + fresh + ",prev=freshRun?window.__ppFreshReferencePlan:entry&&entry.lastPlan;const goal=");
html = replaceOnce(html, "if(!(" + fresh + ")&&prev&&prev.valid!==false", "if(prev&&prev.valid!==false");
// Capture the new reference inside the accepted branch of the native save guard.
const guard = ' if(!html.includes("window.__ppFreshReferencePlan=d")';
html = replaceOnce(html, guard, ` const saveStart=html.indexOf("window.ppProjectAfterPlan=function(d){");
 const select=html.indexOf("const entry=find(id),freshRun=",saveStart);
 const reject=html.indexOf("PP_OPT_SAVE_REGRESSION_PREVENTED",select);
 const save=html.indexOf("mutate(id,x=>{",reject);
 if(saveStart<0||select<0||reject<0||save<0||save-reject>1200)throw Error("CONTINUE_SAVE_SOURCE_CHANGED");
 const capture="if(freshRun&&d?.ok&&d.valid===true&&!d.partial&&(d.operations?.length||d.generic_operations?.length)&&Number.isFinite(d[key])){window.__ppFreshReferencePlan=d;window.__ppFreshReferenceProject=id;}";
 html=html.slice(0,save)+capture+html.slice(save);
` + guard);
let stop = readFileSync(stopFile, "utf8");
const anchor = "function restore(plan){";
stop = replaceOnce(stop, anchor, `function acceptedBeforeStop(fallback){
 const id=localStorage.getItem("prodplan.project.active.v2");
 const fresh=window.__ppFreshRestartMode===true&&window.__ppFreshRestartProject===id;
 let project;
 try{project=JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]").find(p=>p.id===id)}catch(_){}
 if(!project)return fresh?null:fallback;
 const accepted=fresh?window.__ppFreshReferencePlan:project.lastPlan;
 if(!valid(accepted)||accepted.valid!==true||
    Number(accepted._revision??project.revision)!==Number(project.revision))return fresh?null:fallback;
 if(fresh||!valid(fallback)||Number(accepted[key()])<=Number(fallback[key()]))return accepted;
 return fallback;
}
` + anchor);
const snapshot = /prevPlan=(window\.__ppOptimizerCommittedPlan\|\|window\.__ppTabPlan(?:\|\|window\.__ppFreshDisplayBaseline)?\|\|null);/g;
assert.ok([...stop.matchAll(snapshot)].length >= 1, "missing stop snapshot");
stop = stop.replace(snapshot, "prevPlan=acceptedBeforeStop($1);");
stop = replaceOnce(stop, "function choose(plan){", `function choose(plan){
 if(valid(prevPlan)&&(!valid(plan)||Number(plan[key()])>Number(prevPlan[key()])))plan=prevPlan;`);
writeFileSync(stopTarget,stop);
writeFileSync(htmlTarget,html);
