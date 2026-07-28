# ADR 0012: Node 2.0 Transparent Background Matte

## Status

Accepted

## Context

The Node 2.0 backend captures Chromium's compositor through
`getDisplayMedia()`. Captured video frames are opaque, even when the graph
surface being represented has transparent regions.

For a foreground color `F`, opacity `α`, and known background `B`, the captured
color is:

```text
C = αF + (1 - α)B
```

Two captures with different known backgrounds provide enough information to
recover both `F` and `α`, including antialiased edges and shadows.

## Decision

Node 2.0 transparent export uses a two-frame black/white matte in both the fit
and tiled capture paths:

1. Open one display-capture stream.
2. Freeze graph-owned video elements and hide capture chrome.
3. Keep one fitted camera position, or move to one tile camera position.
4. Apply white and record a disposable baseline frame signature.
5. Apply black and strictly wait for a changed frame (`A`).
6. Apply white and strictly wait for a frame different from `A` (`B`).
7. Crop both frames with the same fit geometry, or use the same tile geometry.
8. Recover alpha with `recoverTransparentCanvas(A, B, black, white)`.
9. Snap alpha values within 3/255 of fully opaque or transparent.

For tiled export, steps 3 through 9 run once per tile before that tile is
blitted into the output canvas. The camera does not move between a tile's black
and white frames. Existing tile scale, overlap, and output dimensions remain
unchanged.

Black and white maximize the luminance difference and reduce sensitivity to
chroma subsampling in the browser's video pipeline. The legacy renderer keeps
its existing magenta/green extraction colors and unchanged default recovery
behavior.

The background override saves page, graph-container, and LiteGraph background
state only once. Subsequent color changes do not replace the saved original,
and one restore returns all values to their pre-capture state.

## Failure Policy

Changed-frame polling is strict only for transparent matte capture. Ordinary
UI and solid tiled captures retain their existing timeout behavior.

If the second frame is stale, frame sizes differ, recovery fails, or the result
cannot be recovered, the already captured black frame is exported. In the tile
path this fallback is limited to the affected tile. The report contains:

```js
transparentRecovery: {
  attempted: true,
  ok: false,
  fallback: "black-frame",
  failedTiles: 1,
  totalTiles: 6,
}
```

The result receives `node2:transparent_recovery_failed`, which is logged and
shown in the export UI. `node2:transparent_background_unsupported` is reserved
for a transparent tiled request that reaches an implementation without matte
recovery.

## Scope

Transparent matte recovery applies to Node 2.0 fit and tiled capture. Selecting
Transparent does not change the saved or effective exceed-mode policy.

## Consequences

- One browser sharing prompt is used for both matte frames.
- Transparent exports take about twice as many compositor frames as ordinary
  captures. A tiled transparent export captures every tile twice.
- Dynamic video content is paused and restored around capture.
- The hidden stream video remains playing but is positioned outside the
  captured viewport.
- Recovery and background state logic remain dependency-free and unit-testable.
