import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
const root=process.argv[2];if(!root)throw Error("GA_CONTINUE_PATCH_DIR_REQUIRED");
const sha=s=>createHash("sha256").update(s).digest("hex");
const backend=resolve(root,"python-ga-upstream.mjs");
const worker=resolve(root,"ga_workers/full_runtime_adapter.py");
let s=readFileSync(backend,"utf8");
if(sha(s)!=="b5b01ed36eac244ad0c5971e444e45ec36fb59340190b2616632ed18125128f5")
 throw Error("GA_CONTINUE_BACKEND_PRODUCTION_SHA_MISMATCH_"+sha(s));
const a="      const sameModel=current?.modelKey===modelKey;";
const b='      console.warn("PP_GA_RESUME_SAFE_ORDER_SEED",source);';
if(s.split(a).length!==2||s.split(b).length!==2)throw Error("GA_CONTINUE_BACKEND_ANCHORS_CHANGED");
const first=s.indexOf(a),last=s.indexOf(b,first)+b.length;
const replacement="      const sameModel=current?.modelKey===modelKey;\n      // The completed plan was validated against this authenticated account\n      // when persisted. Extract a compact ORDER SEQUENCE only; never run\n      // expensive full-schedule validators on the POST critical path.\n      // The Python worker independently checks model and locks, then builds\n      // a completely new schedule. No previous result is returned as new.\n      const ownedResult=sameModel&&current?.state==='completed'&&current?.result?.valid===true?\n        compactResumePlan(current.result):null;\n      const verifiedBest=!ownedResult&&sameModel&&current?.best?._pp_verified_checkpoint_v1===true?\n        compactResumePlan(current.best):null;\n      const clientPlan=args.resume_plan;\n      const clientState=args.resume_state;\n      let seed=normalizedContinuationSeed(ownedResult||verifiedBest,model,true);\n      let source=seed?\"owned_plan\":null;\n      if(!seed&&sameModel&&current?.resume_state){\n        seed=normalizedContinuationSeed(current.resume_state,model,false);\n        if(seed)source=\"same_account_resume_order\";\n      }\n      if(!seed&&clientPlan){\n        seed=normalizedContinuationSeed(clientPlan,model,false);\n        if(seed)source=\"client_order_hint\";\n      }\n      if(!seed&&clientState){\n        seed=normalizedContinuationSeed(clientState,model,false);\n        if(seed)source=\"client_state_order_hint\";\n      }\n      delete args.resume_state;\n      delete args.resume_plan;\n      if(!seed)return response({ok:false,error:'continuation_seed_missing_or_invalid'},409);\n      args.resume_plan=seed;\n      console.warn(\"PP_GA_RESUME_SAFE_ORDER_SEED\",source);";
s=s.slice(0,first)+replacement+s.slice(last);
const finished="return response({ok:true,running:false,success:true,done:100,total:100,percent:100,phase:'completed',";
const ongoing="return response({ok:true,running,stage,success:status.status==='completed',done:pct,total:100,";
if(s.split(finished).length!==2||s.split(ongoing).length!==2)
 throw Error("GA_CONTINUE_JOB_ID_RESPONSE_ANCHORS_CHANGED");
s=s.replace(finished,"return response({ok:true,job_id:state.id,running:false,success:true,done:100,total:100,percent:100,phase:'completed',");
s=s.replace(ongoing,"return response({ok:true,job_id:state.id,running,stage,success:status.status==='completed',done:pct,total:100,");
if(s.includes("owned(current.result,model)"))throw Error("OLD_HEAVY_REVALIDATION_SURVIVED");
writeFileSync(backend,s);
let py=readFileSync(worker,"utf8");
const oldPy="    if continuing:\n        try:load_resume_state(opts.get('resume_state'),normalized,objective,pins,ga)\n        except ContinuationError as ex:raise FullGAError(str(ex)) from ex";
const newPy="    if continuing:\n        # The account bridge sends an order hint, never a trusted finished\n        # schedule. Bind it to this worker's own normalized model and locks.\n        native_state=opts.get('resume_state')\n        try:\n            if not isinstance(native_state,dict) or native_state.get('version') != 1:\n                raise ContinuationError('continuation_native_state_absent')\n            load_resume_state(native_state,normalized,objective,pins,ga)\n        except ContinuationError as original_error:\n            hint=opts.get('resume_plan')\n            sequence=hint.get('order_sequence') if isinstance(hint,dict) else None\n            ids=[str(x.get('id')) for x in normalized.get('orders') or []]\n            if (not isinstance(sequence,list) or not ids or\n                len(sequence)!=len(ids) or len(set(ids))!=len(ids) or\n                len(set(map(str,sequence)))!=len(ids) or\n                set(map(str,sequence))!=set(ids)):\n                raise FullGAError('continuation_order_seed_missing_or_invalid') from original_error\n            from .continuation import fingerprint\n            portable={\n                'version':1,'model_hash':fingerprint(normalized),\n                'pin_hash':fingerprint(pins or []),'objective':objective,\n                'order_sequence':[str(x) for x in sequence],\n                'completed_runs':1,'total_trials':0,\n                # Never trust old or client-provided scores.\n                'best_duration_minutes':1000000000.0\n            }\n            try:load_resume_state(portable,normalized,objective,pins,ga)\n            except ContinuationError as ex:raise FullGAError(str(ex)) from ex";
if(py.split(oldPy).length!==2)throw Error("GA_CONTINUE_PYTHON_WORKER_ANCHOR_DRIFT");
py=py.replace(oldPy,newPy);
if(!py.includes("portable={")||!py.includes("load_resume_state(portable,normalized,objective,pins,ga)"))
 throw Error("GA_CONTINUE_PYTHON_PATCH_GUARD_FAILED");
writeFileSync(worker,py);

console.log("GA_CONTINUE_PATCH_READY",JSON.stringify({upstreamSha:sha(s),workerSha:sha(py),workerDelta:newPy.length-oldPy.length}));
