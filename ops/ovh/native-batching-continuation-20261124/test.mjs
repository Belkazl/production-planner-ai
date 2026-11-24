import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {selectNativeResumeState} from "./continuation.mjs";
import {patchUpstream} from "./patch.mjs";
import {patchUpstream as patchLifecycle} from "../first-candidate-preview-20261124/patch.mjs";

const repo = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const original = readFileSync(resolve(repo, "ops/ovh/ga-complete-setup-final-20261117/python-ga-upstream.mjs"), "utf8");
const nativePatch = readFileSync(resolve(repo, "ops/ovh/ga-continue-native-v2-20261119/patch.mjs"), "utf8");
// Build the fixture from the published Nov19 replacement itself, without
// executing its filesystem patcher or duplicating the old continuation logic.
const replacement = JSON.parse(nativePatch.match(/^const replacement=(".*");$/m)[1]);
const begin = original.indexOf("      const sameModel=current?.modelKey===modelKey;");
const endMarker = '      console.warn("PP_GA_RESUME_SAFE_ORDER_SEED",source);';
const end = original.indexOf(endMarker, begin) + endMarker.length;
const fixture = original.slice(0, begin) + replacement + original.slice(end);
const patched = patchUpstream(fixture);
const jobId = "a".repeat(32), newId = "b".repeat(32);
const model = {start: "2026-11-24T08:00:00", orders: [{id: "one"}, {id: "two"}], equipment: []};
const modelKey = JSON.stringify(model);
const clone = value => JSON.parse(JSON.stringify(value));
const native = (extra = {}) => ({
  version: 2, model_hash: "c".repeat(64), pin_hash: "d".repeat(64), objective: "duration",
  order_sequence: ["two", "one"], completed_runs: 3, total_trials: 120,
  best_duration_minutes: 8570,
  native_genome: {batches: [[100, 100], [50, 150]], engine: "test-v2"},
  ...extra
});
const current = resume_state => ({id: jobId, modelKey, state: "completed", resume_state});

function harness({state = native(), savedModelKey = modelKey, result = null, source = patched} = {}) {
  const requests = [], loads = [];
  const factory = new Function("console", source.replace("export function createPythonGAUpstream", "function createPythonGAUpstream") +
    "\nreturn createPythonGAUpstream;")({warn() {}});
  const bridge = factory({
    enabled: true, origin: "http://ga-worker.railway.internal:8080", token: "synthetic-token-".repeat(4),
    upstreamUrl: req => req.url, sessionKey: async req => req.headers.get("x-test-account"),
    verifyLogin: async req => req.headers.get("x-test-account") !== "guest",
    readAccountModel: async () => clone(model), hashModel: value => JSON.stringify(value),
    checkPlan: () => { throw Error("Continuation must not validate a full plan in this POST"); },
    stateStore: {
      load: async principal => {
        loads.push(principal);
        return principal === "owner" ? {job_id: jobId, model_hash: savedModelKey,
          status: "completed", resume_state: state, result} : null;
      },
      save: async () => {}
    },
    fetchImpl: async (url, options) => {
      assert.equal(new URL(url).pathname, "/internal/jobs");
      assert.equal(options.method, "POST");
      requests.push({principal: options.headers["x-authenticated-account"], body: JSON.parse(options.body)});
      return Response.json({job_id: newId}, {status: 202});
    }
  });
  return {
    requests, loads,
    async start(options, account = "owner") {
      const req = new Request("https://app.example.test/api/plan", {method: "POST", headers: {"x-test-account": account}});
      return bridge.fetch(req, {body: JSON.stringify({__pp_async_start: true, continue: true, ...options})});
    }
  };
}

test("compact state preserves an unknown native schema, partition and original fingerprints", () => {
  const state = native({version: "future-native-schema"});
  const selected = selectNativeResumeState(current(state), modelKey, "duration");
  assert.deepEqual(selected, state);
  assert.notEqual(selected, state);
  assert.notEqual(selected.native_genome, state.native_genome);
  assert.equal(selected.model_hash, "c".repeat(64));
  assert.equal(selected.pin_hash, "d".repeat(64));
});

test("stale account model, changed objective and missing native fingerprints are ineligible", () => {
  assert.equal(selectNativeResumeState(current(native()), "changed-model", "duration"), null);
  assert.equal(selectNativeResumeState(current(native()), modelKey, "cycles"), null);
  for (const key of ["model_hash", "pin_hash"]) {
    assert.equal(selectNativeResumeState(current(native({[key]: "bad"})), modelKey, "duration"), null);
  }
});

test("opaque state is bounded JSON, with no nested operation plans or arbitrary objects", () => {
  for (const field of ["operations", "generic_operations", "setup_operations", "plan", "best_preview", "model"]) {
    assert.equal(selectNativeResumeState(current(native({native_genome: {[field]: []}})), modelKey, "duration"), null);
  }
  assert.equal(selectNativeResumeState(current(native({padding: "x".repeat(65536)})), modelKey, "duration"), null);
  assert.equal(selectNativeResumeState(current(native({padding: "я".repeat(33000)})), modelKey, "duration"), null);
  assert.equal(selectNativeResumeState(current(native({genes: Array(9000).fill(1)})), modelKey, "duration"), null);
  assert.equal(selectNativeResumeState(current(native({genes: new Array(1e6)})), modelKey, "duration"), null);
  assert.equal(selectNativeResumeState(current(native({model_hash: {toString() { throw Error("must not execute"); }}})), modelKey, "duration"), null);
  assert.equal(selectNativeResumeState(current(native({bad: Number.NaN})), modelKey, "duration"), null);
  assert.equal(selectNativeResumeState(current(native({bad: new Date()})), modelKey, "duration"), null);
  const cyclic = native(); cyclic.child = cyclic;
  assert.equal(selectNativeResumeState(current(cyclic), modelKey, "duration"), null);
  const state = native();
  Object.defineProperty(state, "getter", {enumerable: true, get() { throw Error("must not execute"); }});
  assert.equal(selectNativeResumeState(current(state), modelKey, "duration"), null);
});

test("server native state wins over the browser's order and forged state without scanning a full result", async () => {
  const result = {valid: true};
  Object.defineProperty(result, "operations", {get() { throw Error("full result must stay untouched"); }});
  const h = harness({result});
  assert.equal((await h.start({resume_plan: {order_sequence: ["one", "two"]},
    resume_state: native({model_hash: "e".repeat(64), native_genome: {forged: true}})})).status, 202);
  const options = h.requests[0].body.options;
  assert.deepEqual(options.resume_state, native());
  assert.deepEqual(options.resume_plan.order_sequence, ["two", "one"]);
  assert.equal(options.resume_plan.duration_minutes, 1e9);
  assert.equal(Object.hasOwn(options.resume_plan, "native_genome"), false);
  assert.equal(h.requests[0].principal, "owner");
  assert.deepEqual(h.loads, ["owner"]);
});

test("native normalized hashes are not rewritten to bridge hashes or current client pins", async () => {
  // A stale native fingerprint cannot be tested against the raw JS model hash.
  // It reaches Python unchanged, where load_resume_state rejects mismatches;
  // the companion fallback contains only an order and a reset score.
  const saved = native({model_hash: "f".repeat(64), pin_hash: "0".repeat(64)});
  const h = harness({state: saved});
  assert.equal((await h.start({pinned_operations: [{operation_id: "client-new-pin"}]})).status, 202);
  const options = h.requests[0].body.options;
  assert.deepEqual(options.resume_state, saved);
  assert.equal(options.resume_plan.model_hash, undefined);
  assert.equal(options.resume_plan.pin_hash, undefined);
  assert.equal(options.resume_plan.native_genome, undefined);
  assert.equal(options.resume_plan.duration_minutes, 1e9);
});

test("changed account model and objective use only the existing safe order fallback", async () => {
  for (const [setup, options] of [
    [{savedModelKey: "old-account-model"}, {}],
    [{}, {objective: "cycles"}],
    [{state: native({padding: "x".repeat(65536)})}, {}]
  ]) {
    const h = harness(setup);
    assert.equal((await h.start({...options, resume_plan: {order_sequence: ["one", "two"], duration_minutes: 1}})).status, 202);
    const posted = h.requests[0].body.options;
    assert.equal(posted.resume_state, undefined);
    assert.deepEqual(posted.resume_plan.order_sequence, ["one", "two"]);
    assert.equal(posted.resume_plan.duration_minutes, 1e9);
  }
});

test("a client native state cannot become trusted state for another authenticated account", async () => {
  const h = harness();
  assert.equal((await h.start({resume_state: native()}, "other-owner")).status, 202);
  assert.equal(h.requests[0].principal, "other-owner");
  assert.equal(h.requests[0].body.options.resume_state, undefined);
  assert.equal(h.requests[0].body.options.resume_plan.native_genome, undefined);
  assert.equal(h.requests[0].body.options.resume_plan.duration_minutes, 1e9);
  assert.deepEqual(h.loads, ["other-owner"]);
});

test("unauthenticated Continue and missing eligible state/hint do not start a worker", async () => {
  const guest = harness();
  assert.equal((await guest.start({resume_state: native()}, "guest")).status, 503);
  assert.equal(guest.requests.length, 0);
  assert.equal(guest.loads.length, 0);
  const absent = harness({state: null});
  assert.equal((await absent.start({})).status, 409);
  assert.equal(absent.requests.length, 0);
});

test("fresh starts remain unchanged and cannot silently receive saved native state", async () => {
  const h = harness();
  assert.equal((await h.start({continue: false})).status, 202);
  assert.equal(h.requests[0].body.options.resume_state, undefined);
  assert.equal(h.requests[0].body.options.resume_plan, undefined);
});

test("patch compiles, is exact/idempotent, and coexists with scoped Stop/SSE guards", () => {
  assert.equal(patchUpstream(patched), patched);
  execFileSync(process.execPath, ["--check", "--input-type=module"], {input: patched, stdio: ["pipe", "pipe", "pipe"]});
  assert.throws(() => patchUpstream(fixture.replace("current=await currentJob(principal)", "current=unscopedJob()")), /REQUIRED_GUARD/);
  assert.throws(() => patchUpstream(fixture.replace('source="client_order_hint"', 'source="changed"')), /SOURCE_DRIFT/);
  assert.throws(() => patchUpstream(patched.replace("if(nativeState)args.resume_state=nativeState;", "args.resume_state=clientState;")), /INSTALLED_SOURCE_DRIFT/);
  const stream = readFileSync(resolve(repo, "ops/ovh/sse-stream-v1-20261120/backend-stream.js.txt"), "utf8");
  const lifecycle = patchLifecycle(fixture.replace("  async function fetchUpstream(req,opts){", stream + "  async function fetchUpstream(req,opts){")
    .replace("    if(path==='/api/plan-progress'&&req.method==='GET')return progress(req);",
      "    if(path==='/api/plan-progress'&&req.method==='GET')return progress(req);\n" +
      "    if(path==='/api/plan-events'&&req.method==='GET')return stream(req);"));
  const combined = patchUpstream(lifecycle);
  assert.equal(patchLifecycle(combined), combined);
  assert.equal(patchUpstream(combined), combined);
  execFileSync(process.execPath, ["--check", "--input-type=module"], {input: combined, stdio: ["pipe", "pipe", "pipe"]});
});

test("optional deployed bridge satisfies the exact source and syntax contract", {
  skip: !process.env.LIFTORBIT_NATIVE_CONTINUATION_FIXTURE_ROOT
}, () => {
  const source = readFileSync(resolve(process.env.LIFTORBIT_NATIVE_CONTINUATION_FIXTURE_ROOT, "python-ga-upstream.mjs"), "utf8");
  const updated = patchUpstream(source);
  assert.equal(patchUpstream(updated), updated);
  execFileSync(process.execPath, ["--check", "--input-type=module"], {input: updated, stdio: ["pipe", "pipe", "pipe"]});
});
