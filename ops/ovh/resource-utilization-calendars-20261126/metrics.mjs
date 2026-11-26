// Plan-derived utilization, independent of the optimizer and saved state.
export function ppCalendarResourceMetrics(plan,model,equipmentSource,employeeSource){
 // Presentation-only metrics from the selected complete schedule. All minutes
 // are relative to the model origin; no reservations, schedules or models are changed.
 const eps=1e-7,arr=v=>Array.isArray(v)?v:[],str=v=>String(v??"").trim(),lower=v=>str(v).toLowerCase(),finite=v=>typeof v==="number"&&Number.isFinite(v);
 const horizon=Number(plan?.duration_minutes);
 if(!model||plan?.valid!==true||plan.partial===true||!finite(horizon)||horizon<=0||horizon>1440*3660||!Array.isArray(plan.generic_operations)||!plan.generic_operations.length)return null;
 const full=[[0,horizon]],duration=xs=>xs.reduce((sum,p)=>sum+p[1]-p[0],0);
 const merge=xs=>{
  const out=[];
  for(const [a,b] of xs.filter(p=>finite(p[0])&&finite(p[1])&&p[1]>p[0]+eps).sort((x,y)=>x[0]-y[0]||x[1]-y[1])){
   const last=out.at(-1);
   if(last&&a<=last[1]+eps)last[1]=Math.max(last[1],b);else out.push([a,b]);
  }
  return out;
 };
 const intersect=(a,b)=>{
  let i=0,j=0;const out=[];
  while(i<a.length&&j<b.length){const lo=Math.max(a[i][0],b[j][0]),hi=Math.min(a[i][1],b[j][1]);if(hi>lo+eps)out.push([lo,hi]);if(a[i][1]<b[j][1])i++;else j++}
  return out;
 };
 const subtract=(a,b)=>{
  let j=0;const out=[];
  for(const [lo,hi] of a){let cursor=lo;while(j<b.length&&b[j][1]<=cursor+eps)j++;for(let k=j;k<b.length&&b[k][0]<hi-eps;k++){if(b[k][0]>cursor+eps)out.push([cursor,Math.min(hi,b[k][0])]);cursor=Math.max(cursor,b[k][1]);if(cursor>=hi-eps)break}if(cursor<hi-eps)out.push([cursor,hi])}
  return out;
 };
 const id=r=>str(r?.__ppid||r?.id||r?.name);
 const eq=arr(equipmentSource??(arr(model.equipment).length?model.equipment:model.autoclaves));
 const staff=arr(employeeSource??model.employees);
 if(eq.length+staff.length>2000||plan.generic_operations.length>100000||arr(plan.setup_operations).length>100000)return null;
 const indexRows=rows=>{
  const by=new Map();
  for(const r of rows){const key=id(r);if(!key||by.has(key))return null;by.set(key,r)}
  return by;
 };
 const equipment=indexRows(eq),employees=indexRows(staff);if(!equipment||!employees)return null;
 const aliases=rows=>{
  const out=new Map();
  for(const r of rows)for(const k of new Set([id(r),str(r.id),str(r.name)].filter(Boolean))){
   if(out.has(k)&&out.get(k)!==id(r))out.set(k,null);else if(!out.has(k))out.set(k,id(r));
  }
  return out;
 };
 const eqAlias=aliases(eq),empAlias=aliases(staff);
 const origin=(()=>{
  const m=str(model.start||plan.start).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if(!m)return null;
  const y=+m[1],mo=+m[2],d=+m[3],h=+(m[4]||0),n=+(m[5]||0),s=+(m[6]||0),fraction=m[7]?Number("0."+m[7]):0;
  const day=new Date(Date.UTC(y,mo-1,d));
  if(day.getUTCFullYear()!==y||day.getUTCMonth()!==mo-1||day.getUTCDate()!==d||h>23||n>59||s>59)return null;
  return {weekday:day.getUTCDay()||7,offset:h*60+n+(s+fraction)/60};
 })();
 const clock=v=>{const m=typeof v==="string"&&v.match(/^([01]\d|2[0-3]):([0-5]\d)$/);return m?+m[1]*60+ +m[2]:null};
 const weeklyBlocks=cal=>{
  if(!cal||!Array.isArray(cal.days)||!cal.days.length||cal.days.some(d=>!Number.isInteger(d)||d<1||d>7)||new Set(cal.days).size!==cal.days.length)return null;
  const start=clock(cal.start);let end=clock(cal.end);
  if(start===null||end===null||start===end&&cal.full_day!==true)return null;
  if(end<=start)end+=1440;
  const breaks=[];
  for(const pair of arr(cal.breaks)){if(!Array.isArray(pair)||pair.length!==2)return null;let a=clock(pair[0]),b=clock(pair[1]);if(a===null||b===null)return null;if(a<start)a+=1440;if(b<=a)b+=1440;if(a<start||b>end||b<=a)return null;breaks.push([a,b])}
  if(cal.breaks!==undefined&&!Array.isArray(cal.breaks))return null;
  let cursor=start;const blocks=[];
  for(const [a,b] of breaks.sort((x,y)=>x[0]-y[0])){if(a<cursor)return null;if(a>cursor)blocks.push([cursor,a]);cursor=b}
  if(cursor<end)blocks.push([cursor,end]);return blocks.length?{days:cal.days,blocks}:null;
 };
 const legacyBlocks=value=>{
  if(!Array.isArray(value))return null;
  const blocks=[];
  for(const p of value){if(!Array.isArray(p)||p.length!==2)return null;const a=clock(p[0]);let b=clock(p[1]);if(a===null||b===null)return null;if(b<=a)b+=1440;blocks.push([a,b])}
  return {days:[1,2,3,4,5,6,7],blocks};
 };
 const shiftCache=new Map();
 const shiftWindows=name=>{
  name=str(name);if(!name||!origin)return null;
  if(shiftCache.has(name))return shiftCache.get(name);
  const cal=model.shift_calendars?.[name];
  const spec=cal!==undefined?weeklyBlocks(cal):legacyBlocks(model.shifts?.[name]);
  if(!spec){shiftCache.set(name,null);return null}
  const out=[],last=Math.ceil((horizon+origin.offset)/1440);
  for(let d=-1;d<=last;d++){
   const weekday=((origin.weekday-1+d)%7+7)%7+1;if(!spec.days.includes(weekday))continue;
   for(const [a,b] of spec.blocks){const lo=Math.max(0,d*1440+a-origin.offset),hi=Math.min(horizon,d*1440+b-origin.offset);if(hi>lo+eps)out.push([lo,hi])}
  }
  const windows=merge(out);shiftCache.set(name,windows);return windows;
 };
 const employeeWindows=new Map(staff.map(e=>[id(e),shiftWindows(e.shift)]));
 const equipmentWindows=new Map(eq.map(e=>[id(e),str(e.shift)?shiftWindows(e.shift):full]));
 const candidates=(req,type,rows)=>{
  const mode=lower(req?.match_mode),refs=arr(req?.resource_refs).map(str).filter(Boolean);
  if(!refs.length&&str(req?.resource_ref))refs.push(str(req.resource_ref));
  if(!refs.length)return mode==="any"?rows.map(id):null;
  const out=new Set();
  for(const ref of refs){
   const prefix=type==="equipment"?"kind:":"role:";
   if(lower(ref).startsWith(prefix)){
    const target=lower(ref.slice(prefix.length));
    if(!target)return null;
    for(const r of rows){const value=type==="equipment"?(r.kind||"other"):(r.role||"Оператор");if(lower(value)===target)out.add(id(r))}
   }else if(ref==="*"||lower(ref)==="any"){for(const r of rows)out.add(id(r))}
   else if(mode==="specific"||!mode){
    const lookup=type==="equipment"?eqAlias:empAlias;
    if(lookup.has(ref)&&!lookup.get(ref))return null;
    if(lookup.get(ref))out.add(lookup.get(ref));
   }else return null;
  }
  return [...out];
 };
 const staffCache=new Map();
 function staffedWindows(requirements){
  if(!requirements.length)return full;
  const key=JSON.stringify(requirements.map(r=>[r.match_mode,r.resource_ref,r.resource_refs,r.quantity,r.consumption_rule]));
  if(staffCache.has(key))return staffCache.get(key);
  const done=value=>{staffCache.set(key,value);return value};
  const slots=[];
  for(const req of requirements){
   if(req.consumption_rule&&req.consumption_rule!=="during_operation")return done(null);
   const n=req.quantity===undefined?1:Number(req.quantity),ids=candidates(req,"employee",staff);
   if(!Number.isSafeInteger(n)||n<=0||n>128||!ids)return done(null);
   if(ids.length<n)return done([]);
   for(let i=0;i<n;i++)slots.push(ids);
   if(slots.length>128)return done(null);
  }
  const ids=[...new Set(slots.flat())];if(ids.length<slots.length)return done([]);
  const unknown=ids.some(x=>employeeWindows.get(x)===null);
  const events=new Map([[0,[]],[horizon,[]]]);
  const add=(time,event)=>{if(!events.has(time))events.set(time,[]);events.get(time).push(event)};
  for(const key of ids)for(const [a,b] of employeeWindows.get(key)||[]){add(a,[key,true]);add(b,[key,false])}
  if(events.size>120000)return done(null);
  const times=[...events.keys()].sort((a,b)=>a-b),active=new Set(),windows=[];
  // Different requirements must be satisfied by different employees, and
  // a quantity greater than one requires simultaneous availability.
  function fits(){
   if(active.size<slots.length)return false;
   const choices=slots.map(xs=>xs.filter(x=>active.has(x))).sort((a,b)=>a.length-b.length);
   if(choices.some(xs=>!xs.length))return false;
   const assigned=new Map();
   const place=(i,seen)=>{
    for(const employee of choices[i]){if(seen.has(employee))continue;seen.add(employee);if(!assigned.has(employee)||place(assigned.get(employee),seen)){assigned.set(employee,i);return true}}
    return false;
   };
   return choices.every((_,i)=>place(i,new Set()));
  }
  for(let i=0;i<times.length-1;i++){
   for(const [key,on] of events.get(times[i])){if(on)active.add(key);else active.delete(key)}
   if(times[i+1]>times[i]+eps&&fits())windows.push([times[i],times[i+1]]);
  }
  const merged=merge(windows);
  return done(unknown&&duration(merged)<horizon-eps?null:merged);
 }
 const processes=arr(model.technical_processes),orders=arr(model.orders),byProcess=new Map(processes.map(p=>[str(p.id),p]));
 const processOrders=new Map();
 for(const o of orders){const p=str(o.technical_process_id);if(!processOrders.has(p))processOrders.set(p,[]);processOrders.get(p).push(o)}
 const allProcesses=!orders.length||orders.some(o=>!byProcess.has(str(o.technical_process_id)));
 const applicable=processes.filter(p=>allProcesses||processOrders.has(str(p.id)));
 const compatible=(machine,order)=>{
  const caps=machine.capabilities||{},params=order?.parameters||{};
  for(const [k,values] of Object.entries(caps.allowed_parameters||{}))if(!Object.hasOwn(params,k)||!(Array.isArray(values)?values:[values]).includes(params[k]))return false;
  for(const [k,v] of Object.entries(caps.min_parameters||{}))if(!Object.hasOwn(params,k)||!finite(Number(params[k]))||Number(params[k])<Number(v))return false;
  for(const [k,v] of Object.entries(caps.max_parameters||{}))if(!Object.hasOwn(params,k)||!finite(Number(params[k]))||Number(params[k])>Number(v))return false;
  return true;
 };
 const modes=new Map(eq.map(e=>[id(e),{autonomous:false,attended:false,unknown:false,windows:[]}]));
 let opCount=0;
 for(const p of applicable)for(const op of arr(p.operations)){
  if(++opCount>5000)return null;
  const reqs=arr(op.resource_requirements),machines=reqs.filter(r=>r.resource_type==="equipment"),staffReqs=reqs.filter(r=>r.resource_type==="employee");
  if(!machines.length)continue;
  const ids=new Set();
  for(const req of machines){const selected=candidates(req,"equipment",eq);if(selected===null)continue;for(const key of selected)ids.add(key)}
  if(!ids.size)continue;
  const available=staffReqs.length?staffedWindows(staffReqs):full,peerOrders=processOrders.get(str(p.id))||[];
  for(const key of ids){
   const m=equipment.get(key),state=modes.get(key);if(!m||!state)continue;
   if(peerOrders.length&&!peerOrders.some(o=>compatible(m,o)))continue;
   if(staffReqs.length){state.attended=true;if(available===null)state.unknown=true;else state.windows.push(...available)}
   else state.autonomous=true;
  }
 }
 const occupation=new Map([...eq,...staff].map(r=>[r, {production:[],setup:[],wait:[],actualStaffed:false,actualAutonomous:false,staffSetup:false}]));
 const setup=row=>row?.is_setup===true||lower(row?.phase)==="setup"||lower(row?.type)==="setup";
 const getIds=(row,key,singular)=>arr(row[key]).length?arr(row[key]).map(str):row[singular]!=null?[str(row[singular])]:[];
 const rows=[...plan.generic_operations.map(row=>[row,false]),...arr(plan.setup_operations).map(row=>[row,true])];
 for(const [r,detached] of rows){
  const a=Number(r?.start_min),b=Number(r?.end_min);
  if(!finite(a)||!finite(b)||a< -eps||b<a-eps||b>horizon+eps*Math.max(1,horizon))return null;
  if(b<=a+eps)continue;
  const lo=Math.max(0,a),hi=Math.min(horizon,b);if(hi<=lo+eps)continue;
  const phase=lower(r.phase||r.type),isWait=r.is_wait===true||["wait","waiting","reserved_wait","blocked_wait"].includes(phase);
  const isReserved=isWait&&(r.resource_reserved===true||r.reserved===true||phase==="reserved_wait"||phase==="blocked_wait");
  const kind=detached||setup(r)?"setup":isWait?(isReserved?"wait":null):"production";
  if(!kind)continue;
  const machineIds=[...new Set(getIds(r,"equipment_ids","equipment_id"))],staffIds=[...new Set(getIds(r,"employee_ids","employee_id"))];
  for(const [ids,lookup,by] of [[machineIds,eqAlias,equipment],[staffIds,empAlias,employees]])for(const rawId of ids){
   const key=lookup.get(rawId),record=by.get(key),value=occupation.get(record);if(!value)return null;
   value[kind].push([lo,hi]);
   if(by===equipment&&kind==="production"){if(staffIds.length)value.actualStaffed=true;else value.actualAutonomous=true}
   if(by===equipment&&kind==="setup"&&staffIds.length)value.staffSetup=true;
  }
 }
 const summarize=(r,kind,windows,mode)=>{
  const own=occupation.get(r),production=merge(own.production),setupIntervals=subtract(merge(own.setup),production);
  const active=merge([...production,...setupIntervals]),wait=subtract(merge(own.wait),active),occupied=merge([...active,...wait]);
  const calendarBusy=duration(occupied),available=windows===null?null:duration(windows);
  const inside=windows===null?null:{production:duration(intersect(production,windows)),setup:duration(intersect(setupIntervals,windows)),wait:duration(intersect(wait,windows))};
  const busy=inside===null?null:inside.production+inside.setup+inside.wait;
  return {id:id(r),name:str(r.name||id(r)),kind,mode,horizon,available,calendarBusy,calendarPercent:100*calendarBusy/horizon,
   production:inside?.production??null,setup:inside?.setup??null,wait:inside?.wait??null,
   free:available===null?null:Math.max(0,available-busy),busy,
   offCalendar:busy===null?null:Math.max(0,calendarBusy-busy),effectivePercent:available!==null&&available>eps?100*busy/available:null};
 };
 const equipmentRows=eq.map(r=>{
  const key=id(r),state=modes.get(key),used=occupation.get(r),base=equipmentWindows.get(key);
  let mode=state.autonomous?(state.attended||used.staffSetup?"mixed":"autonomous"):state.attended?"attended":"unused",windows=base;
  // If the model and selected native assignments disagree, do not invent an
  // availability denominator. Keep the separate calendar metric visible.
  if(base===null||!state.autonomous&&state.unknown||
     used.actualStaffed&&!state.attended||used.actualAutonomous&&!state.autonomous){mode="unknown";windows=null}
  else if(!state.autonomous&&state.attended)windows=intersect(base,merge(state.windows));
  return summarize(r,"equipment",windows,mode);
 });
 const employeeRows=staff.map(r=>summarize(r,"employee",employeeWindows.get(id(r)),employeeWindows.get(id(r))===null?"unknown":"employee"));
 return {horizon,equipment:equipmentRows,employees:employeeRows};
}
export function ppCalendarUtilizationHtml(result,language){
 const ru=language==="ru",t=(en,r)=>ru?r:en;
 const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const fmt=n=>n===null||!Number.isFinite(n)?"—":n.toFixed(1)+"%";
 const hrs=n=>n===null||!Number.isFinite(n)?"—":(n/60).toLocaleString(ru?"ru-RU":"en-US",{maximumFractionDigits:2})+" "+t("h","ч");
 if(!result)return '<div class="ppt pp-utilization-v2"><h3>'+t("Resource utilization","Загрузка ресурсов")+'</h3><p class="pp-util-caption">'+t("A complete valid production schedule is needed to calculate resource utilization.","Для расчёта загрузки необходим полный допустимый производственный план.")+'</p></div>';
 const modes={autonomous:t("Autonomous","Автономное"),attended:t("Staff-dependent","Зависит от сотрудников"),mixed:t("Autonomous + staff-dependent stages","Автономное + операции с сотрудником"),unused:t("No applicable operation","Нет применимых операций"),unknown:t("Calendar or dependency not determined","Календарь или зависимость не определены"),employee:t("Working calendar","Рабочий календарь")};
 const line=r=>{
  const unknown=r.effectivePercent===null,period=r.available===null?null:r.available;
  const details=t("Production: ","Производство: ")+hrs(r.production)+" · "+t("Setup: ","Переналадки: ")+hrs(r.setup)+" · "+t("Reserved waiting: ","Зарезервированное ожидание: ")+hrs(r.wait)+" · "+t("Free: ","Свободно: ")+hrs(r.free);
  const segment=(n,cl)=>'<i class="'+cl+'" style="width:'+(period&&n!==null?Math.max(0,Math.min(100,100*n/period)):0).toFixed(5)+'%"></i>';
  const bar=unknown?'<div class="pp-util-track pp-util-unknown" aria-hidden="true"></div>':'<div class="pp-util-track" title="'+esc(details)+'" role="img" aria-label="'+esc(details)+'">'+segment(r.production,"pp-util-production")+segment(r.setup,"pp-util-setup")+segment(r.wait,"pp-util-wait")+segment(r.free,"pp-util-free")+'</div>';
  const off=r.offCalendar!==null&&r.offCalendar>0.001?'<small class="pp-util-warning">'+esc(t("Occupied outside effective calendar: ","Занято вне эффективного календаря: ")+hrs(r.offCalendar))+'</small>':'';
  return '<div class="ppr pp-util-row" data-resource-kind="'+r.kind+'"><div class="pp-util-head"><b>'+esc(r.name)+'</b><div class="pp-util-values"><small>'+t("Effective","Эффективная")+'</small> <span>'+fmt(r.effectivePercent)+'</span><small>'+t("Calendar","Календарная")+': '+fmt(r.calendarPercent)+'</small></div></div>'+bar+'<div class="pp-util-meta"><small>'+esc(modes[r.mode]||"")+'</small><small>'+esc(t("Occupied / available: ","Занято / доступно: ")+hrs(r.busy)+" / "+hrs(r.available))+'</small></div>'+off+'</div>';
 };
 const group=(rows,title)=>'<section class="ppt pp-util-group" data-util-group="'+(rows===result.equipment?"equipment":"employees")+'"><h3>'+title+' <small>('+rows.length+')</small></h3>'+(rows.length?rows.map(line).join(""):'<p class="pp-util-caption">'+t("No resources","Нет ресурсов")+'</p>')+'</section>';
 return '<div class="pp-utilization-v2"><div class="pp-util-explainer"><h3>'+t("Resource utilization","Загрузка ресурсов")+'</h3><p class="pp-util-caption">'+t("Entire production plan","Весь производственный план")+' · '+esc(hrs(result.horizon))+' · '+t("Effective: occupied / available working time. Calendar: occupied / total plan time.","Эффективная: занятое / доступное рабочее время. Календарная: занятое / общее время плана.")+'</p><div class="pp-util-legend"><small><i class="pp-util-production"></i>'+t("Production","Производство")+'</small><small><i class="pp-util-setup"></i>'+t("Setup","Переналадки")+'</small><small><i class="pp-util-wait"></i>'+t("Reserved waiting","Зарезервированное ожидание")+'</small><small><i class="pp-util-free"></i>'+t("Free working time","Свободное рабочее время")+'</small></div></div>'+group(result.equipment,t("Equipment","Оборудование"))+group(result.employees,t("Employees","Сотрудники"))+'<p class="pp-util-caption">'+t("Availability is based on resource requirements and working calendars, not employee bookings on other machines. Only explicitly reserved waiting intervals are counted; gaps are free time.","Доступность определяется требованиями операций и рабочими календарями, а не занятостью сотрудника на другом оборудовании. Учитывается только явно зарезервированное ожидание; промежутки относятся к свободному времени.")+'</p></div>';
}
