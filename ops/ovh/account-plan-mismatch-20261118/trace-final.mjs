import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
const root=process.argv[2];if(!root)throw Error("OWNER_TRACE_APP_ROOT_REQUIRED");
const path=resolve(root,"python-ga-upstream.mjs");
let s=readFileSync(path,"utf8");
const put=(from,to)=>{if(s.split(from).length!==2)throw Error("TRACE_ANCHOR_CHANGED_"+from.slice(0,60));s=s.replace(from,to)};
const helper=`  const qaOwnTrace=(state,model,final,stage)=> {
    const checkpoint=state?.best;
    const rows=checkpoint?.generic_operations?.length?checkpoint.generic_operations:(checkpoint?.operations||[]);
    const ownOrders=new Set((model.orders||[]).map(x=>String(x.id)));
    const ownEq=new Set((model.equipment||model.autoclaves||[]).map(x=>String(x.id)));
    const ownEmp=new Set((model.employees||[]).map(x=>String(x.id)));
    const ownMat=new Set((model.materials||[]).map(x=>String(x.id)));
    const nbad=(key,allowed)=>rows.reduce((n,row)=>n+(row?.[key]||[]).filter(id=>!allowed.has(String(id))).length,0);
    const summary={source:"python_ga_bridge",stage,modelVersionMatches:state?.modelKey===hashModel(model),
      checkpointPresent:!!checkpoint,checkpointAttested:checkpoint?._pp_verified_checkpoint_v1===true,
      checkpointOps:checkpoint?.operations?.length||0,
      checkpointOwned:!!(checkpoint&&owned(checkpoint,model)),
      checkpointReverified:!!(checkpoint&&verifiedWorkerCheckpoint(checkpoint,model)),
      checkpointValid:checkpoint?.valid===true,checkpointPartial:checkpoint?.partial===true,
      checkpointRows:rows.length,checkpointUnknownOrders:rows.filter(x=>x?.order==null||!ownOrders.has(String(x.order))).length,
      checkpointUnknownEquipment:nbad("equipment_ids",ownEq),
      checkpointUnknownEmployees:nbad("employee_ids",ownEmp),
      checkpointUnknownMaterials:nbad("material_ids",ownMat),
      checkpointSetupOps:rows.filter(x=>x?.is_setup===true).length,
      checkpointSeedCount:checkpoint?.resume_state?.order_sequence?.length||0,
      terminalPresent:!!final,terminalOps:final?.operations?.length||0,terminalOwned:!!(final&&owned(final,model)),
      terminalValid:final?.valid===true,terminalPartial:final?.partial===true
    };
    return summary;
  };
  const qaTraceIfRequested=(req,trace)=>req.headers.get("x-liftorbit-qa-trace")==="1"?trace:undefined;
`;
put("  async function progress(req){",helper+"  async function progress(req){");
put("if(!owned(state.result,model))return response({ok:false,error:'account_plan_mismatch'},409);",
"if(!owned(state.result,model))return response({ok:false,error:'account_plan_mismatch',diagnostic:qaTraceIfRequested(req,qaOwnTrace(state,model,state.result,'stored_completed'))},409);");
put("if(!verified){state.state='invalid';await save(principal,state);return response({ok:false,error:'account_plan_mismatch'},409)}",
"if(!verified){const qa=qaOwnTrace(state,fresh,selected,'sync_final');state.state='invalid';await save(principal,state);return response({ok:false,error:'account_plan_mismatch',diagnostic:qaTraceIfRequested(req,qa)},409)}");
put(`          state.state='invalid';state.error='account_plan_mismatch';
          await save(principal,state);
          return response({ok:false,error:'account_plan_mismatch'},409);`,
`          const qa=qaOwnTrace(state,model,selected,"async_final");
          state._qa_trace=qa;
          state.state='invalid';state.error='account_plan_mismatch';
          await save(principal,state);
          return response({ok:false,error:'account_plan_mismatch',diagnostic:qaTraceIfRequested(req,qa)},409);`);
put("if(['cancelled','failed','timed_out','interrupted','invalid','stale'].includes(state.state))return response({ok:true,running:false,success:false,done:state.progress||0,total:100,percent:state.progress||0,phase:state.state,best_preview:publicCheckpoint(state.best),candidate_preview:state.candidate||null,result:null,error:state.error||null});",
"if(['cancelled','failed','timed_out','interrupted','invalid','stale'].includes(state.state))return response({ok:true,running:false,success:false,done:state.progress||0,total:100,percent:state.progress||0,phase:state.state,best_preview:publicCheckpoint(state.best),candidate_preview:state.candidate||null,result:null,error:state.error||null,diagnostic:qaTraceIfRequested(req,state._qa_trace||null)});");
writeFileSync(path,s);
console.log("PP_GA_ACCOUNT_MISMATCH_TRACE_PATCHED");
