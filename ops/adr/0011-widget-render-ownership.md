## 0011: Widget Render Ownership

### Status

Accepted

### Context

The legacy exporter previously had three independent widget-text drawing paths:

- whole DOM widget capture
- DOM text-element scanning
- graph/widget-value fallback drawing

Those paths tried to avoid duplicates after drawing decisions had already been
made. A `coveredNodeIds` set was populated only when a DOM element could be
mapped back to a node through a `data-node-id` ancestor or graph-rectangle hit
testing.

Current ComfyUI DOM widgets are not necessarily descendants of their graph
nodes, and Vue component widgets may not expose an authoritative DOM element on
the widget object. DOM-to-graph recovery is therefore incomplete by design.
When recovery failed, both the DOM scanner and fallback renderer drew the same
multiline value.

### Decision

Widget overlay ownership is decided before rendering.

1. Planning always iterates graph nodes and their widgets. DOM
   `querySelectorAll()` results never define the widget set.
2. Each entry is keyed by `nodeId:widgetIndex` and stored through a `Map`.
3. Rendering also keeps a `renderedKeys` set so malformed input cannot draw the
   same key twice.
4. Rendering method and style origin are separate axes:
   - `source`: `capture`, `text`, or `media`
   - `styleSource`: `dom` or `default`
5. Multiline values always use `source: text`. A DOM element may provide style,
   but it is never captured to obtain textarea content.
6. Markdown may use `source: capture`. Failed, blank, or explicitly disabled
   capture falls back within the same entry rather than creating another entry.
7. DOM-free offscreen and tiled rendering uses the same planner with
   `allowDom: false`; relevant entries become default-styled text.
8. A live plan is joined to an offscreen graph only by node ID and widget
   index. Failed joins are skipped and counted in debug output. Geometry
   matching is prohibited; geometry is read from the joined widget after its
   identity has been established.
9. During the base LiteGraph pass, an offscreen-canvas-local
   `drawNodeWidgets` wrapper removes plan-owned text/capture widgets from that
   synchronous call. It never mutates live widget objects across an animation
   frame or another await.
10. The planned rectangle is clipped to both the current tile and its owning
    node. Before text/capture rendering, the renderer paints an opaque widget
    background across that rectangle. This pixel ownership also erases output
    from node-level hooks such as `onDrawForeground`.

Textarea values are not serialized into `outerHTML`, so foreignObject capture
cannot reliably reproduce them. Canvas text drawing uses `widget.value`. An
array-form `widgets_values` fallback is accepted only when its cardinality
matches `node.widgets`; object-form values require a matching widget name.

Hidden, disabled, node-filtered, and collapsed widgets do not enter the plan.
The default widget margin is the frontend `BaseDOMWidgetImpl.DEFAULT_MARGIN`
value of 10.

Modal preview intentionally passes `skipWidgetCapture: true`, so Markdown is
rendered as deterministic default-styled text in that path. Final export may
retain `source: capture`; failure falls back inside the same entry.

`source: media` entries are always delegated to the existing media overlay
paths and never use foreignObject capture. Their native widget draw is
suppressed so an unverified media source cannot taint the base export canvas;
the delegated overlay performs the origin-clean check. The tiled renderer no
longer needs the legacy `"media-only"` capture-suppression sentinel described
in ADR 0009.

### DOM Scanner Boundary

The residual text scanner is for node-external extension DOM only and is
disabled by default. A caller must explicitly pass
`allowExternalDomText: true`; support for a specific extension should be exposed
through an explicit allowlist rather than broad scanning.

- Descendants of `.dom-widget` are always excluded.
- Descendants of `[data-node-id]` and `[data-nodeid]` are always excluded.

This is a structural boundary. It applies even when `widget.element` is null and
no node or widget identity can be recovered from the element. `ownedElement`
may be retained as a media delegation hint, but it is never a deduplication
authority.

If a specific extension later needs node-external DOM support, it should be
added through an explicit allowlist rather than weakening this boundary.

### Tile Semantics

The offscreen renderer rebuilds a plan for each tile and clips every entry to
that tile's graph rectangle. A widget spanning multiple tiles may be rendered
once in each intersecting tile because those draws target different output
regions. The one-widget/one-draw invariant applies within each tile.

### Prohibited Approaches

- DOM-to-node hit testing as a widget deduplication mechanism
- overlap thresholds or increasingly elaborate rectangle matching
- node-type or node-title special cases such as Note detection
- frontend class names such as `comfy-multiline-input` as ownership signals
- separate fallback passes that rediscover plausible widget text

### Consequences

- Failure to obtain DOM can reduce visual fidelity but cannot enable a second
  widget-text drawing path.
- Note, CLIPTextEncode, and third-party nodes follow the same property-based
  widget classification.
- Single-line widgets remain owned by LiteGraph canvas rendering.
- Media remains on the existing origin-clean media overlay paths; plan-owned
  element references are delegation hints, and native media widget drawing is
  suppressed while the base graph is drawn.
- Node-external extension text is omitted unless explicitly enabled.
- Node 2.0 compositor capture is unchanged.

### Supersedes

This ADR supersedes [0007: DOM Widget Overlay Policy](./0007-dom-widget-overlay-policy.md).
