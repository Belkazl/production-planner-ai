import {readFileSync,writeFileSync} from "node:fs";
let src=readFileSync("index.ts","utf8");
const replacements=[
 ["await searchWithSetup(base,model,{iterations:48,seed:setupSearchSeed(base),objective:goal})",
  "await ppWorkerSearch(base,model,{iterations:48,seed:setupSearchSeed(base),objective:goal},state?.abortController?.signal)"],
 ["await searchWithSetup(data,model,{iterations:count,seed:setupSearchSeed(data),objective:goal,shouldStop:()=>!!state.stopRequested})",
  "await ppWorkerSearch(data,model,{iterations:count,seed:setupSearchSeed(data),objective:goal,shouldStop:()=>!!state.stopRequested},state.abortController.signal)"]
];
for(const [before,after] of replacements){
 const count=src.split(before).length-1;if(count!==1)throw Error("PP_GA_WORKER_ANCHOR_"+before.slice(0,55)+"_"+count);
 src=src.replace(before,after);
}
if(!src.includes("function ppAlignOwnedResources")||!src.includes("ppWorkerSearch(data,model")||!src.includes("ppWorkerSearch(base,model"))
 throw Error("PP_GA_WORKER_BOUNDARY_MISSING");
const runtime=`
async function ppWorkerSearch(base,model,options={},signal){
 if((typeof Bun==="undefined"||Bun.env.PP_WORKERS_ENABLED!=="1"))
  return searchWithSetup(base,model,options);
 const owned=ppAlignOwnedResources(model,base);
 if(signal?.aborted)throw Object.assign(new Error("worker_cancelled"),{name:"AbortError"});
 return runIsolatedSetupSearch(base,owned,options,signal);
}
`;
src='import {runIsolatedSetupSearch,ppWorkerSummary} from "./worker-manager.ts";\n'+runtime+"\n"+src;
writeFileSync("index.ts",src);
console.log("PP_GA_WORKER_ROUTING_OK",JSON.stringify({enabledByEnv:"PP_WORKERS_ENABLED=1",algorithm:"setup-aware search",preservesPythonGA:true,cancelSignal:true}));
