import {readFileSync,writeFileSync} from "node:fs";
const src=readFileSync("baselines/2026-10-10/aps-setup-bridge/index.ts","utf8");
const marker="// Production-compatibility bridge, tested independently.";
const pos=src.indexOf(marker);
if(pos<12000||src.indexOf(marker,pos+1)!==-1)throw Error("PP_WORKER_SOURCE_BOUNDARY");
const core=src.slice(0,pos);
for(const check of ["export function scheduleWithSetup","export async function searchWithSetup","export function validateSetupPlan"])
 if(!core.includes(check))throw Error("PP_WORKER_CORE_MISSING_"+check);
const runner=`
const MAX_INPUT_BYTES=4_000_000;
async function main(){
 let raw=await Bun.stdin.text();
 if(raw.length>MAX_INPUT_BYTES)throw Error("worker_input_too_large");
 const input=JSON.parse(raw);
 if(input.kind!=="setup_search"||!input.base||!input.model)throw Error("invalid_worker_request");
 const o=input.options||{};
 const options={iterations:Math.max(1,Math.min(300,Math.trunc(Number(o.iterations)||48))),seed:Number(o.seed)||1729,objective:typeof o.objective==="string"?o.objective:"duration"};
 if(o.testHoldMs&&process.env.PP_WORKER_TEST==="1")
  await new Promise(resolve=>setTimeout(resolve,Math.min(10000,Math.max(0,Number(o.testHoldMs)||0))));
 const result=await searchWithSetup(input.base,input.model,options);
 process.stdout.write(JSON.stringify({ok:true,result,pid:process.pid})+"\\n");
}
if(import.meta.main)main().catch(e=>{process.stderr.write("WORKER_ERROR "+String(e?.stack||e).slice(0,800)+"\\n");process.exitCode=1;});
`;
const generated=core+"\n"+runner;
writeFileSync("ga-worker-core.ts",generated);
console.log("PP_GA_WORKER_CORE_BUILD_OK",JSON.stringify({bytes:generated.length,isolated:true,algorithm:"setup-aware search",sourceFrozen:true}));
