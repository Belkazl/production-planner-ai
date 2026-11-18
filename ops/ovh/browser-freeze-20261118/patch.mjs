import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
const root=process.argv[2];
if(!root)throw Error("LIFTORBIT_BROWSER_FREEZE_APP_ROOT_REQUIRED");
const file=resolve(root,"restart-optimizer-ui.js");
const before=readFileSync(file,"utf8");
for(const expected of [
 "ppTruthfulSmoothGaPercentV1",
 "ppSmoothVerifiedProgressV1",
 "ppUnifiedGanttV2",
 "ppStopRestorePreviousPlanV1",
 "ppAutomaticIntermediatePreviewV1"
]){
 if(!before.includes(expected))throw Error("FREEZE_FIX_SOURCE_DRIFT_"+expected);
}
if(before.includes("ppResolveDuplicateGaProgress20261118"))throw Error("FREEZE_FIX_ALREADY_APPLIED");
// Both percent visualizers observe and rewrite the same button text. When the
// server reports a new percentage, one rewrites the other's output, producing
// an endless MutationObserver microtask loop and freezing Chrome.
const fix = `(function ppResolveDuplicateGaProgress20261118(){
"use strict";
if(window.__PP_SINGLE_GA_PROGRESS_RENDERER_V1__?.installed)return;
const oldRenderer=window.__PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__;
const currentRenderer=window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__;
if(!oldRenderer?.installed||typeof oldRenderer.stop!=="function"||
   !currentRenderer?.installed||typeof currentRenderer.refresh!=="function"){
 console.error("PP_GA_PROGRESS_SINGLE_OWNER_PREREQUISITES_MISSING");return;
}
// Disconnect the obsolete MutationObserver and its 85ms interval. Keep the
// newer confirmed-only renderer, which animates one percent at a time.
oldRenderer.stop();
window.__PP_SINGLE_GA_PROGRESS_RENDERER_V1__={
 installed:true,active:"confirmed-only",legacyObserverStopped:true
};
})();`;
writeFileSync(file,before+"\n;"+fix+"\n");
console.log("PP_GA_DOUBLE_MUTATION_OBSERVER_LOOP_FIXED","before",before.length,"addon",fix.length);
