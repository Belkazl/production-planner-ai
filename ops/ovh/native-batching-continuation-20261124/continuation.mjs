/**
 * Normalize an explicitly selected partition as an unscored model-owned seed.
 * Only order IDs and quantities cross this boundary; Python revalidates the
 * complete native capacity, unit, pin, shift and material constraints.
 */
export function normalizeBatchGenome(value, model) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "order_sequence,partitions,version" || value.version !== 1) return null;
  const orders = model?.orders;
  if (!Array.isArray(orders) || orders.length < 1 || orders.length > 256) return null;
  const quantities = new Map();
  for (const order of orders) {
    if (!order || !["string", "number"].includes(typeof order.id)) return null;
    const id = String(order.id), raw = order.quantity ?? order.area;
    if (!id || id.length > 256 || quantities.has(id) ||
        !["number", "string"].includes(typeof raw) || (typeof raw === "string" && !raw.trim())) return null;
    const quantity = Number(raw);
    if (!Number.isFinite(quantity) || quantity <= 0) return null;
    quantities.set(id, quantity);
  }
  const sequence = value.order_sequence, rows = value.partitions;
  if (!Array.isArray(sequence) || sequence.length !== orders.length ||
      !sequence.every(id => typeof id === "string" && quantities.has(id)) ||
      new Set(sequence).size !== orders.length || !Array.isArray(rows) || rows.length !== orders.length) return null;
  let count = 0;
  const partitions = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], id = sequence[index];
    if (!row || typeof row !== "object" || Array.isArray(row) ||
        Object.keys(row).sort().join(",") !== "order_id,sizes" || row.order_id !== id ||
        !Array.isArray(row.sizes) || row.sizes.length < 1 || row.sizes.length > 128) return null;
    if ((count += row.sizes.length) > 1024 ||
        !row.sizes.every(size => typeof size === "number" && Number.isFinite(size) && size > 0)) return null;
    const quantity = quantities.get(id), total = row.sizes.reduce((sum, size) => sum + size, 0);
    if (!Number.isFinite(total) || Math.abs(total - quantity) > 1e-7 * Math.max(1, quantity)) return null;
    partitions.push({order_id: id, sizes: [...row.sizes]});
  }
  const genome = {version: 1, order_sequence: [...sequence], partitions};
  return new TextEncoder().encode(JSON.stringify(genome)).length <= 64 * 1024 ? genome : null;
}

/**
 * Select a small opaque state from the authenticated account's current job.
 * The caller obtains `current` through currentJob(principal), never from POST.
 * Python alone knows its normalized model/pin fingerprints and native schema.
 */
export function selectNativeResumeState(current, modelKey, objective) {
  if (!current || typeof modelKey !== "string" || !modelKey ||
      current.modelKey !== modelKey || !/^[0-9a-f]{32}$/.test(String(current.id || ""))) return null;
  // Stop persists its selected verified checkpoint in `best`; a terminal
  // result fills the top-level state only on successful completion. Read its
  // compact state directly without walking hundreds of operation rows.
  const best = current.best;
  const verifiedBest = best?._pp_verified_checkpoint_v1 === true && best.valid === true && best.partial !== true
    ? best.resume_state : null;
  const result = current.state === "completed" && current.result?.valid === true && current.result.partial !== true
    ? current.result.resume_state : null;
  const state = current.state === "completed"
    ? current.resume_state || result || verifiedBest
    : verifiedBest || current.resume_state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const ownValue = key => Object.getOwnPropertyDescriptor(state, key)?.value;
  const nativeModelHash = ownValue("model_hash"), nativePinHash = ownValue("pin_hash");
  if (typeof nativeModelHash !== "string" || !/^[0-9a-f]{64}$/.test(nativeModelHash) ||
      typeof nativePinHash !== "string" || !/^[0-9a-f]{64}$/.test(nativePinHash) ||
      typeof objective !== "string" || ownValue("objective") !== objective) return null;

  const maxBytes = 64 * 1024, maxNodes = 8192, maxDepth = 16;
  const forbidden = new Set([
    "operations", "generic_operations", "setup_operations", "plan", "result",
    "best_plan", "best_preview", "candidate_preview", "resume_plan", "model",
    "__proto__", "prototype", "constructor"
  ]);
  const seen = new WeakSet(), encoder = new TextEncoder();
  let nodes = 0, bytes = 0;
  const charge = value => {
    bytes += encoder.encode(JSON.stringify(value)).length + 1;
    if (bytes > maxBytes) throw Error("compact_state_too_large");
  };
  const visit = (value, depth) => {
    if (++nodes > maxNodes || depth > maxDepth) throw Error("compact_state_too_complex");
    if (value === null || typeof value === "boolean") { charge(value); return; }
    if (typeof value === "string") {
      if (value.length > maxBytes) throw Error("compact_state_too_large");
      charge(value); return;
    }
    if (typeof value === "number" && Number.isFinite(value)) { charge(value); return; }
    if (!value || typeof value !== "object" || seen.has(value)) throw Error("compact_state_not_json");
    if (Array.isArray(value) && value.length > maxNodes) throw Error("compact_state_too_complex");
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      throw Error("compact_state_not_plain_json");
    seen.add(value);
    bytes += 2;
    const keys = Object.keys(value);
    if (keys.length > maxNodes) throw Error("compact_state_too_complex");
    for (const key of keys) {
      if (key.length > maxBytes) throw Error("compact_state_too_large");
      if (forbidden.has(key)) throw Error("compact_state_contains_plan");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) throw Error("compact_state_not_json");
      if (!Array.isArray(value)) charge(key);
      visit(descriptor.value, depth + 1);
    }
    seen.delete(value);
  };
  try {
    visit(state, 0);
    const serialized = JSON.stringify(state);
    if (encoder.encode(serialized).length > maxBytes) return null;
    // Keep every native field and its ORIGINAL fingerprints. Do not replace
    // model_hash with the bridge hash or stamp current pins onto an old genome.
    return JSON.parse(serialized);
  } catch { return null; }
}
