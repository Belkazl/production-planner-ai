import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
const root=process.argv[2];
if(!root)throw Error("QUICK_DEPTH_APP_ROOT_REQUIRED");
const file=resolve(root,"restart-optimizer-ui.js");
const source=readFileSync(file,"utf8");
const from="  quick:Object.freeze({generations:30,population:24}),";
const to="  quick:Object.freeze({generations:10,population:12}),";
if(source.split(from).length!==2)throw Error("QUICK_DEPTH_SOURCE_DRIFT");
for(const expected of ["  standard:Object.freeze({generations:60,population:32}),","  thorough:Object.freeze({generations:180,population:48}),","  maximum:Object.freeze({generations:360,population:64}),","window.__PP_OPTIMIZER_DEPTH__=","window.__PP_GA_OBJECTIVE_FLOOR_V1__"]){
 if(!source.includes(expected))throw Error("QUICK_DEPTH_REQUIRES_DEPLOYED_FEATURE_"+expected.slice(0,40));
}
const updated=source.replace(from,to);
if(updated.split(to).length!==2||updated.length===source.length-0&&updated===source)
 throw Error("QUICK_DEPTH_BAD_PATCH");
writeFileSync(file,updated);
console.log("PP_QUICK_DEPTH_V2_PATCHED","generations=10","population=12","checks=120");
