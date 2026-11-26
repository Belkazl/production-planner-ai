// Shared deterministic, allowlisted project edit builder. No provider-generated
// code, object paths, raw patches, model replacement or direct DB writes.
export function ppGroqPrepareEdit(model,args){
 const fail=(code)=>{throw Error(code)};
 if(!model||typeof model!=="object"||!args||typeof args!=="object"||Array.isArray(args))fail("invalid_action");
 const allowed={
  add_order:["kind","quantity","process_index","order_id","unit"],
  update_order:["kind","order_index","quantity","process_index","unit"],
  update_equipment_capacity:["kind","equipment_index","value"],
  update_equipment_rate:["kind","equipment_index","value"],
  update_material_stock:["kind","material_index","value"],
  update_employee_shift:["kind","employee_index","shift"],
  update_operation_duration:["kind","process_index","operation_index","value"]
 };
 if(!Object.hasOwn(allowed,args.kind)||Object.keys(args).some(k=>!allowed[args.kind].includes(k)))fail("unsupported_action");
 const list=v=>Array.isArray(v)?v:[];
 const number=(v,min=0)=>{if(typeof v!=="number"||!Number.isFinite(v)||v<min||v>1e9)fail("invalid_number");return v};
 const index=(v,rows)=>{if(!Number.isSafeInteger(v)||v<1||v>rows.length)fail("unknown_record");return v-1};
 const clone=structuredClone(model);
 const orders=list(clone.orders),processes=list(clone.technical_processes);
 const projectUnit=String(clone.quantity_unit||"м²");
 const canonicalUnit=u=>String(u).toLowerCase().trim().replace(/[²]/g,"2").replace(/[³]/g,"3").replace(/^(м|м2|м3)$/u,v=>v.replace("м","m")).replace(/^(шт\.?|pieces|units)$/u,"pcs").replace(/^кг$/u,"kg");
 const validateUnit=(value,expected)=>{if(value!==undefined&&(typeof value!=="string"||canonicalUnit(value)!==canonicalUnit(expected)))fail("unit_mismatch")};
 const processAt=(n,current)=>{
  if(n!==undefined)return processes[index(n,processes)];
  if(current!==undefined){const found=processes.find(p=>String(p.id)===String(current));if(found)return found}
  if(processes.length===1)return processes[0];
  if(!processes.length)fail("no_process");
  fail("choose_process");
 };
 const label=(r,fallback)=>String(r?.name||r?.id||fallback).slice(0,120);
 const opHours=p=>Math.max(.01,list(p.operations).reduce((a,o)=>a+(Number.isFinite(Number(o.duration_min))?Math.max(0,Number(o.duration_min)):0),0)/60||1);
 let change;
 if(args.kind==="add_order"){
  if(orders.length>=5000)fail("too_many_orders");
  const quantity=number(args.quantity,.000001),p=processAt(args.process_index);
  validateUnit(args.unit,projectUnit);
  if(p.id==null||String(p.id)==="")fail("unknown_record");
  const ids=new Set(orders.map(o=>String(o.id)));
  let id;
  if(args.order_id!==undefined){
   if(typeof args.order_id!=="string"||!args.order_id.trim()||args.order_id.length>80||!/^[\p{L}\p{N}_. -]+$/u.test(args.order_id))fail("invalid_order_id");
   const s=args.order_id.trim(),n=Number(s);id=/^\d+$/.test(s)&&Number.isSafeInteger(n)&&String(n)===s?n:s;
  }else if(orders.length&&orders.every(o=>/^\d+$/.test(String(o.id))&&Number.isSafeInteger(Number(o.id))&&Number(o.id)<Number.MAX_SAFE_INTEGER)){
   id=Math.max(...orders.map(o=>Number(o.id)))+1;
  }else{
   let i=orders.length+1;while(ids.has("ORD-"+i))i++;id="ORD-"+i;
  }
  if(ids.has(String(id)))fail("duplicate_order");
  const order={id,area:quantity,quantity,unit:projectUnit,technical_process_id:p.id,process_hours:opHours(p)};
  clone.orders=[...orders,order];
  change={kind:args.kind,record:String(id),after:quantity,unit:projectUnit,process:label(p,"Process"),newOrder:true};
 }else if(args.kind==="update_order"){
  const i=index(args.order_index,orders),o=orders[i],unit=String(o.unit||projectUnit);
  validateUnit(args.unit,unit);
  if(args.quantity===undefined&&args.process_index===undefined)fail("missing_change");
  const before=Number(o.quantity??o.area),quantity=args.quantity===undefined?before:number(args.quantity,.000001);
  if(!Number.isFinite(quantity)||quantity<=0)fail("invalid_number");
  const oldProcess=processes.find(p=>String(p.id)===String(o.technical_process_id));
  const p=processAt(args.process_index,o.technical_process_id);
  if(p.id==null||String(p.id)==="")fail("unknown_record");
  o.quantity=quantity;o.area=quantity;o.unit=unit;
  if(args.process_index!==undefined){o.technical_process_id=p.id;o.process_hours=opHours(p)}
  if(quantity===before&&String(oldProcess?.id)===String(p.id))fail("no_change");
  change={kind:args.kind,record:String(o.id),before,after:quantity,unit,process:label(p,"Process"),previousProcess:oldProcess?label(oldProcess,"Process"):null};
 }else if(args.kind==="update_equipment_capacity"||args.kind==="update_equipment_rate"){
  const rows=list(clone.equipment).length?clone.equipment:list(clone.autoclaves);
  const i=index(args.equipment_index,rows),r=rows[i],value=number(args.value,.000001),isRate=args.kind==="update_equipment_rate";
  if(isRate&&(!r.timing_profile||!Object.hasOwn(r.timing_profile,"throughput_per_hour")))fail("unknown_rate");
  const before=isRate?r.timing_profile.throughput_per_hour:r.capacity;
  if(typeof before!=="number"||!Number.isFinite(before))fail("unknown_value");
  if(before===value)fail("no_change");
  if(isRate)r.timing_profile.throughput_per_hour=value;else r.capacity=value;
  // Some legacy models mirror machines in autoclaves. Update only the same
  // uniquely identified mirror if it has the same previous numeric value.
  const other=rows===clone.equipment?list(clone.autoclaves):list(clone.equipment);
  const matches=other.filter(e=>r.id!=null&&String(e.id)===String(r.id));
  if(matches.length>1)fail("ambiguous_resource");
  if(matches.length){
   const m=matches[0],v=isRate?m.timing_profile?.throughput_per_hour:m.capacity;
   if(v!==before)fail("ambiguous_resource");
   if(isRate)m.timing_profile.throughput_per_hour=value;else m.capacity=value;
  }
  change={kind:args.kind,record:label(r,"Equipment"),before,after:value,unit:String(r.capacity_unit||projectUnit)+(isRate?"/h":"")};
 }else if(args.kind==="update_material_stock"){
  const rows=list(clone.materials),r=rows[index(args.material_index,rows)],value=number(args.value);
  const key=Object.hasOwn(r,"initial_stock")?"initial_stock":Object.hasOwn(r,"initial_stock_kg")?"initial_stock_kg":null;
  if(!key||typeof r[key]!=="number"||!Number.isFinite(r[key]))fail("unknown_value");
  if(r[key]===value)fail("no_change");
  change={kind:args.kind,record:label(r,"Material"),before:r[key],after:value,unit:String(r.unit||"kg")};
  r[key]=value;
  if(Object.hasOwn(r,"initial_stock")&&Object.hasOwn(r,"initial_stock_kg")&&r.initial_stock_kg===change.before&&canonicalUnit(r.unit||"kg")==="kg")r.initial_stock_kg=value;
  if(clone.material&&String(clone.material.id??"")===String(r.id??"")&&r.id!=null)fail("legacy_material_mirror");
 }else if(args.kind==="update_employee_shift"){
  const rows=list(clone.employees),i=index(args.employee_index,rows),r=rows[i];
  const shifts=clone.shifts&&typeof clone.shifts==="object"&&!Array.isArray(clone.shifts)?Object.keys(clone.shifts):[];
  const calendars=clone.shift_calendars&&typeof clone.shift_calendars==="object"&&!Array.isArray(clone.shift_calendars)?Object.keys(clone.shift_calendars):[];
  if(typeof args.shift!=="string"||![...shifts,...calendars].includes(args.shift))fail("unknown_shift");
  if(r.shift===args.shift)fail("no_change");
  change={kind:args.kind,record:"Employee "+(i+1),before:String(r.shift||""),after:args.shift,unit:""};
  r.shift=args.shift;
 }else{
  const p=processes[index(args.process_index,processes)],ops=list(p.operations),o=ops[index(args.operation_index,ops)],value=number(args.value,.000001);
  if(typeof o.duration_min!=="number"||!Number.isFinite(o.duration_min))fail("unknown_value");
  if(o.duration_min===value)fail("no_change");
  change={kind:args.kind,record:label(p,"Process")+" / "+label(o,"Operation"),before:o.duration_min,after:value,unit:"min"};
  o.duration_min=value;
 }
 return {model:clone,change};
}
export const prepareSource=ppGroqPrepareEdit.toString();
