import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {ppCalendarResourceMetrics as calc,ppCalendarUtilizationHtml as html} from "./metrics.mjs";
import {css,helperSource,transformUtilization,patchSource} from "./patch.mjs";
const eq=(id,kind=id)=>({id,name:id,kind,capacity:10,capacity_unit:"pcs"});
const emp=(id,shift,role="operator")=>({id,name:id,shift,role});
const req=(type,ref,quantity=1,mode="specific")=>({resource_type:type,resource_ref:ref,resource_refs:[ref],match_mode:mode,quantity,consumption_rule:"during_operation"});
const op=(id,requirements)=>({id,name:id,duration_min:10,sequence:1,resource_requirements:requirements});
const row=(operation_id,start_min,end_min,equipment_ids=[],employee_ids=[],extra={})=>({operation_id,start_min,end_min,equipment_ids,employee_ids,order:"A",...extra});
const fixture=()=>({start:"2026-11-25T00:00:00",equipment:[eq("Manual"),eq("Oven"),eq("Mixed")],employees:[emp("Worker","day")],shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},orders:[{id:"A",technical_process_id:"P"}],technical_processes:[{id:"P",operations:[op("Press",[req("equipment","Manual"),req("employee","Worker")]),op("Fire",[req("equipment","Oven")]),op("Load",[req("equipment","Mixed"),req("employee","Worker")]),op("Auto",[req("equipment","Mixed")])]}]});
const result=(rows,duration=1440,extra={})=>({valid:true,duration_minutes:duration,generic_operations:rows,...extra});
const near=(a,b)=>assert(Math.abs(a-b)<1e-6,a+" != "+b);
test("manual equipment uses working shift, autonomous and mixed equipment use 24h; employee separate",()=>{
 const m=fixture(),p=result([row("Press",480,720,["Manual"],["Worker"]),row("Press",780,900,["Manual"],["Worker"]),row("Fire",0,1080,["Oven"]),row("Load",900,960,["Mixed"],["Worker"]),row("Auto",960,1440,["Mixed"])]);
 const copy=structuredClone(m),r=calc(p,m);
 assert.equal(r.equipment.length,3);assert.equal(r.employees.length,1);
 near(r.equipment[0].available,480);near(r.equipment[0].effectivePercent,75);near(r.equipment[0].calendarPercent,25);
 near(r.equipment[1].available,1440);near(r.equipment[1].effectivePercent,75);
 assert.equal(r.equipment[2].mode,"mixed");near(r.equipment[2].available,1440);near(r.employees[0].available,480);near(r.employees[0].effectivePercent,87.5);
 assert.deepEqual(m,copy);
 const markup=html(r,"en");assert(markup.includes('data-util-group="equipment"'));assert(markup.includes('data-util-group="employees"'));assert(markup.includes("75.0%"));assert(markup.includes("25.0%"));
 assert(html(r,"ru").includes("Сотрудники"));
});
test("weekly lunch/weekend and non-midnight origin, overnight shift crossing day boundary",()=>{
 const m=fixture();m.start="2026-11-27T11:30:00";m.shift_calendars={day:{days:[1,2,3,4,5],start:"08:00",end:"17:00",breaks:[["12:00","13:00"]]}};
 let p=result([row("Press",0,30,["Manual"],["Worker"]),row("Press",90,210,["Manual"],["Worker"])],3*1440);
 let r=calc(p,m);near(r.employees[0].available,480);near(r.equipment[0].available,480);near(r.employees[0].effectivePercent,31.25);
 m.start="2026-11-27T22:00:00";m.shift_calendars.day={days:[5],start:"22:00",end:"06:00",breaks:[["01:00","01:30"]]};
 p=result([row("Press",0,180,["Manual"],["Worker"]),row("Press",210,480,["Manual"],["Worker"])],1440);
 r=calc(p,m);near(r.employees[0].available,450);near(r.equipment[0].effectivePercent,100);
});
test("role-based availability is union of eligible shifts, not actual employee bookings",()=>{
 const m=fixture();m.employees.push(emp("Evening","evening"));m.shifts.evening=[["17:00","01:00"]];
 m.technical_processes[0].operations[0].resource_requirements[1]=req("employee","role:operator",1,"any");
 const p=result([row("Press",480,540,["Manual"],["Worker"]),row("Load",540,720,["Mixed"],["Worker"]),row("Press",1020,1080,["Manual"],["Evening"])]);
 const r=calc(p,m);near(r.equipment[0].available,960);near(r.equipment[0].effectivePercent,12.5);near(r.employees[0].effectivePercent,50);
});
test("multiple staff requirements need distinct simultaneously available employees",()=>{
 const m=fixture();m.employees.push(emp("Other","late"));m.shifts.late=[["10:00","14:00"]];
 m.technical_processes[0].operations[0].resource_requirements=[req("equipment","Manual"),req("employee","role:operator",2,"any")];
 const r=calc(result([row("Press",600,660,["Manual"],["Worker","Other"])]),m);
 near(r.equipment[0].available,180);near(r.equipment[0].effectivePercent,100/3);
 m.technical_processes[0].operations[0].resource_requirements=[req("equipment","Manual"),req("employee","Worker"),req("employee","role:operator",1,"any")];
 near(calc(result([row("Press",600,660,["Manual"],["Worker","Other"])]),m).equipment[0].available,180);
});
test("setups deduplicated, only explicit reserved wait, free and off-calendar are distinct",()=>{
 const m=fixture(),s=row("__setup__",480,540,["Manual"],["Worker"],{is_setup:true});
 const p=result([s,row("Press",540,660,["Manual"],["Worker"]),row("wait",660,690,["Manual"],[],{phase:"wait"}),row("reserved",690,720,["Manual"],[],{phase:"reserved_wait"}),row("__setup__",100,120,["Manual"],[],{is_setup:true})],1440,{setup_operations:[s]});
 const r=calc(p,m).equipment[0];near(r.production,120);near(r.setup,60);near(r.wait,30);near(r.busy,210);near(r.free,270);near(r.offCalendar,20);near(r.calendarBusy,230);near(r.effectivePercent,43.75);
});
test("unknown shift or incompatible operation never produces invented effective percentages",()=>{
 const m=fixture();m.employees[0].shift="unknown";
 const p=result([row("Press",480,540,["Manual"],["Worker"]),row("Fire",0,180,["Oven"])]);
 const r=calc(p,m);assert.equal(r.equipment[0].effectivePercent,null);assert.equal(r.employees[0].effectivePercent,null);near(r.equipment[0].calendarPercent,100/24);near(r.equipment[1].effectivePercent,12.5);
 assert.equal(calc({...p,partial:true},m),null);assert.equal(calc({...p,valid:false},m),null);
});
test("source transform is exact, idempotent, and leaves other runtime code unchanged",()=>{
 const old='function renderLoad(plan){let dur=Math.max(1,+plan.duration_minutes||1),ops=plan.generic_operations||[],rows=[];return ""}\nwindow.__ppGroqRenderResourceUtilization=renderLoad;';
 const input="<html><head></head><body><script>"+old+"</script></body></html>";
 const out=transformUtilization(input,css,helperSource);assert(out.includes("PP_CALENDAR_UTILIZATION_V1"));
 assert.equal(transformUtilization(out,css,helperSource),out);assert.equal(transformUtilization("<html><head></head></html>",css,helperSource),"<html><head></head></html>");
 new vm.Script(out.match(/<script>([\s\S]*?)<\/script>/)[1]);
 const source='function f(branded){const assistantHtml=ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))));return assistantHtml;}';
 const patched=patchSource(source);new vm.Script(patched);assert(patched.includes("ppCalendarUtilizationPage(ppSolarNavHtml("));
 assert.throws(()=>patchSource("unrelated"));
});
