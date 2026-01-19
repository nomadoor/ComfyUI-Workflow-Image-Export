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
