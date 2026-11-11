// OVH-only load repair for the pinned multi-tenant app.
// Reduces authentication payload, redundant progress storage reads and writes.
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
const root=resolve(process.argv[2]||"");
if(!root.endsWith("/app"))throw Error("LOAD_REPAIR_REQUIRES_PINNED_APP_WORKTREE");
function patch(file,swaps){
  const full=join(root,file);let s=readFileSync(full,"utf8");
  for(const [before,after,label] of swaps){
    const count=s.split(before).length-1;
    if(count!==1)throw Error("LOAD_REPAIR_ANCHOR_"+file+"_"+label+"_"+count);
    s=s.replace(before,after);
  }
  writeFileSync(full,s);
  console.log("OVH_LOAD_REPAIR_READY",file);
}
patch("auth-runtime.js",[[
  'PP_AUTH_GATEWAY_ORIGIN+"/api/db-storage?_pp_session_probe=1"',
  'PP_AUTH_GATEWAY_ORIGIN+"/api/auth/me"',
  "lightweight_session_probe"
],[
  '// Original account service does not implement /api/auth/me after login (returns 404).\n // Its protected storage API is authoritative: 200 only for a valid session, 401 for guests.\n // Never read, log, cache, or return the account\'s stored production data here.',
  '// OVH auth-gateway implements lightweight /api/auth/me. Avoid reading\n // large project/saved-plan JSON on each authenticated GA progress request.',
  "explain_lightweight_session"
]]);
patch("tenant-model-runtime.js",[[
  "async function ppReadAccountModel(req) {\n const session=ppAccountModelSession(req);",
  `const ppProgressRequestModelCache=new WeakMap();
async function ppReadAccountModel(req) {
 if(new URL(req.url).pathname==="/api/plan-progress"){
  let pending=ppProgressRequestModelCache.get(req);
  if(!pending){
   pending=ppReadAccountModelUncached(req);
   ppProgressRequestModelCache.set(req,pending);
  }
  return structuredClone(await pending);
 }
 return ppReadAccountModelUncached(req);
}
async function ppReadAccountModelUncached(req) {
 const session=ppAccountModelSession(req);`,
  "deduplicate_same_request_progress_model"
],[
  " if(!state||state.completed){",
  " if((!state||state.completed)&&!(typeof Bun!==\"undefined\"&&Bun.env.PP_PY_GA_WORKERS_ENABLED===\"1\")){",
  "allow_terminal_ga_result_from_account_scoped_python_worker"
]]);
patch("python-ga-upstream.mjs",[[
  "    try{await save(principal,state)}catch{return response({ok:false,error:'ga_state_unavailable'},503)}",
  `    // Do not rewrite a potentially large preview into PostgreSQL on every
    // progress poll. A new job is saved synchronously before its HTTP 202;
    // during an active job persist at most every 2 seconds, and always on
    // a terminal state. A failed required save still fails closed.
    const terminal=!["queued","running"].includes(state.state);
    const stamp=now();
    if(terminal||!state.lastPersistedAt||stamp-state.lastPersistedAt>=2000){
      try{await save(principal,state);state.lastPersistedAt=stamp}
      catch{return response({ok:false,error:"ga_state_unavailable"},503)}
    }`,
  "throttle_progress_persistence"
]]);
