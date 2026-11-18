const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=process.argv[2];if(!root)throw Error("QUICK_TEST_ROOT_REQUIRED");
const s=fs.readFileSync(path.join(root,"restart-optimizer-ui.js"),"utf8");
for(const [mode,generations,population] of [
 ["quick",10,12],["standard",60,32],["thorough",180,48],["maximum",360,64]
]){
 const regex=new RegExp(mode+":Object\\.freeze\\(\\{generations:(\\d+),population:(\\d+)\\}\\)");
 const matches=[...s.matchAll(new RegExp(regex.source,"g"))];
 assert.equal(matches.length,1,"unique "+mode);
 assert.equal(Number(matches[0][1]),generations,mode+" generations");
 assert.equal(Number(matches[0][2]),population,mode+" candidates");
}
assert.equal(s.includes("generations:30,population:24"),false);
for(const marker of ["PP_OPTIMIZER_DEPTH_LAST_RUN__","__PP_GA_OBJECTIVE_FLOOR_V1__","PP_GA_WORSE_OBJECTIVE_REJECTED","ppOptimizerDepthSelect","pp:optimizer-reconnect-pending","pp:optimizer-depth-changed"]){
 assert(s.includes(marker),"preserved "+marker);
}
assert(s.includes("generations:config.generations,population:config.population"),"depth mode must reach GA POST");
console.log("QUICK_DEPTH_V2_PRESET_AND_BOUNDARY_TEST_PASS",JSON.stringify({quick:{generations:10,population:12,evaluations:120},otherModesUnchanged:true,qualityGuardPreserved:true}));
