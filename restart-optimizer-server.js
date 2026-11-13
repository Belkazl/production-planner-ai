// Authenticated, session-scoped "start optimization from scratch".
// Reset is intentionally in memory: it never touches projects, orders or saved plans.
const ppFreshGenerationSessions=new Map();
let ppFreshGenerationEpoch=0;
function ppFreshSession(req){
 const s=ppFreshGenerationSessions.get(ppSecureSessionKey(req));
 if(!s)return null;
 if(Date.now()-s.created>12*3600000){ppFreshGenerationSessions.delete(ppSecureSessionKey(req));return null}
 return s;
}
async function ppResetOptimizer(req){
 const key=ppSecureSessionKey(req);
 const run=ppActiveObjectiveRuns.get(key);
 if(run&&!run.completed&&!run.stopRequested)
  return jsonifyBridge({ok:false,error:"optimization_running_stop_first"},409);
 const model=await loadModel(req);
 if(!model||!(model.orders||[]).length)
  return jsonifyBridge({ok:false,error:"model_not_ready"},409);
 ppActiveObjectiveRuns.delete(key);
 // All global final/progress caches are disabled by auth-bridge. No storage mutation.
 const epoch=++ppFreshGenerationEpoch;
 ppFreshGenerationSessions.set(key,{
  epoch,created:Date.now(),modelKey:modelSignature(model),
  runs:0,total:0,awaitingRun:true
 });
 if(ppFreshGenerationSessions.size>64)ppFreshGenerationSessions.delete(ppFreshGenerationSessions.keys().next().value);
 console.log("APS_FRESH_OPTIMIZER_RESET",JSON.stringify({epoch,orders:model.orders.length}));
 return jsonifyBridge({ok:true,reset:true,run:0,total_generations:0,baseline:null});
}
function ppFreshPlanResult(req,state,result){
 const session=ppFreshSession(req);
 if(!session||!state||session.epoch!==state.freshEpoch||
    session.modelKey!==state.modelKey||
    !result?.ok||result.valid===false||result.partial||
    !(result.operations||[]).length)return result;
 session.runs++;
 // Count generations actually reported by the completed pass. Never assume 240
 // after changing GA's computation budget. Keep a legacy fallback for old APIs.
 const counts=[Number(result.generations),Number(state.lastProgressTotal)].filter(n=>Number.isFinite(n)&&n>0&&n<1000000);
 const executed=counts.length?Math.round(Math.max(...counts)):240;
 session.total+=executed;
 const fresh={...result,
  optimization_run:session.runs,
  total_generations:session.total,
  pp_fresh_baseline:session.runs===1,
  pp_fresh_run_epoch:session.epoch
 };
 console.log("APS_FRESH_OPTIMIZER_RESULT",JSON.stringify({
  epoch:session.epoch,run:session.runs,total:session.total,
  baseline:session.runs===1,score:fresh.duration_minutes
 }));
 return fresh;
}
