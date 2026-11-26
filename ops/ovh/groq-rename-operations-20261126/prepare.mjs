import {prepareSource as oldPrepare} from "../groq-universal-parameters-20261126/prepare.mjs";
function ppGroqRenameOperations(model,args){
 const fail=code=>{throw Error(code)};
 if(!model||typeof model!=="object"||!args||Object.keys(args).some(k=>!["kind","scope","renames"].includes(k)))fail("invalid_action");
 if(!["all","selected"].includes(args.scope)||!Array.isArray(args.renames)||!args.renames.length||args.renames.length>150)fail("invalid_renames");
 const copy=structuredClone(model),processes=copy.technical_processes;
 if(!Array.isArray(processes)||!processes.length)fail("no_process");
 const targets=new Set(),changes=[];
 const index=(v,rows)=>{if(!Array.isArray(rows)||!Number.isSafeInteger(v)||v<1||v>rows.length)fail("unknown_record");return v-1};
 const names=x=>{if(typeof x!=="string"||!x.trim()||x.length>120||/[\x00-\x1f<>]/.test(x))fail("invalid_renames");return x.trim()};
 for(const r of args.renames){
  if(!r||typeof r!=="object"||Array.isArray(r)||Object.keys(r).some(k=>!["process_index","operation_index","name"].includes(k)))fail("invalid_renames");
  const pi=index(r.process_index,processes),p=processes[pi],oi=index(r.operation_index,p.operations),o=p.operations[oi];
  if(o.id==null||!String(o.id)||p.id==null||!String(p.id))fail("unknown_record");
  const key=pi+":"+oi;
  if(targets.has(key))fail("duplicate_operation");targets.add(key);
  const name=names(r.name),before=String(o.name??"");
  if(name===before)continue;
  // The optimizer uses stable IDs. Never change a name referenced as a key
  // in legacy dependency fields unless the old name is itself the retained ID.
  if(before&&before!==String(o.id)){
   const scan=(v,k="")=>{
    if(v===o)return false;
    if(Array.isArray(v))return v.some(x=>scan(x,k));
    if(v&&typeof v==="object")return Object.entries(v).some(([n,x])=>scan(x,n));
    return typeof v==="string"&&v===before&&/^(operation_ref|operation_refs|operation_id|operation_ids|from_operation|to_operation|predecessors?|successors?|depends_on|depends_on_operations)$/i.test(k);
   };
   if(scan(copy))fail("operation_name_dependency");
  }
  changes.push({process:String(p.name??p.id).slice(0,120),processId:String(p.id),operationId:String(o.id),before,after:name});
  o.name=name;
 }
 const total=processes.reduce((n,p)=>n+(Array.isArray(p.operations)?p.operations.length:0),0);
 if(args.scope==="all"&&targets.size!==total)fail("incomplete_renames");
 if(!changes.length)fail("no_change");
 return {model:copy,change:{kind:"rename_operations",scope:args.scope,record:String(changes.length),renames:changes}};
}
export function ppGroqRenamesApplied(expected,actual){
 const a=expected?.technical_processes,b=actual?.technical_processes;
 if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return false;
 return a.every(p=>{
  const q=b.filter(x=>String(x.id)===String(p.id));
  if(q.length!==1||!Array.isArray(p.operations)||!Array.isArray(q[0].operations)||p.operations.length!==q[0].operations.length)return false;
  return p.operations.every(o=>{
   const r=q[0].operations.filter(x=>String(x.id)===String(o.id));
   return r.length===1&&r[0].name===o.name;
  });
 });
}
const legacySource=oldPrepare.replace("function ppGroqPrepareEdit(","function ppGroqPrepareLegacyEdit(");
const legacy=Function("return ("+legacySource+")")();
export function ppGroqPrepareEdit(model,args){return args?.kind==="rename_operations"?ppGroqRenameOperations(model,args):legacy(model,args)}
export const prepareSource=legacySource+"\n"+ppGroqRenameOperations.toString()+"\nfunction ppGroqPrepareEdit(model,args){return args?.kind==='rename_operations'?ppGroqRenameOperations(model,args):ppGroqPrepareLegacyEdit(model,args)}";
