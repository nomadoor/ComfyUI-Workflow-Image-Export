## 0009: Raster Export Renderer Split Policy

### Status

Accepted

### Context

Raster export (`png` / `webp`) ended up with three competing requirements that
could not be satisfied by a single rendering path:

1. Modal preview had to be safe.
   - Opening the export modal could trigger unexpected VHS audio playback.
   - The preview path was traced to DOM widget `foreignObject` capture.
   - Preview was therefore moved onto `captureLegacy()` with
     `skipWidgetCapture: true`.

2. Final export had to match preview for normal-sized workflows.
   - `VHS Video Combine` node height, DOM-backed video previews, and scope
     rendering were easier to keep correct when export and preview used the
     same live-graph-based renderer.
   - Routing normal export through `captureLegacy()` removed a class of
     “preview is correct but export is structurally different” bugs.

3. Very large workflows still needed a huge/tiled path.
   - Giant single-canvas `captureLegacy()` exports produced layout drift:
     extra top padding, text scattering, and unstable results on huge graphs.
   - Those failures were not the same as the preview/export mismatch bugs.
   - Huge workflows therefore still needed the tiled offscreen renderer.

During debugging, several intermediate fixes were attempted and rejected:

- Forcing all export widget capture off (`skipWidgetCapture: true`) fixed
  taint/audio regressions but caused text/widget regressions:
  stretched text bands, duplicate text, and broken DOM-backed widgets.
- Reusing the offscreen renderer for all export sizes reintroduced
  `VHS Video Combine` node-height mismatch: preview media appeared to float
  below a too-short node background.
- Ad-hoc DOM rect based height patching alone was not enough for VHS, because
  the effective node height is partly driven by live widget state
  (`aspectRatio`, `computedHeight`, hidden parent state) and `computeSize()`.

The final state was reached only after separating the problem into:

- preview safety
- normal export visual parity
- huge export scalability

### Decision

We intentionally split raster rendering into three modes.

#### 1. Modal Preview

Preview rendering uses `captureLegacy()` directly from `dialog.js` and always
passes:

- `skipWidgetCapture: true`

Rationale:

- Preview must never trigger widget `foreignObject` media side effects again.
- Preview is allowed to be content-first rather than widget-capture-first.
- This preserves the decision already documented in
  [0008](./0008-preview-widget-capture-policy.md).

#### 2. Normal Raster Export

Normal-sized raster export (`png` / `webp`) uses `captureLegacy()`.

In `capture/index.js`:

- if `normalized.exceedMode !== "tile"`:
  - call `captureLegacy(...)`
  - pass `scopeSelected`, `scopeOpacity`, `selectedNodeIds`
  - pass `skipWidgetCapture: true`

Why:

- This path matches modal preview layout rules much more closely.
- It keeps `VHS Video Combine` and other DOM/video-backed nodes aligned with
  what the user saw in the modal.
- It avoids the old “preview OK, export wrong” class of bugs for ordinary
  graph sizes.

This is intentionally biased toward correctness/stability for normal exports,
not toward a single universal renderer.

#### 3. Huge / Tile Raster Export

Huge exports still use the tiled offscreen renderer:

- if `normalized.exceedMode === "tile"`:
  - call `exportWorkflowPng(...)`

Why:

- `captureLegacy()` on a huge single canvas produced spacing and text-layout
  failures that were not acceptable.
- The tiled/offscreen renderer scales better for very large workflows and keeps
  progress reporting semantics already expected by the huge-export path.

However, the tile/offscreen path is not left in its original form.
It includes two specific compensations:

1. **Media-only widget capture suppression**
   - Offscreen tile rendering uses `drawDomWidgetOverlays(..., skipWidgetCapture: "media-only")`
   - This suppresses the most dangerous widget/media capture cases without
     forcing all widgets through the degraded “skip everything” path.

2. **Live widget state sync before `computeSize()`**
   - During offscreen graph preparation, live widget state is copied into the
     export graph widgets:
     - `height`
     - `aspectRatio`
     - `computedHeight`
     - `parentEl.hidden`
   - After that, `node.computeSize()` / `node.setSize()` is re-run.

This is specifically required for VHS preview-backed nodes such as
`Video Combine`, where effective node height depends on live widget preview
state rather than only on static serialized node size.

Additionally, offscreen preparation may extend node heights from live DOM media
geometry when widget/media containers demonstrably exceed the export node box.
This is treated as a secondary correction, not the primary sizing rule.

### Rationale

This split is intentional because the failures came from different layers:

- Preview safety failures were caused by browser-side widget DOM capture.
- Normal export mismatch failures were caused by using a structurally different
  renderer than preview.
- Huge export failures were caused by using a renderer that does not scale well
  to enormous single canvases.

Trying to force all three concerns through one renderer repeatedly caused
regressions:

- fixing VHS audio re-broke video thumbnails
- fixing tainted canvas re-broke text rendering
- fixing huge workflows re-broke VHS node height
- fixing offscreen node height with geometry-only heuristics overshot for
  non-VHS cases

The accepted policy is therefore:

- one safe preview path
- one accurate normal-export path
- one scalable huge/tile path

rather than pretending a single rendering implementation is currently stable
enough for every case.

### Consequences

#### Positive

- Modal preview stays safe from the known widget-capture audio issue.
- Normal export is much closer to preview for DOM/video-backed nodes.
- Huge workflows keep a dedicated tile renderer instead of depending on a giant
  single-canvas legacy capture.
- VHS `Video Combine` in tile mode can recover correct node height through
  synced live widget state plus recomputed sizing.

#### Negative

- Raster export behavior is now mode-dependent by design.
- `capture/index.js` owns more branching logic than before.
- `render_graph_offscreen.js` now contains renderer-specific live-state sync
  logic for widget/media-heavy nodes.
- This is a pragmatic split, not a final architectural unification.

### Rejected Alternatives

#### A. Use `captureLegacy()` for everything

Rejected because:

- huge workflows produced top gaps, scattered text, and unstable giant-canvas
  results

#### B. Use tiled/offscreen export for everything

Rejected because:

- preview/export parity became worse on normal workflows
- `VHS Video Combine` and similar nodes regressed in node height/layout

#### C. Set `skipWidgetCapture: true` for all export rendering

Rejected because:

- it removed taint/audio problems
- but introduced stretched text bands, duplicated text, and generic widget
  rendering regressions

#### D. Fix offscreen VHS height using DOM geometry only

Rejected as a complete solution because:

- geometry alone did not reproduce the same height logic as live widget
  `computeSize()`
- the more correct source of truth was live widget state plus recomputation

### Implementation Notes

Current decision points live in:

- [`web/js/core/capture/index.js`](../../web/js/core/capture/index.js)
  - normal export vs tile export split
- [`web/js/ui/dialog.js`](../../web/js/ui/dialog.js)
  - preview uses `captureLegacy()` directly with widget capture disabled
- [`web/js/core/backends/legacy_capture.js`](../../web/js/core/backends/legacy_capture.js)
  - preview/legacy capture behavior
- [`web/js/export/render_graph_offscreen.js`](../../web/js/export/render_graph_offscreen.js)
  - tiled/offscreen preparation, live widget state sync, and tile-specific DOM
    overlay behavior

### Follow-up

If future work revisits renderer unification, the bar is:

1. no preview-triggered media side effects
2. no tainted-canvas regressions
3. preview/export parity for normal workflows
4. stable results for huge workflows
5. correct VHS/core video node sizing without ad-hoc visual patching

Until all five can be met simultaneously, this split renderer policy remains
the intended architecture.
