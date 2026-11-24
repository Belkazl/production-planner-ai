/**
 * Select a small opaque state from the authenticated account's current job.
 * The caller obtains `current` through currentJob(principal), never from POST.
 * Python alone knows its normalized model/pin fingerprints and native schema.
 */
export function selectNativeResumeState(current, modelKey, objective) {
  if (!current || typeof modelKey !== "string" || !modelKey ||
      current.modelKey !== modelKey || !/^[0-9a-f]{32}$/.test(String(current.id || ""))) return null;
  const state = current.resume_state;
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
