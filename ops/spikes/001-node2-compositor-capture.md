# Node 2.0 Compositor Capture Spike

Date: 2026-06-07

## Scope

This spike reviews whether ComfyUI Node 2.0 can be exported as a workflow image
from inside the normal browser extension, without trying to reproduce the
Classic LiteGraph offscreen renderer.

Historical note: this spike was not originally a user-facing implementation.
The initial spike goal was to prove or reject the browser-compositor capture
path before adding any Node 2.0 export UI. The current PR now includes the
Node 2.0 export UI path, so this note describes the starting intent rather than
the current implementation status.

## Current Findings

- `ops/adr/0011...` is not present in this repository. This review used the
  current README, existing ADRs, and the installed ComfyUI frontend package.
- Local ComfyUI checked during the spike: `0.24.0`.
- Local frontend package checked during the spike:
  `comfyui_frontend_package 1.45.15`.
- Node 2.0 renders as a browser composition of the main graph canvas, Vue node
  DOM inside `TransformPane`, and a separate link overlay canvas.
- In the installed frontend sourcemap, `GraphCanvas.vue` places:
  - `#graph-canvas`
  - `[data-testid="transform-pane"]`
  - `LinkOverlayCanvas`
  as sibling layers inside the graph view.
- `TransformPane.vue` mirrors LiteGraph camera state with CSS transforms:
  `scale3d(camera.z, camera.z, 1) translate3d(camera.x, camera.y, 0)`.
- The Classic offscreen-LiteGraph strategy is therefore not a faithful Node 2.0
  strategy. It can miss Vue DOM nodes, transformed node content, and overlay
  link state.

## Browser API Assessment

The most plausible browser-only WYSIWYG route is:

1. Ask the user to share the current tab with `getDisplayMedia()`.
2. Restrict the resulting tab-capture video track to the graph-view root with
   Element Capture (`RestrictionTarget` / `restrictTo`) when available.
3. Fall back to Region Capture (`CropTarget` / `cropTo`) for rectangular graph
   root cropping when Element Capture is unavailable.
4. Draw a stable video frame into a canvas, then encode the result.

This is a reasonable compromise, but it is not equivalent to Classic export:

- It requires user browser capture permission.
- It cannot force the user to choose the current tab; it can only hint and then
  detect likely self-capture.
- Region Capture crops by rectangle and can include occluding pixels.
- Captured video frames do not preserve alpha, so transparent background is not
  a first-pass Node 2.0 feature.
- Large graph export needs camera movement and stitched captures; this depends
  on frame-settling behavior and must be tested in the actual ComfyUI frontend.

Alternatives considered:

- Serializing Vue/DOM into SVG or foreignObject repeats the legacy fragility and
  may fetch or taint external media.
- Reusing minimap or thumbnails is not WYSIWYG enough for node screenshots.
- Directly mounting ComfyUI Vue components offscreen is too coupled to private
  frontend internals.
- Electron/CDP/Playwright screenshots could be more faithful, but that is no
  longer a normal custom-node browser extension and belongs in a separate tool.

## Implemented Probe

`web/js/main.js` exposes a lazy debug-only API:

```js
await window.__cwie__.node2Spike.inspect()
await window.__cwie__.node2Spike.captureFrame({ target: "commonRoot" })
await window.__cwie__.node2Spike.tileProbe({ tiles: 2 })
```

Targets accepted by `captureFrame()`:

- `commonRoot`: graph canvas, Vue transform pane, and link overlay together.
- `transformPane`: Vue node DOM only.
- `linkOverlayCanvas`: Node 2.0 link canvas only.
- `graphCanvas`: the base graph canvas only.

The probe is only loaded when those methods are called. Normal Classic menu and
dialog behavior remain on the existing legacy path.

## Recommendation

Proceed only if `captureFrame({ target: "commonRoot" })` proves that the current
browser can capture a readable graph-view frame including Vue nodes and links.

The local/user browser probe passed after the capture order was adjusted to
attach and start the hidden video before applying `restrictTo()`. On this
browser, `requestVideoFrameCallback()` stalled after restriction, but the video
already had current frame data, so the implementation falls back to
`requestAnimationFrame()` before drawing to canvas.

The first implementation step is a Node 2.0 backend behind feature detection
that initially supports:

- PNG/WebP of the visible graph viewport.
- Solid or UI background only.
- Workflow metadata embedding for PNG.
- Clear unsupported messaging for transparent background, exact Classic-style
  selection cropping, and huge tiled export until separately proven.

If common-root capture fails, do not spend more time on browser-only WYSIWYG
Node 2.0 export. The more honest route would be an external screenshot backend
or a future ComfyUI-provided renderer/export API.
