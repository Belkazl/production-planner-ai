import {readFileSync,writeFileSync} from "node:fs";
const oldPath=process.argv[2],newPath=process.argv[3];
if(!oldPath||!newPath)throw Error("SSE_COMPLETE_LABEL_FILE_PATHS_REQUIRED");
const original=readFileSync(oldPath,"utf8");
const from=' if(label.textContent!==percent+"%")label.textContent=percent+"%";';
const to=[
 ' const doneText=(/^ru/i.test(document.documentElement.lang||"")||',
 '   window.__PP_LANGUAGE__?.current==="ru")?"Продолжить · 100%":"Continue · 100%";',
 ' const shownText=completed?doneText:percent+"%";',
 ' if(label.textContent!==shownText)label.textContent=shownText;'
].join("\n");
const reference=readFileSync("ops/ovh/sse-stream-v1-20261120/frontend.js.txt","utf8");
if(!reference.includes(to))throw Error("SSE_COMPLETE_LABEL_SOURCE_MISMATCH");
if(!original.includes("function ppOneSseProgressAndGantt()")||
   !original.includes("one-native-ga-sse-no-client-status-poll")||
   original.split(from).length!==2)throw Error("SSE_COMPLETE_LABEL_LIVE_DRIFT");
writeFileSync(newPath,original.replace(from,to));
console.log("SSE_COMPLETE_LABEL_TARGETED_ONE_LINE_HOTFIX_READY");
