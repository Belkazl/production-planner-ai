import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
const file=process.argv[2];
if(!file)throw Error("BUTTON_LABEL_SOURCE_REQUIRED");
const before=readFileSync(file,"utf8");
const section=[
' const button=document.getElementById("opt");',
' const state=window.__PP_GA_PROGRESS_V4__?.state;',
' if(button?.classList.contains("pp-ga-v4-busy")&&state?.shown!=null&&state?.shown>1){',
'  const label=(isRu()?"Оптимизация":"Optimization")+" "+state.shown+"% · "+',
'   (isRu()?"расчёт идёт ":"working ")+elapsed;',
'  if(button.getAttribute("data-pp-ga-v4-label")!==label)',
'   button.setAttribute("data-pp-ga-v4-label",label);',
' }',
''
].join("\n");
if(before.split(section).length!==2)throw Error("BUTTON_LABEL_SOURCE_ANCHOR_DRIFT");
const after=before.replace(section,"");
if(after.includes('?"расчёт идёт ":"working "'))throw Error("UNEXPECTED_SECOND_WORKING_LABEL");
if(!after.includes("ppNativeOneOwnerProgressV4")||!after.includes("ppLightweightLiveGanttV2"))throw Error("PROGRESS_ENGINE_MISMATCH");
writeFileSync(file,after);
console.log("BUTTON_ONLY_PERCENT_CLEANUP",createHash("sha256").update(after).digest("hex"),after.length);
