import { mkdirSync } from "node:fs";
import path from "node:path";

const root="/tmp/pp-progress-fixed";
const base="https://raw.githubusercontent.com/Belkazl/production-planner-ai";
const files=[
  ["baselines/2026-10-10/aps-setup-bridge/index.ts",base+"/96998d8d3ddced9eb5281d24a6d2539e275220a0/baselines/2026-10-10/aps-setup-bridge/index.ts"],
  ["build-bridge.ts",base+"/fix/ga-progress-not-premature-100/build-bridge.ts"]
];
mkdirSync(root,{recursive:true});
process.chdir(root);
for (const [filename,url] of files) {
  const resp=await fetch(url,{signal:AbortSignal.timeout(15000)});
  if(!resp.ok)throw Error("PP_BOOTSTRAP_SOURCE_UNAVAILABLE "+filename+" "+resp.status);
  const target=path.join(root,filename);
  mkdirSync(path.dirname(target),{recursive:true});
  await Bun.write(target,await resp.text());
}
await import(path.join(root,"build-bridge.ts"));
await import(path.join(root,"index.ts"));
