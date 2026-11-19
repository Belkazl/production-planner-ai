import {readFileSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {patchTransitionV5} from "../ga-native-transition-v5-20261119/transform.mjs";
const root=process.argv[2];
if(!root)throw Error("FIRST_STAGE_UI_ROOT_REQUIRED");
const file=resolve(root,"restart-optimizer-ui.js");
const source=readFileSync(file,"utf8");
const base=dirname(fileURLToPath(import.meta.url));
const v4=readFileSync(resolve(base,"../ga-progress-v4-20261119/runtime.js"),"utf8");
const v5=patchTransitionV5(v4);
const shed=readFileSync(resolve(base,"../ga-progress-load-shed-20261119/runtime.js"),"utf8");
const suffix="\n;"+v5+"\n\n;"+shed+"\n";
if(!source.endsWith(suffix))throw Error("FIRST_STAGE_UI_SOURCE_DRIFT");
const old= ` button.setAttribute("data-pp-ga-v4-label",
  (prefix.trim()|| (isRu()?"Оптимизация":"Optimization"))+" "+shown+"%");
 busyCount++;`;
const fresh=` const description=shown<=4?(isRu()?"Подготовка расчёта":"Preparing calculation"):
  shown===5?(isRu()?"Построение первого плана":"Building first plan"):
  (prefix.trim()||(isRu()?"Оптимизация":"Optimization"));
 button.setAttribute("data-pp-ga-v4-label",description+" · "+shown+"%");
 busyCount++;`;
const target=source.slice(0,-suffix.length);
if(v5.split(old).length!==2)throw Error("FIRST_STAGE_UI_V5_UNEXPECTED");
const enhanced=v5.replace(old,fresh);
const next=target+"\n;"+enhanced+"\n\n;"+shed+"\n";
if(!next.includes("ppStopRestorePreviousPlanV1")||!next.includes("ppUnifiedGanttV2")||
 !next.includes("ppLargeGaProgressLoadShedV1"))throw Error("FIRST_STAGE_UI_REQUIRED_FEATURE_MISSING");
writeFileSync(file,next);
console.log("FIRST_STAGE_UI_NO_STALE_ONE_PERCENT_READY",JSON.stringify({bytes:source.length,after:next.length}));
