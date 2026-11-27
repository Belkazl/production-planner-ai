import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
export function transformProductionUnits(html){
 if(typeof html!=="string"||html.includes("PP_PRODUCTION_HIDE_UNITS_V1"))return html;
 const matches=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(m=>/\bid=["']ppTechProcessJs["']/.test(m[1]));
 if(matches.length!==1)return html;
 const match=matches[0],source=match[2];
 const before='<div class="pp-quantity-with-unit" style="display:flex;align-items:center;gap:6px">';
 const after='<div class="pp-quantity-with-unit" style="display:block">';
 const old='<output class="pp-requirement-unit" data-rf="unit" aria-readonly="true" title="Единица задана типом ресурса или справочником материалов" style="white-space:nowrap">';
 const next='<output class="pp-requirement-unit" data-rf="unit" hidden aria-hidden="true" aria-readonly="true" style="display:none!important">';
 if(!source.includes("PP_RESOURCE_UNITS_INLINE_20261124")||!source.includes("unit:ppCanonicalRequirementUnit({resource_type:t,resource_ref:")||source.split(before).length!==2||source.split(old).length!==2)return html;
 const updated="// PP_PRODUCTION_HIDE_UNITS_V1\n"+source.replace(before,after).replace(old,next);
 const offset=match.index+match[0].indexOf(">")+1;
 return html.slice(0,offset)+updated+html.slice(offset+source.length);
}
export function patchSource(auth){
 assert(!auth.includes("function ppProductionUnitsPage("),"PRODUCTION_UNITS_ALREADY_INSTALLED");
 const before="const assistantHtml=ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))))));",after="const assistantHtml=ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))))))));";
 assert.equal(auth.split(before).length,2,"PRODUCTION_UNITS_AUTH_ANCHOR_DRIFT");
 const append="\n// PP_PRODUCTION_HIDE_UNITS_V1\nfunction ppProductionUnitsPage(html){return ("+transformProductionUnits.toString()+")(html);}\n";
 const result=auth.replace(before,after)+append;
 assert.equal(result.slice(0,-append.length).replace(after,before),auth);
 return result;
}
if(process.argv[1]?.endsWith("/production-hide-redundant-units-20261127/patch.mjs")){
 const [input,output]=process.argv.slice(2);assert(input&&output);
 writeFileSync(output,patchSource(readFileSync(input,"utf8")),{mode:0o600});
 console.log("PRODUCTION_UNITS_EXACT_PATCH_PASS");
}
