(function installAcceptedPlanGuard(){
 function install(){
  const save=window.ppProjectAfterPlan;
  if(typeof save!=="function"||save.acceptedPlanGuard)return;
  function guarded(candidate){
   const id=localStorage.getItem("prodplan.project.active.v2");
   const records=JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]");
   const project=records.find(p=>p.id===id);
   if(!project)return save.apply(this,arguments);
   const fresh=window.__ppFreshRestartMode===true&&window.__ppFreshRestartProject===id;
   const prior=fresh?window.__ppFreshReferencePlan:project.lastPlan;
   const goal=window.__ppOptimizerObjectiveAtStart||window.ppOptimizerObjective?.()||project.model?.objective;
   const metric=({wait:"operator_wait_minutes",idle:"machine_idle_minutes",cycles:"batch_count"})[goal]||"duration_minutes";
   const complete=p=>p?.valid===true&&!p.partial&&(p.operations?.length||p.generic_operations?.length)&&
     (p._revision==null||Number(p._revision)===Number(project.revision))&&p[metric]!=null&&
     Number.isFinite(Number(p[metric]))&&Number(p[metric])>=0;
   if(complete(prior)&&(!complete(candidate)||Number(candidate[metric])>Number(prior[metric])+0.01)){
    window.__ppOptimizerCommittedPlan=window.__ppTabPlan=window.__ppGenericPlan=prior;
    if(typeof renderPlan==="function")renderPlan(prior);
    if(typeof renderKpisWithDelta==="function")renderKpisWithDelta(prior);
    return;
   }
   const result=save.apply(this,arguments);
   if(fresh&&complete(candidate)){
    const stored=JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]").find(p=>p.id===id);
    if(stored?.revision===project.revision&&complete(stored.lastPlan)){
     window.__ppFreshReferencePlan=stored.lastPlan;
     window.__ppFreshReferenceProject=id;
    }
   }
   return result;
  }
  guarded.acceptedPlanGuard=true;
  window.ppProjectAfterPlan=guarded;
 }
 install();
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});
})();
