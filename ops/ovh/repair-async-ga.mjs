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
const updated=source.replace(old,replacement);
if(!updated.includes("return jsonifyBridge(data,202)")||
   !updated.includes("state.completed=true;return jsonifyBridge(data)"))
 throw Error("ASYNC_PATCH_INVARIANTS_FAILED");
writeFileSync(target,updated);
// Restart builder is the last owner of GA progress transformation. Insert
// terminal status reconciliation into its own generated replacement, not
// into the older baseline before restart-builder anchor checks run.
const restart=join(root,"restart-optimizer.ts");
const restartSource=readFileSync(restart,"utf8");
const progressAnchor="const data=await r.json();if(fresh){";
const terminal="const data=await r.json();if(data?.ok&&data.running===false&&[\u0027completed\u0027,\u0027cancelled\u0027,\u0027failed\u0027,\u0027timed_out\u0027,\u0027interrupted\u0027,\u0027stale\u0027,\u0027invalid\u0027].includes(data.phase)){const run=ppActiveObjectiveRuns.get(ppSecureSessionKey(req));if(run)run.completed=true;}if(fresh){";
if(restartSource.split(progressAnchor).length!==2)throw Error("ASYNC_RESTART_PROGRESS_ANCHOR_NOT_UNIQUE");
const freshGuard="(!state.seenRunning&&!data.running))return jsonifyBridge(";
const finishedGuard="(!state.seenRunning&&!data.running&&!data.success))return jsonifyBridge(";
if(restartSource.split(freshGuard).length!==2)throw Error("ASYNC_FRESH_SUCCESS_GUARD_ANCHOR");
const nextRestart=restartSource.replace(progressAnchor,terminal).replace(freshGuard,finishedGuard);
if(!nextRestart.includes("run.completed=true;")||!nextRestart.includes(finishedGuard))
 throw Error("ASYNC_TERMINAL_SYNC_MISSING");
writeFileSync(restart,nextRestart);
console.log("OVH_ASYNC_GA_202_AND_TENANT_TERMINAL_PROGRESS_REPAIRED");
