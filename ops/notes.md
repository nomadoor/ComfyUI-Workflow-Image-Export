# Workflow Image Export - Notes

## Milestone 1 (Day-0 "hello export")

### Manual test checklist
- Context menu item "Export Workflow Image..." appears on canvas right click
- Dialog opens and closes (Cancel / backdrop click)
- Export starts a download and the file is not empty

### Known limitations / assumptions
- Day-0 export always downloads a PNG placeholder regardless of the selected format.
- Context menu placement is best-effort (prepended in extension hook).
- If the official canvas menu hook is unavailable, a LiteGraph (legacy) menu hook is used as a fallback.

## Milestone 2 (UI + settings plumbing)

### Manual test checklist
- Basic section shows Format / Embed workflow / Background / Padding
- Solid color picker only shows when Background = Solid
- Advanced section is collapsed by default and can be expanded
- Output resolution / Max long edge / If exceeded appear in Advanced
- Defaults are taken from ComfyUI Settings
- Set as default is disabled until a change is made, then saves to Settings
- Settings has "Reset to defaults" to restore extension defaults

### Known limitations / assumptions
- Export output is still the Day-0 placeholder (format selection does not change the output yet).
