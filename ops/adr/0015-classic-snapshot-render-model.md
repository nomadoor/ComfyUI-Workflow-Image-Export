# ADR 0015: Classic Snapshot Render Model

## Status

Accepted

## Context

ComfyUI frontend 1.53 moved Classic widget membership and values into
graph-scoped stores. Assigning a temporary filtered array to `node.widgets`
during export therefore stopped being a local canvas trick: the setter
reconciled the store and removed the live widgets. The export could erase
multiline values from the workflow and from the API prompt.

The tiled renderer had a second instability. It built an overlay plan from the
live graph, drew a configured clone, then read widget geometry from that clone
again. Frontend drawing may disable, replace, or lay out clone widgets. A valid
multiline or DOM entry could consequently disappear after the base pass.
Flexible DOM widgets also legitimately expose `computedHeight = 0`; treating
that value as a measured zero-sized box discarded visible previews.

These failures have the same architectural cause: transient frontend state was
being treated as export state.

## Decision

Classic export has an explicit snapshot render model.

1. `exportWorkflowPng()` captures one `ClassicRenderModel` from the live graph
   before bbox measurement, clone construction, scope passes, or tile drawing.
2. The model owns widget identity, text/value, node-relative widget geometry,
   computed style, and an origin-clean copy of each available media frame.
3. Every tile and scope pass receives the same model and media cache. It may
   project node-relative rectangles onto synchronized clone node positions, but
   it must not replace those rectangles or values with post-draw clone widget
   state.
4. The configured `LGraph` clone remains a rendering adapter for the
   LiteGraph-native base layer: nodes, links, groups, grid, and extension draw
   hooks. Clone widget layout and clone DOM lifecycle are not authoritative.
5. Native widget suppression changes an existing widget collection in place
   and restores the same object instances in `finally`. It never assigns
   `node.widgets`, because that property may be a store-backed reconciliation
   boundary.
6. A DOM-owned widget whose computed height is non-positive derives its visual
   height from the next visible widget or the remaining node body. The fallback
   applies only to widgets with an owned DOM element.
7. The small/live Classic renderer continues to draw the live graph, but its
   overlay plan is captured before suppression and its temporary mutations are
   guarded and restored. Export must leave widget membership, serialized
   workflow data, and API prompt data unchanged.

Node 2.0 keeps its browser-compositor architecture and is not part of this
decision.

## Consequences

- A frontend draw may mutate clone layout without deleting captured text,
  geometry, or media from later tiles.
- Video frames are consistent across all tiles because they are copied at
  export start rather than when the first intersecting tile happens to draw.
- Store-backed widget setters are no longer invoked for temporary suppression.
- Custom widget support remains best-effort: LiteGraph-native drawing stays in
  the base adapter, while DOM/media support requires an owned `widget.element`
  or an existing safe fallback.
- The current exporter may still construct a disposable clone per tile. Clone
  lifetime is now an implementation detail behind the render-model boundary;
  it can be optimized into a session later without changing the model contract.
- Browser regression checks must compare live widget values, serialized graph
  data, and `graphToPrompt()` before and after both live and tiled exports.

## Verification

The contract is covered by structural tests for store-backed widget
suppression, immutable text/geometry capture, post-draw projection, flexible
DOM height, and export-start media snapshots. Manual browser verification is
required against the bundled frontend for live workflow invariants and real
DOM/video pixels.

## Relationship

This supersedes the clone-widget authority described by older offscreen export
notes. ADR 0014 still governs renderer routing and output policy.
