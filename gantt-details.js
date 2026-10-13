(function(){
"use strict";
if(window.__PP_GANTT_BLOCK_DETAILS_V1__)return;
window.__PP_GANTT_BLOCK_DETAILS_V1__={installed:true,version:"1.0"};
const overlay=document.createElement("div");
overlay.id="ppGanttOperationDetails";
overlay.hidden=true;
overlay.setAttribute("aria-hidden","true");
document.body.appendChild(overlay);
let selected=null,lastFocus=null;
const val=v=>v===null||v===undefined?"":String(v).trim();
const first=(o,keys)=>{for(const k of keys){if(o&&o[k]!==undefined&&o[k]!==null&&val(o[k])!=="")return o[k]}return null};
const display=v=>{
 if(v===undefined||v===null||v==="")return "";
 if(Array.isArray(v))return v.map(display).filter(Boolean).join(", ");
 if(typeof v==="object")return Object.entries(v).filter(([k,x])=>x!==null&&x!==undefined&&typeof x!=="object").map(([k,x])=>k+": "+x).join("; ");
 return val(v);
};
const order=v=>val(v).replace(/^__ppb__(.+?)__\d+$/,"$1");
function clock(plan,offset){
 const n=Number(offset);
 if(offset===null||offset===undefined||!Number.isFinite(n))return "";
 const start=Date.parse(plan?.start||"");
 if(Number.isFinite(start)){
  const d=new Date(start+n*60000);
  return d.toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
 }
 const day=Math.floor(n/1440),m=((Math.round(n)%1440)+1440)%1440;
 return "+"+day+" д "+String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");
}
function close(){
 if(overlay.hidden)return;
 overlay.hidden=true;overlay.setAttribute("aria-hidden","true");
 if(selected)selected.classList.remove("pgd-selected");
 selected=null;
 if(lastFocus?.isConnected){try{lastFocus.focus({preventScroll:true})}catch(e){}}
 lastFocus=null;
}
function item(label,value,container){
 const str=display(value);if(!str)return;
 const k=document.createElement("div"),v=document.createElement("div");
 k.className="pgd-label";k.textContent=label;
 v.className="pgd-value";v.textContent=str;
 container.append(k,v);
}
function open(bar){
 if(!bar)return;
 const op=bar.__ppOperation||null,plan=bar.__ppPlan||null,resource=bar.__ppResource||null;
 const kind=bar.__ppKind||"operation",event=bar.__ppMaterialEvent||null,blocked=bar.__ppBlockedOrder||null;
 const title=kind==="setup"?"Переналадка":kind==="delivery"?"Поставка материала":kind==="consumption"?"Расход материала":kind==="blocked"?"Ожидание материала":val(first(op,["operation_name","name"]))||"Операция";
 const subtitle=kind==="setup"?"Операция переналадки":kind==="delivery"||kind==="consumption"?"Событие движения материала":kind==="blocked"?"Блокировка выполнения заказа":"Производственная операция";
 const box=document.createElement("div");box.className="pgd-panel";box.setAttribute("role","dialog");box.setAttribute("aria-modal","true");box.setAttribute("aria-labelledby","pgdTitle");
 const header=document.createElement("div");header.className="pgd-header";
 const text=document.createElement("div");
 const eyebrow=document.createElement("p");eyebrow.className="pgd-eyebrow";eyebrow.textContent=subtitle;
 const heading=document.createElement("h3");heading.className="pgd-heading";heading.id="pgdTitle";heading.textContent=title;
 text.append(eyebrow,heading);
 const x=document.createElement("button");x.type="button";x.className="pgd-close";x.textContent="×";x.setAttribute("aria-label","Закрыть сведения об операции");x.addEventListener("click",close);
 header.append(text,x);box.append(header);
 const fields=document.createElement("div");fields.className="pgd-fields";
 if(kind==="blocked"){
  item("Заказ",order(first(blocked,["order","order_id","id"])),fields);
  item("Материалы",(blocked?.materials||[]).map(m=>m.name||m.id||"").filter(Boolean),fields);
  item("Причина","Ожидание материалов",fields);
 }else if(event && (kind==="delivery"||kind==="consumption")){
  item("Ресурс",first(resource,["name","id"]),fields);
  item("Событие",event?.desc||bar.title,fields);
  item("Время",clock(plan,event.start),fields);
 }else{
  const name=first(op,["operation_name","name"]);
  if(kind==="setup"&&name)item("Правило / операция",name,fields);
  item("Заказ",order(first(op,["order","order_id","parent_order_id"])),fields);
  item("Партия",first(op,["batch","batch_index","batch_id"]),fields);
  item("Оборудование",bar.__ppResourceKind==="equipment"?first(resource,["name","id"]):null,fields);
  item("Сотрудник",bar.__ppResourceKind==="employee"?first(resource,["name","id"]):null,fields);
  item("Ресурс",bar.__ppResourceKind==="order"?first(resource,["name","id"]):null,fields);
  item("Время начала",clock(plan,op?.start_min),fields);
  item("Время окончания",clock(plan,op?.end_min),fields);
  const minutes=Number(op?.end_min)-Number(op?.start_min);
  if(op&&Number.isFinite(minutes)&&minutes>=0)item("Длительность",Math.round(minutes*100)/100+" мин",fields);
  item("Количество",first(op,["batch_quantity","quantity","area"]),fields);
  item("Единица",first(op,["unit","quantity_unit"]),fields);
  if(kind==="setup"){
   item("Параметр",first(op,["setup_parameter","parameter","setup_type","setup_group"]),fields);
   item("От состояния",first(op,["from_state","setup_from"]),fields);
   item("К состоянию",first(op,["to_state","setup_to"]),fields);
  }
  const equipment=Array.isArray(op?.equipment_ids)?op.equipment_ids:[];
  const employees=Array.isArray(op?.employee_ids)?op.employee_ids:[];
  if(bar.__ppResourceKind!=="equipment"&&equipment.length)item("Оборудование (ID)",equipment,fields);
  if(bar.__ppResourceKind!=="employee"&&employees.length)item("Сотрудники (ID)",employees,fields);
  item("ID операции",first(op,["operation_id","id"]),fields);
 }
 if(!fields.children.length)item("Сведения",bar.title||bar.getAttribute("aria-label")||"Нет дополнительных данных",fields);
 box.append(fields);
 const hint=document.createElement("p");hint.className="pgd-hint";hint.textContent="Закрыть: Esc или нажатие за пределами карточки.";
 box.append(hint);
 overlay.replaceChildren(box);
 overlay.hidden=false;overlay.setAttribute("aria-hidden","false");
 if(selected)selected.classList.remove("pgd-selected");
 selected=bar;selected.classList.add("pgd-selected");
 lastFocus=bar;
 x.focus({preventScroll:true});
}
overlay.addEventListener("click",e=>{if(e.target===overlay)close()});
document.addEventListener("keydown",e=>{
 if(!overlay.hidden&&e.key==="Escape"){e.preventDefault();close();return}
 if((e.key==="Enter"||e.key===" ")&&e.target?.matches?.(".pg2-bar,.pp3-bar")){
  e.preventDefault();open(e.target);
 }
});
document.addEventListener("click",e=>{
 const bar=e.target?.closest?.(".pg2-bar,.pp3-bar");
 if(!bar)return;
 open(bar);
});
window.__PP_GANTT_BLOCK_DETAILS_V1__.open=open;
window.__PP_GANTT_BLOCK_DETAILS_V1__.close=close;
console.log("PP_GANTT_BLOCK_DETAILS_READY","1.0");
})();