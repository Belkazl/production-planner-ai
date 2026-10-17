function ppStartOverHtml(input){
 let html=input;
 // Optional debug routes may disable strict optimizer guards, keep those routes usable.
 if(!html.includes("function ppIncumbentCurrentPlan(){let saved=null;"))return html;
 function swap(a,b,label){
  const n=html.split(a).length-1;
  if(n!==1)throw Error("PP_START_OVER_HTML_"+label+"_"+n);
  html=html.replace(a,b);
 }
 swap("function ppIncumbentCurrentPlan(){let saved=null;",
      "function ppIncumbentCurrentPlan(){if(window.__ppFreshRestartPending)return null;if(window.__ppFreshRestartMode&&window.__ppFreshRestartProject===localStorage.getItem('prodplan.project.active.v2'))return window.__ppFreshReferencePlan||null;let saved=null;",
      "dont_inherit_old_incumbent");
 swap("const entry=find(id),prev=entry&&entry.lastPlan,goal=",
      "const entry=find(id),prev=entry&&entry.lastPlan;if(window.__ppFreshRestartPending&&d&&d.valid!==false&&(d.operations||d.generic_operations||[]).length){window.__ppFreshReferencePlan=d;window.__ppFreshReferenceProject=id}const goal=",
      "fresh_plan_persistence");
 swap("if(prev&&prev.valid!==false&&Number(prev._revision??entry.revision)",
      "if(!window.__ppFreshRestartPending&&prev&&prev.valid!==false&&Number(prev._revision??entry.revision)",
      "skip_old_best_only_during_initial_run");
 if(!html.includes("window.__ppFreshReferencePlan=d")||!html.includes("if(window.__ppFreshRestartPending)return null"))
  throw Error("PP_START_OVER_HTML_FAILED");
 return html;
}
