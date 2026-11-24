/** Compact selected-plan proposal. Scores, fingerprints and schedule rows stay out. */
export function ppSelectedBatchGenome(plan, project, ordered) {
  try {
    const model = project?.model;
    if (!plan || typeof plan !== 'object' || Array.isArray(plan) || plan.valid === false || plan.partial === true ||
        !model || !Array.isArray(model.orders) || model.orders.length < 1 || model.orders.length > 256 ||
        !Array.isArray(ordered) || ordered.length !== model.orders.length) return null;
    if (plan._revision != null && project.revision != null && Number(plan._revision) !== Number(project.revision)) return null;
    const identity = value => (typeof value === 'string' && value.length > 0 ||
      typeof value === 'number' && Number.isFinite(value)) ? String(value) : null;
    const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
    const unit = value => String(value || '').trim().toLowerCase().replace(/\s/g, '').replace(/\.$/, '');
    const discreteUnits = new Set(['шт', 'штука', 'штуки', 'штук', 'pc', 'pcs', 'piece', 'pieces', 'item', 'items', 'unit', 'units', 'count']);
    const specs = new Map();
    for (const order of model.orders) {
      if (!order || typeof order !== 'object') return null;
      const id = identity(order.id), quantity = order.quantity ?? order.area;
      if (id == null || specs.has(id) || !positive(quantity)) return null;
      const discrete = discreteUnits.has(unit(order.unit || order.quantity_unit || model.quantity_unit));
      if (discrete && !Number.isInteger(quantity)) return null;
      specs.set(id, {quantity, discrete});
    }
    const sequence = ordered.map(identity);
    if (sequence.some(id => id == null || !specs.has(id)) || new Set(sequence).size !== specs.size) return null;
    const partitions = [];
    if (plan.batch_genome != null) {
      const proposal = plan.batch_genome;
      if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal) ||
          Object.keys(proposal).sort().join(',') !== 'order_sequence,partitions,version' || proposal.version !== 1 ||
          !Array.isArray(proposal.order_sequence) || proposal.order_sequence.length !== sequence.length ||
          proposal.order_sequence.some((id, index) => identity(id) !== sequence[index]) ||
          !Array.isArray(proposal.partitions) || proposal.partitions.length !== sequence.length) return null;
      for (let index = 0; index < sequence.length; index++) {
        const row = proposal.partitions[index];
        if (!row || typeof row !== 'object' || Array.isArray(row) ||
            Object.keys(row).sort().join(',') !== 'order_id,sizes' || identity(row.order_id) !== sequence[index] ||
            !Array.isArray(row.sizes)) return null;
        partitions.push({order_id: sequence[index], sizes: row.sizes.slice()});
      }
    } else {
      if (!Array.isArray(plan.batches) || plan.batches.length < 1 || plan.batches.length > 1024) return null;
      const byOrder = new Map(sequence.map(id => [id, new Map()]));
      for (const batch of plan.batches) {
        if (!batch || typeof batch !== 'object' || Array.isArray(batch)) return null;
        const id = identity(batch.order), index = batch.batch;
        const quantity = batch.quantity ?? batch.batch_quantity ?? batch.area;
        if (id == null || !byOrder.has(id) || !Number.isInteger(index) || index < 1 || index > 128 ||
            !positive(quantity) || byOrder.get(id).has(index)) return null;
        byOrder.get(id).set(index, quantity);
      }
      for (const id of sequence) {
        const rows = [...byOrder.get(id)].sort((left, right) => left[0] - right[0]);
        if (!rows.length || rows.some(([index], offset) => index !== offset + 1)) return null;
        partitions.push({order_id: id, sizes: rows.map(([, quantity]) => quantity)});
      }
    }
    let totalParts = 0;
    for (const row of partitions) {
      const spec = specs.get(row.order_id), sizes = row.sizes;
      if (sizes.length < 1 || sizes.length > 128 || !sizes.every(positive) ||
          spec.discrete && !sizes.every(Number.isInteger)) return null;
      totalParts += sizes.length;
      const quantity = sizes.reduce((sum, value) => sum + value, 0);
      if (!Number.isFinite(quantity) || Math.abs(quantity - spec.quantity) > 1e-7 * Math.max(1, spec.quantity)) return null;
    }
    if (totalParts > 1024) return null;
    const proposal = {version: 1, order_sequence: sequence, partitions};
    if (new TextEncoder().encode(JSON.stringify(proposal)).length > 64 * 1024) return null;
    return proposal;
  } catch {
    return null;
  }
}


export function patchSelectedGenomeUi(source) {
  const anchor = 'function orderHint(plan,project){';
  const helper = ppSelectedBatchGenome.toString() + '\n';
  const beforeHint = ' return {order_sequence:ordered};\n}\nfunction seed(){';
  const afterHint = ' const batch_genome=ppSelectedBatchGenome(plan,project,ordered);\n' +
    ' return batch_genome?{order_sequence:ordered,batch_genome}:{order_sequence:ordered};\n}\nfunction seed(){';
  const beforeExisting = '   hint={order_sequence:ordered};';
  const afterExisting = '   const batch_genome=ppSelectedBatchGenome(existing,ownProject,ordered);\n' +
    '   hint=batch_genome?{order_sequence:ordered,batch_genome}:{order_sequence:ordered};';
  const count = (text, token) => text.split(token).length - 1;
  const require = condition => {
    if (!condition) throw Error('SELECTED_GENOME_UI_SOURCE_DRIFT');
  };
  require(typeof source === 'string' && count(source, anchor) === 1 &&
    count(source, 'window.__PP_CONTINUATION_SEED_V2__={installed:true,lastSeedLength:0};') === 1);
  if (source.includes('ppSelectedBatchGenome')) {
    require(count(source, helper) === 1 && count(source, afterHint) === 1 && count(source, afterExisting) === 1 &&
      count(source, beforeHint) === 0 && count(source, beforeExisting) === 0 && count(source, 'ppSelectedBatchGenome') === 3);
    return source;
  }
  require(count(source, beforeHint) === 1 && count(source, beforeExisting) === 1);
  const output = source.replace(anchor, helper + anchor).replace(beforeHint, afterHint).replace(beforeExisting, afterExisting);
  require(output.replace(helper, '').replace(afterHint, beforeHint).replace(afterExisting, beforeExisting) === source);
  return output;
}
