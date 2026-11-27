import assert from "node:assert/strict";
import {prepare as previousPrepare} from "../equipment-types-create-20261127/patch.mjs";
import {prepareSource as oldPrepare} from "../groq-universal-parameters-20261126/prepare.mjs";
import {source as oldUI} from "../groq-parameter-units-20261126/patch.mjs";
import {transformActionsHtml} from "../groq-universal-parameters-20261126/actions-ui.mjs";
import {ppShipByValue,ppShipByApply} from "./shared.mjs";
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,"SHIP_BY_AI_ANCHOR: "+a.slice(0,80));return s.replace(a,()=>b)};
const helpers=[ppShipByValue,ppShipByApply].map(f=>f.toString()).join("\n");
export function patchPrepare(source){
 let s=once(source,"function ppGroqPrepareEdit(model,args){","function ppGroqPrepareEdit(model,args){\n"+helpers+"\n");
 s=once(s,'  add_order:["kind","quantity","process_index","order_id","unit","template_order_index","parameters"],','  set_order_ship_by:["kind","order_index","ship_by"],\n  add_order:["kind","quantity","process_index","order_id","unit","template_order_index","parameters","ship_by"],');
 s=once(s,' const list=v=>Array.isArray(v)?v:[];',' if(args.kind==="set_order_ship_by")return ppShipByApply(model,args);\n const list=v=>Array.isArray(v)?v:[];');
 s=once(s,'  clone.orders=[...orders,order];','  if(args.ship_by!==undefined){const due=ppShipByValue(args.ship_by);if(due!==null)order.ship_by=due;}\n  clone.orders=[...orders,order];');
 s=once(s,'newOrder:true,...(template?','newOrder:true,...(order.ship_by?{shipBy:order.ship_by}:{}),...(template?');
 return s;
}
export const prepare=patchPrepare(previousPrepare);
export const prepareEdit=new Function(prepare+"\nreturn ppGroqPrepareEdit;")();
export function patchRuntime(s){
 s=once(s,'set_equipment_parameter_rule edits allowed/min/max equipment capabilities','set_order_ship_by sets or clears the optional date and time by which the entire existing order must be ready for shipment; use order_index and ship_by in project-local YYYY-MM-DDTHH:MM format, or null only when explicitly removing the deadline. The same optional field is supported in add_order. Never copy the deadline from the production parameter template. If the date or time is ambiguous, ask before proposing a change. A deadline is a soft constraint, not a guarantee of on-time completion. set_equipment_parameter_rule edits allowed/min/max equipment capabilities');
 s=once(s,'enum:["create_equipment_type","add_order","complete_order_parameters"','enum:["set_order_ship_by","create_equipment_type","add_order","complete_order_parameters"');
 s=once(s,'order_index:{type:"integer",description:"1-based order index in editing catalog"},','order_index:{type:"integer",description:"1-based order index in editing catalog"},ship_by:{type:["string","null"],description:"Project-local deadline YYYY-MM-DDTHH:MM; null clears it"},');
 s=once(s,'number:idLabel(o),quantity:','number:idLabel(o),shipBy:o.ship_by||null,quantity:');
 s=once(s,'   choose_process:[','   invalid_ship_by:["Enter a valid date and time (YYYY-MM-DDTHH:MM).","Укажите корректную дату и время (ГГГГ-ММ-ДДTЧЧ:ММ)."],\n   choose_process:[');
 return s;
}
export function patchTenant(s){return patchRuntime(once(s,previousPrepare,prepare))}
const oldEquipmentUI=()=>{
 let ui=once(oldUI,oldPrepare,previousPrepare);
 ui=once(ui,'const kinds={set_order_parameters:', 'const kinds={create_equipment_type:t("New equipment type","Новый тип оборудования"),set_order_parameters:');
 ui=once(ui,' switch(args.kind){',' switch(args.kind){\n case "create_equipment_type":{\n  const saved=Array.isArray(actual.equipment_types)&&actual.equipment_types.includes(args.type_name.normalize("NFC").trim().replace(/ +/g," "));\n  if(!saved)return false;if(args.equipment_index===undefined)return true;\n  return fields(eq(expected)?.[args.equipment_index-1],eq(actual)?.[args.equipment_index-1],["id","kind"]);\n }');
 return ui;
};
export function patchUI(s){
 s=once(s,previousPrepare,prepare);
 s=once(s,'const kinds={create_equipment_type:', 'const kinds={set_order_ship_by:t("Ship by","Отгрузить до"),create_equipment_type:');
 s=once(s,' if(c.process)out+=',' if(c.shipBy)out+="\\n"+t("Ship by: ","Отгрузить до: ")+c.shipBy;\n if(c.process)out+=');
 s=once(s,' switch(args.kind){',' switch(args.kind){\n case "set_order_ship_by":return expected.orders.length===actual.orders?.length&&fields(getOrder(expected),getOrder(actual),["id","ship_by"]);\n');
 s=once(s,'["id","quantity","area","technical_process_id","unit"])&&(!change.parameters','["id","quantity","area","technical_process_id","unit","ship_by"])&&(!change.parameters');
 return s;
}
export const previousUI=oldEquipmentUI();
export const nextUI=patchUI(previousUI);
const serverTransform=s=>"\nfunction ppGroqActionsHtml(html){return ("+transformActionsHtml.toString()+")(html,"+JSON.stringify(s)+");}\n";
export function patchAuthAI(s){return once(s,serverTransform(previousUI),serverTransform(nextUI))}
