import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {source,css} from "./browser-ui.mjs";
export function transformPage(html,source,css){
 if(typeof html!=="string"||html.includes('id="ppPlanningStartJs"')||!html.includes('id="ppShipByJs"'))return html;
 if(html.split("</head>").length!==2||html.split("</body>").length!==2)throw Error("PLANNING_START_PAGE_ANCHOR");
 return html.replace("</head>",()=>css+"</head>").replace("</body>",()=>'<script id="ppPlanningStartJs">/* PP_PLANNING_START_V1 */\n'+source+'\nppInstallPlanningStart();</script></body>');
}
export function patchPreview(html){return transformPage(html,source,css)}
export function patchAuth(s){
 assert(!s.includes("function ppPlanningStartPage("));
 const lines=s.split("\n"),indices=lines.map((l,i)=>l.includes("const assistantHtml=ppShipByPage(")?i:-1).filter(i=>i>=0);
 assert.equal(indices.length,1,"PLANNING_START_AUTH_CHAIN");
 const i=indices[0];assert(lines[i].trim().endsWith(";"));
 lines[i]=lines[i].replace("const assistantHtml=","const assistantHtml=ppPlanningStartPage(").replace(/;\s*$/,");");
 return lines.join("\n")+"\nfunction ppPlanningStartPage(html){return ("+transformPage.toString()+")(html,"+JSON.stringify(source)+","+JSON.stringify(css)+");}\n";
}
if(process.argv[1]?.endsWith("/planning-start-20261127/patch.mjs")){
 const [before,after]=process.argv.slice(2);
 writeFileSync(after,patchAuth(readFileSync(before,"utf8")),{mode:0o600});
 console.log("PLANNING_START_EXACT_AUTH_PATCH_PASS");
}
