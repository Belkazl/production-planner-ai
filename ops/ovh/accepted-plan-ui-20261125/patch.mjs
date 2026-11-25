import {readFileSync,writeFileSync} from "node:fs";
import assert from "node:assert/strict";
const [before,after]=process.argv.slice(2);
const src=readFileSync(before,"utf8");
assert(src.includes("ppOneSseProgressAndGantt")&&src.includes("ppGaQualityFloorV1"));
assert(!src.includes("function installAcceptedPlanGuard"));
writeFileSync(after,src+"\n;"+readFileSync(new URL("./guard.js",import.meta.url),"utf8"));
