/**
 * Expose the existing native Gantt zoom controls on the unified employee/order
 * views. The native closure retains its scale, handlers and 50–500% limits.
 * Install after ppUnifiedGanttV2; this addon never redraws or changes a plan.
 */
export function ppSecondaryGanttZoom() {
  "use strict";
  if (window.__PP_SECONDARY_GANTT_ZOOM_V1__?.installed) {
    return window.__PP_SECONDARY_GANTT_ZOOM_V1__;
  }

  const view = document.getElementById("planView");
  const heading = view?.querySelector(".card.gantt-card .gantt-head");
  const controls = ["zoomOut", "zoomLabel", "zoomIn"].map(id => document.getElementById(id));
  const group = controls[0]?.parentElement;
  if (!window.__PP_GANTT_TOOL_V2_INSTALLED__ ||
      !window.__PP_UNIFIED_GANTT_V2__?.installed || !heading ||
      !group?.classList.contains("zoom") || !view.contains(group) ||
      controls.some(control => !control || control.parentElement !== group)) {
    console.warn("PP_SECONDARY_GANTT_ZOOM_PREREQUISITES_MISSING");
    return null;
  }

  // Move the real nodes: the native capture handlers and the unified renderer's
  // resource projection during zoom depend on these same IDs and listeners.
  const home = document.createComment("pp-secondary-gantt-zoom-home");
  group.parentNode.insertBefore(home, group);
  const style = document.createElement("style");
  style.id = "pp-secondary-gantt-zoom-style-v1";
  style.textContent = `
#planView[data-pp-unified-gantt='1'] .card.gantt-card .gantt-head,
#planView[data-pp-unified-gantt='3'] .card.gantt-card .gantt-head {
  display: flex; align-items: center; gap: 12px;
}
#planView .card.gantt-card .gantt-head > .zoom[data-pp-secondary-gantt-zoom] {
  margin-left: auto; flex: 0 0 auto;
}`;
  document.head.appendChild(style);

  const mode = () => Number(view.dataset.ppUnifiedGantt ?? window.__PP_UNIFIED_GANTT_V2__.activeMode);
  function sync() {
    if ([1, 3].includes(mode())) {
      if (group.parentNode !== heading) heading.appendChild(group);
      group.setAttribute("data-pp-secondary-gantt-zoom", "");
    } else if (home.parentNode) {
      if (group.parentNode !== home.parentNode || group.previousSibling !== home) {
        home.parentNode.insertBefore(group, home.nextSibling);
      }
      group.removeAttribute("data-pp-secondary-gantt-zoom");
    }
  }

  // The unified renderer already writes this attribute after switching views.
  // Watching only that attribute avoids reacting to the native timeline redraw.
  const observer = new MutationObserver(sync);
  observer.observe(view, {attributes: true, attributeFilter: ["data-pp-unified-gantt"]});
  const api = Object.freeze({
    installed: true,
    engine: "PP_GANTT_TOOL_V2",
    sync,
    get activeMode() { return mode(); },
    get inHeader() { return group.parentNode === heading; }
  });
  window.__PP_SECONDARY_GANTT_ZOOM_V1__ = api;
  sync();
  return api;
}

/** Optional auth HTML transform; the installer can also be appended to the UI. */
export function ppSecondaryGanttZoomHtml(html) {
  if (typeof html !== "string") return html;
  if (/\bid\s*=\s*['"]pp-secondary-gantt-zoom-v1['"]/.test(html)) return html;
  const endings = [...html.matchAll(/<\/body\s*>/gi)];
  if (endings.length !== 1) {
    console.warn("PP_SECONDARY_GANTT_ZOOM_HTML_DRIFT");
    return html;
  }
  const script = `<script id="pp-secondary-gantt-zoom-v1">;(${ppSecondaryGanttZoom.toString()})();</script>`;
  const index = endings[0].index;
  return html.slice(0, index) + script + html.slice(index);
}
