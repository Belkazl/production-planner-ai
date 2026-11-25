import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {
  openProjectTextImport, transformSource,
  IMPORT_ANCHOR, API_ANCHOR, API_REPLACEMENT,
  STATS_ANCHOR, STATS_REPLACEMENT, READY_ANCHOR, READY_REPLACEMENT
} from './text-import.mjs';

const require = createRequire(import.meta.url);
const {JSDOM} = require(process.env.PP_TEST_JSDOM || '/tmp/liftorbit-text-import-test/node_modules/jsdom');
const copy = value => JSON.parse(JSON.stringify(value));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const fixture = {
  scheduler_mode: 'resource', start: '2026-11-24T08:00:00',
  orders: [1, 2, 3].map(n => ({id: `C${n}`, quantity: 1, unit: 'шт.', technical_process_id: 'FRY'})),
  equipment: [1, 2].map(n => ({id: `P${n}`, name: `Pan slot ${n}`, kind: 'workstation', capacity: 1, capacity_unit: 'шт.'})),
  employees: [], materials: [], setup_rules: [],
  technical_processes: [{id: 'FRY', operations: [1, 2].map(n => ({
    id: `S${n}`, sequence: n, duration_min: 1,
    resource_requirements: [{resource_type: 'equipment', match_mode: 'any', resource_ref: 'kind:workstation', resource_refs: ['kind:workstation'], quantity: 1}]
  }))}]
};
const sourceProject = {id: 'foreign-export-id', name: 'Imported name', model: fixture, revision: 20};
const baseProjects = () => [
  {id: 'existing-a', name: 'Existing A', model: {orders: [{id: 'A'}]}, revision: 8, lastPlan: {duration_minutes: 50}, history: [{run: 3}], savedPlans: [{id: 'saved-a'}]},
  {id: 'existing-b', name: 'Existing B', model: {orders: [{id: 'B'}]}, revision: 6, messages: [{role: 'user', text: 'keep'}]},
  {id: 'empty', name: '3 котлеты', model: null, revision: 0, lastPlan: null, savedPlans: [], history: [], messages: [{role: 'user', text: 'Keep this message'}], createdAt: '2026-11-24T08:00:00Z'}
];
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject}; };

function harness(options = {}) {
  const dom = new JSDOM('<!doctype html><body><input id="pmFile" type="file"></body>', {url: 'https://app.liftorbit.app/', runScripts: 'outside-only'});
  const w = dom.window;
  const state = {projects: copy(options.projects || baseProjects()), activeId: options.activeId || 'empty', writes: 0, apiCalls: [], opened: [], imports: [], shown: 0, fileClicks: 0};
  const get = id => state.projects.find(p => p.id === id) || null;
  Object.assign(w, {
    active: () => state.activeId, find: get, clone: copy,
    q: id => w.document.getElementById(id),
    mutate: (id, fn) => {const p = get(id); if (!p) return null; fn(p); state.writes++; return p;},
    apiModel: async m => {state.apiCalls.push(copy(m)); return options.api ? await options.api(m) : {ok: true, model: copy(m), model_ready: true};},
    openProject: async id => {state.opened.push(id);},
    showProjects: () => {state.shown++;},
    importFile: blob => {state.imports.push(blob);}
  });
  w.document.getElementById('pmFile').onclick = () => state.fileClicks++;
  w.eval(`(${openProjectTextImport.toString()})()`);
  const button = selector => w.document.querySelector(selector);
  const setInput = value => {button('#pmJsonText').value = typeof value === 'string' ? value : JSON.stringify(value);};
  setInput({project: sourceProject});
  return {dom, w, state, get, button, setInput, close: () => w.close()};
}

function schedule(minutes) {
  const starts = minutes === 3 ? [0,1,0,2,1,2] : [0,1,0,1,2,3];
  const stamp = min => `2026-11-24T08:0${min}:00`;
  const ops = [1,2,3].flatMap((order,i)=>[1,2].map((sequence,j)=>({
    order:`C${order}`,operation_id:`S${sequence}`,sequence,duration_min:1,
    batch_id:`C${order}.1`,batch:1,batch_quantity:1,equipment_ids:[`P${sequence===1?(order===2?2:1):(order===2?1:2)}`],employee_ids:[],
    start_min:starts[i*2+j],end_min:starts[i*2+j]+1,start:stamp(starts[i*2+j]),end:stamp(starts[i*2+j]+1)
  })));
  return {ok:true,valid:true,start:fixture.start,finish:stamp(minutes),duration_minutes:minutes,operation_count:6,batch_count:3,
    operations:copy(ops),generic_operations:copy(ops),errors:[],validation_errors:[],conflicts:[],violations:[],
    batches:[1,2,3].map(n=>({order:`C${n}`,batch_id:`C${n}.1`,batch:1,start_min:Math.min(...ops.filter(o=>o.order===`C${n}`).map(o=>o.start_min)),end_min:Math.max(...ops.filter(o=>o.order===`C${n}`).map(o=>o.end_min))}))};
}
const referencePayload = () => ({format:'prodplan-project-v2',project:{name:'Imported',model:copy(fixture),lastPlan:{...schedule(3),algorithm:'operation_level_reference_scheduler',calculation_origin:'offline_existing_operation_scheduler'}},plan_name:'Эталонное решение — 3 минуты (планировщик операций)'});
function populatedProjects() {
  const projects=baseProjects(); Object.assign(projects[2],{model:copy(fixture),revision:2,lastPlan:{...schedule(4),algorithm:'generic_resource_scheduler',optimization_run:3,total_generations:440},history:[{run:3}],savedPlans:Array.from({length:35},(_,i)=>({id:`old-${i}`,name:`Old ${i}`,plan:{duration_minutes:20+i}}))}); return projects;
}
const planHarness = options => {const h=harness({projects:populatedProjects(),...options});h.setInput(referencePayload());return h;};

test('matching reference plan preserves project and all saved plans, including the previous GA result', async () => {
  const h=planHarness();
  try {
    const before=copy(h.state.projects); await h.button('[data-plan]').onclick();
    const p=h.get('empty'); assert.equal(h.state.writes,1); assert.deepEqual(h.state.opened,['empty']);
    assert.deepEqual(h.state.projects.slice(0,2),before.slice(0,2));
    for(const k of ['id','name','model','revision','history','messages','createdAt']) assert.deepEqual(p[k],before[2][k]);
    assert.equal(p.savedPlans.length,37); assert.deepEqual(copy(p.savedPlans.slice(2)),before[2].savedPlans);
    assert.deepEqual(p.savedPlans[1].plan,before[2].lastPlan); assert.match(p.savedPlans[1].name,/4 мин/);
    assert.equal(p.savedPlans[1].optimization_run,3); assert.equal(p.savedPlans[1].total_generations,440);
    assert.equal(p.savedPlans[0].name,referencePayload().plan_name); assert.equal(p.savedPlans[0].duration_minutes,3);
    assert.equal(p.savedPlans[0].optimization_run,0); assert.equal(p.savedPlans[0].total_generations,0);
    assert.equal(p.lastPlan.algorithm,'operation_level_reference_scheduler'); assert.equal(p.lastPlan.calculation_origin,'offline_existing_operation_scheduler');
    assert.equal(p.lastPlan.optimization_run,undefined); assert.equal(p.lastPlan.total_generations,undefined);
    assert.equal(p.lastPlan._revision,2); assert.deepEqual(p.savedPlans[0].plan,p.lastPlan);
  } finally {h.close();}
});

test('plan import rejects mismatched models and incomplete or invalid schedules before any request', async () => {
  const changes = [
    d=>{d.project.model.orders[0].quantity=2;}, d=>{d.project.lastPlan=null;}, d=>{d.project.lastPlan.partial=true;},
    d=>{d.project.lastPlan.validation_errors=['bad'];}, d=>{d.project.lastPlan.operation_count=5;},
    d=>{d.project.lastPlan.operations.pop();d.project.lastPlan.generic_operations.pop();},
    d=>{d.project.lastPlan.operations[0].equipment_ids=['P2'];d.project.lastPlan.generic_operations=copy(d.project.lastPlan.operations);},
    d=>{d.project.lastPlan.operations[0].start_min=-1;d.project.lastPlan.generic_operations=copy(d.project.lastPlan.operations);},
    d=>{d.project.lastPlan.operations[0].batch_quantity=2;d.project.lastPlan.generic_operations=copy(d.project.lastPlan.operations);},
    d=>{d.project.lastPlan.operations[4].start_min=0;d.project.lastPlan.operations[4].end_min=1;d.project.lastPlan.operations[4].start='2026-11-24T08:00:00';d.project.lastPlan.operations[4].end='2026-11-24T08:01:00';d.project.lastPlan.generic_operations=copy(d.project.lastPlan.operations);},
    d=>{d.project.lastPlan.operations[5].start_min=0;d.project.lastPlan.operations[5].end_min=1;d.project.lastPlan.operations[5].start='2026-11-24T08:00:00';d.project.lastPlan.operations[5].end='2026-11-24T08:01:00';d.project.lastPlan.generic_operations=copy(d.project.lastPlan.operations);},
    d=>{d.project.lastPlan.duration_minutes=2;}, d=>{d.project.lastPlan.finish='2026-11-24T08:04:00';},
    d=>{d.project.lastPlan.batches[0].end_min=3;}, d=>{d.project.lastPlan.generic_operations[0].start='2026-11-24T09:00:00';}
  ];
  for(const change of changes) {
    const h=planHarness(); try {const before=copy(h.state.projects),data=referencePayload();change(data);h.setInput(data);await h.button('[data-plan]').onclick();assert(h.button('#pmJsonError').textContent);assert.equal(h.state.apiCalls.length,0);assert.equal(h.state.writes,0);assert.deepEqual(h.state.projects,before);} finally {h.close();}
  }
});

test('plan import guards changes to selection, model, revision, current plan and deletion across validation', async () => {
  const changes=[h=>{h.state.activeId='existing-a';},h=>{h.get('empty').model.orders[0].quantity=2;},h=>{h.get('empty').revision++;},h=>{h.get('empty').lastPlan.duration_minutes=9;},h=>{h.state.projects=h.state.projects.filter(p=>p.id!=='empty');}];
  for(const change of changes) {
    const pending=deferred(),h=planHarness({api:()=>pending.promise});
    try {const operation=h.button('[data-plan]').onclick();assert.equal(h.state.apiCalls.length,1);change(h);const before=copy(h.state.projects);pending.resolve({model:copy(fixture),model_ready:true});await operation;assert.equal(h.state.writes,0);assert.deepEqual(h.state.projects,before);assert(h.button('#pmJsonError').textContent);} finally {h.close();}
  }
});

test('plan cancellation prevents a pending write and server readiness false remains blocking', async () => {
  for(const action of ['cancel','not-ready','different-model']) {
    const pending=deferred(),h=planHarness({api:()=>pending.promise});
    try {const before=copy(h.state.projects),operation=h.button('[data-plan]').onclick();if(action==='cancel')h.button('[data-cancel]').click();pending.resolve({model:action==='different-model'?{orders:[]}:copy(fixture),model_ready:action!=='not-ready'});await operation;assert.equal(h.state.writes,0);assert.deepEqual(h.state.projects,before);} finally {h.close();}
  }
});

test('concurrent saved plans and metadata remain intact and duplicate previous plan is not added', async () => {
  const pending=deferred(),h=planHarness({api:()=>pending.promise});
  try {const operation=h.button('[data-plan]').onclick();const p=h.get('empty'),extra={id:'saved-while-validating',plan:copy(p.lastPlan)};p.savedPlans.push(extra);p.name='Renamed meanwhile';p.history.push({run:4});const before=copy(p);pending.resolve({model:copy(fixture),model_ready:true});await operation;assert.equal(h.state.writes,1);assert.equal(p.savedPlans.length,before.savedPlans.length+1);assert.deepEqual(copy(p.savedPlans.slice(1)),before.savedPlans);assert.equal(p.name,before.name);assert.deepEqual(p.history,before.history);} finally {h.close();}
});

test('matching ignores only UI __ppid while saved snapshots retain current metadata', async () => {
  const projects=populatedProjects();projects[2].model.equipment[0].__ppid='native-ui-id';
  const h=planHarness({projects});try {await h.button('[data-plan]').onclick();assert.equal(h.state.writes,1);assert.equal(h.get('empty').savedPlans[0].model_snapshot.equipment[0].__ppid,'native-ui-id');} finally {h.close();}
});

test('invalid JSON and invalid model shapes never reach persistence', async () => {
  for (const value of ['{', {}, {projects: []}, {project: {model: []}}, {project: {model: {orders: {}}}}, {model: fixture}]) {
    const h = harness();
    try {
      const before = copy(h.state.projects);
      h.setInput(value);
      await h.button('[data-fill]').onclick();
      assert(h.button('#pmJsonError').textContent);
      assert.equal(h.state.apiCalls.length, 0);
      assert.equal(h.state.writes, 0);
      assert.deepEqual(h.state.projects, before);
    } finally {h.close();}
  }
});

test('fill rejects multiple projects and oversized input', async () => {
  for (const value of [{projects: [sourceProject, sourceProject]}, ' '.repeat(10 * 1024 * 1024 + 1)]) {
    const h = harness();
    try {h.setInput(value); await h.button('[data-fill]').onclick(); assert(h.button('#pmJsonError').textContent); assert.equal(h.state.apiCalls.length, 0); assert.equal(h.state.writes, 0);}
    finally {h.close();}
  }
});

test('fill keeps the selected ID and preserves every other project', async () => {
  const h = harness();
  try {
    const before = copy(h.state.projects);
    await h.button('[data-fill]').onclick();
    assert.equal(h.state.projects.length, before.length);
    assert.deepEqual(h.state.projects.slice(0, 2), before.slice(0, 2));
    const changed = h.get('empty');
    assert.equal(changed.id, 'empty'); assert.equal(changed.name, '3 котлеты');
    assert.equal(changed.createdAt, before[2].createdAt);
    assert.deepEqual(changed.messages, before[2].messages);
    assert.deepEqual(changed.model, fixture); assert.equal(changed.revision, 1);
    assert.equal(h.state.writes, 1); assert.deepEqual(h.state.opened, ['empty']);
    assert.equal(h.button('#pmJsonText'), null);
  } finally {h.close();}
});

test('populated projects and projects with saved results cannot be filled', () => {
  for (const patch of [{model: fixture}, {savedPlans: [{id: 'keep'}]}, {lastPlan: {valid: true}}, {history: [{run: 1}]}]) {
    const projects = baseProjects(); Object.assign(projects[2], patch);
    const h = harness({projects});
    try {assert.equal(h.button('[data-fill]'), null); assert(h.button('[data-new]')); assert(h.button('[data-file]'));}
    finally {h.close();}
  }
});

test('selection changed before submission is rejected without an API call', async () => {
  const h = harness();
  try {h.state.activeId = 'existing-a'; await h.button('[data-fill]').onclick(); assert.equal(h.state.apiCalls.length, 0); assert.equal(h.state.writes, 0);}
  finally {h.close();}
});

test('selection change or concurrent edit during validation does not overwrite data', async () => {
  for (const change of [h => {h.state.activeId = 'existing-a';}, h => {h.get('empty').model = {orders: [{id: 'concurrent-edit'}]};}, h => {h.state.projects = h.state.projects.filter(p => p.id !== 'empty');}]) {
    const wait = deferred(); const h = harness({api: () => wait.promise});
    try {
      const pending = h.button('[data-fill]').onclick();
      change(h); const afterConcurrentChange = copy(h.state.projects);
      wait.resolve({ok: true, model: copy(fixture), model_ready: true}); await pending;
      assert.deepEqual(h.state.projects, afterConcurrentChange); assert.equal(h.state.writes, 0);
      assert.equal(h.state.opened.length, 0); assert(h.button('#pmJsonError').textContent);
    } finally {h.close();}
  }
});

test('Cancel, Escape and backdrop cancellation stop a pending fill', async () => {
  const cancelActions = [h => h.button('[data-cancel]').click(), h => h.button('#pmJsonText').dispatchEvent(new h.w.KeyboardEvent('keydown', {key: 'Escape'})), h => h.button('.pm-modal-backdrop').click()];
  for (const cancel of cancelActions) {
    const wait = deferred(); const h = harness({api: () => wait.promise});
    try {
      const before = copy(h.state.projects); const pending = h.button('[data-fill]').onclick();
      cancel(h); assert.equal(h.button('#pmJsonText'), null);
      wait.resolve({ok: true, model: copy(fixture), model_ready: true}); await pending;
      assert.deepEqual(h.state.projects, before); assert.equal(h.state.writes, 0); assert.equal(h.state.opened.length, 0);
    } finally {h.close();}
  }
});

test('server failure keeps the modal usable and leaves all models unchanged', async () => {
  const h = harness({api: async () => {throw new Error('temporary server failure');}});
  try {const before = copy(h.state.projects); await h.button('[data-fill]').onclick(); assert.deepEqual(h.state.projects, before); assert.equal(h.button('[data-fill]').disabled, false); assert.match(h.button('#pmJsonError').textContent, /temporary server failure/);}
  finally {h.close();}
});

test('new project import delegates the unchanged JSON to the native file importer', async () => {
  const h = harness();
  try {
    const before = copy(h.state.projects); h.button('[data-new]').click();
    assert.equal(h.state.imports.length, 1); assert.deepEqual(h.state.projects, before); assert.equal(h.state.writes, 0);
    const text = await new Promise((resolve, reject) => {const fr = new h.w.FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsText(h.state.imports[0]);});
    assert.deepEqual(JSON.parse(text), {project: sourceProject});
  } finally {h.close();}
});

test('Choose file still opens the original file input', () => {
  const h = harness();
  try {h.button('[data-file]').click(); assert.equal(h.state.fileClicks, 1); assert.equal(h.button('#pmJsonText'), null); assert.equal(h.state.writes, 0);}
  finally {h.close();}
});

function apiHarness(responses) {
  const calls = [];
  const context = vm.createContext({fetch: async (url, options) => {
    calls.push({url, options}); const r = responses.shift(); if (!r) throw new Error('unexpected fetch');
    return {ok: r.httpOk !== false, json: async () => r.body};
  }});
  const fn = vm.runInContext(`(async function(m){const r=await fetch('/api/project/model/import',{method:'POST',body:JSON.stringify({model:m})});${API_REPLACEMENT}})`, context);
  return {fn, calls};
}

test('explicit server readiness false is preserved without another request', async () => {
  const model = copy(fixture); const h = apiHarness([{body: {ok: true, model, model_ready: false}}]);
  const result = await h.fn(model); assert.equal(result.model_ready, false); assert.equal(result.model, model); assert.equal(h.calls.length, 1);
});

test('missing readiness is checked without replacing the acknowledged model', async () => {
  const model = copy(fixture); const reordered = Object.fromEntries(Object.entries(copy(model)).reverse());
  const h = apiHarness([{body: {ok: true, model}}, {body: {ok: true, model: reordered, model_ready: true}}]);
  const result = await h.fn(model); assert.equal(result.model_ready, true); assert.equal(result.model, model);
  assert.equal(h.calls[1].url, '/api/model'); assert.equal(h.calls[1].options.cache, 'no-store');
});

test('readiness verification rejects a different model or server failure', async () => {
  for (const response of [{body: {ok: true, model: {orders: [{id: 'other'}]}, model_ready: true}}, {httpOk: false, body: {ok: false, error: 'offline'}}, {body: {ok: true, model: fixture}}]) {
    const h = apiHarness([{body: {ok: true, model: fixture}}, response]); await assert.rejects(() => h.fn(fixture));
  }
});

test('Gantt-only __ppid metadata is not treated as a different production model', async () => {
  const model = copy(fixture); const stored = copy(fixture); model.equipment[0].__ppid = 'ui-render-id';
  const h = apiHarness([{body: {ok: true, model}}, {body: {ok: true, model: stored, model_ready: true}}]);
  const result = await h.fn(model); assert.equal(result.model, model); assert.equal(result.model_ready, true);
});

test('cards count the resource model once and recognize it as ready', () => {
  const stats = new Function('m', `return ({${STATS_REPLACEMENT}})`);
  const ready = new Function(`${READY_REPLACEMENT};return modelLooksReady`)();
  assert.equal(stats(fixture).a, 2); assert.equal(ready(fixture), true);
  assert.equal(stats({...fixture, autoclaves: copy(fixture.equipment)}).a, 2);
  assert.equal(stats({equipment: [], autoclaves: [{id: 'legacy'}]}).a, 1);
  assert.equal(ready({...fixture, orders: []}), false);
});

const transformer = vm.runInNewContext(`${transformSource()};ppProjectTextImportHtml`);
const anchors = [IMPORT_ANCHOR, API_ANCHOR, STATS_ANCHOR, READY_ANCHOR];
test('HTML transformation is all-or-nothing and idempotent', () => {
  const input = anchors.join('\n'); const output = transformer(input);
  assert(output.includes('PP_PROJECT_TEXT_IMPORT_V1')); assert.equal(transformer(output), output);
  assert.equal(transformer('<html>login</html>'), '<html>login</html>');
  for (const anchor of anchors) {const missing = input.replace(anchor, 'drift'); assert.equal(transformer(missing), missing); const duplicate = input + '\n' + anchor; assert.equal(transformer(duplicate), duplicate);}
});

const nativePath = process.env.PP_NATIVE_PROJECT_FIXTURE || '/tmp/liftorbit-text-import-test/native-project-manager.js';
if (existsSync(nativePath)) {
  test('actual native project-manager fixture remains syntactically valid', () => {
    const source = readFileSync(nativePath, 'utf8'); for (const anchor of anchors) assert.equal(source.split(anchor).length, 2);
    const output = transformer(source); assert(output.includes('PP_PROJECT_TEXT_IMPORT_V1')); new vm.Script(output);
  });
  test('actual native manager fills and reopens the same project with optimizer enabled', async () => {
    const dom = new JSDOM('<!doctype html><body><div id="sectionView"></div><div id="planView"></div><div id="messages"></div><div id="activeProjectChip"></div><span id="valid"></span><span id="meta"></span><button id="opt"></button></body>', {url: 'https://app.liftorbit.app/', runScripts: 'outside-only'});
    const w = dom.window; let acknowledged = null; const calls = [];
    try {
      Object.assign(w, {model: null, modelReady: false, hasResult: false, opt: w.document.getElementById('opt'), q: id => w.document.getElementById(id), renderSummary: () => {}, clearPlan: () => {}, buildGanttSkeleton: () => {}, bubble: () => {}});
      w.fetch = async (url, options) => {calls.push(url); if (url === '/api/project/model/import') {acknowledged = JSON.parse(options.body).model; return {ok: true, json: async () => ({ok: true, model: copy(acknowledged)})};} if (url === '/api/model') return {ok: true, json: async () => ({ok: true, model: copy(acknowledged), model_ready: true})}; throw new Error(`unexpected route ${url}`);};
      const before = baseProjects(); w.localStorage.setItem('prodplan.projects.v2', JSON.stringify(before)); w.localStorage.setItem('prodplan.project.active.v2', 'empty');
      const init = "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0));else setTimeout(init,0)";
      let source = transformer(readFileSync(nativePath, 'utf8')); assert.equal(source.split(init).length, 2);
      source = source.replace(init, 'window.__nativeProjectTest={showProjects,read,active};'); w.eval(source);
      w.__nativeProjectTest.showProjects(); w.document.getElementById('pmImport').click(); w.document.getElementById('pmJsonText').value = JSON.stringify({project: sourceProject});
      await w.document.querySelector('[data-fill]').onclick();
      const saved = JSON.parse(w.localStorage.getItem('prodplan.projects.v2'));
      assert.equal(saved.length, before.length); assert.deepEqual(saved.slice(0, 2), before.slice(0, 2)); assert.deepEqual(saved.find(p => p.id === 'empty').model, fixture);
      assert.equal(w.__nativeProjectTest.active(), 'empty'); assert.equal(w.modelReady, true); assert.equal(w.opt.disabled, false);
      assert(calls.includes('/api/model')); assert(!calls.includes('/api/project/model/clear'));
    } finally {w.close();}
  });
}

const nativeSavedPath = '/tmp/liftorbit-text-import-test/native-saved-plans.js';
if (existsSync(nativeSavedPath)) test('imported records match native Saved Plans snapshot and signature exactly', async () => {
  const source=readFileSync(nativeSavedPath,'utf8');
  const helpers=vm.runInNewContext(`(()=>{${source.slice(source.indexOf('const c='),source.indexOf('function diff('))};return {proj,hash}})()`);
  const projects=populatedProjects();projects[2].model.equipment[0].__ppid='native-id';
  const h=planHarness({projects});
  try {await h.button('[data-plan]').onclick();assert.equal(h.state.writes,1);const p=h.get('empty'),record=p.savedPlans[0],snapshot=helpers.proj(p.model);assert.deepEqual(record.model_snapshot,copy(snapshot));assert.equal(record.model_signature,helpers.hash(snapshot));} finally {h.close();}
});

const liveModelPath='/tmp/liftorbit-text-import-test/live-model.json',livePlanPath='/tmp/liftorbit-text-import-test/live-progress.json',referencePath='/tmp/liftorbit-text-import-test/reference-project.json';
if ([liveModelPath,livePlanPath,referencePath].every(existsSync)) test('exact live model accepts the actual operation scheduler reference and preserves the live GA result', async () => {
  const model=JSON.parse(readFileSync(liveModelPath,'utf8')).model,plan=JSON.parse(readFileSync(livePlanPath,'utf8')).result,data=JSON.parse(readFileSync(referencePath,'utf8'));
  const projects=populatedProjects();Object.assign(projects[2],{model,lastPlan:plan});
  const h=planHarness({projects});
  try {h.setInput(data);await h.button('[data-plan]').onclick();assert.equal(h.state.writes,1,h.button('#pmJsonError')?.textContent);const p=h.get('empty');assert.equal(p.lastPlan.duration_minutes,3);assert.equal(p.lastPlan.operation_count,6);assert.deepEqual(p.savedPlans[1].plan,plan);assert.equal(p.lastPlan.total_generations,undefined);assert.equal(p.lastPlan.reference_schedule.validation.valid,true);} finally {h.close();}
});

let failures = 0;
for (const [name, fn] of tests) {
  try {await fn(); console.log('PASS', name);}
  catch (error) {failures++; console.error('FAIL', name, error.stack || String(error));}
}
console.log('PROJECT_TEXT_IMPORT_TESTS', JSON.stringify({passed: tests.length - failures, failed: failures, nativeFixture: existsSync(nativePath)}));
if (failures) process.exitCode = 1;
