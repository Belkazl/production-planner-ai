import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
const root=process.argv[2];
if(!root)throw Error("SSE_UI_ROOT_REQUIRED");
const path=resolve(root,"restart-optimizer-ui.js");
let source=readFileSync(path,"utf8");
const modules=[
 ["ppLightweightLiveGanttV2","__PP_FOUR_SECOND_PREVIEW__"],
 ["ppSingleServerProgressV5","__PP_GA_PROGRESS_V5__"]
];
for(const [name,marker] of modules){
 const start=";(function "+name+"(){";
 const pos=source.indexOf(start);
 if(pos<0||source.indexOf(start,pos+start.length)!==-1)
  throw Error("SSE_UI_NONUNIQUE_LEGACY_"+name);
 const end=source.indexOf("\n})();",pos);
 if(end<pos||end-pos>20000)throw Error("SSE_UI_LEGACY_TERMINATOR_"+name);
 const removed=source.slice(pos,end+6);
 if(!removed.includes(marker))throw Error("SSE_UI_LEGACY_GUARD_"+name);
 source=source.slice(0,pos)+source.slice(end+6);
 console.log("SSE_RETIRED_POLLING_MODULE",name,removed.length);
}
if(!source.includes("ppUnifiedGanttV2")||!source.includes("__PP_STOP_DEBUG__"))
 throw Error("SSE_UI_NATIVE_GANTT_OR_STOP_MISSING");
if(source.includes("ppLightweightLiveGanttV2")||source.includes("ppSingleServerProgressV5"))
 throw Error("SSE_UI_DUPLICATE_OWNERS_SURVIVED");
source+="\n"+readFileSync("ops/ovh/sse-stream-v1-20261120/frontend.js.txt","utf8")+"\n";
writeFileSync(path,source);
console.log("SSE_UI_ONE_BAR_NO_INTERVAL_HTTP",source.length,
 createHash("sha256").update(source).digest("hex"));
