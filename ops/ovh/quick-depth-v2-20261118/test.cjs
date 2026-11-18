const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=process.argv[2],previous=process.argv[3];
if(!root||!previous)throw Error("QUICK_TEST_REQUIRES_BOTH_OLD_AND_NEW_ROOT");
const s=fs.readFileSync(path.join(root,"restart-optimizer-ui.js"),"utf8");
const prior=fs.readFileSync(path.join(previous,"restart-optimizer-ui.js"),"utf8");
const oldQuick="  quick:Object.freeze({generations:30,population:24}),";
const newQuick="  quick:Object.freeze({generations:10,population:12}),";
assert.equal(prior.split(oldQuick).length,2,"exactly one prior Quick preset");
assert.equal(s.split(newQuick).length,2,"exactly one new Quick preset");
assert.equal(s.replace(newQuick,oldQuick),prior,"no other changes anywhere in current deployed UI");
for(const mode of ["standard","thorough","maximum"]){
 const before=prior.split("\n").filter(row=>row.includes(mode+":Object.freeze({"));
 const after=s.split("\n").filter(row=>row.includes(mode+":Object.freeze({"));
 assert.equal(before.length,1,"unique old "+mode);
 assert.equal(after.length,1,"unique new "+mode);
 assert.equal(after[0],before[0],"unchanged "+mode);
 console.log("PP_QUICK_MODE_UNCHANGED",mode,after[0].trim());
}
for(const marker of ["__PP_OPTIMIZER_DEPTH__","__PP_GA_OBJECTIVE_FLOOR_V1__","PP_GA_WORSE_OBJECTIVE_REJECTED","ppOptimizerDepthSelect","pp:optimizer-reconnect-pending","pp:optimizer-depth-changed","generations:config.generations,population:config.population"]){
 assert(s.includes(marker),"preserved "+marker);
}
assert(!s.includes(oldQuick));
console.log("QUICK_DEPTH_V2_PRESET_AND_BOUNDARY_TEST_PASS",JSON.stringify({quick:{generations:10,population:12,evaluations:120},otherModesUntouched:true,qualityGuardUntouched:true,oldEvaluations:720}));
