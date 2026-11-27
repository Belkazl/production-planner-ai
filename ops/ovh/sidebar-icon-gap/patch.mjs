import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
const css="\n/* Keep the existing vertical rail, Solar icons and SDK colors.\n   A compact natural-height stack prevents legacy flex distribution and\n   inherited label margins from opening an empty band between icon and text. */\n.side.pp-sdk-sidebar .item {\n  flex:0 0 auto!important;\n  flex-direction:column!important;\n  align-items:center!important;\n  justify-content:center!important;\n  gap:4px!important;\n  min-height:0!important;\n  height:auto!important;\n  padding:8px 2px!important;\n  line-height:16px!important;\n}\n.side.pp-sdk-sidebar .item [data-pp-solar-holder] {\n  flex:0 0 auto!important;\n  margin:0!important;\n  padding:0!important;\n  align-self:center!important;\n}\n.side.pp-sdk-sidebar .item .pp-i18n-route-label {\n  flex:0 0 auto!important;\n  margin:0!important;\n  padding:0!important;\n  min-height:0!important;\n  height:auto!important;\n  line-height:16px!important;\n}\nhtml[lang=\"en\"] .side.pp-sdk-sidebar .item .pp-i18n-route-label {\n  line-height:0!important;\n}\nhtml[lang=\"en\"] .side.pp-sdk-sidebar .item .pp-i18n-route-label::after {\n  line-height:16px!important;\n  margin:0!important;\n}\n.side.pp-sdk-sidebar .item > :not([data-pp-solar-holder]) {\n  margin-top:0!important;\n  margin-bottom:0!important;\n  flex-grow:0!important;\n}\n";
function transform(html,css){
 if(typeof html!=="string"||!html.includes("PP_HEADER_SIDEBAR_SDK_V1")||html.includes("PP_SIDEBAR_ICON_GAP_V1"))return html;
 if(html.split("</head>").length!==2)throw Error("Sidebar CSS HTML anchor");
 return html.replace("</head>",()=>'<style id="ppSidebarIconGapStyle">/* PP_SIDEBAR_ICON_GAP_V1 */\n'+css+"</style></head>");
}
export function patchPreview(html){return transform(html,css)}
export function patchSource(source){
 const anchor="const assistantHtml=ppHeaderSidebarSdkPage(";
 assert(!source.includes("function ppSidebarIconGapPage("),"Already installed");
 assert.equal(source.split(anchor).length,2,"Header SDK auth chain");
 const lines=source.split("\n"),i=lines.findIndex(l=>l.includes(anchor));assert(lines[i].trimEnd().endsWith(";"));
 lines[i]=lines[i].replace(anchor,"const assistantHtml=ppSidebarIconGapPage(ppHeaderSidebarSdkPage(").replace(/;\s*$/,");");
 return lines.join("\n")+"\nfunction ppSidebarIconGapPage(html){return ("+transform.toString()+")(html,"+JSON.stringify(css)+");}\n";
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)writeFileSync(process.argv[3],patchSource(readFileSync(process.argv[2],"utf8")),{mode:0o600});
