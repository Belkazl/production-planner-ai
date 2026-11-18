# LiftOrbit browser freeze investigation (2026-11-18)

Reproduction: browser becomes unresponsive while GA shows 0 percent with 14 machines and six ceramic orders.

Source audit: native paintProgress() redraws the entire Gantt on each two-second poll even if the candidate is unchanged. The automatic preview add-on has a MutationObserver on document.body with subtree=true; this fires for every Gantt node addition.

Proposed safety goals: scope the preview observer to its own toolbar, preserve intermediate previews every two seconds, deduplicate unchanged candidate redraws, and retain Stop/reconnect and saved plans.
