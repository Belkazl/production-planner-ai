import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
const from=process.argv[2],to=process.argv[3];
if(!from||!to)throw Error("SSE_METER_SOURCE_AND_TARGET_PATH_REQUIRED");
const source=readFileSync(from,"utf8");
const marker=";(function ppOneSseProgressAndGantt(){";
const pos=source.indexOf(marker);
if(pos<0||source.indexOf(marker,pos+marker.length)>=0)throw Error("SSE_METER_OWNER_MISSING_OR_DUPLICATED");
const end=source.indexOf("\n})();",pos);
if(end<=pos||end-pos>24000)throw Error("SSE_METER_OWNER_TERMINATOR_DRIFT");
const original=source.slice(pos,end+6);
if(original.includes("const STEP_MS=250;"))throw Error("SSE_METER_CADENCE_ALREADY_PATCHED");
let patched=original;
function replace(needle,value,count=1){
 const seen=patched.split(needle).length-1;
 if(seen!==count)throw Error("SSE_METER_EXPECTED_"+count+"_GOT_"+seen+"_"+needle.slice(0,72));
 patched=patched.replaceAll(needle,value);
}
replace("let targetPercent=0,animationTimer=null,verifiedTerminal=false,finalRetryTimer=null,finalRetries=0;",
 "const STEP_MS=250; // One visible percent per fixed beat, including the verified final stretch.\nlet targetPercent=0,animationTimer=null,verifiedTerminal=false,finalRetryTimer=null,finalRetries=0;\nlet terminalGap=0,terminalAt=0,terminalElapsedMs=0;");
replace(' "#opt.pp-sse-active .pp-opt-progress-line{display:none!important}",',
 ' "#opt.pp-sse-active .pp-opt-progress-line{display:none!important}",\n "#opt.pp-sse-active:not(.pp-sse-done){pointer-events:none!important}",');
replace(' barButton?.classList.remove("pp-sse-active");',
 ' barButton?.classList.remove("pp-sse-active","pp-sse-done");');
replace(' if(!btn.classList.contains("pp-sse-active"))btn.classList.add("pp-sse-active");',
 ' if(!btn.classList.contains("pp-sse-active"))btn.classList.add("pp-sse-active");\n btn.classList.toggle("pp-sse-done",completed);');
replace(' verifiedTerminal=false;completed=true;active=false;\n percent=100;targetPercent=100;ensureMeter();',
 ' terminalElapsedMs=terminalAt?Math.round(performance.now()-terminalAt):0;\n verifiedTerminal=false;completed=true;active=false;\n hideFog();\n percent=100;targetPercent=100;ensureMeter();');
replace("setTimeout(animatePercent,32)","setTimeout(animatePercent,STEP_MS)",2);
replace('  fullData=data;phase="completed";\n  hideFog();',
 '  fullData=data;phase="completed";\n  terminalGap=100-percent;terminalAt=performance.now();');
replace(" active=true;completed=false;verifiedTerminal=false;finalRetries=0;",
 " active=true;completed=false;verifiedTerminal=false;finalRetries=0;\n terminalGap=0;terminalAt=0;terminalElapsedMs=0;");
replace(" active=false;completed=false;verifiedTerminal=false;finalRetries=0;",
 " active=false;completed=false;verifiedTerminal=false;finalRetries=0;\n terminalGap=0;terminalAt=0;terminalElapsedMs=0;");
replace("   lineVisible:!!track?.isConnected}},",
 "   lineVisible:!!track?.isConnected,paceMs:STEP_MS,serverTarget:targetPercent,\n   terminalGap,terminalElapsedMs,terminalPending:verifiedTerminal}},");
const canonical=readFileSync("ops/ovh/sse-stream-v1-20261120/frontend.js.txt","utf8").trimEnd();
if(patched.trimEnd()!==canonical)throw Error("SSE_METER_PATCH_DIFFERS_FROM_TESTED_CANONICAL_SOURCE");
const output=source.slice(0,pos)+patched+source.slice(end+6);
writeFileSync(to,output);
console.log("SSE_METER_STEADY_ONE_PERCENT_PER_250MS_GUARDED_SOURCE_PASS",createHash("sha256").update(output).digest("hex"));
