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

Node 2.0 transparent export uses a two-frame black/white matte in the
single-frame fit path:

1. Open one display-capture stream and keep one fitted camera position.
2. Freeze graph-owned video elements and hide capture chrome.
3. Apply white and record a disposable baseline frame signature.
4. Apply black and strictly wait for a changed frame (`A`).
5. Apply white and strictly wait for a frame different from `A` (`B`).
6. Crop both frames with the same fit geometry.
7. Recover alpha with `recoverTransparentCanvas(A, B, black, white)`.
8. Snap alpha values within 3/255 of fully opaque or transparent.

Black and white maximize the luminance difference and reduce sensitivity to
chroma subsampling in the browser's video pipeline. The legacy renderer keeps
its existing magenta/green extraction colors and unchanged default recovery
behavior.

The background override saves page, graph-container, and LiteGraph background
state only once. Subsequent color changes do not replace the saved original,
and one restore returns all values to their pre-capture state.

## Failure Policy

Changed-frame polling is strict only for transparent matte capture. Existing
tiled polling retains its timeout behavior.

If the second frame is stale, frame sizes differ, recovery fails, or the result
is fully opaque, the already captured black frame is exported. The report
contains:

```js
transparentRecovery: {
  attempted: true,
  ok: false,
  fallback: "black-frame",
}
```

The result receives `node2:transparent_recovery_failed`, which is logged and
shown in the export UI. A transparent request that actually uses tiled capture
keeps `node2:transparent_background_unsupported`.

## Scope

Transparent matte recovery is limited to Node 2.0 single-frame fit capture.
Selecting Transparent in the dialog forces that export to the fit path without
changing the saved tile preference used by UI and solid backgrounds.

Tiled transparent capture is excluded because it would require two captures
for every tile and would amplify frame synchronization and seam risks.

## Consequences

- One browser sharing prompt is used for both matte frames.
- Transparent exports take longer than ordinary fit captures.
- Dynamic video content is paused and restored around capture.
- The hidden stream video remains playing but is positioned outside the
  captured viewport.
- Recovery and background state logic remain dependency-free and unit-testable.
