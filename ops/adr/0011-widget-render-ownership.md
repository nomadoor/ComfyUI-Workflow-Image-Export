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
   index. Failed joins are skipped. Geometry matching is prohibited.

Textarea values are not serialized into `outerHTML`, so foreignObject capture
cannot reliably reproduce them. Canvas text drawing uses `widget.value`, with
the corresponding serialized `widgets_values` entry only when the widget value
is not a string.

### DOM Scanner Boundary

The residual text scanner is for node-external extension DOM only.

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
- Media remains on the existing media overlay paths; plan-owned element
  references are delegation hints only.
- Node 2.0 compositor capture is unchanged.

### Supersedes

This ADR supersedes [0007: DOM Widget Overlay Policy](./0007-dom-widget-overlay-policy.md).

