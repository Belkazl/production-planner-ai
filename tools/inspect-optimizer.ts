const root="https://aps-setup-bridge-candidate-v2-production.up.railway.app";
async function getHtml(){
 const r=await fetch(root+"/",{signal:AbortSignal.timeout(60000)});
 const t=await r.text();
 console.log("PROBE_FETCH",JSON.stringify({status:r.status,bytes:t.length,rev:r.headers.get("x-pp-gantt-component")}));
 for(const id of ["ppRealOptProgressV1","ppLivePanelV2"]){
  const a=t.indexOf('<script id="'+id+'">'),b=t.indexOf("</script>",a);
  if(a<0||b<0){console.log("PROBE_MISSING",id);continue;}
  const src=t.slice(a,b+9);
  console.log("PROBE_SECTION",JSON.stringify({id,at:a,len:src.length}));
  for(let i=0;i<src.length;i+=1100) console.log("PROBE_PART",JSON.stringify({id,i,text:src.slice(i,i+1100)}));
 }
 const needles=["async function optimize(","async function optimizePlan(","function optimize(","async function runOptimize(","async function startOptimization(","function ppIncumbentDecision(","ppProjectAfterPlan","window.__ppOptimizationInFlight","id=\"opt\"","id=\"optimize\"","id=\"startOpt\"","id=\"planView\""];
 for(const s of needles){
  let pos=-1;
  while((pos=t.indexOf(s,pos+1))!==-1){
   console.log("PROBE_CONTEXT",JSON.stringify({needle:s,pos,text:t.slice(Math.max(0,pos-350),Math.min(t.length,pos+2700))}));
   if(s==="ppProjectAfterPlan"||s==="window.__ppOptimizationInFlight")break;
  }
 }
}
await getHtml();
for(const path of ["/api/plan-progress","/api/model","/__bridge_health"]){
 try{
  const t=Date.now(),r=await fetch(root+path,{signal:AbortSignal.timeout(60000)});
  const data=await r.json();
  const out=path==="/api/plan-progress"?{...data,candidate_preview:data.candidate_preview&&Object.keys(data.candidate_preview),best_preview:data.best_preview&&Object.keys(data.best_preview)}
  :path==="/api/model"?{ok:data.ok,ready:data.ready,orders:data.orders?.length,setupRules:data.setup_rules?.length,modelKeys:Object.keys(data).slice(0,30)}:data;
  console.log("PROBE_API",JSON.stringify({path,status:r.status,ms:Date.now()-t,data:out}).slice(0,4500));
 }catch(e){console.log("PROBE_API_ERR",path,String(e))}
}
