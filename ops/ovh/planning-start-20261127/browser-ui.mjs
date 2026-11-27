import {ppPlanningStartMinute,ppPlanningStartNow,ppPlanningStartInput,ppPlanningStartCurrentPlan,ppPlanningStartValue,ppPlanningStartEdit} from "./shared.mjs";

export function ppPlanningStartEntry(storage){
 try{
  const id=storage?storage["prodplan.project.active.v2"]:localStorage.getItem("prodplan.project.active.v2");
  const rows=JSON.parse(storage?storage["prodplan.projects.v2"]:localStorage.getItem("prodplan.projects.v2")||"[]");
  return Array.isArray(rows)?rows.find(p=>String(p.id)===String(id))||null:null;
 }catch{return null}
}
export function ppPlanningStartStable(value){
 const normalize=v=>Array.isArray(v)?v.map(normalize):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).filter(k=>k!=="__ppid").sort().map(k=>[k,normalize(v[k])])):v;
 return JSON.stringify(normalize(value));
}
export function ppPlanningStartSame(a,b){
 return !!a&&!!b&&String(a.id)===String(b.id)&&Number(a.revision||0)===Number(b.revision||0)&&ppPlanningStartStable(a.model)===ppPlanningStartStable(b.model);
}
export function ppPlanningStartBusy(){
 return !!(window.__ppOptimizationInFlight||window.__PP_SSE_PROGRESS_V1__?.state?.active||window.__ppGroqApplyingEdit||window.__ppStopRequestPending||(typeof busy!=="undefined"&&busy===true));
}
export async function ppPlanningStartCommit(value){
 const before=ppPlanningStartEntry();
 if(!before?.model||typeof model!=="object"||!model||!ppPlanningStartSame(before,{...before,model}))throw Error("stale");
 if(ppPlanningStartBusy())throw Error("busy");
 const clickedAt=ppPlanningStartNow();
 ppPlanningStartEdit(before.model,value,clickedAt);
 if(ppPlanningStartMinute(before.model.start)===value&&before.model.planning_start_initialized===true)return before.model;
 const wasInert=document.body.inert;document.body.inert=true;
 window.__ppPlanningStartSaving=true;
 const request=async(path,method="GET",payload)=>{
  const r=await fetch(path,{method,credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json","Accept":"application/json"},body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(35000)});
  const data=await r.json();
  if(!r.ok||data?.ok===false)throw Error("save_failed");
  return data;
 };
 try{
  const db=await request("/api/db-storage"),remote=ppPlanningStartEntry(db.storage||{});
  if(!ppPlanningStartSame(before,remote)||!ppPlanningStartSame(before,ppPlanningStartEntry()))throw Error("stale");
  if(ppPlanningStartBusy())throw Error("busy");
  const current=await request("/api/model");
  if(!current.model||ppPlanningStartStable(current.model)!==ppPlanningStartStable(model)||!ppPlanningStartSame(before,ppPlanningStartEntry()))throw Error("stale");
  const next=ppPlanningStartEdit(current.model,value,clickedAt);
  const d=await request("/api/project/model/import","POST",{model:next});
  let accepted=d.model,ready=d.model_ready;
  if(!accepted||typeof ready!=="boolean"){
   const check=await request("/api/model");accepted=check.model;ready=check.model_ready;
  }
  if(!accepted||ppPlanningStartMinute(accepted.start)!==value||accepted.planning_start_initialized!==true||
     ppPlanningStartStable(accepted.orders||[])!==ppPlanningStartStable(current.model.orders||[])){
   if(ppPlanningStartSame(before,ppPlanningStartEntry()))await request("/api/project/model/import","POST",{model:current.model}).catch(()=>{});
   throw Error("save_failed");
  }
  if(!ppPlanningStartSame(before,ppPlanningStartEntry()))throw Error("stale");
  const records=JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]");
  const i=records.findIndex(p=>String(p.id)===String(before.id));
  if(i<0)throw Error("stale");
  // Same project revision semantics as the native order/process editors.
  // Named saved plans are retained; only the current calculated plan becomes stale.
  records[i]={...records[i],model:structuredClone(accepted),lastPlan:null,revision:Number(records[i].revision||0)+1,updatedAt:new Date().toISOString()};
  localStorage.setItem("prodplan.projects.v2",JSON.stringify(records));
  model=accepted;modelReady=!!ready;hasResult=false;
  if(typeof renderSummary==="function")renderSummary();
  if(typeof clearPlan==="function")clearPlan();
  const ru=document.getElementById("ppLanguageSelect")?.value==="ru",t=(en,r)=>ru?r:en;
  const valid=document.getElementById("valid"),meta=document.getElementById("meta"),opt=document.getElementById("opt");
  if(valid){valid.textContent=ready?t("Model ready","Модель готова"):t("Model needs data","Нужны данные");valid.className="pill"+(ready?" ok":"")}
  if(meta)meta.textContent=t("Model changed · run optimization again","Модель изменена · запустите оптимизацию заново");
  if(opt){opt.disabled=!ready;opt.textContent=t("Start optimization","Запустить оптимизацию")}
  const confirmed=ppPlanningStartEntry((await request("/api/db-storage")).storage||{});
  const saved=ppPlanningStartEntry();
  if(!ppPlanningStartSame(saved,confirmed)||Number(saved?.revision)!==Number(before.revision||0)+1||saved?.lastPlan||ppPlanningStartMinute(saved?.model?.start)!==value)throw Error("save_unconfirmed");
  return accepted;
 }finally{document.body.inert=wasInert;window.__ppPlanningStartSaving=false}
}
export function ppInstallPlanningStart(){
 if(window.__PP_PLANNING_START_V1__)return;
 const view=document.getElementById("planView"),bar=view?.querySelector(".titlebar");
 if(!bar)return;
 let group=document.createElement("div");group.id="ppPlanningStart";group.className="pp-planning-start";
 const title=document.createElement("label");title.htmlFor="ppPlanningStartDate";title.className="pp-planning-start-label";
 const date=document.createElement("input");date.id="ppPlanningStartDate";date.type="date";date.className="pp-edit-input";
 const time=document.createElement("input");time.id="ppPlanningStartTime";time.type="time";time.step="60";time.className="pp-edit-input";
 const now=document.createElement("button");now.type="button";now.id="ppPlanningStartNow";now.className="pp-saved-btn";
 const apply=document.createElement("button");apply.type="button";apply.id="ppPlanningStartApply";apply.className="pp-saved-btn";
 const status=document.createElement("span");status.className="pp-planning-start-status";status.setAttribute("role","status");
 group.append(title,date,time,now,apply,status);bar.insertAdjacentElement("afterend",group);
 let key="",dirty=false,committing=false,replay=false,scheduled=false,shown="",message="",isError=false;
 const ru=()=>document.getElementById("ppLanguageSelect")?.value==="ru";
 const t=(en,r)=>ru()?r:en;
 const say=(en,r,error=false)=>{message=t(en,r);isError=error;refresh()};
 const setText=(el,v)=>{if(el.textContent!==v)el.textContent=v};
 const setValue=v=>{if(!v)return;date.value=v.slice(0,10);time.value=v.slice(11,16);shown=v};
 const chosen=()=>ppPlanningStartInput(date.value,time.value);
 const refresh=()=>{
  scheduled=false;
  const p=ppPlanningStartEntry(),k=p?JSON.stringify([p.id,p.revision,p.model?.start,p.model?.planning_start_initialized]):"";
  if(group.hidden!==!p?.model)group.hidden=!p?.model;
  if(k!==key){key=k;dirty=false;message="";isError=false;setValue(ppPlanningStartValue(p,ppPlanningStartNow()))}
  else if(!dirty&&!shown)setValue(ppPlanningStartValue(p,ppPlanningStartNow()));
  const disabled=!p?.model||committing||ppPlanningStartBusy();
  for(const el of [date,time,now])if(el.disabled!==disabled)el.disabled=disabled;
  const canApply=!disabled&&dirty&&!!chosen();
  if(apply.disabled===canApply)apply.disabled=!canApply;
  setText(title,t("Planning start","Начало планирования"));setText(now,t("Now","Сейчас"));setText(apply,t("Apply","Применить"));
  date.setAttribute("aria-label",t("Planning start date","Дата начала планирования"));
  time.setAttribute("aria-label",t("Planning start time","Время начала планирования"));
  setText(status,message);status.dataset.error=isError?"true":"false";
 };
 const schedule=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(refresh)}};
 const edited=()=>{dirty=chosen()!==shown;message="";isError=false;refresh()};
 for(const el of [date,time]){el.addEventListener("input",edited);el.addEventListener("change",edited)}
 const save=async(value)=>{
  if(committing||ppPlanningStartBusy())return false;
  if(!value){say("Enter a valid date and time.","Укажите корректную дату и время.",true);return false}
  committing=true;say("Saving…","Сохранение…");
  try{
   await ppPlanningStartCommit(value);
   key="";dirty=false;shown="";refresh();
   say("Saved · recalculate the plan","Сохранено · пересчитайте план");
   return true;
  }catch(e){
   const text={planning_start_in_past:["Choose the current time or a future date.","Укажите текущее время или будущую дату."],invalid_planning_start:["Enter a valid date and time.","Укажите корректную дату и время."],busy:["Stop optimization before changing the start.","Остановите оптимизацию перед изменением даты."],stale:["Project changed. Reload before editing the start.","Проект изменился. Обновите страницу перед изменением даты."]}[e?.message]||["Could not confirm the saved start. Check the project and try again.","Не удалось подтвердить сохранение даты. Проверьте проект и повторите попытку."];
   say(...text,true);return false;
  }finally{committing=false;refresh()}
 };
 now.addEventListener("click",()=>{setValue(ppPlanningStartNow());dirty=true;void save(chosen())});
 apply.addEventListener("click",()=>void save(chosen()));
 document.addEventListener("click",async e=>{
  const button=e.target?.closest?.("#opt,#ppOptimizerStartOver");
  if(!button||replay||button.disabled||ppPlanningStartBusy())return;
  const p=ppPlanningStartEntry();
  if(!p?.model)return;
  const auto=!p.model.planning_start_initialized&&!ppPlanningStartCurrentPlan(p);
  if(!dirty&&!auto&&!committing)return;
  e.preventDefault();e.stopImmediatePropagation();
  if(committing)return;
  const value=dirty?chosen():ppPlanningStartNow();
  if(!await save(value))return;
  if(String(ppPlanningStartEntry()?.id)!==String(p.id)||!button.isConnected||button.disabled)return;
  replay=true;try{button.click()}finally{replay=false}
 },true);
 new MutationObserver(schedule).observe(bar,{childList:true,subtree:true,attributes:true,attributeFilter:["disabled","class"]});
 const rail=document.querySelector(".side");if(rail)new MutationObserver(schedule).observe(rail,{attributes:true,subtree:true,attributeFilter:["class"]});
 document.addEventListener("change",e=>{if(e.target?.id==="ppLanguageSelect")schedule()});
 document.addEventListener("click",schedule);
 window.addEventListener("storage",schedule);
 window.__PP_PLANNING_START_V1__={refresh:schedule};
 refresh();
}
export const source=[ppPlanningStartMinute,ppPlanningStartNow,ppPlanningStartInput,ppPlanningStartCurrentPlan,ppPlanningStartValue,ppPlanningStartEdit,ppPlanningStartEntry,ppPlanningStartStable,ppPlanningStartSame,ppPlanningStartBusy,ppPlanningStartCommit,ppInstallPlanningStart].map(f=>f.toString()).join("\n");
export const css='<style id="ppPlanningStartStyle">.pp-planning-start{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:12px 0 4px;padding:0;min-width:0}.pp-planning-start[hidden]{display:none!important}.pp-planning-start-label{font-size:12px;font-weight:600;color:#34465b;margin-right:4px}.pp-planning-start input{height:32px;box-sizing:border-box;font:inherit;font-size:12px;width:auto;min-width:0;padding:5px 8px;border:1px solid #d4e0ec;border-radius:7px;background:white;color:#16283e}.pp-planning-start input[type=date]{width:145px}.pp-planning-start input[type=time]{width:108px}.pp-planning-start .pp-saved-btn{height:32px;white-space:nowrap}.pp-planning-start-status{font-size:11px;color:#61748b}.pp-planning-start-status[data-error=true]{color:#b42318}</style>';
export const script='<script id="ppPlanningStartJs">/* PP_PLANNING_START_V1 */\n'+source+'\nppInstallPlanningStart();</script>';
