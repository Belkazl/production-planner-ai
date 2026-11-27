// Project-local wall-clock time. Never convert the browser's wall clock to UTC.
export function ppPlanningStartMinute(raw){
 if(typeof raw!=="string")return null;
 const m=raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?$/);
 if(!m||m[1].startsWith("0000"))return null;
 const value=m[1],d=new Date(value+":00Z");
 return Number.isFinite(+d)&&d.toISOString().slice(0,16)===value?value:null;
}
export function ppPlanningStartNow(date=new Date()){
 if(!(date instanceof Date)||!Number.isFinite(+date))throw Error("invalid_clock");
 const p=n=>String(n).padStart(2,"0");
 return String(date.getFullYear()).padStart(4,"0")+"-"+p(date.getMonth()+1)+"-"+p(date.getDate())+"T"+p(date.getHours())+":"+p(date.getMinutes());
}
export function ppPlanningStartInput(date,time){
 const s=String(date||"")+"T"+String(time||"");
 return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)&&ppPlanningStartMinute(s)===s?s:null;
}
export function ppPlanningStartCurrentPlan(project){
 const p=project?.lastPlan;
 return !!(p&&p.valid===true&&!p.partial&&p.ok!==false&&(p.operations?.length||p.generic_operations?.length)&&(p._revision==null||Number(p._revision)===Number(project.revision)));
}
export function ppPlanningStartValue(project,now){
 const m=project?.model,stored=ppPlanningStartMinute(m?.start);
 // Keep explicitly chosen starts and existing accepted schedules stable.
 // For a not-yet-planned legacy project, default to now without editing it
 // merely because it was opened. The first run commits this start.
 return stored&&(m.planning_start_initialized===true||ppPlanningStartCurrentPlan(project))?stored:ppPlanningStartMinute(now);
}
export function ppPlanningStartEdit(model,value,now){
 const date=ppPlanningStartInput(value?.slice(0,10),value?.slice(11,16));
 if(!date||date!==value)throw Error("invalid_planning_start");
 if(date<now)throw Error("planning_start_in_past");
 return {...structuredClone(model),start:date+":00",planning_start_initialized:true};
}
