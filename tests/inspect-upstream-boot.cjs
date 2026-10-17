"use strict";
const fs=require("fs");
const s=fs.readFileSync("/tmp/pp-gateway-fixture.html","utf8");
const keys=["prodplan.projects.v2","/api/db-storage","restoreProject","restorePlan","loadProjects","loadModel","sync","initialize","DOMContentLoaded","projects-mode","project.active","Saved Plans","savedPlans","function init","window.onload","document.body.innerHTML","bootstrap"];
console.log("UPSTREAM_FIXTURE_ANALYSIS",JSON.stringify({bytes:s.length,scripts:(s.match(/<script/g)||[]).length,body:(s.match(/<body/g)||[]).length,head:s.slice(0,320).replace(/\n/g," ")}));
for(const term of keys){
 const pos=[];let i=-1;while((i=s.indexOf(term,i+1))!==-1){pos.push(i);if(pos.length>=15)break}
 console.log("FIXTURE_KEY",JSON.stringify({term,count:pos.length,parts:pos.slice(0,7).map(i=>s.slice(Math.max(0,i-360),Math.min(s.length,i+460)).replace(/\n/g," "))}));
}
