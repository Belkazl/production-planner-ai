import {readFileSync,writeFileSync} from "node:fs";
let source=readFileSync("index.ts","utf8");
const js=readFileSync("language-ui.js","utf8");
const css=readFileSync("language-ui.css","utf8");
if(!js.includes("prodplan.ui.language.v1")||!js.includes("__PP_LANGUAGE__")||
   !js.includes("ppLanguageSelect")||!css.includes(".pp-language-control"))
 throw Error("PP_I18N_FEATURE_FILES_INVALID");
function one(before:string,after:string,label:string){
 const matches=source.split(before).length-1;
 if(matches!==1)throw Error("PP_I18N_"+label+"_ANCHOR_"+matches);
 source=source.replace(before,after);
}
const inline="<style id=\"ppLanguageUiCss\">"+css+"</style>"+
 "<script id=\"ppLanguageUiJs\">"+js+"</script>";
// Replace the legacy autoclave-only heading in the proxied UI HTML before localization.
// This is presentation-only: optimizer, saved models, routing and API payloads stay unchanged.
one("const h=await r.text();const pp3Mode",
    "const h=(await r.text()).replaceAll('Занятость автоклавов','Загрузка оборудования');const pp3Mode",
    "generic_equipment_heading");
one("async function serveGanttUi(req){",
 "const PP_LANGUAGE_INLINE="+JSON.stringify(inline)+";\nasync function serveGanttUi(req){",
 "inject_language_bundle");
one("+PP_START_OVER_INLINE+PP_DOCUMENTS_INLINE+'</body>'",
 "+PP_START_OVER_INLINE+PP_DOCUMENTS_INLINE+PP_LANGUAGE_INLINE+'</body>'",
 "show_in_authenticated_planner");
one("return new Response(ppAuthLoginPage,{status:200,headers:{",
 "return new Response(ppAuthLoginPage.replace('</body>',PP_LANGUAGE_INLINE+'</body>'),{status:200,headers:{",
 "show_in_login");
if(!source.includes("PP_LANGUAGE_INLINE+'</body>'")||
   !source.includes("ppAuthLoginPage.replace('</body>',PP_LANGUAGE_INLINE")||
   !source.includes("ppGaBudgetHtml(ppStartOverHtml(ppGaPollHtml))"))
 throw Error("PP_I18N_BUILD_INTEGRITY");
writeFileSync("index.ts",source);
console.log("PP_I18N_BUILD_OK",JSON.stringify({
 defaultLanguage:"en",supported:["en","ru"],login:true,authenticatedApp:true,
 selectorsPreserveRussianRouteKeys:true,projectDataUntouched:true,optimizerUntouched:true,
 bytes:source.length,uiJsBytes:js.length,uiCssBytes:css.length
}));
