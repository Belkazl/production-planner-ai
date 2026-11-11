// OVH-only compatibility patch for the PINNED production scheduler bridge.
// The GA worker returns 202 for an accepted asynchronous start. The legacy
// bridge incorrectly normalizes it to 200 and marks its run completed,
// causing the tenant progress gate to return "idle" permanently.
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
const root=resolve(process.argv[2]||"");
if(!root.endsWith("/app"))throw Error("ASYNC_PATCH_EXPECTS_PINNED_APP_TREE");
const target=join(root,"baselines/2026-10-10/aps-setup-bridge/index.ts");
const source=readFileSync(target,"utf8");
const old="const data=await r.json();if(!data?.ok||!data.operations?.length||!(model.setup_rules||[]).length){state.completed=true;return jsonifyBridge(data)}";
const replacement="const data=await r.json();if(r.status===202&&data?.ok===true&&data.started===true)return jsonifyBridge(data,202);if(!data?.ok||!data.operations?.length||!(model.setup_rules||[]).length){state.completed=true;return jsonifyBridge(data)}";
if(source.split(old).length!==2)throw Error("ASYNC_PATCH_SOURCE_ANCHOR_NOT_UNIQUE");
const progressOld="const data=await r.json();if(!data?.ok||!(data.candidate_preview||data.best_preview))return jsonifyBridge(data);";
const progressNew="const data=await r.json();if(data?.ok&&data.running===false&&['completed','cancelled','failed','timed_out','interrupted','stale','invalid'].includes(data.phase)){const run=ppActiveObjectiveRuns.get(ppSecureSessionKey(req));if(run)run.completed=true;}if(!data?.ok||!(data.candidate_preview||data.best_preview))return jsonifyBridge(data);";
if(source.split(progressOld).length!==2)throw Error("ASYNC_PROGRESS_RECONCILE_ANCHOR_NOT_UNIQUE");
const updated=source.replace(old,replacement).replace(progressOld,progressNew);
if(!updated.includes("return jsonifyBridge(data,202)")||!updated.includes("run.completed=true;")||
   !updated.includes("state.completed=true;return jsonifyBridge(data)"))
 throw Error("ASYNC_PATCH_INVARIANTS_FAILED");
writeFileSync(target,updated);
console.log("OVH_ASYNC_GA_HTTP_202_AND_TERMINAL_RUN_STATE_SYNCED");
