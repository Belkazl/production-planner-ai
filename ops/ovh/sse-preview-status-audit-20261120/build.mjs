import {readFileSync,writeFileSync} from "node:fs";
let s=readFileSync("ops/ovh/sse-stream-v1-20261120/_live-qa.mjs","utf8");
const anchor=' const epochs=Date.now();';
if(s.split(anchor).length!==2)throw Error("RAW_PREVIEW_QA_INSERTION_DRIFT");
const probe=[
' const summarizeRaw=p=>{',
'  if(!p||typeof p!=="object")return null;',
'  const main=Array.isArray(p.operations)?p.operations:[];',
'  const generic=Array.isArray(p.generic_operations)?p.generic_operations:[];',
'  const detached=Array.isArray(p.setup_operations)?p.setup_operations:[];',
'  const setup=x=>x?.is_setup===true||String(x?.phase||"").toLowerCase()==="setup";',
'  const chosen=(generic.filter(setup).length>main.filter(setup).length?generic:main.length?main:generic);',
'  const full=[...chosen,...detached.filter(x=>!chosen.some(y=>y===x)).map(x=>({...x,is_setup:true}))];',
'  const ownEq=model.equipment||[];',
'  let first=0,earlySetups=0,earlyJobs=0;',
'  for(const eq of ownEq){',
'   const aliases=new Set([eq.id,eq.__ppid,eq.name].filter(x=>x!=null).map(String));',
'   const lane=full.filter(op=>{',
'    let ids=Array.isArray(op.equipment_ids)&&op.equipment_ids.length?op.equipment_ids:',
'      op.equipment_id!=null?[op.equipment_id]:',
'      (op.resources||[]).filter(r=>r?.resource_type==="equipment").map(r=>r.id??r.resource_ref??r.name);',
'    return ids.some(id=>aliases.has(String(id)));',
'   }).sort((a,b)=>Number(a.start_min)-Number(b.start_min));',
'   const firstTen=lane.slice(0,10);',
'   first+=firstTen.length;',
'   earlySetups+=firstTen.filter(setup).length;',
'   earlyJobs+=firstTen.filter(x=>!setup(x)).length;',
'  }',
'  const sample=detached[0]||generic.find(setup)||main.find(setup);',
'  return {native:main.length,generic:generic.length,detached:detached.length,',
'   nativeSetups:main.filter(setup).length,genericSetups:generic.filter(setup).length,',
'   earlySetups,earlyJobs,first,',
'   planSetupCount:p.setup_count??null,changeovers:p.changeovers?.length??null,',
'   setupShape:sample?Object.keys(sample).sort().slice(0,40):[],',
'   startType:typeof sample?.start_min,endType:typeof sample?.end_min,',
'   duration:p.duration_minutes??null,valid:p.valid??null};',
' };',
' for(let sample=0;sample<6;sample++){',
'  try{',
'   const r=await ctx.request.get(base+"/api/plan-progress",{timeout:13000});',
'   const body=await r.json();',
'   console.log("SSE_LIVE_RAW_BEST_CANDIDATE_SETUP_AUDIT",JSON.stringify({',
'    sample,http:r.status(),phase:body.phase,percent:body.percent,',
'    best:summarizeRaw(body.best_preview),candidate:summarizeRaw(body.candidate_preview)',
'   }));',
'  }catch(e){console.log("SSE_LIVE_RAW_SETUP_AUDIT_ERROR",sample,String(e).slice(0,150));}',
'  await page.waitForTimeout(2600);',
' }'
].join("\n");
s=s.replace(anchor,probe+"\n"+anchor);
writeFileSync("ops/ovh/sse-stream-v1-20261120/_raw-preview-qa.mjs",s);
console.log("SSE_READONLY_PREVIEW_STATUS_DIAGNOSTIC_BUILT");
