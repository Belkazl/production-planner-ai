import {prepareSource} from "./prepare.mjs";

function ppGroqStable(value){
 const normalized=v=>Array.isArray(v)?v.map(normalized):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).filter(k=>k!=="__ppid").sort().map(k=>[k,normalized(v[k])])):v;
 return JSON.stringify(normalized(value));
}
function ppGroqActionEntry(storage,expected){
 try{
  const id=storage["prodplan.project.active.v2"]||"";
  const raw=storage["prodplan.projects.v2"],records=typeof raw==="string"?JSON.parse(raw):raw;
  if(!id||!Array.isArray(records)||expected&&id!==expected)return null;
  const p=records.find(x=>x?.id===id);
  if(!p?.model||!Number.isSafeInteger(Number(p.revision))||Number(p.revision)<0)return null;
  return {id,revision:Number(p.revision),model:p.model,planStamp:p.lastPlan?String(p.lastPlan._savedAt||p.lastPlan._revision||p.lastPlan.duration_minutes||"present"):"",savedPlans:p.savedPlans};
 }catch{return null}
}
function ppGroqLocalEntry(){
 return ppGroqActionEntry({"prodplan.project.active.v2":localStorage.getItem("prodplan.project.active.v2"),"prodplan.projects.v2":localStorage.getItem("prodplan.projects.v2")});
}
function ppGroqSameEntry(a,b){
 return !!a&&!!b&&a.id===b.id&&a.revision===b.revision&&a.planStamp===b.planStamp&&ppGroqStable(a.model)===ppGroqStable(b.model);
}
function ppGroqEditBusy(){
 return !!(window.__ppGroqApplyingEdit||window.__ppOptimizationInFlight||window.__PP_SSE_PROGRESS_V1__?.state?.active||window.__ppStopRequestPending||typeof busy!=="undefined"&&busy);
}
function ppGroqActionDescription(c){
 const t=assistantText;
 const kinds={set_order_parameters:t("Order parameters","Параметры заказа"),set_process_parameters:t("Process order parameters","Параметры заказов техпроцесса"),set_equipment_parameter_rule:t("Equipment compatibility rule","Правило совместимости оборудования"),set_operation_setup_parameter:t("Operation setup parameter","Параметр переналадки операции"),upsert_setup_rule:t("Setup transition","Правило переналадки"),add_order:t("Add order","Добавить заказ"),complete_order_parameters:t("Complete order parameters","Заполнить параметры заказа"),update_order:t("Update order","Изменить заказ"),update_equipment_capacity:t("Equipment capacity","Вместимость оборудования"),update_equipment_rate:t("Equipment throughput","Производительность оборудования"),update_material_stock:t("Initial material stock","Начальный остаток материала"),update_employee_shift:t("Employee shift","Смена сотрудника"),update_operation_duration:t("Nominal operation duration","Нормативная длительность операции")};
 const v=x=>(x==null?"—":typeof x==="object"?JSON.stringify(x):String(x))+(c.unit?" "+c.unit:"");
 let out=(kinds[c.kind]||t("Project change","Изменение проекта"))+": "+c.record+"\n";
 if(c.parameter)out+=c.parameter+(c.rule?" · "+c.rule:"")+"\n";
 if(c.fromState!==undefined)out+=c.fromState+" → "+c.toState+"\n";
 if(c.after!==undefined)out+=c.before!==undefined?v(c.before)+" → "+v(c.after):v(c.after);
 if(c.affectedOrders!==undefined)out+=t("Affected orders: ","Затронуто заказов: ")+c.affectedOrders+"\n";
 if(c.process)out+="\n"+t("Process: ","Техпроцесс: ")+c.process;
 if(c.previousProcess&&c.previousProcess!==c.process)out+="\n"+t("Previous process: ","Прежний техпроцесс: ")+c.previousProcess;
 if(c.templateRecord)out+="\n"+t("Production parameters from order: ","Производственные параметры из заказа: ")+c.templateRecord;
 if(c.parameters&&!c.differences)for(const [k,value] of Object.entries(c.parameters))out+="\n"+k+": "+v(value);
 if(c.differences)for(const d of c.differences)out+="\n"+d.order+" · "+d.parameter+": "+v(d.before)+" → "+v(d.after);
 return out;
}
function ppGroqCheckApplied(expected,actual,args,change){
 if(!actual||typeof actual!=="object")return false;
 const eq=m=>m.equipment?.length?m.equipment:m.autoclaves;
 const getOrder=m=>m.orders?.find(o=>String(o.id)===change.record);
 const fields=(a,b,keys)=>!!a&&!!b&&keys.every(k=>String(a[k]??"")===String(b[k]??""));
 switch(args.kind){
 case "set_order_parameters":
 case "set_process_parameters":
  return expected.orders.length===actual.orders?.length&&expected.orders.every(o=>{
   const b=actual.orders.find(x=>String(x.id)===String(o.id));
   return fields(o,b,["id","quantity","area","technical_process_id","unit"])&&ppGroqStable(o.parameters||{})===ppGroqStable(b.parameters||{});
  });
 case "set_equipment_parameter_rule":{
  const a=eq(expected)?.[args.equipment_index-1],b=eq(actual)?.[args.equipment_index-1];
  return fields(a,b,["id"])&&ppGroqStable(a.capabilities)===ppGroqStable(b.capabilities);
 }
 case "set_operation_setup_parameter":{
  const a=expected.technical_processes?.[args.process_index-1],b=actual.technical_processes?.[args.process_index-1];
  return fields(a,b,["id"])&&fields(a?.operations?.[args.operation_index-1],b?.operations?.[args.operation_index-1],["id","setup_parameter"]);
 }
 case "upsert_setup_rule":{
  const ref=args.all_equipment===true?"*":String(eq(expected)?.[args.equipment_index-1]?.id);
  const find=m=>(m.setup_rules||[]).find(r=>String(r.equipment_ref||"*")===ref&&r.setup_parameter===args.parameter_name&&String(r.from_state)===args.from_state&&String(r.to_state)===args.to_state);
  return expected.setup_rules.length===actual.setup_rules?.length&&fields(find(expected),find(actual),["id","equipment_ref","setup_parameter","from_state","to_state","duration_min"]);
 }
 case "add_order":
 case "complete_order_parameters":
 case "update_order": {
  const a=getOrder(expected),b=getOrder(actual);
  return expected.orders.length===actual.orders?.length&&fields(a,b,["id","quantity","area","technical_process_id","unit"])&&(!change.parameters||Object.entries(a.parameters||{}).every(([k,v])=>ppGroqStable(b.parameters?.[k])===ppGroqStable(v)));
 }
 case "update_equipment_capacity":
  return fields(eq(expected)?.[args.equipment_index-1],eq(actual)?.[args.equipment_index-1],["id","capacity"]);
 case "update_equipment_rate":{
  const a=eq(expected)?.[args.equipment_index-1],b=eq(actual)?.[args.equipment_index-1];
  return fields(a,b,["id"])&&fields(a?.timing_profile,b?.timing_profile,["throughput_per_hour"]);
 }
 case "update_material_stock":{
  const a=expected.materials?.[args.material_index-1],b=actual.materials?.[args.material_index-1];
  return fields(a,b,["id",Object.hasOwn(a||{},"initial_stock")?"initial_stock":"initial_stock_kg"]);
 }
 case "update_employee_shift":
  return fields(expected.employees?.[args.employee_index-1],actual.employees?.[args.employee_index-1],["id","shift"]);
 case "update_operation_duration":{
  const a=expected.technical_processes?.[args.process_index-1],b=actual.technical_processes?.[args.process_index-1];
  return fields(a,b,["id"])&&fields(a?.operations?.[args.operation_index-1],b?.operations?.[args.operation_index-1],["id","duration_min"]);
 }
 default:return false;
 }
}
async function ppGroqApplyProposal(action,snapshot,userMessage){
 if(ppGroqEditBusy())throw Error("busy");
 const before=ppGroqLocalEntry();
 if(!ppGroqSameEntry(before,snapshot)||before.id!==action.projectId||before.revision!==action.revision)throw Error("stale");
 if(typeof window.ppProjectAfterChat!=="function"||typeof renderSummary!=="function"||typeof clearPlan!=="function")throw Error("unavailable");
 if(!model||typeof model!=="object")throw Error("stale");
 // Do not discard unsaved native form edits. Apply from the planner view,
 // or save the current form first if any of its controls have changed.
 const section=document.getElementById("sectionView");
 if(section?.getClientRects().length){
  const changed=[...section.querySelectorAll("input:not([type=button]):not([type=hidden]),textarea,select")].some(el=>
   el.tagName==="SELECT"?[...el.options].some(o=>o.selected!==o.defaultSelected)&&[...el.options].some(o=>o.defaultSelected):
   el.type==="checkbox"||el.type==="radio"?el.checked!==el.defaultChecked:el.value!==el.defaultValue);
  if(changed||section.querySelector('[data-i="-1"],[data-idx="-1"]'))throw Error("unsaved");
  // Forms may also contain deleted rows. Avoid replacing an open edit table
  // altogether; the user can switch to Chat/Planning before applying.
  if(section.querySelector("[data-order-save],[data-pp-save]"))throw Error("unsaved");
 }
 let prepared=ppGroqPrepareEdit(before.model,action.args);
 if(ppGroqStable(prepared.change)!==ppGroqStable(action.change))throw Error("stale");
 window.__ppGroqApplyingEdit=true;
 const wasInert=document.body.inert;document.body.inert=true;
 const request=async(path,method="GET",payload)=>{
  const r=await fetch(path,{method,credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json","Accept":"application/json"},body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(35000)});
  const d=await r.json();
  if(!r.ok||d?.ok===false)throw Error("save_failed");
  return d;
 };
 try{
  // The existing DB-sync wrapper flushes all native queued writes before GET.
  const db=await request("/api/db-storage");
  const remote=ppGroqActionEntry(db.storage||{},before.id);
  if(!ppGroqSameEntry(before,remote)||!ppGroqSameEntry(before,ppGroqLocalEntry()))throw Error("stale");
  if(window.__ppOptimizationInFlight||window.__PP_SSE_PROGRESS_V1__?.state?.active)throw Error("busy");
  const current=await request("/api/model");
  if(!current.model||ppGroqStable(current.model)!==ppGroqStable(model))throw Error("stale");
  // The native import/read route may normalize legacy defaults. Preserve its
  // current canonical model, but require the identical reviewed change.
  prepared=ppGroqPrepareEdit(current.model,action.args);
  if(ppGroqStable(prepared.change)!==ppGroqStable(action.change))throw Error("stale");
  if(!ppGroqSameEntry(before,ppGroqLocalEntry()))throw Error("stale");
  // Validation runs the same native scheduler on a temporary copy and never
  // writes the plan, revision or model. Only a verified result permits import.
  const validation=await fetch("/api/assistant/validate-edit",{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify(action),signal:AbortSignal.timeout(110000)});
  const checked=await validation.json().catch(()=>({}));
  if(!validation.ok||checked.ok!==true||checked.valid!==true){
   const e=Error(checked.error||"validation_unavailable");e.issues=checked.issues;throw e;
  }
  const refreshed=ppGroqActionEntry((await request("/api/db-storage")).storage||{},before.id);
  if(!ppGroqSameEntry(before,refreshed)||!ppGroqSameEntry(before,ppGroqLocalEntry())||ppGroqStable((await request("/api/model")).model)!==ppGroqStable(current.model))throw Error("stale");
  const d=await request("/api/project/model/import","POST",{model:prepared.model});
  let accepted=d.model;
  let ready=d.model_ready;
  if(!accepted||typeof ready!=="boolean"){
   const check=await request("/api/model");
   if(accepted&&ppGroqStable(accepted)!==ppGroqStable(check.model))throw Error("stale");
   accepted=check.model;ready=check.model_ready;
  }
  if(ready!==true||!ppGroqCheckApplied(prepared.model,accepted,action.args,prepared.change)){
   // A rejected native result must not become the active saved project.
   if(ppGroqSameEntry(before,ppGroqLocalEntry()))await request("/api/project/model/import","POST",{model:before.model}).catch(()=>{});
   throw Error("save_failed");
  }
  if(!ppGroqSameEntry(before,ppGroqLocalEntry()))throw Error("stale");
  const success=assistantText("Native schedule check passed. Saved to the active project. Recalculate the production plan to include this change.","Проверка штатным оптимизатором пройдена. Изменение сохранено. Пересчитайте производственный план с учётом изменения.");
  model=accepted;modelReady=ready;hasResult=false;
  window.ppProjectAfterChat(userMessage,{model:accepted,reply:success+"\n"+ppGroqActionDescription(prepared.change)});
  renderSummary();clearPlan();
  q("valid").textContent=ready?assistantText("Model ready","Модель готова"):assistantText("Model needs data","Нужны данные");
  q("valid").className="pill"+(ready?" ok":"");
  q("meta").textContent=assistantText("Model changed · run optimization again","Модель изменена · запустите оптимизацию заново");
  opt.disabled=!ready;opt.textContent=assistantText("Start optimization","Запустить оптимизацию");
  const saved=ppGroqLocalEntry();
  if(!saved||saved.id!==before.id||saved.revision!==before.revision+1||saved.planStamp||!ppGroqCheckApplied(prepared.model,saved.model,action.args,prepared.change))throw Error("save_failed");
  const confirmed=ppGroqActionEntry((await request("/api/db-storage")).storage||{},before.id);
  if(!ppGroqSameEntry(saved,confirmed)||!ppGroqCheckApplied(prepared.model,confirmed.model,action.args,prepared.change))throw Error("save_unconfirmed");
  return success;
 }finally{document.body.inert=wasInert;window.__ppGroqApplyingEdit=false}
}
function ppGroqShowProposal(data,snapshot,userMessage){
 const a=data?.action;
 if(!a||!snapshot||a.projectId!==snapshot.id||a.revision!==snapshot.revision)return;
 const root=document.getElementById("messages");if(!root)return;
 let prepared;
 try{prepared=ppGroqPrepareEdit(snapshot.model,a.args);if(ppGroqStable(prepared.change)!==ppGroqStable(a.change))throw Error("invalid")}catch{assistantBubble(assistantText("The proposal is invalid. No data was changed.","Предложение недействительно. Данные не изменены."));return}
 const node=document.createElement("div");node.className="bubble";node.dataset.groqAction="pending";
 const title=document.createElement("div");title.style.fontWeight="600";title.textContent=assistantText("Proposed change","Предлагаемое изменение");
 const detail=document.createElement("div");detail.style.whiteSpace="pre-wrap";detail.style.margin="8px 0";detail.style.maxHeight="320px";detail.style.overflowY="auto";detail.textContent=ppGroqActionDescription(a.change);
 const note=document.createElement("div");note.style.fontSize="11px";note.style.marginBottom="8px";note.textContent=assistantText("The change will be checked on a temporary copy before saving. Saved named plans are kept.","Перед сохранением изменение проверяется на временной копии. Сохранённые планы останутся.");
 const buttons=document.createElement("div");buttons.style.display="flex";buttons.style.gap="6px";
 const make=(label,primary)=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.style.cssText="border:1px solid #c9d8ec;border-radius:6px;padding:7px 10px;cursor:pointer;font:600 11px Arial;background:"+(primary?"#2464d3;color:white":"white;color:#344c6b");return b};
 const apply=make(assistantText("Apply","Применить"),true),cancel=make(assistantText("Cancel","Отмена"),false);apply.dataset.groqApply="1";cancel.dataset.groqCancel="1";
 buttons.append(apply,cancel);node.append(title,detail,note,buttons);root.append(node);root.scrollTop=root.scrollHeight;
 const settle=(state,text)=>{node.dataset.groqAction=state;buttons.remove();note.textContent=text};
 cancel.onclick=()=>settle("cancelled",assistantText("Cancelled. No data was changed.","Отменено. Данные не изменены."));
 apply.onclick=async()=>{
  if(node.dataset.groqAction!=="pending"||apply.disabled)return;
  apply.disabled=true;cancel.disabled=true;
  note.textContent=assistantText("Checking feasibility on a temporary copy…","Проверяю выполнимость на временной копии…");
  try{
   const reply=await ppGroqApplyProposal(a,snapshot,userMessage);
   settle("applied",reply);
   const history=assistantState.history;
   if(history.at(-1)?.role==="assistant"&&history.at(-2)?.role==="user"&&history.at(-2)?.content===userMessage)history[history.length-1]={role:"assistant",content:(reply+"\n"+detail.textContent).slice(0,1800)};
  }catch(e){
   let msg={validation_busy:assistantText("The validator is busy. Finish optimization or try again.","Валидатор занят. Завершите оптимизацию или повторите проверку."),validation_timed_out:assistantText("The feasibility check did not finish. No data was changed.","Проверка не успела завершиться. Данные не изменены."),validation_unavailable:assistantText("The native validator is unavailable. No data was changed.","Штатный валидатор недоступен. Данные не изменены."),validation_model_not_ready:assistantText("The model is not ready for scheduling. No data was changed.","Модель не готова к расчёту. Данные не изменены."),validation_no_feasible_plan:assistantText("The native check did not find a valid schedule for this change. No data was changed. Review the parameters and resource constraints.","Штатная проверка не нашла допустимый план после изменения. Данные не изменены. Проверьте параметры и ограничения ресурсов."),busy:assistantText("Stop or finish optimization before applying changes.","Сначала завершите или остановите оптимизацию."),unsaved:assistantText("Save or close the open editor, then return to Planning/Chat and apply again.","Сохраните или закройте редактор, вернитесь в Планирование/Чат и примените изменение."),stale:assistantText("The active project or its revision has changed. Request a new proposal.","Проект или его версия изменились. Запросите изменение заново."),save_unconfirmed:assistantText("The save could not be confirmed. Reopen the project and check the data before retrying.","Не удалось подтвердить сохранение. Откройте проект заново и проверьте данные перед повтором.")}[e?.message]||assistantText("The change could not be confirmed. Reopen the project and check its data before retrying.","Не удалось подтвердить изменение. Откройте проект заново и проверьте данные перед повтором.");
   if(Array.isArray(e?.issues)&&e.issues.length)for(const issue of e.issues.slice(0,8))msg+="\n"+assistantText("Order ","Заказ ")+issue.order+" / "+issue.operation+": "+(issue.parameters||[]).map(p=>p.name+" = "+(p.value??"—")).join(", ");
   note.style.whiteSpace="pre-wrap";
   if(["busy","unsaved","validation_busy","validation_timed_out","validation_unavailable"].includes(e?.message)){note.textContent=msg;apply.disabled=false;cancel.disabled=false}
   else settle("failed",msg);
  }
 };
}
// Only suggest a repair when a single existing order has no production
// parameters and a same-process template is available. No writes
// or provider requests occur until the user confirms the displayed values.
function ppGroqOfferIncompleteOrder(){
 try{
  const snapshot=ppGroqLocalEntry();
  if(!snapshot||!snapshot.model?.orders?.length||snapshot.model.orders.length>5000||!document.getElementById("messages"))return;
  if(typeof model!=="object"||!model||ppGroqEditBusy())return;
  const key=snapshot.id+":"+snapshot.revision;
  if(window.__ppGroqOfferedRepair===key)return;
  const absent=snapshot.model.orders.map((o,i)=>({o,i})).filter(({o})=>!o.parameters||typeof o.parameters!=="object"||!Object.keys(o.parameters).length);
  if(absent.length!==1||document.querySelector('[data-groq-action="pending"]'))return;
  const args={kind:"complete_order_parameters",order_index:absent[0].i+1};
  let change;try{({change}=ppGroqPrepareEdit(snapshot.model,args))}catch{return}
  if(!change.templateRecord||!Object.keys(change.parameters||{}).length)return;
  window.__ppGroqOfferedRepair=key;
  const c={args,change};
  assistantBubble(assistantText("Order "+c.change.record+" has no production parameters, unlike other orders of the same process. Review the proposed repair before calculating the schedule.","В заказе "+c.change.record+" отсутствуют производственные параметры, которые заданы в других заказах этого техпроцесса. Проверьте предложенное исправление перед расчётом плана."));
  ppGroqShowProposal({action:{projectId:snapshot.id,revision:snapshot.revision,args:c.args,change:c.change}},snapshot,assistantText("Complete order parameters","Заполнить параметры заказа")+" "+c.change.record);
 }catch{}
}
function ppGroqInstallRepairOffer(){
 const schedule=()=>{clearTimeout(window.__ppGroqRepairTimer);window.__ppGroqRepairTimer=setTimeout(ppGroqOfferIncompleteOrder,1200)};
 if(document.readyState==="complete")schedule();else window.addEventListener("load",schedule,{once:true});
 const chip=document.getElementById("activeProjectChip");
 if(chip)new MutationObserver(schedule).observe(chip,{childList:true,subtree:true,characterData:true});
}
const helpers=[ppGroqStable,ppGroqActionEntry,ppGroqLocalEntry,ppGroqSameEntry,ppGroqEditBusy,ppGroqActionDescription,ppGroqCheckApplied,ppGroqApplyProposal,ppGroqShowProposal,ppGroqOfferIncompleteOrder,ppGroqInstallRepairOffer].map(f=>f.toString()).join("\n");
export const source=prepareSource+"\n"+helpers+"\n";
export function transformActionsHtml(html,helperSource){
 if(typeof html!=="string"||html.includes("PP_GROQ_ACTIONS_V1")||!html.includes("PP_GROQ_PROJECT_CONTEXT_V1"))return html;
 const start="async function sendChat(){";
 const end="\nq('chatSend').onclick=sendChat;";
 if(html.split(start).length!==2||html.split(end).length!==2)return html;
 const a=html.indexOf(start),b=html.indexOf(end,a);
 if(b<=a||b-a>10000)return html;
 let client=html.slice(a,b);
 const edits=[
 ["const seq=assistantState.sequence;","const seq=assistantState.sequence,editSnapshot=ppGroqLocalEntry();"],
 ["JSON.stringify({message,history,includeProject,viewContext:ppGroqCaptureContext()})","JSON.stringify({message,history,includeProject,viewContext:ppGroqCaptureContext(),allowActions:true})"],
 ["assistantBubble(data.reply);","assistantBubble(data.reply);\n  if(data.action)ppGroqShowProposal(data,editSnapshot,message);"],
 ["Sending a message shares current project metrics with Groq. Read-only. Do not include confidential or personal data.","Sending a message shares current project metrics with Groq. Confirm changes before applying. Do not include confidential or personal data."],
 ["При отправке сообщения текущие показатели проекта передаются Groq. Только чтение. Не указывайте конфиденциальные или личные данные.","При отправке сообщения текущие показатели проекта передаются Groq. Изменения требуют подтверждения. Не указывайте конфиденциальные или личные данные."],
 ["Ask a production question…","Ask or change your production data…"],
 ["Задайте вопрос о производстве…","Задайте вопрос или измените данные производства…"],
 ["installAssistantControls();","installAssistantControls();\nppGroqInstallRepairOffer();"]
 ];
 for(const [from] of edits)if(client.split(from).length!==2)return html;
 for(const [from,to] of edits)client=client.replace(from,to);
 return (html.slice(0,a)+"/* PP_GROQ_ACTIONS_V1 */\n"+helperSource+client+html.slice(b)).replace("Sending a message shares current project metrics with Groq. Read-only. Do not include confidential or personal data.","Sending a message shares current project metrics with Groq. Confirm changes before applying. Do not include confidential or personal data.");
}
export function serverTransformSource(){
 return "\nfunction ppGroqActionsHtml(html){return ("+transformActionsHtml.toString()+")(html,"+JSON.stringify(source)+");}\n";
}
