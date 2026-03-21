## 0008: Preview Widget Capture Policy

### Status

Accepted

### Context

Opening the export modal could trigger audible VHS playback even without user
hover.

The issue was isolated to the preview path, not the final export path.
Stepwise preview-only disablement showed:

1. Disabling modal-open WebP size checks did not stop the audio.
2. Disabling the initial preview render did stop the audio.
3. Inside preview rendering, disabling `drawOffscreen()` did not stop the
   audio.
4. Disabling video overlays (`drawVideoOverlays()` and
   `drawVhsVideoOverlays()`) did not stop the audio.
5. Disabling `drawDomWidgetOverlays()` did stop the audio.
6. Re-enabling `drawDomWidgetOverlays()` while disabling only
   `captureElementAsCanvas()` also stopped the audio.

This isolates the modal audio side effect to browser `foreignObject` DOM widget
capture during preview rendering.

### Decision

We disable DOM widget foreignObject capture for preview rendering only.

- Preview rendering in `dialog.js` uses `captureLegacy()` directly instead of
  the higher-level `capture()` pipeline.
- The preview call passes `skipWidgetCapture: true`.
- `drawDomWidgetOverlays()` still runs in preview mode, but it must avoid
  `captureElementAsCanvas()` and fall back to safer text/content-first paths.

### Rationale

- The bug is triggered by preview rendering, not by final export in general.
- The minimal reliable fix is to remove the specific preview-only code path
  that causes the side effect.
- Preview correctness is less important than preview safety; a degraded preview
  is acceptable if it avoids unexpected media playback.
- Calling `captureLegacy()` directly from `dialog.js` is intentional here:
  preview now needs a stable, explicitly constrained rendering path that can
  opt out of widget capture without changing final export behavior.

### Consequences

- Export modal preview avoids the `foreignObject` widget capture path.
- Preview may show content-first fallbacks instead of full DOM-captured widget
  appearance.
- `dialog.js` now depends directly on the `captureLegacy()` interface.
  This is an accepted coupling and should be revisited if the capture API is
  refactored.
- Final export behavior remains unchanged by this ADR.

### Follow-up

- If final export shows the same audio side effect, evaluate whether
  `skipWidgetCapture` should become a broader policy or a more explicit capture
  mode.
- If the capture API is unified later, preserve the distinction between
  preview-safe rendering and full export rendering.
