import {ppShipByValue,ppShipByStart,ppShipByReport,ppShipByScore,ppShipByCompare,ppShipByFormatMinutes} from "./shared.mjs";
export function ppShipByProject(){
 try{const id=localStorage.getItem("prodplan.project.active.v2");return JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]").find(p=>String(p.id)===String(id))||null}catch{return null}
}
export function ppShipByCurrentPlan(p){
 const plan=p?.lastPlan;
 if(!plan||plan.valid!==true||plan.partial||plan.ok===false||(plan._revision!=null&&Number(plan._revision)!==Number(p.revision)))return null;
 return plan;
}
export function ppShipByLang(){return document.getElementById("ppLanguageSelect")?.value==="ru"}
export function ppShipByText(status,late,ru=ppShipByLang()){
 return status==="on_time"?(ru?"Вовремя":"On time"):status==="late"?(ru?"Опоздание на ":"Late by ")+ppShipByFormatMinutes(late,ru):status==="no_deadline"?(ru?"Без срока":"No deadline"):(ru?"Не запланирован":"Not planned");
}
export function ppShipByEscape(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
export function ppShipByCells(o){
 let due="";try{due=ppShipByValue(o.ship_by)||""}catch{}
 return '<td class="pp-ship-by-date"><input class="pp-edit-input" data-f="ship_by" type="datetime-local" step="60" aria-label="'+(ppShipByLang()?'Отгрузить до':'Ship by')+'" value="'+ppShipByEscape(due)+'"></td><td class="pp-ship-by-status"><span data-pp-ship-status data-status="'+(due?"not_planned":"no_deadline")+'">'+ppShipByText(due?"not_planned":"no_deadline")+'</span></td>';
}
export function ppShipByValidate(root){
 for(const input of root.querySelectorAll('input[data-f="ship_by"]')){
  input.setCustomValidity("");
  try{if(input.validity.badInput)throw Error();ppShipByValue(input.value)}
  catch{input.setCustomValidity(ppShipByLang()?"Укажите корректную дату и время.":"Enter a valid date and time.");input.reportValidity();return false}
 }
 return true;
}
export function ppShipBySave(base,row){
 const field=row.querySelector('input[data-f="ship_by"]');
 if(!field)throw Error("ship_by_editor_missing");
 const due=ppShipByValue(field.value);
 if(due===null)delete base.ship_by;else base.ship_by=due;
 return base;
}
export function ppShipByAnalytics(project,report,ru){
 const t=(en,r)=>ru?r:en,esc=ppShipByEscape;
 const on=report.filter(r=>r.status==="on_time").length,late=report.filter(r=>r.status==="late"),unknown=report.length-on-late.length;
 const stat=(label,value)=>'<div><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong></div>';
 const pct=report.length&&unknown===0?(100*on/report.length).toLocaleString(ru?"ru-RU":"en-US",{maximumFractionDigits:1})+"%":"—";
 const rows=late.slice().sort((a,b)=>b.late_minutes-a.late_minutes).map(r=>'<tr><td>'+esc(r.order_id)+'</td><td>'+esc(r.ship_by.replace("T"," "))+'</td><td data-status="late">'+esc(ppShipByFormatMinutes(r.late_minutes,ru))+'</td></tr>').join("");
 return '<h3>'+t("Order deadlines","Сроки отгрузки")+'</h3><div class="pp-ship-by-kpis">'+stat(t("With deadline","Со сроком"),report.length)+stat(t("On time","Вовремя"),on)+stat(t("Late","С опозданием"),late.length)+stat(t("On-time completion","Выполнение в срок"),pct)+'</div>'+
  (unknown?'<p class="pp-ana-note">'+esc(t("Not planned: ","Не запланировано: ")+unknown)+'</p>':"")+
  (rows?'<h3>'+t("Late orders","Заказы с опозданием")+'</h3><table><thead><tr><th>'+t("Order","Заказ")+'</th><th>'+t("Ship by","Отгрузить до")+'</th><th>'+t("Delay","Опоздание")+'</th></tr></thead><tbody>'+rows+'</tbody></table>':"");
}
export function ppInstallShipBy(){
 if(window.__PP_ORDER_SHIP_BY_V1__)return;
 window.__PP_ORDER_SHIP_BY_V1__={compare:(a,b)=>ppShipByCompare(ppShipByProject()?.model,a,b)};
 const section=document.getElementById("sectionView"),rail=document.querySelector(".side"),planView=document.getElementById("planView");
 let scheduled=false;
 const refresh=()=>{
  scheduled=false;
  const project=ppShipByProject(),plan=ppShipByCurrentPlan(project),ru=ppShipByLang(),report=ppShipByReport(project?.model,plan),byId=new Map(report.map(x=>[x.order_id,x]));
  if(section){
   for(const row of section.querySelectorAll('tr:has(input[data-f="ship_by"])')){
    const input=row.querySelector('input[data-f="ship_by"]'),status=row.querySelector("[data-pp-ship-status]"),idx=Number(row.dataset.i??row.dataset.idx);
    if(!status)continue;
    const order=Number.isInteger(idx)&&idx>=0?project?.model?.orders?.[idx]:null;
    const id=row.querySelector('[data-f="id"]')?.value??order?.id;
    const quantity=row.querySelector('[data-f="area"]')?.value,process=row.querySelector('[data-f="technical_process_id"]')?.value;
    const same=!!order&&String(id)===String(order.id)&&String(input.value)===String(order.ship_by||"")&&
      (quantity==null||Number(quantity)===Number(order.quantity??order.area))&&(process==null||String(process)===String(order.technical_process_id??""));
    const r=same?byId.get(String(id)):null,state=!input.value?"no_deadline":r?.status||"not_planned";
    const label=ppShipByText(state,r?.late_minutes,ru);
    if(status.dataset.status!==state)status.dataset.status=state;
    if(status.textContent!==label)status.textContent=label;
    const title=ru?"Отгрузить до":"Ship by";if(input.getAttribute("aria-label")!==title)input.setAttribute("aria-label",title);
   }
   const dash=section.querySelector("[data-pp-analytics-dashboard]");
   if(dash){
    let card=dash.querySelector("[data-pp-ship-analytics]");
    const html=ppShipByAnalytics(project,report,ru);
    if(!card){card=document.createElement("section");card.className="pp-ana-card";card.dataset.ppShipAnalytics="";dash.insertBefore(card,dash.querySelector(".pp-ana-kpis")?.nextSibling||null)}
    if(card.innerHTML!==html)card.innerHTML=html;
   }
  }
  if(planView){
   // Annotate only real order lanes. Use their native bars and displayed
   // time scale, never an inferred start from the first visible operation.
   const byLane=new Map(),lateBars=new Set();
   for(const bar of planView.querySelectorAll(".pg2-bar,.pp3-bar")){
    if(bar.__ppResourceKind!=="order"||!bar.__ppOperation||bar.__ppKind==="setup")continue;
    const lane=bar.parentElement,oid=String(bar.__ppOperation.order??bar.__ppResource?.id??"");
    const r=byId.get(oid);if(!r||r.status==="not_planned"||!plan)continue;
    const shown=bar.__ppPlan;
    if(shown!==plan&&(!shown||shown.partial||shown.duration_minutes!==plan.duration_minutes||shown.operations?.length!==plan.operations?.length))continue;
    if(!byLane.has(lane))byLane.set(lane,{r,bars:[]});
    byLane.get(lane).bars.push(bar);
    const start=Number(bar.__ppOperation.start_min),end=Number(bar.__ppOperation.end_min);
    if(r.status==="late"&&end>r.deadline_min&&end>start){lateBars.add(bar);bar.dataset.ppShipLate="";bar.style.setProperty("--pp-ship-late-start",Math.max(0,Math.min(100,100*(r.deadline_min-start)/(end-start)))+"%")}
   }
   for(const bar of planView.querySelectorAll("[data-pp-ship-late]"))if(!lateBars.has(bar)){delete bar.dataset.ppShipLate;bar.style.removeProperty("--pp-ship-late-start")}
   for(const marker of planView.querySelectorAll("[data-pp-ship-marker]"))if(!byLane.has(marker.parentElement))marker.remove();
   for(const [lane,{r,bars}] of byLane){
    const samples=bars.map(bar=>({bar,start:Number(bar.__ppOperation.start_min),end:Number(bar.__ppOperation.end_min)})).filter(x=>Number.isFinite(x.start)&&Number.isFinite(x.end)&&x.end>x.start&&x.bar.offsetWidth>2).sort((a,b)=>(b.end-b.start)-(a.end-a.start));
    if(!samples.length)continue;
    const {bar,start,end}=samples[0],scale=bar.offsetWidth/(end-start);
    const x=bar.offsetLeft+(r.deadline_min-start)*scale;
    if(!Number.isFinite(x)||x<0||x>lane.scrollWidth){lane.querySelector("[data-pp-ship-marker]")?.remove();continue}
    let marker=lane.querySelector("[data-pp-ship-marker]");
    if(!marker){marker=document.createElement("span");marker.dataset.ppShipMarker="";marker.setAttribute("role","img");lane.append(marker)}
    const title=(ru?"Отгрузить до: ":"Ship by: ")+r.ship_by.replace("T"," ")+" · "+ppShipByText(r.status,r.late_minutes,ru);
    marker.dataset.status=r.status;marker.style.left=x.toFixed(2)+"px";marker.title=title;marker.setAttribute("aria-label",title);
   }
  }
 };
 const schedule=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(refresh)}};
 if(section)new MutationObserver(schedule).observe(section,{childList:true,subtree:true});
 if(planView){new MutationObserver(schedule).observe(planView,{childList:true,subtree:true});planView.addEventListener("click",schedule)}
 if(rail)new MutationObserver(schedule).observe(rail,{attributes:true,subtree:true,attributeFilter:["class"]});
 document.addEventListener("input",e=>{if(e.target?.closest?.("#sectionView"))schedule()});
 document.addEventListener("change",schedule);
 window.addEventListener("storage",schedule);window.addEventListener("resize",schedule);
 schedule();
}
export const browserFunctions=[ppShipByValue,ppShipByStart,ppShipByReport,ppShipByScore,ppShipByCompare,ppShipByFormatMinutes,ppShipByProject,ppShipByCurrentPlan,ppShipByLang,ppShipByText,ppShipByEscape,ppShipByCells,ppShipByValidate,ppShipBySave,ppShipByAnalytics,ppInstallShipBy].map(f=>f.toString()).join("\n");
export const css='<style id="ppShipByStyle">#sectionView .pp-ship-by-date{min-width:180px;width:205px}#sectionView .pp-ship-by-date input{width:100%;min-width:0;box-sizing:border-box;font:inherit}#sectionView .pp-ship-by-status{min-width:120px;white-space:nowrap} [data-pp-ship-status]{font-size:12px;color:#687c92}[data-pp-ship-status][data-status="on_time"]{color:#167844}[data-pp-ship-status][data-status="late"],[data-pp-ship-analytics] [data-status="late"]{color:#b42318}[data-pp-ship-marker]{position:absolute;top:0;bottom:0;width:0;border-left:2px dashed #167844;z-index:4;pointer-events:none}[data-pp-ship-marker][data-status="late"]{border-color:#b42318}[data-pp-ship-late]::after{content:"";position:absolute;top:0;bottom:0;left:var(--pp-ship-late-start);right:0;background:rgba(180,35,24,.55);pointer-events:none;border-radius:inherit}.pp-ship-by-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin:8px 0 14px}.pp-ship-by-kpis div{display:grid;gap:4px}.pp-ship-by-kpis small{font-size:11px;color:#51667d}.pp-ship-by-kpis strong{font-size:20px;font-variant-numeric:tabular-nums}</style>';
export const script='<script id="ppShipByJs">/* PP_ORDER_SHIP_BY_V1 */\n'+browserFunctions+'\nppInstallShipBy();</script>';
