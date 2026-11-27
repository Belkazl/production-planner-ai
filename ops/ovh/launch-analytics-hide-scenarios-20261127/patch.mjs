import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {ppCalendarResourceMetrics,ppCalendarUtilizationHtml} from "../resource-utilization-calendars-20261126/metrics.mjs";
export function analyticsData(project,calc){
 const model=project?.model,plan=project?.lastPlan,arr=v=>Array.isArray(v)?v:[],num=v=>typeof v==="number"&&Number.isFinite(v)&&v>=0?v:null;
 if(!model||!plan||plan.valid!==true||plan.ok===false||plan.partial===true||num(plan.duration_minutes)===null||plan.duration_minutes<=0||!arr(plan.generic_operations).length||plan._revision!=null&&Number(plan._revision)!==Number(project.revision))return null;
 const metrics=calc(plan,model);
 const rows=metrics?[...metrics.equipment,...metrics.employees]:[];
 const ranked=rows.filter(r=>Number.isFinite(r.effectivePercent)&&r.available>0).sort((a,b)=>b.effectivePercent-a.effectivePercent||b.busy-a.busy);
 const sum=(group,field)=>group.some(r=>!Number.isFinite(r[field]))?null:group.reduce((n,r)=>n+r[field],0);
 const groupAverage=group=>{const a=sum(group,"available"),b=sum(group,"busy");return a>0&&b!==null?100*b/a:null};
 const list=arr(model.materials),byId=new Map();
 for(const r of list){for(const key of [r.id,r.name,r.__ppid].filter(x=>x!=null)){const k=String(key);if(byId.has(k)&&byId.get(k)!==r)byId.set(k,null);else byId.set(k,r)}}
 const materials=list.map(r=>({id:String(r.id??r.name),name:String(r.name??r.id),unit:String(r.unit??""),quantity:0}));
 const byRecord=new Map(list.map((r,i)=>[r,materials[i]]));
 let recorded=false,materialUnknown=false;
 for(const op of plan.generic_operations){
  if(op.materials===undefined)continue;
  if(!Array.isArray(op.materials)){materialUnknown=true;continue}
  for(const m of op.materials){const resource=byId.get(String(m.id??m.material_id??""));const qty=num(m.quantity);
   if(!resource||qty===null){materialUnknown=true;continue}
   if(m.unit&&resource.unit&&String(m.unit).trim().toLowerCase()!==String(resource.unit).trim().toLowerCase()){materialUnknown=true;continue}
   recorded=true;byRecord.get(resource).quantity+=qty;
  }
 }
 // Only report recorded quantities; absence of material data is not zero usage.
 const materialRows=recorded&&!materialUnknown?materials.filter(m=>m.quantity>0):null;
 return {metrics,ranked,materials:materialRows,materialCount:list.length,orders:arr(model.orders).length,equipment:arr(model.equipment).length||arr(model.autoclaves).length,employees:arr(model.employees).length,
  duration:plan.duration_minutes,batches:num(plan.batch_count),wait:num(plan.operator_wait_minutes),idle:num(plan.machine_idle_minutes),
  equipmentLoad:metrics?groupAverage(metrics.equipment):null,staffLoad:metrics?groupAverage(metrics.employees):null,
  equipmentSetup:metrics?sum(metrics.equipment,"setup"):null,equipmentFree:metrics?sum(metrics.equipment,"free"):null};
}
export function analyticsHtml(project,data,lang,renderUtil){
 const ru=lang==="ru",t=(en,r)=>ru?r:en,esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
 const number=n=>n==null||!Number.isFinite(n)?"—":n.toLocaleString(ru?"ru-RU":"en-US",{maximumFractionDigits:2});
 const pct=n=>n==null||!Number.isFinite(n)?"—":n.toFixed(1)+"%";
 const hours=n=>n==null?"—":number(n/60)+" "+t("h","ч");
 const title='<h2 class="pp-ana-title">'+t("Analytics","Аналитика")+'</h2>';
 if(!data)return title+'<section class="pp-ana-card"><h3>'+t("No current calculated plan","Нет актуального рассчитанного плана")+'</h3><p>'+t("Calculate or recalculate the production plan to view its analytics.","Рассчитайте или пересчитайте производственный план, чтобы увидеть аналитику.")+'</p><button type="button" data-pp-ana-plan>'+t("Open plan","Открыть план")+'</button></section>';
 const card=(key,label,value,detail="")=>'<div class="pp-ana-card pp-ana-kpi" data-pp-kpi="'+key+'"><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong>'+(detail?'<small>'+esc(detail)+'</small>':'')+'</div>';
 const top=data.ranked.slice(0,5);
 const most=top[0];
 const materialRows=data.materials===null?'<p>'+t(data.materialCount?"The plan does not contain complete recorded material consumption.":"No materials in this project.",data.materialCount?"В плане нет полных данных о расходе материалов.":"В проекте нет материалов.")+'</p>':'<table><thead><tr><th>'+t("Material","Материал")+'</th><th>'+t("Planned consumption","Плановый расход")+'</th></tr></thead><tbody>'+data.materials.map(r=>'<tr><td>'+esc(r.name)+'</td><td>'+esc(number(r.quantity)+" "+r.unit)+'</td></tr>').join("")+'</tbody></table>';
 return title+'<p class="pp-ana-note">'+t("Latest calculated plan · Planned figures, not actual production results","Последний рассчитанный план · Плановые, а не фактические показатели")+'</p>'+
 '<div class="pp-ana-kpis">'+card("orders",t("Orders","Заказы"),number(data.orders))+card("equipment",t("Equipment","Оборудование"),number(data.equipment))+card("employees",t("Employees","Сотрудники"),number(data.employees))+card("duration",t("Plan duration","Длительность плана"),hours(data.duration),number(data.duration)+" "+t("min","мин"))+card("equipment-load",t("Equipment utilization","Загрузка оборудования"),pct(data.equipmentLoad),t("Weighted by available time","По доступному времени"))+card("staff-load",t("Employee utilization","Загрузка сотрудников"),pct(data.staffLoad),t("Weighted by available time","По доступному времени"))+'</div>'+
 '<section class="pp-ana-card"><h3>'+t("Potential bottlenecks","Возможные узкие места")+'</h3><p class="pp-ana-note">'+t("Highest effective utilization; high load alone does not prove a bottleneck.","Наибольшая эффективная загрузка; сама по себе высокая загрузка не доказывает наличие узкого места.")+'</p>'+(most?'<table><thead><tr><th>'+t("Resource","Ресурс")+'</th><th>'+t("Type","Тип")+'</th><th>'+t("Effective utilization","Эффективная загрузка")+'</th></tr></thead><tbody>'+top.map(r=>'<tr><td>'+esc(r.name)+'</td><td>'+t(r.kind==="equipment"?"Equipment":"Employee",r.kind==="equipment"?"Оборудование":"Сотрудник")+'</td><td>'+pct(r.effectivePercent)+'</td></tr>').join("")+'</tbody></table>':'<p>'+t("Availability could not be determined.","Доступность не определена.")+'</p>')+'</section>'+
 '<div class="pp-ana-kpis pp-ana-kpis-detail">'+card("batches",t("Batches","Партии"),number(data.batches))+card("wait",t("Resource waiting (plan metric)","Ожидание ресурсов (показатель плана)"),hours(data.wait),t("Cumulative across operations","Суммарно по операциям"))+card("idle",t("Equipment idle (plan metric)","Простой оборудования (показатель плана)"),hours(data.idle))+card("setup",t("Equipment setup in available time","Переналадки в доступное время оборудования"),hours(data.equipmentSetup))+card("free",t("Free equipment working time","Свободное рабочее время оборудования"),hours(data.equipmentFree))+'</div>'+
 renderUtil(data.metrics,lang)+
 '<section class="pp-ana-card"><h3>'+t("Material consumption","Расход материалов")+'</h3>'+materialRows+'</section>'+
 '<section class="pp-ana-card"><h3>'+t("AI recommendations","Рекомендации AI")+'</h3><p>'+t("Ask the assistant to analyze these planned metrics and suggest ways to improve the schedule. You review the request before sending.","Попросите ассистента проанализировать плановые показатели и предложить улучшения. Запрос можно проверить перед отправкой.")+'</p><button type="button" data-pp-ana-ai>'+t("Ask AI to analyze","Запросить анализ AI")+'</button></section>';
}
export function installAnalytics(calc,renderUtil,compute,render){
 const rail=document.querySelector(".side"),section=document.getElementById("sectionView");if(!rail||!section)return;
 const norm=s=>String(s||"").trim().toLowerCase();
 const item=name=>[...rail.querySelectorAll(".item")].find(x=>x.dataset.ppSolarKey===name||x.querySelector("[data-pp-solar-holder]")?.dataset.ppSolarHolder===name||({analytics:["analytics","аналитика"],scenarios:["scenarios","сценарии"],plan:["plan","план"]}[name]||[]).includes(norm(x.textContent)));
 const project=()=>{try{const id=localStorage.getItem("prodplan.project.active.v2");return JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]").find(p=>String(p.id)===String(id))||null}catch{return null}};
 const lang=()=>document.getElementById("ppLanguageSelect")?.value==="ru"?"ru":"en";
 let host=null,signature="",scheduled=false;
 const refresh=()=>{
  scheduled=false;
  const scenario=item("scenarios");
  if(scenario){if(!scenario.hasAttribute("data-pp-launch-hidden")){scenario.setAttribute("data-pp-launch-hidden","");scenario.setAttribute("aria-hidden","true")}if(scenario.classList.contains("active")){item("plan")?.click();return}}
  if(!item("analytics")?.classList.contains("active")){
   if(section.hasAttribute("data-pp-analytics-active"))section.removeAttribute("data-pp-analytics-active");
   if(host?.isConnected)host.remove();host=null;signature="";return;
  }
  // Use only the plan persisted for the current project. Never reuse a global
  // preview from a different project, or invent data while optimization runs.
  const p=project(),language=lang(),key=JSON.stringify([p?.id,p?.revision,p?.model,p?.lastPlan,language]);
  if(host?.isConnected&&key===signature)return;
  let data=null;try{data=compute(p,calc)}catch{}
  if(!host?.isConnected){host=document.createElement("div");host.setAttribute("data-pp-analytics-dashboard","");section.append(host)}
  section.setAttribute("data-pp-analytics-active","");
  host.innerHTML=render(p,data,language,renderUtil);signature=key;
  host.querySelector("[data-pp-ana-plan]")?.addEventListener("click",()=>item("plan")?.click());
  host.querySelector("[data-pp-ana-ai]")?.addEventListener("click",()=>{
   const input=document.getElementById("chatInput");if(!input||input.disabled||!data)return;
   // A draft only. Never send project data or call the provider automatically.
   const facts={duration_minutes:data.duration,batches:data.batches,resource_wait_minutes:data.wait,equipment_idle_minutes:data.idle,equipment_effective_utilization:data.equipmentLoad,employee_effective_utilization:data.staffLoad,equipment_setup_available_minutes:data.equipmentSetup,top_resources:data.ranked.slice(0,5).map(r=>({name:r.name,kind:r.kind,effective_percent:r.effectivePercent,available_minutes:r.available})),material_consumption:data.materials?.slice(0,20)};
   const prompt=(lang()==="ru"?"Проанализируй эти плановые показатели и предложи улучшения. Эффективная загрузка рассчитана относительно доступного рабочего времени ресурса, не календарного времени. Не утверждай наличие узкого места только по загрузке. Не изменяй проект.":"Analyze these planned metrics and recommend improvements. Effective utilization is based on available working time, not calendar time. Do not infer a bottleneck solely from utilization. Do not modify the project.")+"\n"+JSON.stringify(facts);
   input.value=input.value.trim()?input.value+"\n\n"+prompt:prompt;input.dispatchEvent(new Event("input",{bubbles:true}));input.focus();
  });
 };
 const schedule=()=>{if(!scheduled){scheduled=true;queueMicrotask(refresh)}};
 new MutationObserver(schedule).observe(rail,{childList:true,subtree:true,attributes:true,attributeFilter:["class"]});
 new MutationObserver(schedule).observe(section,{childList:true});
 document.addEventListener("change",e=>{if(e.target?.id==="ppLanguageSelect")schedule()});
 window.addEventListener("storage",e=>{if(e.key==="prodplan.projects.v2"||e.key==="prodplan.project.active.v2")schedule()});
 // Native navigation and same-window save changes do not emit a storage event.
 rail.addEventListener("click",schedule);
 refresh();
}
export function transformAnalytics(html,css,script){
 if(typeof html!=="string"||html.includes("PP_LAUNCH_ANALYTICS_V1")||!html.includes("PP_BOTTLENECK_SYSTEM_LANGUAGE_V1")||!html.includes("PP_CALENDAR_UTILIZATION_V1")||html.split("</head>").length!==2||html.split("</body>").length!==2)return html;
 const old='if(parent.closest("script,style,noscript,textarea,svg,code,pre,[contenteditable],.pp-i18n-route-label"))return;';
 const next='if(parent.closest("script,style,noscript,textarea,svg,code,pre,[contenteditable],.pp-i18n-route-label,[data-pp-analytics-dashboard]"))return;';
 if(html.split(old).length!==2)return html;
 return html.replace(old,next).replace("</head>",()=>css+"</head>").replace("</body>",()=>script+"</body>");
}
export const css="<style id=\"ppLaunchAnalyticsStyle\">.side .item[data-pp-launch-hidden]{display:none!important}#sectionView[data-pp-analytics-active]>:not([data-pp-analytics-dashboard]){display:none!important}#sectionView [data-pp-analytics-dashboard]{display:grid;gap:12px;min-width:0} .pp-ana-title{font-size:20px;margin:0}.pp-ana-note{font-size:12px;color:#60738a;margin:0 0 4px;line-height:1.5}.pp-ana-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}.pp-ana-card{border:1px solid #d7e1ee;border-radius:10px;background:#fff;padding:14px;min-width:0}.pp-ana-card h3{font-size:14px;margin:0 0 8px}.pp-ana-card p{font-size:12px;line-height:1.5}.pp-ana-kpi{display:grid;align-content:start;gap:6px}.pp-ana-kpi small{font-size:11px;color:#51667d}.pp-ana-kpi strong{font-size:21px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.pp-ana-card table{width:100%;border-collapse:collapse;font-size:12px}.pp-ana-card th,.pp-ana-card td{padding:9px 8px;text-align:left;border-bottom:1px solid #e6edf5}.pp-ana-card th:last-child,.pp-ana-card td:last-child{text-align:right}.pp-ana-card button{cursor:pointer;border:1px solid #bed2ee;background:#2464e9;color:white;border-radius:7px;padding:8px 12px;font-size:12px}</style>";
export const script='<script id="ppLaunchAnalyticsJs">/* PP_LAUNCH_ANALYTICS_V1 */('+installAnalytics.toString()+')(('+ppCalendarResourceMetrics.toString()+'),('+ppCalendarUtilizationHtml.toString()+'),('+analyticsData.toString()+'),('+analyticsHtml.toString()+'));</script>';
export function patchSource(auth){
 assert(!auth.includes("function ppLaunchAnalyticsPage("),"LAUNCH_ANALYTICS_ALREADY_INSTALLED");
 const before="const assistantHtml=ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))))))))));",after="const assistantHtml=ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))))))))))));";
 assert.equal(auth.split(before).length,2,"LAUNCH_ANALYTICS_AUTH_ANCHOR_DRIFT");
 const append="\n// PP_LAUNCH_ANALYTICS_V1\nfunction ppLaunchAnalyticsPage(html){return ("+transformAnalytics.toString()+")(html,"+JSON.stringify(css)+","+JSON.stringify(script)+");}\n";
 const result=auth.replace(before,after)+append;assert.equal(result.slice(0,-append.length).replace(after,before),auth);return result;
}
if(process.argv[1]?.endsWith("/launch-analytics-hide-scenarios-20261127/patch.mjs")){
 const [input,output]=process.argv.slice(2);assert(input&&output);writeFileSync(output,patchSource(readFileSync(input,"utf8")),{mode:0o600});console.log("LAUNCH_ANALYTICS_EXACT_PATCH_PASS");
}
