import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
const root=process.argv[2];if(!root)throw Error("GA_CHECKPOINT_PATCH_ROOT_REQUIRED");
const file=resolve(root,"python-ga-upstream.mjs");
let source=readFileSync(file,"utf8");
const before=[
 '    // Do not rewrite a potentially large preview into PostgreSQL on every',
 '    // progress poll. A new job is saved synchronously before its HTTP 202;',
 '    // during an active job persist at most every 2 seconds, and always on',
 '    // a terminal state. A failed required save still fails closed.',
 '    const terminal=!["queued","running"].includes(state.state);',
 '    const stamp=now();',
 '    if(terminal||!state.lastPersistedAt||stamp-state.lastPersistedAt>=2000){',
 '      try{await save(principal,state);state.lastPersistedAt=stamp}',
 '      catch{return response({ok:false,error:"ga_state_unavailable"},503)}',
 '    }'
].join("\n");
const after=[
 '    // Persist a real change in GA progress or incumbent, never a duplicate',
 '    // multi-megabyte JSONB checkpoint on every browser status request.',
 '    // The active job remains readable from its account-owned worker; a',
 '    // terminal result and explicit Stop are ALWAYS saved synchronously.',
 '    const terminal=!["queued","running"].includes(state.state);',
 '    const stamp=now();',
 '    const best=state.best;',
 '    const marker=[best?.duration_minutes,best?.operations?.length,',
 '      best?.total_generations,best?.optimization_run].join("|");',
 '    const changed=state.progress!==state.lastPersistedProgress||',
 '      state.state!==state.lastPersistedState||',
 '      marker!==state.lastPersistedBestMarker;',
 '    const due=stamp-(state.lastPersistedAt||0);',
 '    if(terminal||!state.lastPersistedAt||',
 '       (changed&&due>=12000)||due>=30000){',
 '      try{',
 '        await save(principal,state);',
 '        state.lastPersistedAt=stamp;',
 '        state.lastPersistedProgress=state.progress;',
 '        state.lastPersistedState=state.state;',
 '        state.lastPersistedBestMarker=marker;',
 '      }catch{return response({ok:false,error:"ga_state_unavailable"},503)}',
 '    }'
].join("\n");
if(source.split(before).length!==2)throw Error("GA_CHECKPOINT_SOURCE_ANCHOR_DRIFT");
for(const guard of [
 "if(status.status==='completed'){",
 "await save(principal,state);",
 "async function progress(req){",
 "const rememberWorkerBest =",
 "ga_state_unavailable",
 "account_plan_mismatch"
])if(!source.includes(guard))throw Error("GA_CHECKPOINT_REQUIRED_GUARD_MISSING_"+guard);
if(source.includes("state.lastPersistedBestMarker"))throw Error("GA_CHECKPOINT_ALREADY_INSTALLED");
source=source.replace(before,after);
writeFileSync(file,source);
console.log("GA_PROGRESS_DB_CHECKPOINT_THROTTLE_PATCHED");
