## 0010: Modal Raster Export Saves Preview

### Status

Accepted

### Context

The export modal already renders a preview image that users can visually verify
before saving.

Historically, modal preview and modal raster export (`png` / `webp`) used
different rendering paths:

- preview:
  - `dialog.js -> captureLegacy(..., skipWidgetCapture: true)`
- export:
  - `dialog.js -> capture()`
  - normal size: `captureLegacy(...)`
  - huge / tile: `exportWorkflowPng(...) -> render_graph_offscreen.js`

That separation caused repeated divergence bugs:

- preview correct, export wrong
- preview safe, export triggers VHS/media side effects
- normal export acceptable, huge/tile export broken differently
- portable builds exposing tainted-canvas behavior not seen in development

In practice, users were already able to right-click and save the preview image,
and the preview itself proved to be the most trustworthy representation of what
the modal intended to export.

An additional observation changed the tradeoff:

- `previewMaxPixels` is present in preview state, but current `captureLegacy()`
  does not use it
- preview rendering therefore is not a deliberately low-resolution thumbnail
  path under the current implementation

This removes the main conceptual objection to saving the preview result
directly.

### Decision

Modal raster export (`png` / `webp`) saves the preview blob instead of running a
separate export renderer.

Implementation in `web/js/ui/dialog.js`:

1. Preview rendering stores:
   - `lastPreviewBlob`
   - `lastPreviewKey`

2. `lastPreviewKey` is derived from the preview-visible raster state:
   - `format`
   - `background`
   - `solidColor`
   - `padding`
   - `nodeOpacity`
   - `scopeSelected`
   - `scopeOpacity`
   - `selectedNodeIds`

3. On modal export:
   - if format is `png` or `webp`
   - and a matching preview blob exists
   - save that blob directly
   - otherwise force a preview refresh and save the resulting blob

4. PNG workflow embedding remains supported as a post-processing step:
   - preview rendering itself still uses `embedWorkflow: false`
   - when the user exports PNG with embedding enabled, the saved preview blob is
     passed through `embedWorkflowInPngBlob(...)`

5. Non-raster export paths remain separate by design.

### Rationale

- The modal already presents preview as the user-facing source of truth.
- Re-rendering for export created renderer divergence by design.
- Saving the preview blob makes raster modal export WYSIWYG in the literal
  sense: what the user sees is what gets saved.
- This removes an entire class of bugs instead of tuning them individually:
  - preview/export mismatch
  - modal-only VHS regressions
  - tile/offscreen-specific raster divergence from the modal preview

### Consequences

#### Positive

- Modal preview and modal raster export now share the same rendered image.
- Raster export no longer depends on a second renderer invocation from the modal
  path.
- Bugs caused specifically by “preview path vs export path” are eliminated for
  `png` / `webp`.
- Workflow embedding for PNG is preserved through a save-time post-process.

#### Neutral / Accepted

- Raster export quality is now exactly preview quality by design.
- The preview blob cache is state-sensitive rather than renderer-sensitive.
- `debug` is intentionally not part of the preview cache key because it does not
  change visual output and should not force rerendering.

#### Still Separate

- This ADR only changes modal raster export.
- It does not claim to simplify or remove all lower-level rendering code in one
  step.
- Programmatic capture APIs and non-raster paths may still use the existing
  capture pipeline.

### Rejected Alternative

#### Re-render on export even when preview is already correct

Rejected because it repeatedly recreated the same class of bugs:

- one renderer for preview
- another renderer for saving
- endless reconciliation work between the two

The observed behavior demonstrated that this architecture was producing more
complexity than value for modal raster export.

### Follow-up

1. Keep the lower-level raster/export code available until all callers are
   audited.
2. If future product requirements demand a true high-resolution export distinct
   from preview, expose it as a separate explicit mode instead of silently
   replacing modal preview output.
3. Treat “save preview” as the default modal contract going forward.
