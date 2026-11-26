// Read the same rendered metrics the planner displays, not an alternative formula.
function ppGroqCaptureContext(){
 const visible=el=>!!el&&el.getClientRects().length>0&&getComputedStyle(el).display!=="none";
 const planView=document.getElementById("planView"),section=document.getElementById("sectionView");
 const tabs=[...document.querySelectorAll("#planView .tabs > div")];
 const index=tabs.findIndex(x=>x.classList.contains("a"));
 const modes=["equipment_gantt","employee_gantt","materials","orders_gantt","resource_utilization","bottlenecks"];
 const sideItems=[...document.querySelectorAll(".side .item")];
 const sideIndex=sideItems.findIndex(x=>x.classList.contains("active"));
 const sections=["chat","production","orders","materials","equipment","employees","plan","analytics","scenarios","settings"];
 let projectId="",revision=null;
 try{
  projectId=localStorage.getItem("prodplan.project.active.v2")||"";
  const p=JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]").find(x=>x.id===projectId);
  if(p&&Number.isSafeInteger(Number(p.revision))&&Number(p.revision)>=0)revision=Number(p.revision);
 }catch{}
 const result={projectId,revision,view:visible(planView)?modes[index]||"planning":visible(section)?sections[sideIndex]||"section":"none",kpis:{},utilization:[],utilizationSource:"none",totalRows:0};
 if(!projectId||!visible(planView))return result;
 for(const [key,id] of Object.entries({duration:"dur",batches:"cycles",operatorWait:"waitKpi",machineIdle:"idleKpi",durationDelta:"durDelta",batchesDelta:"cyclesDelta",operatorWaitDelta:"waitDelta",machineIdleDelta:"idleDelta"})){
  const el=document.getElementById(id),t=el?.textContent?.trim()||"";
  if(t&&t.length<=80)result.kpis[key]=t;
 }
 const secondary=document.getElementById("ppTabsView");
 let container=null;
 if(index===4&&visible(secondary)){
  container=secondary;result.utilizationSource="visible_resource_utilization";
 }else if(typeof window.__ppGroqRenderResourceUtilization==="function"&&window.__ppGenericPlan?.generic_schedule&&window.__ppGenericPlan?.valid===true&&!window.__ppGenericPlan?.partial){
  // The renderer is pure; do not change selected tabs, model or DOM.
  try{
   const p=window.__ppGenericPlan;
   const duration=Number(String(result.kpis.duration||"").replace(/\s/g,"").replace(",",".")); 
   if(Number.isFinite(duration)&&duration>0&&Math.round(p.duration_minutes)===Math.round(duration)&&!window.__ppOptimizationInFlight){
    container=document.createElement("div");container.innerHTML=window.__ppGroqRenderResourceUtilization(p);
    result.utilizationSource="same_resource_utilization_renderer";
   }
  }catch{}
 }
 if(container){
  let rows=[];
  for(const row of container.querySelectorAll(".ppr")){
   const name=row.querySelector("b")?.textContent?.trim()||"";
   const percent=[...row.querySelectorAll("span")].map(x=>x.textContent.trim()).find(x=>/^\d+(?:[.,]\d+)?\s*%$/.test(x));
   if(name&&percent)rows.push({name:name.slice(0,120),percent:percent.slice(0,20)});
  }
  if(!rows.length){
   for(const row of container.querySelectorAll("table tbody tr")){
    const cells=[...row.querySelectorAll("td")].map(x=>x.textContent.trim());
    const percent=cells.slice(1).find(x=>/^\d+(?:[.,]\d+)?\s*%$/.test(x));
    if(cells[0]&&percent)rows.push({name:cells[0].slice(0,120),percent:percent.slice(0,20)});
   }
  }
  result.totalRows=rows.length;
  // Bounded snapshot of the visible view. All normal-sized projects fit.
  result.utilization=rows.slice(0,160);
 }
 return result;
}
export const marker="PP_GROQ_PROJECT_CONTEXT_V1";
const capture=ppGroqCaptureContext.toString();
export function transformContextHtml(html,fn){
 if(typeof html!=="string"||html.includes("PP_GROQ_PROJECT_CONTEXT_V1")||!html.includes("PP_GROQ_ASSISTANT_UI_V1")||!html.includes("ppGroqChatCleanupV1"))return html;
 const edits=[
 ['async function sendChat(){','/* PP_GROQ_PROJECT_CONTEXT_V1 */\n'+fn+'\nasync function sendChat(){'],
 ['const project=assistantSyncProject(),includeProject=!!consent?.checked;','const project=assistantSyncProject(),includeProject=true;'],
 ['JSON.stringify({message,history,includeProject})','JSON.stringify({message,history,includeProject,viewContext:ppGroqCaptureContext()})'],
 ['<label><input type="checkbox" id="ppGroqConsent"><span id="ppGroqConsentLabel">Include anonymized project summary</span></label>',''],
 ['if(!consent||!label||!notice||!inp)return;','if(!notice||!inp)return;'],
 ['  label.textContent=assistantText("Include anonymized project summary","Добавить обезличенную сводку проекта");\n',''],
 ['consent.addEventListener("change",()=>{assistantSyncProject();assistantState.history=[];assistantState.includeProject=consent.checked;assistantState.sequence++});',''],
 ['Messages are sent to Groq. Do not include confidential or personal data. Read-only.','Sending a message shares current project metrics with Groq. Read-only. Do not include confidential or personal data.'],
 ['Messages and recent chat context are sent to Groq. Do not include confidential or personal data. Read-only.','Sending a message shares current project metrics with Groq. Read-only. Do not include confidential or personal data.'],
 ['Сообщения и недавний контекст чата передаются Groq. Не указывайте конфиденциальные или личные данные. Только чтение.','При отправке сообщения текущие показатели проекта передаются Groq. Только чтение. Не указывайте конфиденциальные или личные данные.'],
 ['Project summary is unavailable. Try without sharing it.','Project data is not synchronized. Reopen the project and try again.'],
 ['Сводка проекта недоступна. Попробуйте без неё.','Данные проекта не синхронизированы. Откройте проект заново и повторите запрос.'],
 ['function overrideSecondary(name){','window.__ppGroqRenderResourceUtilization=renderLoad;\nfunction overrideSecondary(name){']
 ];
 for(const [a] of edits)if(html.split(a).length!==2)return html;
 for(const [a,b] of edits)html=html.replace(a,b);
 return html;
}
export function serverTransformSource(){
 return "\n// "+marker+"\nfunction ppGroqProjectContextHtml(html){return ("+transformContextHtml.toString()+")(html,"+JSON.stringify(capture)+");}\n";
}
export {capture,ppGroqCaptureContext};
