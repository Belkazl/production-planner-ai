import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// These two small worker-response fixtures are public at
// Belkazl/production-planner-ai@fa8e2d61ca996a33c0a36c635fabdf333b104ab9.
// They predate the complete native schedule contract. Only their data changes;
// the account-isolation, persistence, cancellation and secret checks stay exact.
const marker = 'pp_integrated_setup_complete_build_fixture_20261125';
export const BUILD_FIXTURE_FILES = ['tests/python-ga-upstream.test.mjs', 'tests/python-ga-state.test.mjs'];
const upstreamBefore = '  const plan={ok:true,valid:true,operations:m.orders.map(x=>({order:x.id})),setup_rules_processed:false};';
const upstreamAfter = `  // ${marker}: complete synthetic native worker response.
  const plan={ok:true,valid:true,partial:false,
    operations:m.orders.map((x,i)=>({order:x.id,batch:1,operation_id:'synthetic-work',
      equipment_ids:[m.equipment[0].id],employee_ids:[],start_min:i,end_min:i+1,duration_min:1})),
    setup_operations:[],setup_count:0,setup_minutes:0,setup_rules_processed:true,
    duration_minutes:m.orders.length,batch_count:m.orders.length,operator_wait_minutes:0,machine_idle_minutes:0,
    order_sequence:m.orders.map(x=>x.id)};`;
const stateBefore = '   worker.set(id,{status:"completed",result:{valid:true,operations:[{order:"OA1"}],resume_state:{completed_runs:1}}});';
const stateAfter = `   // ${marker}: complete synthetic native worker response.
   worker.set(id,{status:"completed",result:{ok:true,valid:true,partial:false,
    operations:[{order:"OA1",batch:1,operation_id:"synthetic-work",equipment_ids:["E1"],employee_ids:[],
      start_min:0,end_min:1,duration_min:1}],setup_operations:[],setup_count:0,setup_minutes:0,
    duration_minutes:1,batch_count:1,operator_wait_minutes:0,machine_idle_minutes:0,
    order_sequence:["OA1"],resume_state:{completed_runs:1}}});`;

function replaceFixture(source, before, after, label) {
  if (typeof source !== 'string') throw Error('INTEGRATED_SETUP_BUILD_FIXTURE_SOURCE_' + label);
  if (source.includes(marker)) {
    if (source.split(marker).length !== 2 || source.split(after).length !== 2 || source.includes(before))
      throw Error('INTEGRATED_SETUP_BUILD_FIXTURE_INSTALL_DRIFT_' + label);
    const original = source.replace(after, before);
    if (original.includes(marker) || replaceFixture(original, before, after, label) !== source)
      throw Error('INTEGRATED_SETUP_BUILD_FIXTURE_REVERSE_' + label);
    return source;
  }
  if (source.split(before).length !== 2 || source.includes(after))
    throw Error('INTEGRATED_SETUP_BUILD_FIXTURE_SOURCE_DRIFT_' + label);
  const updated = source.replace(before, after);
  if (updated.replace(after, before) !== source)
    throw Error('INTEGRATED_SETUP_BUILD_FIXTURE_UNRELATED_CHANGE_' + label);
  return updated;
}

export function patchUpstreamBuildFixture(source) {
  return replaceFixture(source, upstreamBefore, upstreamAfter, 'upstream');
}

export function patchStateBuildFixture(source) {
  return replaceFixture(source, stateBefore, stateAfter, 'state');
}

export function patchBuildFixtures(files) {
  return {
    [BUILD_FIXTURE_FILES[0]]: patchUpstreamBuildFixture(files[BUILD_FIXTURE_FILES[0]]),
    [BUILD_FIXTURE_FILES[1]]: patchStateBuildFixture(files[BUILD_FIXTURE_FILES[1]])
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw Error('usage: build-fixtures.mjs APP_ROOT');
  const root = resolve(process.argv[2]);
  const before = Object.fromEntries(BUILD_FIXTURE_FILES.map(name => [name, readFileSync(resolve(root, name), 'utf8')]));
  // Reject either fixture drift before touching either staged test file.
  const after = patchBuildFixtures(before);
  for (const name of BUILD_FIXTURE_FILES) {
    if (before[name] !== after[name]) writeFileSync(resolve(root, name), after[name]);
    console.log('INTEGRATED_SETUP_BUILD_FIXTURE_PATCH', name, createHash('sha256').update(after[name]).digest('hex'));
  }
}
