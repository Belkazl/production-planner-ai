import test from 'node:test';
import assert from 'node:assert/strict';
import {comparePlan} from './verify_app.mjs';
import {ppCanonicalNativeResult} from '../integrated-setup-result-20261125/canonical.mjs';

function fixture() {
  const production = [{order: 'SYNTHETIC_A', operation_id: 'WORK', batch: 1, batch_quantity: 1,
    start_min: 0, end_min: 10, equipment_ids: ['M'], employee_ids: [], materials: []},
  {order: 'SYNTHETIC_B', operation_id: 'WORK', batch: 1, batch_quantity: 1,
    start_min: 25, end_min: 35, equipment_ids: ['M'], employee_ids: [], materials: []}];
  const setup = {order: 'SYNTHETIC_B', operation_id: 'SETUP', start_min: 10, end_min: 25,
    equipment_ids: ['M'], employee_ids: [], materials: []};
  const native = {ok: true, valid: true, partial: false, operations: production,
    setup_operations: [setup], duration_minutes: 35, batch_count: 2,
    operator_wait_minutes: 25, machine_idle_minutes: 0, setup_count: 1, setup_minutes: 15,
    start: '2026-11-25T00:00:00', finish: '2026-11-25T00:35:00',
    order_sequence: ['SYNTHETIC_A', 'SYNTHETIC_B'], history_best: [50, 35],
    resume_state: {version: 2, objective: 'idle', best_duration_minutes: 35}};
  const canonical = ppCanonicalNativeResult(native, {orders: [{id: 'SYNTHETIC_A'}, {id: 'SYNTHETIC_B'}],
    setup_rules: [{id: 'rule'}]}, 'synthetic-model');
  assert.ok(canonical);
  const projected = structuredClone(canonical);
  for (const key of ['resume_state', 'history_best', 'setup_count', 'setup_minutes']) delete projected[key];
  return {native, canonical, projected};
}

test('Stop projection may omit native history and setup aliases while retaining canonical invariants', () => {
  const {native, canonical, projected} = fixture();
  assert.equal(comparePlan(native, canonical, {objective: 'idle'}).setup_count, 1);
  assert.equal(comparePlan(native, projected, {publicProjection: true, objective: 'idle'}).setup_count, 1);
  assert.throws(() => comparePlan(native, projected, {objective: 'idle'}), /native_metrics_changed/);
});

test('Stop projection still rejects changes to KPI, setup reservation, objective and canonical setup count', () => {
  const {native, projected} = fixture();
  for (const mutate of [value => value.duration_minutes--,
    value => value.setup_operation_count = 0, value => value.setup_duration_total_minutes = 0,
    value => value.operations.find(row => row.is_setup).start_min++,
    value => value._pp_native_schedule_v1.context.objective = 'duration']) {
    const changed = structuredClone(projected); mutate(changed);
    assert.throws(() => comparePlan(native, changed, {publicProjection: true, objective: 'idle'}));
  }
});

test('A present public history or resume state must still be the original native metadata', () => {
  const {native, projected} = fixture();
  const wrongHistory = {...projected, history_best: [15]};
  assert.throws(() => comparePlan(native, wrongHistory, {publicProjection: true}), /native_metrics_changed/);
  const wrongResume = {...projected, resume_state: {version: 2, objective: 'duration', best_duration_minutes: 35}};
  assert.throws(() => comparePlan(native, wrongResume, {publicProjection: true}), /native_resume_changed/);
});
