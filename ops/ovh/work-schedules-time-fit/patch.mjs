import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
const css="\n/* PP_WORK_SCHEDULES_TIME_FIT_V1: keep native time segments and picker visible, including AM/PM. */\n#sectionView [data-pp-weekly-calendar] .pp-sdk-InputContainer:has(>input[type=time]) {\n  width:172px;min-width:172px;flex-shrink:0;\n}\n#sectionView [data-pp-weekly-calendar] .pp-sdk-InputContainer>input[type=time].pp-sdk-Input {\n  min-width:0; padding-inline:16px 12px;\n}\n#sectionView [data-pp-weekly-calendar] .pp-sdk-InputContainer>input[type=time]::-webkit-datetime-edit {\n  padding:0;\n}\n#sectionView [data-pp-weekly-calendar] .pp-sdk-InputContainer>input[type=time]::-webkit-calendar-picker-indicator {\n  flex-shrink:0; margin-inline-start:6px; padding:0;\n}\n";
function transform(html,css){
 if(typeof html!=="string"||!html.includes('id="ppWorkSchedulesSdkStyle"')||html.includes("PP_WORK_SCHEDULES_TIME_FIT_V1"))return html;
 const anchor='<style id="ppWorkSchedulesSdkStyle">';
 const a=html.indexOf(anchor),b=html.indexOf("</style>",a+anchor.length);
 if(b<0)throw Error("Work schedules SDK style end missing");
 return html.slice(0,b)+css+html.slice(b);
}
export function patchPreview(html){return transform(html,css)}
export function patchSource(source){
 const anchor="const assistantHtml=ppWorkSchedulesSdkPage(";
 assert(!source.includes("function ppWorkSchedulesTimeFitPage("),"Already installed");
 assert.equal(source.split(anchor).length,2,"Work schedules SDK auth anchor");
 const lines=source.split("\n"),i=lines.findIndex(l=>l.includes(anchor));
 assert(lines[i].trimEnd().endsWith(";"));
 lines[i]=lines[i].replace(anchor,"const assistantHtml=ppWorkSchedulesTimeFitPage(ppWorkSchedulesSdkPage(").replace(/;\s*$/,");");
 return lines.join("\n")+"\nfunction ppWorkSchedulesTimeFitPage(html){return ("+transform.toString()+")(html,"+JSON.stringify(css)+");}\n";
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)writeFileSync(process.argv[3],patchSource(readFileSync(process.argv[2],"utf8")),{mode:0o600});
