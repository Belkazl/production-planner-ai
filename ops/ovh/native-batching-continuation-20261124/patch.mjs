import {readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {selectNativeResumeState, normalizeBatchGenome} from "./continuation.mjs";

const marker = "pp_native_batching_continuation_v1";
const helperAnchor = "  const compactResumePlan = plan => {";
const helper = "  // " + marker + ": opaque worker state; account scope comes from currentJob.\n" +
  normalizeBatchGenome.toString().split("\n").map(line => "  " + line).join("\n") + "\n" +
  selectNativeResumeState.toString().split("\n").map(line => "  " + line).join("\n") + "\n";
const oldBlock = String.raw`      const sameModel=current?.modelKey===modelKey;
      // First use the already compact order hint sent by this authenticated
      // account's existing Continue button. Validate all IDs against its
      // current model and never accept a stale score or schedule as output.
      // Crucially no prior 800+ operation plan is touched on the common path.
      const clientPlan=args.resume_plan;
      const clientState=args.resume_state;
      let seed=null,source=null;
      if(!seed&&clientPlan){
        seed=normalizedContinuationSeed(clientPlan,model,false);
        if(seed)source="client_order_hint";
      }
      if(!seed&&sameModel&&current?.resume_state){
        seed=normalizedContinuationSeed(current.resume_state,model,false);
        if(seed)source="same_account_resume_order";
      }
      if(!seed&&clientState){
        seed=normalizedContinuationSeed(clientState,model,false);
        if(seed)source="client_state_order_hint";
      }
      // Older browsers may not send a usable compact order. For those only,
      // derive the order from a previously validated same-account/model result.
      // Never recompute full ownership / setup constraints in this POST;
      // all rows and locks are revalidated in the fresh Python worker.
      if(!seed&&sameModel){
        const ownedResult=current?.state==='completed'&&current?.result?.valid===true?
          compactResumePlan(current.result):null;
        const verifiedBest=!ownedResult&&current?.best?._pp_verified_checkpoint_v1===true?
          compactResumePlan(current.best):null;
        seed=normalizedContinuationSeed(ownedResult||verifiedBest,model,true);
        if(seed)source="same_account_completed_order";
      }
      delete args.resume_state;
      delete args.resume_plan;
      if(!seed)return response({ok:false,error:'continuation_seed_missing_or_invalid'},409);
      args.resume_plan=seed;
      console.warn("PP_GA_RESUME_SAFE_ORDER_SEED",source);`;
const newBlock = String.raw`      const sameModel=current?.modelKey===modelKey;
      // The account-owned server state takes priority over a browser's order
      // hint. The worker validates the untouched normalized model/pin hashes
      // and native schema before restoring any batch genes or cached score.
      const clientPlan=args.resume_plan;
      const clientState=args.resume_state;
      const hasSelectedGenome=!!clientPlan&&Object.hasOwn(clientPlan,'batch_genome');
      const selectedGenome=hasSelectedGenome?normalizeBatchGenome(clientPlan.batch_genome,model):null;
      if(hasSelectedGenome&&!selectedGenome)
        return response({ok:false,error:'continuation_batch_seed_invalid'},409);
      const nativeCandidate=selectNativeResumeState(current,modelKey,args.objective||'duration');
      const nativeOrder=nativeCandidate?normalizedContinuationSeed(nativeCandidate,model,false):null;
      const selectedOrder=selectedGenome?normalizedContinuationSeed({order_sequence:selectedGenome.order_sequence},model,false):
        clientPlan?normalizedContinuationSeed(clientPlan,model,false):null;
      if(selectedGenome&&Array.isArray(clientPlan.order_sequence)&&
          JSON.stringify(clientPlan.order_sequence)!==JSON.stringify(selectedGenome.order_sequence))
        return response({ok:false,error:'continuation_batch_seed_order_mismatch'},409);
      // An explicit selected ordering must not silently resume a different
      // server checkpoint. The fallback carries only the selected order.
      const nativeGenome=selectedGenome&&nativeCandidate?normalizeBatchGenome(nativeCandidate.batch_genome,model):null;
      const matchesSelection=(!selectedOrder||(nativeOrder&&
        JSON.stringify(nativeOrder.order_sequence)===JSON.stringify(selectedOrder.order_sequence)))&&
        (!selectedGenome||(nativeGenome&&JSON.stringify(nativeGenome)===JSON.stringify(selectedGenome)));
      const nativeState=matchesSelection?nativeCandidate:null;
      let seed=nativeState?nativeOrder:null;
      let source=nativeState?"same_account_native_state":null;
      if(selectedGenome&&!nativeState){seed=selectedOrder;source="selected_unscored_batch_seed";}
      if(!seed&&clientPlan){
        seed=normalizedContinuationSeed(clientPlan,model,false);
        if(seed&&!nativeState)source="client_order_hint";
      }
      if(!seed&&sameModel&&current?.resume_state){
        seed=normalizedContinuationSeed(current.resume_state,model,false);
        if(seed&&!nativeState)source="same_account_resume_order";
      }
      if(!seed&&clientState){
        seed=normalizedContinuationSeed(clientState,model,false);
        if(seed&&!nativeState)source="client_state_order_hint";
      }
      // Older browsers may not send a usable compact order. For those only,
      // derive the order from a previously validated same-account/model result.
      // Never recompute full ownership / setup constraints in this POST;
      // all rows and locks are revalidated in the fresh Python worker.
      if(!seed&&!nativeState&&sameModel){
        const ownedResult=current?.state==='completed'&&current?.result?.valid===true?
          compactResumePlan(current.result):null;
        const verifiedBest=!ownedResult&&current?.best?._pp_verified_checkpoint_v1===true?
          compactResumePlan(current.best):null;
        seed=normalizedContinuationSeed(ownedResult||verifiedBest,model,true);
        if(seed)source="same_account_completed_order";
      }
      delete args.resume_state;
      delete args.resume_plan;
      if(!seed&&!nativeState)return response({ok:false,error:'continuation_seed_missing_or_invalid'},409);
      if(nativeState)args.resume_state=nativeState;
      // Separate order-only fallback for old schemas or changed native hashes.
      // No batch fields or historical score are copied into this portable hint.
      if(selectedGenome)args.resume_plan={order_sequence:selectedGenome.order_sequence,batch_genome:selectedGenome};
      else if(seed)args.resume_plan=seed;
      console.warn(nativeState?"PP_GA_RESUME_COMPACT_NATIVE_STATE":"PP_GA_RESUME_SAFE_ORDER_SEED",source);`;

function once(source, before, after, label) {
  if (source.split(before).length !== 2) throw Error("NATIVE_CONTINUATION_SOURCE_DRIFT_" + label);
  return source.replace(before, after);
}

export function patchUpstream(source) {
  for (const guard of [
    "principal=await account(req);model=await readAccountModel(req)",
    "current=await currentJob(principal)", "const modelKey=hashModel(model);",
    "stateStore.load(principal)", "'x-authenticated-account':principal",
    "const normalizedContinuationSeed=", "continuation_seed_missing_or_invalid"
  ]) if (!source.includes(guard)) throw Error("NATIVE_CONTINUATION_REQUIRED_GUARD_" + guard);
  if (source.includes(marker)) {
    if (source.split(helper).length !== 2 || source.split(newBlock).length !== 2 || source.includes(oldBlock))
      throw Error("NATIVE_CONTINUATION_INSTALLED_SOURCE_DRIFT");
    return source;
  }
  source = once(source, oldBlock, newBlock, "continue_v2_block");
  return once(source, helperAnchor, helper + helperAnchor, "compact_helper");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw Error("NATIVE_CONTINUATION_APP_ROOT_REQUIRED");
  const path = resolve(process.argv[2], "python-ga-upstream.mjs");
  const before = readFileSync(path, "utf8"), after = patchUpstream(before);
  if (after !== before) writeFileSync(path, after);
  console.log("NATIVE_BATCHING_CONTINUATION_PATCHED", createHash("sha256").update(after).digest("hex"));
}
