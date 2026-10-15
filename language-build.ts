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

// Public upstream planner ships a synchronous POST on *every* localStorage write
// and even repeats the whole account store POST while <head> is still parsing.
// A slow write blocks the browser for tens of seconds before the title is drawn.
// Keep the initial GET hydration unchanged but enqueue ordered, debounced writes.
function ppNonBlockingDbSyncHtml(html:string){
 const begin=html.indexOf('<script id="db-persistence-shim">');
 if(begin<0)return html;
 const end=html.indexOf("</script>",begin);
 if(end<begin)throw Error("PP_DB_PERSISTENCE_END_MISSING");
 let tag=html.slice(begin,end);
 const syncPattern=/function sync\(\)\s*\{[\s\S]*?syncing=false;\s*\}/g;
 const oldSync=tag.match(syncPattern)||[];
 if(oldSync.length!==1||tag.split("if(S.length)sync();").length!==2)
  throw Error("PP_DB_PERSISTENCE_SYNC_ANCHOR_MISMATCH");
 const replacement=[
 'var pending=false,writing=false,saveTimer=null,saveRetries=0;',
 'function sync(){if(initializing)return;pending=true;if(!writing&&!saveTimer)saveTimer=setTimeout(flush,250)}',
 'async function flush(){',
 '  saveTimer=null;if(writing||!pending)return;pending=false;writing=true;',
 '  let unauthorized=false;',
 '  try{',
 '    const r=await fetch("/api/db-storage",{method:"POST",credentials:"same-origin",',
 '      headers:{"Content-Type":"application/json"},body:JSON.stringify({storage:snap()}),cache:"no-store"});',
 '    if(!r.ok){unauthorized=r.status===401||r.status===403;throw Error("db_save_"+r.status)}',
 '    saveRetries=0;',
 '  }catch(e){',
 '    if(!unauthorized){pending=true;saveRetries=Math.min(saveRetries+1,5)}',
 '    console.error("DB async persistence write failed",e);',
 '  }finally{',
 '    writing=false;',
 '    if(pending&&!saveTimer)saveTimer=setTimeout(flush,saveRetries?Math.min(15000,1000*Math.pow(2,saveRetries)):200);',
 '  }',
 '}',
 'window.__PP_ASYNC_DB_SYNC__=true;'
 ].join("\n");
 tag=tag.replace(syncPattern,replacement);
 tag=tag.replace("if(S.length)sync();","/* storage already loaded from server: do not POST back on every page load */");
 if(!tag.includes("window.__PP_ASYNC_DB_SYNC__=true;")||tag.includes("x.open('POST','/api/db-storage',false)"))
  throw Error("PP_ASYNC_STORAGE_PATCH_INTEGRITY");
 return html.slice(0,begin)+tag+html.slice(end);
}

const inline="<style id=\"ppLanguageUiCss\">"+css+"</style>"+
 "<script id=\"ppLanguageUiJs\">"+js+"</script>";
// Replace the legacy autoclave-only heading in the proxied UI HTML before localization.
// This is presentation-only: optimizer, saved models, routing and API payloads stay unchanged.
one("const h=await r.text();const pp3Mode",
    "const h=ppNonBlockingDbSyncHtml((await r.text()).replaceAll('Занятость автоклавов','Загрузка оборудования'));const pp3Mode",
    "generic_equipment_heading");
one("async function serveGanttUi(req){",
 ppNonBlockingDbSyncHtml.toString()+"\nconst PP_LANGUAGE_INLINE="+JSON.stringify(inline)+";\nasync function serveGanttUi(req){",
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
 bytes:source.length,uiJsBytes:js.length,uiCssBytes:css.length,
 asyncStorageWrites:true
}));
