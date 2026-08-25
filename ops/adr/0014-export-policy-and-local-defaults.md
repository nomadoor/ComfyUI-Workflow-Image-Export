# ADR 0014: Export Policy and Local Defaults

## Status

Accepted

## Context

Issue #29 reported that the default tiled PNG path could taint its canvas while
the downscale path succeeded. Later fixes added origin-clean media drawing, but
three obsolete design choices remained:

- modal PNG/WebP export saved its preview snapshot, so final output resolution,
  maximum-edge, and exceed-mode settings were ignored;
- `exceedMode: tile` selected the offscreen exporter unconditionally instead of
  only after the configured output edge was exceeded;
- extension defaults were split between fixed JavaScript defaults and a
  partially registered ComfyUI Settings integration.

Node 2.0 also inherited a saved Legacy downscale policy even though its current
full-resolution architecture is tiled, and its displayed `200%` option used a
hard-coded 1.25× camera scale without a documented rationale.

## Decision

1. Preview remains a fast, safe `captureLegacy()` render used only for display.
   Final PNG/WebP export always runs the normal `capture()` pipeline.
2. Classic uses the tiled exporter only when the scaled bounds exceed the
   configured maximum edge or a hard canvas safety threshold. Otherwise it uses
   the normal Legacy capture. Forced tile rendering is passed explicitly to the
   offscreen exporter once that decision is made. Tiled PNG encoder dimensions,
   bleed, crop coordinates, and graph tile rectangles all account for the
   selected output scale.
3. Every media source in fallback overlays passes through an origin-clean
   scratch canvas before it can reach the export canvas. Unsafe media degrades
   to a placeholder instead of tainting the complete export. Planned media
   widgets are suppressed during native base drawing and delegated to that safe
   overlay path.
   Live runtime media objects are not copied into the cloned offscreen graph;
   fallback overlays resolve them from the live graph only after base drawing.
4. Node 2.0 always resolves to `exceedMode: tile` and the disabled dialog control
   displays `Tile`, regardless of Last used values saved by Legacy.
5. Node 2.0 `200%` means a true 2× graph/camera scale. A result above the 64 MP
   safety limit fails explicitly instead of silently falling back to a lower
   resolution fit capture.
6. The extension does not register, read, or write its own ComfyUI Settings.
   Dialog state is fixed `DEFAULTS` overlaid by Last used values. Reset restores
   fixed `DEFAULTS`. Access to ComfyUI's own `Comfy.Graph.CanvasInfo` setting is
   retained only to hide and restore that overlay during Node 2.0 capture.

## Consequences

- Final export options now describe the file that is actually downloaded.
- Small Classic workflows avoid the tiled/offscreen path even when Tile is the
  selected exceed policy.
- Node 2.0 cannot silently reuse a Legacy downscale preference.
- A forced Node 2.0 Tile policy is not written back over the shared Legacy Last
  used exceed preference.
- Existing obsolete `WorkflowImageExport.*` values may remain in ComfyUI's
  storage, but this extension no longer observes or mutates them.
- Preview and final export may differ in resolution because preview is no longer
  treated as the file to save.
- Large Node 2.0 200% captures can report the 64 MP limit instead of degrading
  resolution without notice.

## Relationship

Follow-up to GitHub issue #29. ADR 0001 is fully superseded. ADRs 0009 and 0010
remain as historical explanations of the renderer decisions they introduced.
