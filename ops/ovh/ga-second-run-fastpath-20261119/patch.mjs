import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
const root=process.argv[2];if(!root)throw Error("FASTPATH_ROOT_REQUIRED");
const path=resolve(root,"python-ga-upstream.mjs"),s=readFileSync(path,"utf8");
const sha=x=>createHash("sha256").update(x).digest("hex");
if(sha(s)!=="b5b01ed36eac244ad0c5971e444e45ec36fb59340190b2616632ed18125128f5")
 throw Error("FASTPATH_PRODUCTION_SHA_MISMATCH_"+sha(s));
const old=String.raw`      const sameModel=current?.modelKey===modelKey;
      const ownedResult=sameModel&&current?.result&&current.result.valid===true&&
        owned(current.result,model)?current.result:null;
      const verifiedBest=!ownedResult&&sameModel?verifiedAccountBest(current,model):null;
      const clientPlan=args.resume_plan;
      const clientState=args.resume_state;
      let seed=normalizedContinuationSeed(ownedResult||verifiedBest,model,true);
      let source=seed?"owned_plan":null;
      if(!seed&&sameModel&&current?.resume_state){
        seed=normalizedContinuationSeed(current.resume_state,model,false);
        if(seed)source="stored_order_seed";
      }`;
const replacement=String.raw`      const sameModel=current?.modelKey===modelKey;
      const clientPlan=args.resume_plan;
      const clientState=args.resume_state;
      // A completed account-owned GA persists a compact ordering hint. Validate
      // every order against this exact model BEFORE invoking expensive full
      // schedule verification (hundreds of operations and setup rows).
      // The seed score stays untrusted: the worker must recompute the schedule.
      let seed=null,source=null;
      if(!seed&&sameModel&&current?.resume_state){
        seed=normalizedContinuationSeed(current.resume_state,model,false);
        if(seed)source="stored_order_seed";
      }
      if(!seed&&sameModel){
        const ownedResult=current?.result&&current.result.valid===true&&
          owned(current.result,model)?current.result:null;
        const verifiedBest=!ownedResult?verifiedAccountBest(current,model):null;
        seed=normalizedContinuationSeed(ownedResult||verifiedBest,model,true);
        if(seed)source="owned_plan";
      }`;
if(s.split(old).length!==2)throw Error("FASTPATH_ANCHOR_DRIFT");
const next=s.replace(old,replacement);
if(!next.includes("if(!seed&&clientPlan)")||!next.includes("if(!seed&&clientState)")||
 !next.includes("if(!seed)return response({ok:false,error:'continuation_seed_missing_or_invalid'},409)")||
 !next.includes("const r=await call(principal,'/internal/jobs','POST',{model,options:args});"))
 throw Error("FASTPATH_CONTRACT_GUARD_FAILED");
writeFileSync(path,next);
console.log("FASTPATH_READY",JSON.stringify({before:sha(s),after:sha(next),changed:next.length-s.length}));
