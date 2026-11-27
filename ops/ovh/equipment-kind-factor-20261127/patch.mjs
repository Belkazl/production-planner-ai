import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
export function ppEquipmentEditorRows(m){
 return Array.isArray(m?.equipment)&&m.equipment.length?m.equipment:Array.isArray(m?.autoclaves)?m.autoclaves:[];
}
export function ppEquipmentKindOptions(m,current,escape){
 const group=typeof current==="string"&&current.trim()?current:"other";
 const kinds=new Set();
 const add=k=>{if(typeof k==="string"&&k.trim())kinds.add(k)};
 for(const e of ppEquipmentEditorRows(m))add(e?.kind);
 for(const p of m?.technical_processes||[])for(const op of p?.operations||[])for(const r of op?.resource_requirements||[]){
  if(r?.resource_type!=="equipment")continue;
  const refs=[r.resource_ref,...(Array.isArray(r.resource_refs)?r.resource_refs:[])];
  for(const ref of refs)if(typeof ref==="string"&&ref.startsWith("kind:"))add(ref.slice(5));
 }
 add(group);
 const legacy={large:"Большой",small:"Малый",other:"Другой"};
 return [...kinds].map(k=>'<option value="'+escape(k)+'" '+(k===group?'selected':'')+'>'+escape(Object.hasOwn(legacy,k)?legacy[k]:k)+'</option>').join('');
}
export function transformEquipmentKinds(html,helpers){
 if(typeof html!=="string"||html.includes("PP_EQUIPMENT_KIND_GROUPS_V1")||!html.includes("PP_PROJECT_CARD_LANGUAGE_V1"))return html;
 const matches=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(m=>/\bid=["']ppEditableTablesJs["']/.test(m[1]));
 if(matches.length!==1)return html;
 const match=matches[0],source=match[2];
 const oldRow=`'<td><select class="pp-edit-select" data-f="kind"><option value="large" '+(a.kind==='large'?'selected':'')+'>Большой</option><option value="small" '+(a.kind==='small'?'selected':'')+'>Малый</option><option value="other" '+(!['large','small'].includes(a.kind)?'selected':'')+'>Другой</option></select></td>'`;
 const newRow=`'<td><select class="pp-edit-select" data-f="kind">'+ppEquipmentKindOptions(model,a.kind,esc)+'</select></td>'`;
 const edits=[
 ["function equipmentRow(a,idx){","/* PP_EQUIPMENT_KIND_GROUPS_V1 */\n"+helpers+"\nfunction equipmentRow(a,idx){"],
 [oldRow,newRow],
 ["(model.autoclaves||[]).map((a,i)=>equipmentRow(a,i))","ppEquipmentEditorRows(model).map((a,i)=>equipmentRow(a,i))"],
 ["base=idx>=0?clone((model.autoclaves||[])[idx]||{}):{};","base=idx>=0?clone(ppEquipmentEditorRows(model)[idx]||{}):{};"],
 ["equipmentRow({name:'Новое оборудование',capacity:1,kind:'large',process_multiplier:1},-1)","equipmentRow({name:'Новое оборудование',capacity:1,kind:'other',process_multiplier:1},-1)"]
 ];
 if(!source.includes('base.process_multiplier=num(r.querySelector(\'[data-f="process_multiplier"]\').value,1)||1;')||edits.some(([old])=>source.split(old).length!==2))return html;
 let next=source;for(const [old,replacement] of edits)next=next.replace(old,()=>replacement);
 const offset=match.index+match[0].indexOf(">")+1;
 return html.slice(0,offset)+next+html.slice(offset+source.length);
}
export const helpers=ppEquipmentEditorRows.toString()+"\n"+ppEquipmentKindOptions.toString();
export function patchSource(auth){
 assert(!auth.includes("function ppEquipmentGroupsPage("),"EQUIPMENT_KIND_ALREADY_INSTALLED");
 const before="const assistantHtml=ppProjectCardsLanguagePage(ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))))))))))))));",after="const assistantHtml=ppEquipmentGroupsPage(ppProjectCardsLanguagePage(ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))))))))))))));";
 assert.equal(auth.split(before).length,2,"EQUIPMENT_KIND_AUTH_ANCHOR_DRIFT");
 const append="\n// PP_EQUIPMENT_KIND_GROUPS_V1\nfunction ppEquipmentGroupsPage(html){return ("+transformEquipmentKinds.toString()+")(html,"+JSON.stringify(helpers)+");}\n";
 const result=auth.replace(before,after)+append;
 assert.equal(result.slice(0,-append.length).replace(after,before),auth);return result;
}
if(process.argv[1]?.endsWith("/equipment-kind-factor-20261127/patch.mjs")){
 const [input,output]=process.argv.slice(2);assert(input&&output);writeFileSync(output,patchSource(readFileSync(input,"utf8")),{mode:0o600});console.log("EQUIPMENT_KIND_EXACT_PATCH_PASS");
}
