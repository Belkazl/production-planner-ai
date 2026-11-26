// Read-only context built from the authenticated account's active project.
// The browser snapshot represents the current rendered view, not a server-side
// authority for model changes. Its identifiers are never sent to the provider.
const ppGroqViewNames=new Set(["equipment_gantt","employee_gantt","materials","orders_gantt","resource_utilization","bottlenecks","planning","chat","production","orders","equipment","employees","plan","analytics","scenarios","settings","section","none"]);
const ppGroqViewSources=new Set(["none","visible_resource_utilization","same_resource_utilization_renderer"]);
const ppGroqKpiKeys=new Set(["duration","batches","operatorWait","machineIdle","durationDelta","batchesDelta","operatorWaitDelta","machineIdleDelta"]);
function ppGroqSafeLabel(value){
 if(typeof value!=="string")return "";
 const s=value.trim().replace(/[\r\n\t]+/g," ").slice(0,120);
 if(!s||/[\x00-\x1f<>]|(?:https?:\/\/|www\.|@|gsk_|sk-|bearer\s|password\s*[:=]|api[_ -]?key\s*[:=])/i.test(s))return "";
 return s;
}
function ppGroqValidateView(value){
 if(value===undefined)return null;
 const invalid=()=>{throw Error("assistant_invalid_request")};
 if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(k=>!["projectId","revision","view","kpis","utilization","utilizationSource","totalRows"].includes(k)))invalid();
 if(typeof value.projectId!=="string"||value.projectId.length>200||!(value.revision===null||Number.isSafeInteger(value.revision)&&value.revision>=0)||!ppGroqViewNames.has(value.view)||!ppGroqViewSources.has(value.utilizationSource))invalid();
 if(!value.kpis||typeof value.kpis!=="object"||Array.isArray(value.kpis)||Object.keys(value.kpis).some(k=>!ppGroqKpiKeys.has(k)))invalid();
 const kpis={};
 for(const [k,v] of Object.entries(value.kpis)){
  if(typeof v!=="string"||v.length>80)invalid();
  // The localized numeric KPIs contain units, punctuation and delta signs only.
  if(/^[\d\s.,+%()\-−–—\u00a0\u202f:а-яА-ЯёЁa-zA-Z]+$/u.test(v)&&/^[\s+\-−–—\d]/u.test(v))kpis[k]=v;
 }
 if(!Array.isArray(value.utilization)||value.utilization.length>160||!Number.isSafeInteger(value.totalRows)||value.totalRows<value.utilization.length||value.totalRows>100000)invalid();
 const utilization=value.utilization.map(r=>{
  if(!r||typeof r!=="object"||Object.keys(r).some(k=>!["name","percent"].includes(k))||typeof r.name!=="string"||r.name.length>120||typeof r.percent!=="string"||r.percent.length>20||!/^\d{1,7}(?:[.,]\d{1,6})?\s*%$/.test(r.percent))invalid();
  return {name:r.name,percent:r.percent};
 });
 if(utilization.length&&value.utilizationSource==="none")invalid();
 if(value.utilizationSource==="visible_resource_utilization"&&value.view!=="resource_utilization")invalid();
 return {projectId:value.projectId,revision:value.revision,view:value.view,kpis,utilization,utilizationSource:value.utilizationSource,totalRows:value.totalRows};
}
function ppGroqCurrentView(model,view,message){
 if(!view)return null;
 const eq=ppGroqList(model?.equipment?.length?model.equipment:model?.autoclaves),emp=ppGroqList(model?.employees);
 const aliases=new Map();
 const add=(resource,i,kind)=>{
  const name=String(resource?.name||resource?.id||"").trim().slice(0,120);
  if(!name)return;
  // Never transmit employee names. Machine labels are needed to match the UI.
  const label=kind==="employee"?"Employee "+(i+1):ppGroqSafeLabel(resource?.name||resource?.id)||"Equipment "+(i+1);
  if(!aliases.has(name))aliases.set(name,[]);
  aliases.get(name).push({resource:kind,index:i+1,label});
 };
 eq.forEach((r,i)=>add(r,i,"equipment"));emp.forEach((r,i)=>add(r,i,"employee"));
 const rows=[];
 for(const r of view.utilization){
  const matches=aliases.get(r.name.trim())||[];
  if(matches.length!==1)continue; // No ambiguous name or unknown resource.
  const m=matches[0],n=Number(r.percent.replace("%","").replace(",",".").trim());
  if(!Number.isFinite(n)||n<0||n>100000)continue;
  rows.push({...m,displayedPercent:r.percent});
 }
 // Normally include every machine and employee. Very large projects are
 // bounded, prioritizing resources explicitly mentioned in the question.
 const query=String(message||"").toLocaleLowerCase();
 const rank=r=>r.resource==="equipment"&&query.includes(r.label.toLocaleLowerCase())?0:r.resource==="equipment"?1:2;
 const sorted=rows.map((r,i)=>({r,i})).sort((a,b)=>rank(a.r)-rank(b.r)||a.i-b.i).map(x=>x.r);
 const selected=[];
 let chars=0;
 for(const r of sorted){
  const size=JSON.stringify(r).length;
  if(chars+size>5400)continue;
  selected.push(r);chars+=size;
 }
 return {activeView:view.view,source:"browser_snapshot_at_message_send",kpis:view.kpis,
  resourceUtilization:{source:view.utilizationSource,displayedRows:selected,rowsInView:view.totalRows,matchedRows:rows.length,complete:selected.length===view.totalRows,
   interpretation:view.utilizationSource==="same_resource_utilization_renderer"?"Exact native renderer values: total reserved operation minutes divided by total plan duration, not shift-available minutes.":"Exact percentage text rendered by the application's utilization view; do not substitute a different denominator or claim real-world execution."}};
}
function ppGroqAddDetails(summary,model,plan,view,message){
 const eq=ppGroqList(model?.equipment?.length?model.equipment:model?.autoclaves),emp=ppGroqList(model?.employees),orders=ppGroqList(model?.orders),processes=ppGroqList(model?.technical_processes),materials=ppGroqList(model?.materials);
 const eqIndex=new Map(eq.map((r,i)=>[String(r?.id),i+1])),empIndex=new Map(emp.map((r,i)=>[String(r?.id),i+1])),orderIndex=new Map(orders.map((r,i)=>[String(r?.id),i+1]));
 const safeNumber=ppGroqNumber;
 const name=(r,fallback)=>ppGroqSafeLabel(r?.name)||fallback;
 const query=String(message||"").toLocaleLowerCase();
 const sortEquipment=eq.map((r,i)=>({r,i})).sort((a,b)=>Number(query.includes(name(b.r,"Equipment "+(b.i+1)).toLocaleLowerCase()))-Number(query.includes(name(a.r,"Equipment "+(a.i+1)).toLocaleLowerCase()))||a.i-b.i);
 const equipment=sortEquipment.slice(0,28).map(({r,i})=>({equipment:i+1,label:name(r,"Equipment "+(i+1)),capacity:safeNumber(r?.capacity),unit:ppGroqUnit(r?.capacity_unit),throughputPerHour:safeNumber(r?.timing_profile?.throughput_per_hour)}));
 const details={equipment,employees:emp.slice(0,20).map((r,i)=>({employee:i+1,shift:ppGroqSafeLabel(r?.shift)})),materials:materials.slice(0,14).map((r,i)=>({material:i+1,label:name(r,"Material "+(i+1)),unit:ppGroqUnit(r?.unit),initialStock:safeNumber(r?.initial_stock??r?.initial_stock_kg),deliveries:ppGroqList(r?.deliveries).slice(0,3).map(d=>({quantity:safeNumber(d?.quantity),at:typeof d?.at==="string"&&/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?$/.test(d.at)?d.at:undefined}))})),
  processes:processes.slice(0,6).map((r,i)=>({process:i+1,operations:ppGroqList(r?.operations).slice(0,12).map((o,j)=>({operation:j+1,label:name(o,"Operation "+(j+1)),durationMinutes:safeNumber(o?.duration_min),sequence:safeNumber(o?.sequence),requirements:ppGroqList(o?.resource_requirements).slice(0,6).map(q=>({type:["equipment","employee","material"].includes(q?.resource_type)?q.resource_type:undefined,quantity:safeNumber(q?.quantity),unit:ppGroqUnit(q?.unit),equipment:eqIndex.get(String(q?.resource_ref)),employee:empIndex.get(String(q?.resource_ref))}))}))})),
  savedPlanDetails:null};
 if(plan?.valid===true&&!plan.partial){
  const operations=ppGroqList(plan.generic_operations?.length?plan.generic_operations:plan.operations);
  const matched=new Set(sortEquipment.filter(({r,i})=>query.includes(name(r,"Equipment "+(i+1)).toLocaleLowerCase())).map(({i})=>i+1));
  const samples=[];
  for(const r of operations.slice(0,30000)){
   const machines=ppGroqList(r?.equipment_ids).map(x=>eqIndex.get(String(x))).filter(Boolean);
   if(matched.size&&!machines.some(x=>matched.has(x)))continue;
   if(samples.length>=20)break;
   const a=safeNumber(r?.start_min),b=safeNumber(r?.end_min);
   if(a===null||b===null||b<=a)continue;
   samples.push({equipment:machines,employees:ppGroqList(r?.employee_ids).map(x=>empIndex.get(String(x))).filter(Boolean),order:orderIndex.get(String(r?.order)),batch:safeNumber(r?.batch),batchQuantity:safeNumber(r?.batch_quantity),operation:ppGroqSafeLabel(r?.operation_name),startMinute:a,endMinute:b,isSetup:r?.is_setup===true});
  }
  details.savedPlanDetails={source:"last saved valid plan; the displayed view takes precedence",durationMinutes:safeNumber(plan.duration_minutes),batchCount:safeNumber(plan.batch_count),operatorWaitMinutes:safeNumber(plan.operator_wait_minutes),machineIdleMinutes:safeNumber(plan.machine_idle_minutes),operations:operations.length,setupOperations:ppGroqList(plan.setup_operations).length,sampleOperations:samples};
 }
 // Preserve the view snapshot and the original bounded summary; fit additional
 // fields in a bounded context budget, with an explicit incompleteness flag.
 const max=10800;
 const result={displayedView:view,projectSummary:summary,projectDetails:details};
 const arrays=()=>[details.savedPlanDetails?.sampleOperations,details.processes,details.materials,details.employees,details.equipment,summary.plan?.sampleIdleGaps,summary.processSamples,summary.equipmentSamples,summary.orderSamples,summary.weeklyCalendars,summary.shiftWindows].filter(a=>Array.isArray(a)&&a.length);
 while(JSON.stringify(result).length>max){
  const a=arrays();if(!a.length)break;
  a.sort((x,y)=>JSON.stringify(y).length-JSON.stringify(x).length);
  a[0].pop();result.detailsTruncated=true;
 }
 return result;
}
async function ppGroqOwnedContextV2(req,view,message){
 const response=await fetch(PP_AUTH_GATEWAY_ORIGIN+"/api/db-storage",{headers:{cookie:req.headers.get("cookie")||"",accept:"application/json"},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(10000)});
 if(response.status!==200)throw Error("assistant_context_unavailable");
 const data=await response.json();
 const storage=data?.storage;
 let projects=storage?.["prodplan.projects.v2"];
 if(typeof projects==="string")projects=JSON.parse(projects);
 const active=storage?.["prodplan.project.active.v2"]||"";
 if(view&&view.projectId!==active)throw Error("assistant_context_unavailable");
 const entry=Array.isArray(projects)?projects.find(p=>p&&p.id===active):null;
 if(view&&entry&&view.revision!==null&&Number(entry.revision)!==view.revision)throw Error("assistant_context_unavailable");
 if(!entry||!entry.model)return ppGroqAddDetails(ppGroqSummarize(ppAccountModelEmpty(),null),ppAccountModelEmpty(),null,null,message);
 const model=ppAccountModelFromStorage(data);
 const p=entry.lastPlan;
 const plan=p?.valid===true&&p.partial!==true&&ppAccountPlanBelongsToModel(p,model)?p:null;
 return ppGroqAddDetails(ppGroqSummarize(model,plan),model,plan,ppGroqCurrentView(model,view,message),message);
}
