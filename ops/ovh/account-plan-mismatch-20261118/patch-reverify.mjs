import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
const root=process.argv[2];
if(!root)throw Error("GA_CHECKPOINT_REVERIFY_APP_ROOT_REQUIRED");
const path=resolve(root,"python-ga-upstream.mjs");
const source=readFileSync(path,"utf8");
const old=`  const verifiedAccountBest = (state,model) => {
    const best=state?.best;
    if(!best||best._pp_verified_checkpoint_v1!==true||
       best.valid!==true||!Array.isArray(best.operations)||!best.operations.length||
       !best.resume_state||typeof best.resume_state!=="object"||
       !owned(best,model))return null;
    return best;
  };`;
const updated=`  const verifiedAccountBest = (state,model) => {
    const best=state?.best;
    // Durable best_preview is worker-supplied and keyed by the authenticated
    // account and exact model hash. A persistence boundary may omit the
    // internal checkpoint attestation: verify ALL physical resource refs again.
    if(!best||state?.modelKey!==hashModel(model)||best.valid!==true||
       !Array.isArray(best.operations)||!best.operations.length)return null;
    const checked=verifiedWorkerCheckpoint(best,model);
    if(!checked)return null;
    if(best._pp_verified_checkpoint_v1!==true)
      console.warn("PP_GA_DURABLE_BEST_CHECKPOINT_REVERIFIED");
    return checked;
  };`;
if(source.split(old).length!==2)throw Error("EXPECTED_REVERIFY_ANCHOR_CHANGED");
for(const marker of ["const verifiedWorkerCheckpoint = (raw,model) =>", "PP_GA_UNOWNED_FINAL_REPLACED_BY_VERIFIED_OWNED_BEST","PP_GA_SYNC_UNOWNED_FINAL_REPLACED_BY_VERIFIED_OWNED_BEST"]){
 if(!source.includes(marker))throw Error("GA_GUARD_DRIFT_"+marker);
}
writeFileSync(path,source.replace(old,updated));
console.log("GA_CHECKPOINT_DURABLE_ACCOUNT_MODEL_STRICT_REVERIFY_PATCHED");
