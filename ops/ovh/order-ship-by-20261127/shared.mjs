// One project-local wall-clock date, independent of browser timezone.
export function ppShipByValue(raw){
 if(raw==null||raw==="")return null;
 if(typeof raw!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)||raw.startsWith("0000"))throw Error("invalid_ship_by");
 const date=new Date(raw+":00Z");
 if(!Number.isFinite(+date)||date.toISOString().slice(0,16)!==raw)throw Error("invalid_ship_by");
 return raw;
}
export function ppShipByStart(raw){
 if(typeof raw!=="string")return null;
 const m=raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?$/);
 if(!m)return null;
 try{ppShipByValue(m[1]);}catch{return null}
 const date=Date.parse(m[1]+(m[2]||":00")+"Z");return Number.isFinite(date)?date:null;
}
export function ppShipByReport(model,plan){
 const rows=Array.isArray(model?.orders)?model.orders:[], start=ppShipByStart(model?.start);
 const report=rows.filter(o=>o?.ship_by!=null&&o.ship_by!=="").map(o=>{
  let date=null;try{date=ppShipByValue(o.ship_by)}catch{}
  return {order_id:String(o.id),ship_by:date,deadline_min:date!=null&&start!=null?(Date.parse(date+":00Z")-start)/60000:null,completion_min:null,late_minutes:null,status:"not_planned"};
 });
 if(!report.length||!plan||plan.valid!==true||plan.partial||!Array.isArray(plan.operations))return report;
 const ends=new Map(),invalid=new Set();
 for(const row of plan.operations){
  if(row?.is_setup||row?.phase==="setup")continue;
  const id=String(row?.order),end=row?.end_min;
  if(typeof end!=="number"||!Number.isFinite(end)||end<0){invalid.add(id);continue}
  ends.set(id,Math.max(ends.get(id)??0,end));
 }
 for(const row of report){
  const end=ends.get(row.order_id);if(end==null||invalid.has(row.order_id)||row.deadline_min==null)continue;
  const late=Math.max(0,end-row.deadline_min);
  Object.assign(row,{completion_min:end,late_minutes:late,status:late>1e-7?"late":"on_time"});
 }
 return report;
}
export function ppShipByScore(model,plan){
 const report=ppShipByReport(model,plan);
 if(!report.length||report.some(r=>r.status==="not_planned")||typeof plan?.duration_minutes!=="number"||!Number.isFinite(plan.duration_minutes)||plan.duration_minutes<0)return null;
 return [report.filter(r=>r.status==="late").length,report.reduce((s,r)=>s+r.late_minutes,0),plan.duration_minutes];
}
export function ppShipByCompare(model,a,b){
 const x=ppShipByScore(model,a),y=ppShipByScore(model,b);
 if(!x||!y)return null;
 for(let i=0;i<x.length;i++){const d=x[i]-y[i];if(Math.abs(d)>(i===0?0:1e-7))return Math.sign(d)}
 return 0;
}
export function ppShipByApply(model,args){
 if(!model||!Array.isArray(model.orders)||!args||!Number.isSafeInteger(args.order_index)||args.order_index<1||args.order_index>model.orders.length||!Object.hasOwn(args,"ship_by"))throw Error("invalid_ship_by");
 const clone=structuredClone(model),order=clone.orders[args.order_index-1],before=ppShipByValue(order.ship_by),after=ppShipByValue(args.ship_by);
 if(before===after)throw Error("no_change");
 if(after===null)delete order.ship_by;else order.ship_by=after;
 return {model:clone,change:{kind:"set_order_ship_by",record:String(order.id),before,after}};
}
export function ppShipByFormatMinutes(n,ru=false){
 if(typeof n!=="number"||!Number.isFinite(n)||n<0)return "—";
 const min=Math.ceil(Math.max(0,n-1e-7)),d=Math.floor(min/1440),h=Math.floor(min%1440/60),m=min%60;
 return [d?d+(ru?"д":"d"):"",h?h+(ru?"ч":"h"):"",m||(!d&&!h)?m+(ru?"мин":"m"):""].filter(Boolean).join(" ");
}
