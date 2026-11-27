import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
export function transformConsumption(html){
 if(typeof html!=="string"||html.includes("PP_UNIVERSAL_CONSUMPTION_V1"))return html;
 const matches=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(m=>/\bid=["']ppTechProcessJs["']/.test(m[1]));
 if(matches.length!==1)return html;
 const match=matches[0],source=match[2];
 const anchor="function rr(r){",normalize="if(unit&&req.unit!==unit){req.unit=unit;fixes++;}";
 if(!source.includes("PP_PRODUCTION_HIDE_UNITS_V1")||!source.includes("per_m2")||!source.includes("per_unit")||source.split(anchor).length!==2||source.split(normalize).length!==2)return html;
 const wrapper=String.raw`function rr(r){
 const canonical=r&&r.resource_type==='material'&&r.consumption_rule==='per_m2'?{...r,consumption_rule:'per_unit'}:r;
 return ppLegacyRequirementRow(canonical).replace(/<option\b(?=[^>]*\bvalue\s*=\s*(?:"per_m2"|'per_m2'|per_m2(?=[\s>])))[^>]*>[\s\S]*?<\/option\s*>/gi,'');
}
function ppLegacyRequirementRow(r){`;
 const updated="// PP_UNIVERSAL_CONSUMPTION_V1\n"+source.replace(anchor,()=>wrapper).replace(normalize,()=>normalize+"\n   if(req.resource_type==='material'&&req.consumption_rule==='per_m2'){req.consumption_rule='per_unit';fixes++;}");
 const offset=match.index+match[0].indexOf(">")+1;
 return html.slice(0,offset)+updated+html.slice(offset+source.length);
}
export function patchSource(auth){
 assert(!auth.includes("function ppUniversalConsumptionPage("),"CONSUMPTION_ALREADY_INSTALLED");
 const before="const assistantHtml=ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))))))));",after="const assistantHtml=ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))))))));";
 assert.equal(auth.split(before).length,2,"CONSUMPTION_AUTH_ANCHOR_DRIFT");
 const append="\n// PP_UNIVERSAL_CONSUMPTION_V1\nfunction ppUniversalConsumptionPage(html){return ("+transformConsumption.toString()+")(html);}\n";
 const result=auth.replace(before,after)+append;
 assert.equal(result.slice(0,-append.length).replace(after,before),auth);
 return result;
}
if(process.argv[1]?.endsWith("/universal-material-consumption-20261127/patch.mjs")){
 const [input,output]=process.argv.slice(2);assert(input&&output);
 writeFileSync(output,patchSource(readFileSync(input,"utf8")),{mode:0o600});
 console.log("CONSUMPTION_EXACT_PATCH_PASS");
}
