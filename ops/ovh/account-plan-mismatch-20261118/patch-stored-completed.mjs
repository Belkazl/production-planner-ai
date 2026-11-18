import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
const root=process.argv[2];if(!root)throw Error("RECOVER_COMPLETED_PLAN_ROOT_REQUIRED");
const path=resolve(root,"python-ga-upstream.mjs");
let s=readFileSync(path,"utf8");
if(!s.includes("const qaOwnTrace=")||!s.includes("const verifiedWorkerCheckpoint = (raw,model)"))throw Error("OWNERSHIP_TRACE_AND_GUARDS_MISSING");
const old="if(!owned(state.result,model))return response({ok:false,error:'account_plan_mismatch',diagnostic:qaTraceIfRequested(req,qaOwnTrace(state,model,state.result,'stored_completed'))},409);";
const next=`if(!owned(state.result,model)){
        // A persisted completed state can contain only a GA result summary.
        // Never trust that incomplete object or a client-provided schedule.
        // Recover using this same authenticated account's original private
        // worker job and independently revalidate every operation/resource.
        let recovered=null;
        const detail={workerReachable:false,workerCompleted:false,bestRows:0,finalRows:0,
          bestVerified:false,finalVerified:false};
        try{
          const r=await call(principal,'/internal/jobs/'+state.id);
          detail.workerReachable=r.status===200;
          if(r.status===200&&r.body?.status==='completed'){
            detail.workerCompleted=true;
            detail.bestRows=r.body.best_preview?.operations?.length||0;
            detail.finalRows=r.body.result?.operations?.length||0;
            const realBest=verifiedWorkerCheckpoint(r.body.best_preview,model);
            const realFinal=verifiedWorkerCheckpoint(r.body.result,model);
            detail.bestVerified=!!realBest;detail.finalVerified=!!realFinal;
            recovered=realFinal&&(!realBest||!setupOperationsDropped(realFinal,realBest,model))
              ?realFinal:realBest;
          }
        }catch{detail.workerUnavailable=true}
        state._qa_recovery=detail;
        if(!recovered){
          return response({ok:false,error:'account_plan_mismatch',
            diagnostic:qaTraceIfRequested(req,{...qaOwnTrace(state,model,state.result,'stored_completed'),recovery:detail})},409);
        }
        const restored=restoreOwnedBest(recovered,'persisted_completed_plan_reverified');
        state.result=publicPlan(restored);
        state.best=state.result;
        state.resume_state=state.result.resume_state||null;
        state.progress=100;
        state.error=null;
        await save(principal,state);
      }`;
if(s.split(old).length!==2)throw Error("EXACT_COMPLETED_OWNERSHIP_ANCHOR_CHANGED");
s=s.replace(old,next);
writeFileSync(path,s);
console.log("GA_STORED_COMPLETED_RECOVERY_REVERIFY_SAME_JOB_PATCHED");
