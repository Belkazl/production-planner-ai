import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
const from=process.argv[2],to=process.argv[3];
if(!from||!to)throw Error("FRESH_GANTT_CLEAR_PATHS_REQUIRED");
let s=readFileSync(from,"utf8");
const old=[
 'function resetVisiblePlan(){',
 " // clearPlan is the original app's reset; it clears all four KPIs and the Gantt.",
 ' try{if(typeof clearPlan==="function")clearPlan()}catch(e){console.warn("PP_FRESH_RESET_GANTT",String(e))}',
 ' for(const id of ["dur","cycles","waitKpi","idleKpi"])setText(id,"—");'
].join("\n");
const next=[
 'function resetVisiblePlan(){',
 " // The native clearPlan resets model/render state, but depending on which",
 ' // Gantt engine was active its DOM bars can remain on screen. Clearing the',
 ' // VISIBLE chart is the only intended effect; never edit Saved plans or inputs.',
 ' try{if(typeof clearPlan==="function")clearPlan()}catch(e){console.warn("PP_FRESH_RESET_GANTT",String(e))}',
 ' const gantt=find("ppGanttToolV2");',
 ' if(gantt){',
 '  for(const stale of gantt.querySelectorAll(".pg2-bar,.pp-sse-fog"))stale.remove();',
 '  gantt.classList.remove("pp-sse-interim");',
 ' }',
 ' for(const id of ["dur","cycles","waitKpi","idleKpi"])setText(id,"—");'
].join("\n");
if(s.split(old).length!==2)throw Error("FRESH_GANTT_CLEAR_LIVE_SOURCE_DRIFT");
for(const x of [
 'window.__ppFreshDisplayBaseline=null;',
 'pp:fresh-gantt-cleared',
 'return accepted||(lastReal?.partial===true?lastReal:null);',
 'window.__PP_KPI_FIRST_BEST_V1__=',
 'function ppOneSseProgressAndGantt(){'
])if(!s.includes(x))throw Error("FRESH_GANTT_CLEAR_GUARD_MISSING_"+x);
s=s.replace(old,next);
if(s.includes(old)||s.split('for(const stale of gantt.querySelectorAll(".pg2-bar,.pp-sse-fog"))stale.remove();').length!==2)
 throw Error("FRESH_GANTT_CLEAR_PATCH_NOT_EXACT");
writeFileSync(to,s);
console.log("FRESH_GANTT_VISIBLE_OPERATION_BARS_CLEAR_PATCH_PASS",JSON.stringify({
 old:createHash("sha256").update(readFileSync(from)).digest("hex"),
 updated:createHash("sha256").update(s).digest("hex")}));
