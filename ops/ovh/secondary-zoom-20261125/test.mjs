import assert from "node:assert/strict";
import vm from "node:vm";
import {ppSecondaryGanttZoom, ppSecondaryGanttZoomHtml} from "./zoom.mjs";

// Synthetic DOM only. Existing native nodes and their listeners must survive
// moving between the toolbar and header; no production plan/source is embedded.
class Node {
  constructor(tag = "div", classes = "") {
    this.tagName = tag;
    this.classList = {contains: name => classes.split(" ").includes(name)};
    this.childNodes = [];
    this.parentNode = null;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = [];
    this.textContent = "";
  }
  get parentElement() { return this.parentNode; }
  get previousSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) - 1] ?? null; }
  get nextSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null; }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, anchor) {
    if (node === anchor) return node;
    if (node.parentNode) {
      const siblings = node.parentNode.childNodes;
      siblings.splice(siblings.indexOf(node), 1);
    }
    const index = anchor === null ? this.childNodes.length : this.childNodes.indexOf(anchor);
    assert(index >= 0, "insertion anchor belongs to its parent");
    this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    return node;
  }
  contains(node) { return this === node || this.childNodes.some(child => child.contains(node)); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  click() { for (const listener of this.listeners) listener({target: this}); }
}

function environment(initialMode = 0, {missing = null, native = true, unified = true} = {}) {
  const documentRoot = new Node("html");
  const head = documentRoot.appendChild(new Node("head"));
  const view = documentRoot.appendChild(new Node());
  view.id = "planView";
  view.dataset.ppUnifiedGantt = String(initialMode);
  const toolbar = view.appendChild(new Node("div", "toolbar"));
  const range = toolbar.appendChild(new Node("b"));
  range.textContent = "Planning date range";
  const group = toolbar.appendChild(new Node("div", "zoom"));
  const after = toolbar.appendChild(new Node("div"));
  const controls = ["zoomOut", "zoomLabel", "zoomIn"].map((id, index) => {
    const control = group.appendChild(new Node(index === 1 ? "span" : "button"));
    control.id = id;
    return control;
  });
  const card = view.appendChild(new Node("div", "card gantt-card"));
  const heading = card.appendChild(new Node("div", "gantt-head"));
  const title = heading.appendChild(new Node("b"));
  title.textContent = "Order Gantt";
  const otherHeaderControl = heading.appendChild(new Node("button"));
  const scroll = card.appendChild(new Node());
  scroll.scrollLeft = 417;
  view.querySelector = selector => selector === ".card.gantt-card .gantt-head" ? heading : null;
  const descendants = node => [node, ...node.childNodes.flatMap(descendants)];
  const document = {
    head,
    getElementById: id => id === missing ? null : descendants(documentRoot).find(node => node.id === id) ?? null,
    createElement: tag => new Node(tag),
    createComment: text => Object.assign(new Node("#comment"), {textContent: text})
  };
  const observers = [];
  const warnings = [];
  const window = {
    __PP_GANTT_TOOL_V2_INSTALLED__: native,
    __PP_UNIFIED_GANTT_V2__: {installed: unified, activeMode: initialMode}
  };
  const plan = {duration_minutes: 42, operations: [{quantity: 137}]};
  const model = {equipment: [{id: "original-machine"}]};
  const snapshot = JSON.stringify({plan, model});
  // Representative pre-existing native handlers, not installed by this addon.
  let scale = 1;
  const renderModes = [];
  for (const [index, step] of [[0, -.25], [1, 0], [2, .25]]) {
    controls[index].listeners.push(() => {
      scale = step === 0 ? 1 : Math.min(5, Math.max(.5, scale + step));
      controls[1].textContent = `${Math.round(scale * 100)}%`;
      renderModes.push(Number(view.dataset.ppUnifiedGantt));
    });
  }
  controls[1].textContent = "100%";
  const context = vm.createContext({
    window, document, model, plan,
    console: {warn: message => warnings.push(message)},
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(target, options) { this.target = target; this.options = options; }
    }
  });
  const install = () => vm.runInContext(`(${ppSecondaryGanttZoom.toString()})()`, context);
  const choose = mode => {
    view.dataset.ppUnifiedGantt = String(mode);
    window.__PP_UNIFIED_GANTT_V2__.activeMode = mode;
    for (const observer of observers) observer.callback();
  };
  return {install, choose, window, document, documentRoot, head, view, toolbar, range,
    group, after, controls, heading, title, otherHeaderControl, scroll, observers,
    warnings, renderModes, plan, model, snapshot, descendants};
}

const fixture = environment();
const api = fixture.install();
assert.equal(api.installed, true);
assert.equal(api.inHeader, false, "equipment controls stay in their original toolbar");
assert.equal(fixture.group.nextSibling, fixture.after);
assert.equal(fixture.observers.length, 1);
assert.equal(fixture.observers[0].target, fixture.view);
assert.equal(JSON.stringify(fixture.observers[0].options),
  JSON.stringify({attributes: true, attributeFilter: ["data-pp-unified-gantt"]}));
const nativeListeners = fixture.controls.map(control => control.listeners[0]);

for (const mode of [3, 1, 3]) {
  fixture.choose(mode);
  assert.equal(api.inHeader, true);
  assert.equal(fixture.heading.childNodes.at(-1), fixture.group);
  assert.equal(fixture.title.textContent, "Order Gantt", "heading text belongs to the renderer");
  assert.equal(fixture.heading.childNodes[1], fixture.otherHeaderControl, "other header controls survive");
  for (let i = 0; i < 20; i++) fixture.controls[2].click();
  assert.equal(fixture.controls[1].textContent, "500%", "native zoom-in handler remains attached");
  assert.equal(fixture.renderModes.at(-1), mode);
  for (let i = 0; i < 22; i++) fixture.controls[0].click();
  assert.equal(fixture.controls[1].textContent, "50%", "native lower bound remains attached");
  fixture.controls[1].click();
  assert.equal(fixture.controls[1].textContent, "100%", "native reset remains attached");
  assert.equal(fixture.scroll.scrollLeft, 417, "moving controls preserves timeline scroll");
  for (const [index, control] of fixture.controls.entries()) {
    assert.equal(control.listeners.length, 1, "no replacement click handlers");
    assert.equal(control.listeners[0], nativeListeners[index]);
    assert.equal(fixture.document.getElementById(control.id), control, "same native control node");
    assert.equal(fixture.descendants(fixture.documentRoot).filter(node => node.id === control.id).length, 1);
  }
}

fixture.controls[2].click();
fixture.choose(0);
assert.equal(api.inHeader, false);
assert.equal(fixture.group.parentNode, fixture.toolbar);
assert.equal(fixture.group.nextSibling, fixture.after, "original position restored");
assert.equal(fixture.controls[1].textContent, "125%", "scale is shared and retained across views");
for (const mode of [2, 4, 5]) {
  fixture.choose(3);
  fixture.choose(mode);
  assert.equal(api.inHeader, false, "no zoom group stranded in a non-Gantt tab");
  assert.equal(fixture.group.parentNode, fixture.toolbar);
}
assert.equal(fixture.install(), api, "installation is idempotent");
assert.equal(fixture.observers.length, 1);
assert.equal(fixture.head.childNodes.length, 1);
assert.equal(fixture.warnings.length, 0);
assert.equal(JSON.stringify({plan: fixture.plan, model: fixture.model}), fixture.snapshot,
  "zoom presentation cannot modify the model or plan");

for (const mode of [1, 3]) {
  const initial = environment(mode);
  assert.equal(initial.install().inHeader, true, "existing active secondary tab is handled immediately");
}
for (const options of [{missing: "zoomIn"}, {native: false}, {unified: false}]) {
  const incomplete = environment(3, options);
  assert.equal(incomplete.install(), null, "source/prerequisite drift fails closed");
  assert.equal(incomplete.group.parentNode, incomplete.toolbar);
  assert.equal(incomplete.head.childNodes.length, 0);
  assert.equal(incomplete.observers.length, 0);
}

const html = "<!doctype html><html><body><main>Existing page</main></body></html>";
const transformed = ppSecondaryGanttZoomHtml(html);
assert.equal(ppSecondaryGanttZoomHtml(transformed), transformed, "HTML transform is idempotent");
assert.equal(transformed.replace(/<script id="pp-secondary-gantt-zoom-v1">[\s\S]*?<\/script>/, ""), html);
assert.equal(ppSecondaryGanttZoomHtml(null), null);
const warn = console.warn;
try {
  console.warn = () => {};
  assert.equal(ppSecondaryGanttZoomHtml("<main>No body close</main>"), "<main>No body close</main>");
} finally { console.warn = warn; }

console.log("SECONDARY_GANTT_ZOOM_SAME_NATIVE_NODES_50_TO_500_PERCENT_PASS");
console.log("SECONDARY_GANTT_ZOOM_ORDER_EMPLOYEE_RESTORE_SCROLL_IDEMPOTENCE_PASS");
