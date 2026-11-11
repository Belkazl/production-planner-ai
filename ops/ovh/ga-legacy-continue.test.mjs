import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync("app/auth-runtime.js","utf8");
const upstream=readFileSync("app/python-ga-upstream.mjs","utf8");
test("fallback native optimizer ships compact legacy incumbent when continuing",()=>{
 assert(html.includes("pp-ovh-portable-legacy-continuation"));
 assert(html.includes("__ppLegacyContinuationSeed"));
 assert(html.includes("resume_plan:continuing"));
 assert(html.includes("order_sequence:sequence"));
 assert(html.includes("window.__ppFreshRestartPending"));
});
test("backend prefers same-account compatible persisted resume_state",()=>{
 assert(upstream.includes("current.modelKey===modelKey"));
 assert(upstream.includes("delete args.resume_plan"));
 assert(upstream.includes("continuation_seed_missing_or_invalid"));
});
