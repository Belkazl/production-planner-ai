import {readFileSync,writeFileSync} from "node:fs";
let s=readFileSync("ops/ovh/ga-start-recover-20261119/live-regression.mjs","utf8");
const anchor=' const noIntermediate=process.env.FREEZE_TEST_MODE==="no-intermediate";';
if(s.split(anchor).length!==2)throw Error("KPI_PROBE_LIVE_SOURCE_DRIFT");
const before=s.split(anchor)[0];
const probe=[
' const out=await page.evaluate(()=>{',
'  const getSrc=name=>{try{const fn=window[name];return typeof fn==="function"?String(fn).slice(0,7000):typeof fn}catch(e){return String(e)}};',
'  const box=[...document.querySelectorAll("section,div,output")].find(el=>/Key metrics|Ключевые показатели/i.test(el.textContent||"")',
'     &&(el.textContent||"").length<320);',
'  const ids=["dur","cycles","wait","idle","durDelta","cyclesDelta","waitDelta","idleDelta",',
'    "duration","batchCount","operatorWait","machineIdle","metrics","kpi","kpiDur","kpiCycles","kpiWait","kpiIdle"];',
'  const nodes={};',
'  for(const id of ids){const el=document.getElementById(id);if(el)nodes[id]={tag:el.tagName,text:(el.textContent||"").slice(0,160),',
'    parent:el.parentElement?.outerHTML?.slice(0,380)};}',
'  return {source:getSrc("renderKpisWithDelta"),plain:getSrc("renderKpis"),nodes,',
'   samples:box?.outerHTML?.slice(0,4000)||null,',
'   gaReference:window.__PP_KPI_FIRST_BEST_V1__?.snapshot,',
'   sse:window.__PP_SSE_PROGRESS_V1__?.mode,',
'   previewLegacy:window.__PP_OVH_LIVE_PREVIEW_BRIDGE__?.getState?.()};',
' });',
' console.log("NATIVE_KPI_RENDER_PROBE",JSON.stringify(out));',
'} catch(e){',
' console.log("NATIVE_KPI_READONLY_PROBE_FAILED",String(e?.stack||e).slice(0,900));',
' process.exitCode=1;',
'} finally { await browser.close(); }'
].join("\n");
writeFileSync("ops/ovh/sse-interim-kpi-20261120/_readonly-probe.mjs",before+probe);
console.log("SSE_KPI_PROBE_BUILT");
