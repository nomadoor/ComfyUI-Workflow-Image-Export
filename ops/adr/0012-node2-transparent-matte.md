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
and tiled capture paths. The original plan covered fit capture only, but forcing
transparent exports through fit reduced large workflows to a single
screen-resolution frame. Tiled matte recovery was added so transparent, UI,
and solid backgrounds retain the same size policy and output resolution.

1. Open one display-capture stream.
2. Freeze graph-owned video elements and hide capture chrome.
3. For fit capture, keep one fitted camera position, record a disposable white
   baseline signature, then strictly capture black (`A`) and white (`B`).
4. For tiled capture, seed the stream signature once before the loop. At each
   tile, wait for the next display-media frame and capture it in the background
   color left by the previous tile, switch to the opposite color, and strictly
   capture the changed second frame.
5. Assign the two tile frames to `A` and `B` by their known colors, independent
   of chronological order. Leave the second color applied for the next tile.
6. Crop both fit frames with the same geometry, or blit each recovered tile
   with the existing tile geometry.
7. Recover alpha with `recoverTransparentCanvas(A, B, black, white)`.
8. Snap alpha values within 3/255 of fully opaque or transparent.

The alternating tile colors separate camera arrival from the background
change. The arrival frame becomes the new signature baseline; after it is
sampled, the only strictly awaited visual change is the background switch.
This prevents a delayed display-media stream from mistaking a late white
camera-arrival frame for black `A` and reversing the matte pair.

Camera arrival itself cannot require a changed visual signature. Two different
tiles can be visually identical or can collide in the downsampled signature,
as observed in a 5x4 tiled export where strict arrival polling timed out after
5 seconds. The tile camera is first settled in the DOM, then the next available
video frame is sampled even if its signature equals the previous tile. The
background switch remains strict because black and white must produce a visual
change. Existing tile scale, overlap, and output dimensions remain unchanged.

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
for a transparent request that reaches an implementation without matte
recovery. After all tiles are composed, the output canvas is checked once for
any transparent pixel. A fully opaque result marks recovery as failed and emits
the same warning, because a complete workflow export is expected to contain
transparent space between nodes.

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
- Graph-owned `<video>` elements are paused during capture. WebGL viewers such
  as Load3D and canvas widgets that continue drawing through
  `requestAnimationFrame` cannot be frozen generically; motion in those regions
  can corrupt recovered alpha.
- A failed tile is emitted with its captured black background while other tiles
  remain transparent, and the export reports a warning.
- Recovery and background state logic remain dependency-free and unit-testable.
