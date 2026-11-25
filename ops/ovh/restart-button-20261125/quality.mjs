import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const sha=s=>createHash('sha256').update(s).digest('hex');
function once(src,old,next,label){assert.equal(src.split(old).length,2,'QUALITY_SOURCE_DRIFT_'+label);return src.replace(old,next)}
export const sameConstraints=(a,b)=>!!a&&!!b&&typeof a.model_key==='string'&&a.model_key===b.model_key&&a.pin_key===b.pin_key;
export const compareNative=(candidate,prior,objective)=>{
 const keys={duration:'duration_minutes',wait:'operator_wait_minutes',idle:'machine_idle_minutes',cycles:'batch_count'};
 const key=keys[objective];if(!key)return false;
 const a=candidate?.[key],b=prior?.[key];
 if(!Number.isFinite(a)||!Number.isFinite(b))return false;
 return a>b+1e-7*Math.max(1,Math.abs(a),Math.abs(b));
};
export function keepNativeIncumbent(candidate,prior,objective,modelKey,owns){
 if(!candidate||!prior||candidate===prior||candidate.valid!==true||prior.valid!==true||
    candidate.partial===true||prior.partial===true||!owns(prior))return candidate;
 const a=candidate._pp_native_schedule_v1,b=prior._pp_native_schedule_v1;
 if(a?.version!=='integrated-native-setup-v1-20261125'||b?.version!==a.version||
    a.context?.model_key!==modelKey||b.context?.model_key!==modelKey||
    !sameConstraints(a.context,b.context)||!compareNative(candidate,prior,objective))return candidate;
 // Preserve the exact schedule and its matching compact native state.
 // Only attempt counters come from the newly completed search.
 const retained={...prior,ok:true,optimization_previous_best_preserved:true,
   optimization_termination_reason:'new_search_no_objective_improvement'};
 for(const key of ['optimization_run','total_generations','generations','population','runtime_ms'])
   if(Number.isFinite(candidate[key]))retained[key]=candidate[key];
 return retained;
}
export function patchQualityUpstream(src){
 const anchor='  async function fetchUpstream(req,opts){';
 // Function source is injected inside the account-owned adapter. The client
 // supplies only a genome hint, never a trusted score or finished schedule.
 const helper=sameConstraints.toString(); // arrow functions need named declarations
 const code='  const sameConstraints='+helper+';\n  const compareNative='+compareNative.toString()+';\n  '+keepNativeIncumbent.toString()+'\n';
 let next=once(src,anchor,code+anchor,'upstream_helpers');
 const stateNeedle="      state={id:r.body.job_id,modelKey,state:'queued',began:now(),best:null,";
 const statePrefix="      const previousResult=continuing&&current?.state==='completed'&&current.modelKey===modelKey?current.result:null;\n"+
 "      const requestedGenome=normalizeBatchGenome(args.resume_plan?.batch_genome||args.resume_state?.batch_genome,model);\n"+
 "      const previousGenome=normalizeBatchGenome(previousResult?.batch_genome||previousResult?.resume_state?.batch_genome,model);\n"+
 "      const continuationFloor=previousResult&&requestedGenome&&previousGenome&&JSON.stringify(requestedGenome)===JSON.stringify(previousGenome)?previousResult:null;\n";
 next=once(next,stateNeedle,statePrefix+stateNeedle,'job_floor');
 const resultNeedle="      state.best=finalPlan;state.result=finalPlan;";
 const resultPrefix="      const objective=finalPlan?._pp_native_schedule_v1?.context?.objective||'duration';\n"+
 "      const retained=keepNativeIncumbent(keepNativeIncumbent(finalPlan,state.continuationFloor,objective,state.modelKey,p=>owned(p,model)),state.best,objective,state.modelKey,p=>owned(p,model));\n"+
 "      state.best=retained;state.result=retained;";
 next=once(next,resultNeedle,resultPrefix,'native_final');
 // Keep the resume checkpoint and the returned schedule paired.
 next=once(next,"state.resume_state=finalPlan?.resume_state||null;","state.resume_state=retained?.resume_state||null;",'resume');
 const initNeedle="      jobs.set(principal,state);";
 next=once(next,initNeedle,"      state.continuationFloor=continuationFloor;\n"+initNeedle,'remember_floor');
 return next;
}
export function patchQualityUi(src){
 assert.equal(sha(src),'f63adeb046a2b279662129e62fb7da4c2794759cca73253afb952f2e8a8feada','QUALITY_UI_HASH');
 let next=src;
 const oldChoices=[
 "    return (fresh ? [window.__ppFreshReferencePlan] : [project.lastPlan, window.__ppOptimizerCommittedPlan,",
 "      window.__ppFreshRestartProject === project.id ? window.__ppFreshDisplayBaseline : null])",
 "      .filter(plan => plan && (plan._revision == null || Number(plan._revision) === Number(project.revision)));"
 ].join('\n');
 const newChoices=[
 "    const eligible = plan => plan && plan.valid === true && plan.partial !== true &&",
 "      (plan._revision == null || Number(plan._revision) === Number(project.revision));",
 "    // Compare to the current accepted plan, not the first result of this search.",
 "    const selected = window.__ppOptimizerCommittedPlan;",
 "    if (eligible(selected)) return [selected];",
 "    return (fresh ? [window.__ppFreshReferencePlan] : [project.lastPlan]).filter(eligible);"
 ].join('\n');
 next=once(next,oldChoices,newChoices,'selected_floor');
 const oldMatch="    JSON.stringify(contextOf(prior._pp_native_schedule_v1.context)) === JSON.stringify(context));";
 const newMatch="    (()=>{const old=contextOf(prior._pp_native_schedule_v1.context);return !!old&&!!context&&old.model_key===context.model_key&&old.pin_key===context.pin_key})());";
 next=once(next,oldMatch,newMatch,'constraint_context');
 const oldSuper="    JSON.stringify(plan._pp_native_schedule_v1.context) !== JSON.stringify(previous._pp_native_schedule_v1.context));";
 const newSuper="    plan._pp_native_schedule_v1.context.model_key !== previous._pp_native_schedule_v1.context.model_key ||\n    plan._pp_native_schedule_v1.context.pin_key !== previous._pp_native_schedule_v1.context.pin_key);";
 next=once(next,oldSuper,newSuper,'supersedes');
 // Native plans may contain valid order-less setup operations.
 const oldOwned="if(ops.some(op=>!op||op.order==null||!orders.has(String(op.order))||";
 const newOwned="if(ops.some(op=>!op||((op.order??op.order_id)==null?!(op.is_setup===true||String(op.phase||op.type||'').toLowerCase()==='setup'):!orders.has(String(op.order??op.order_id)))||";
 next=once(next,oldOwned,newOwned,'setup_ownership');
 const oldFresh="const currentFreshPlan=window.__ppFreshReferencePlan;";
 next=once(next,oldFresh,"const currentFreshPlan=window.__ppOptimizerCommittedPlan||window.__ppFreshReferencePlan;",'fresh_floor');
 new vm.Script(next);
 return next;
}
export function patchQualityHtml(src){
 assert.equal(sha(src),'4b575f08dcdb2f232e545c65dae5fb993493c11ef74c7d81e23ef1b008f40a1d','QUALITY_HTML_HASH');
 const from="return window.__ppFreshReferencePlan||null;let saved=null;";
 const to="return window.__ppOptimizerCommittedPlan||window.__ppFreshReferencePlan||null;let saved=null;";
 const next=once(src,from,to,'native_incumbent');
 new vm.Script(next);return next;
}
