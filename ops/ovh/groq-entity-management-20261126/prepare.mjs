import {prepareSource as oldPrepare} from "../groq-universal-parameters-20261126/prepare.mjs";
function ppGroqManageEntity(model,args){
 const fail=code=>{throw Error(code)};
 const allowed=["kind","entity","verb","record_index","name","equipment_kind","capacity","unit","throughput","duration_minutes","role","shift","stock","operations","order_id"];
 if(!model||typeof model!=="object"||!args||Object.keys(args).some(k=>!allowed.includes(k)))fail("unsupported_action");
 const entity=args.entity,verb=args.verb;
 const keys={equipment:"equipment",employee:"employees",material:"materials",process:"technical_processes",order:"orders"};
 if(!Object.hasOwn(keys,entity)||!["create","update","duplicate","delete"].includes(verb))fail("unsupported_action");
 const common=["kind","entity","verb","record_index"];
 const per={equipment:["name","equipment_kind","capacity","unit","throughput","duration_minutes"],employee:["name","role","shift"],material:["name","stock","unit"],process:["name","operations"],order:["order_id"]};
 if(Object.keys(args).some(k=>!common.includes(k)&&!per[entity].includes(k)))fail("unsupported_action");
 if(verb==="delete"&&Object.keys(args).some(k=>!common.includes(k)))fail("unsupported_action");
 if(entity==="order"&&!["duplicate","delete"].includes(verb))fail("unsupported_action");
 if(verb==="create"&&args.record_index!==undefined)fail("invalid_action");
 const copy=structuredClone(model),list=v=>Array.isArray(v)?v:[],own=(v,k)=>Object.hasOwn(v,k);
 const key=keys[entity];
 if(copy[key]!==undefined&&!Array.isArray(copy[key]))fail("unsupported_model");
 // Do not mutate legacy dual resource collections or singular material objects.
 if(entity==="equipment"&&list(copy.autoclaves).length)fail("legacy_resource_model");
 if(entity==="material"&&copy.material&&typeof copy.material==="object")fail("legacy_resource_model");
 const rows=list(copy[key]);
 const idx=(n,r)=>{if(!Number.isSafeInteger(n)||n<1||n>r.length)fail("unknown_record");return n-1};
 const str=(x,max=120)=>{if(typeof x!=="string"||!x.trim()||x.length>max||/[\x00-\x1f<>]/.test(x))fail("invalid_entity_value");return x.trim()};
 const num=(x,min=0)=>{if(typeof x!=="number"||!Number.isFinite(x)||x<min||x>1e9)fail("invalid_number");return x};
 const unit=x=>str(x,40);
 const label=r=>String(r?.name??r?.id??"").slice(0,120);
 const unique=(name,skip)=>{if(rows.some(r=>r!==skip&&String(r.name||"").trim().toLowerCase()===name.toLowerCase()))fail("duplicate_entity")};
 const ids=new Set();
 const collect=x=>{if(Array.isArray(x))x.forEach(collect);else if(x&&typeof x==="object"){if(x.id!=null)ids.add(String(x.id));Object.values(x).forEach(collect)}};
 collect(copy);
 const nextId=prefix=>{let i=1;while(ids.has("AI-"+prefix+"-"+i))i++;const id="AI-"+prefix+"-"+i;ids.add(id);return id};
 const prefix={equipment:"EQ",employee:"EMP",material:"MAT",process:"PROC",order:"ORD"}[entity];
 const old=verb==="create"?null:rows[idx(args.record_index,rows)];
 if(old&&old.id==null)fail("unknown_record");
 const shift=value=>{
  const s=str(value),shifts=[...Object.keys(copy.shifts||{}),...Object.keys(copy.shift_calendars||{})];
  if(!shifts.includes(s))fail("unknown_shift");return s;
 };
 // Conservative dependency protection; never cascade or silently rewrite references.
 function referenced(record,onlyName=false){
  const values=new Set([...(onlyName?[]:[String(record.id)]),...(record.name?[String(record.name)]:[])]);
  if(!onlyName&&entity==="equipment"&&record.kind&&!rows.some(x=>x!==record&&x.kind===record.kind))values.add("kind:"+record.kind);
  if(!onlyName&&entity==="employee"&&record.role&&!rows.some(x=>x!==record&&x.role===record.role))values.add("role:"+record.role);
  const scan=x=>{
   if(x===record)return false;
   if(typeof x==="string"||typeof x==="number")return values.has(String(x));
   if(Array.isArray(x))return x.some(scan);
   if(x&&typeof x==="object")return Object.entries(x).some(([k,v])=>k!=="__ppid"&&scan(v));
   return false;
  };
  return scan(copy);
 }
 function newOperations(input,existing=[]){
  if(!Array.isArray(input)||!input.length||input.length>30||input.length+existing.length>100)fail("invalid_operations");
  const sequence=existing.reduce((n,o)=>Math.max(n,Number(o.sequence)||0),0);
  return input.map((o,i)=>{
   if(!o||typeof o!=="object"||Array.isArray(o)||Object.keys(o).some(k=>!["name","duration_minutes","requirements"].includes(k)))fail("invalid_operations");
   const name=str(o.name),duration=num(o.duration_minutes,.000001);
   if(!Array.isArray(o.requirements)||o.requirements.length>20)fail("invalid_operations");
   const requirements=o.requirements.map(r=>{
    if(!r||typeof r!=="object"||Array.isArray(r)||Object.keys(r).some(k=>!["resource_type","resource_index","quantity","consumption_rule"].includes(k))||!["equipment","employee","material"].includes(r.resource_type))fail("invalid_resource_requirement");
    const type=r.resource_type,source=type==="equipment"?(list(copy.equipment).length?list(copy.equipment):list(copy.autoclaves)):list(copy[keys[type]]);
    const record=source[idx(r.resource_index,source)];
    if(record.id==null||!String(record.id))fail("unknown_record");
    let amount=num(r.quantity,.000001),u,rule;
    if(type==="material"){
     u=unit(record.unit||"kg");rule=r.consumption_rule;
     if(!["per_m2","per_operation"].includes(rule))fail("invalid_resource_requirement");
    }else{
     if(!Number.isSafeInteger(amount)||amount!==1)fail("invalid_resource_requirement");
     u="pcs";rule="during_operation";
     if(r.consumption_rule!==undefined&&r.consumption_rule!==rule)fail("invalid_resource_requirement");
    }
    return {id:nextId("RR"),resource_type:type,match_mode:"specific",resource_ref:String(record.id),resource_refs:[String(record.id)],quantity:amount,unit:u,consumption_rule:rule};
   });
   if(new Set(requirements.map(r=>r.resource_type+":"+r.resource_ref)).size!==requirements.length)fail("invalid_resource_requirement");
   return {id:nextId("OP"),name,sequence:sequence+i+1,duration_min:duration,resource_requirements:requirements};
  });
 }
 if(verb==="delete"){
  if(entity==="order"&&rows.length<=1)fail("last_order");
  if(referenced(old))fail("entity_in_use");
  copy[key]=rows.filter(r=>r!==old);
  return {model:copy,change:{kind:"manage_entity",entity,verb,record:label(old),entityId:String(old.id),before:structuredClone(old)}};
 }
 if(rows.length>=5000&&verb!=="update")fail("too_many_changes");
 const record=old?structuredClone(old):{id:nextId(prefix)};
 if(verb==="duplicate"){
  record.id=nextId(prefix);
  if(entity==="process")record.operations=list(record.operations).map(o=>({...o,id:nextId("OP"),resource_requirements:list(o.resource_requirements).map(r=>({...r,id:nextId("RR")}))}));
 }
 if(entity==="order"){
  const orderId=args.order_id;
  if(orderId!==undefined){const s=str(orderId,80);if(!/^[\p{L}\p{N}_. -]+$/u.test(s))fail("invalid_order_id");record.id=s}
  else if(rows.every(o=>/^\d+$/.test(String(o.id))&&Number.isSafeInteger(Number(o.id))&&Number(o.id)<Number.MAX_SAFE_INTEGER))record.id=Math.max(...rows.map(o=>Number(o.id)))+1;
  if(rows.some(r=>String(r.id)===String(record.id)))fail("duplicate_order");
 }else{
  if(verb==="create"||verb==="duplicate"||args.name!==undefined){
   const name=str(args.name);unique(name,verb==="update"?old:null);
   if(verb==="update"&&name!==old.name&&referenced(old,true))fail("entity_in_use");
   record.name=name;
  }
  if(entity==="equipment"){
   if(args.equipment_kind!==undefined){const k=str(args.equipment_kind);if(verb==="update"&&k!==old.kind&&referenced(old))fail("entity_in_use");record.kind=k}
   if(args.capacity!==undefined)record.capacity=num(args.capacity,.000001);
   if(args.unit!==undefined){const u=unit(args.unit);if(verb==="update"&&u!==old.capacity_unit&&referenced(old))fail("entity_in_use");record.capacity_unit=u}
   if(args.throughput!==undefined&&args.duration_minutes!==undefined)fail("invalid_entity_value");
   if(args.throughput!==undefined)record.timing_profile={timing_mode:"throughput",throughput_per_hour:num(args.throughput,.000001)};
   if(args.duration_minutes!==undefined)record.timing_profile={timing_mode:"fixed",duration_min:num(args.duration_minutes,.000001)};
   if(verb==="create"&&(!record.kind||!record.capacity||!record.capacity_unit||!record.timing_profile))fail("missing_entity_fields");
  }
  if(entity==="employee"){
   if(args.role!==undefined){const role=str(args.role);if(verb==="update"&&role!==old.role&&referenced(old))fail("entity_in_use");record.role=role}
   if(args.shift!==undefined)record.shift=shift(args.shift);
   if(verb==="create"&&(!record.role||((Object.keys(copy.shifts||{}).length||Object.keys(copy.shift_calendars||{}).length)&&!record.shift)))fail("missing_entity_fields");
  }
  if(entity==="material"){
   if(args.stock!==undefined)record.initial_stock=num(args.stock);
   if(args.unit!==undefined){const u=unit(args.unit);if(verb==="update"&&u!==old.unit&&referenced(old))fail("entity_in_use");record.unit=u}
   if(verb==="create"){if(!record.unit||record.initial_stock===undefined)fail("missing_entity_fields");record.deliveries=[]}
   if(args.stock!==undefined&&own(record,"initial_stock_kg")){if(!["kg","кг"].includes(record.unit))fail("legacy_resource_model");record.initial_stock_kg=record.initial_stock}
  }
  if(entity==="process"){
   if(verb==="create"){record.operations=newOperations(args.operations)}
   else if(args.operations!==undefined){record.operations=[...list(record.operations),...newOperations(args.operations,list(record.operations))]}
   if(!list(record.operations).length)fail("invalid_operations");
  }
 }
 if(verb==="update"&&JSON.stringify(old)===JSON.stringify(record))fail("no_change");
 if(verb==="update")copy[key]=rows.map(r=>r===old?record:r);else copy[key]=[...rows,record];
 const change={kind:"manage_entity",entity,verb,record:label(record),entityId:String(record.id),...(old?{before:structuredClone(old)}:{}),after:structuredClone(record)};
 return {model:copy,change};
}
export function ppGroqEntityApplied(expected,actual,args){
 const key={equipment:"equipment",employee:"employees",material:"materials",process:"technical_processes",order:"orders"}[args.entity];
 const a=expected?.[key],b=actual?.[key];if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return false;
 const normalizeUnit=v=>String(v).trim().toLowerCase().replace(/[²]/g,"2").replace(/[³]/g,"3").replace(/^м(?=[23]?$)/,"m").replace(/^(шт\.?|pieces|units)$/,"pcs").replace(/^кг$/,"kg");
 const matches=(x,y,k)=>{
  if(k==="__ppid")return true;
  if(k==="unit"||k==="capacity_unit")return normalizeUnit(x)===normalizeUnit(y);
  if(Array.isArray(x))return Array.isArray(y)&&x.length===y.length&&x.every((v,i)=>matches(v,y[i],""));
  if(x&&typeof x==="object")return !!y&&typeof y==="object"&&Object.entries(x).every(([n,v])=>matches(v,y[n],n));
  return typeof x==="boolean"||x===null?x===y:String(x)===String(y);
 };
 return a.every(r=>{const found=b.filter(q=>String(q.id)===String(r.id));return found.length===1&&matches(r,found[0],"")});
}
const legacySource=oldPrepare.replace("function ppGroqPrepareEdit(","function ppGroqPrepareLegacyEdit(");
const legacy=Function("return ("+legacySource+")")();
export function ppGroqPrepareEdit(model,args){return args?.kind==="manage_entity"?ppGroqManageEntity(model,args):legacy(model,args)}
export const prepareSource=legacySource+"\n"+ppGroqManageEntity.toString()+"\nfunction ppGroqPrepareEdit(model,args){return args?.kind==='manage_entity'?ppGroqManageEntity(model,args):ppGroqPrepareLegacyEdit(model,args)}";
