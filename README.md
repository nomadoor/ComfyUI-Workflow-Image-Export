# ComfyUI Workflow Image Export

Export clean workflow images from **ComfyUI Classic (LiteGraph)** and the **ComfyUI Node 2.0 frontend** with optional embedded JSON metadata.

https://github.com/user-attachments/assets/f705aae4-d082-4d68-a1be-57c0d3076327

> [!IMPORTANT]
> Node 2.0 export is not a full replacement for the Classic/LiteGraph renderer.
> It uses Chromium browser compositor capture, so it currently requires a Chromium-based browser and cannot support every Classic option.

## Features
- Export workflow as PNG or WebP image
- Customizable background and padding
- Embed workflow JSON metadata (PNG only)
- Selection-based cropping with opacity control
- Node 2.0 compositor capture support for current Chromium-based browsers

## Installation

Install via **ComfyUI Manager**:

1. Open ComfyUI Manager
2. Search for "Workflow Image Export"
3. Click Install
4. Restart ComfyUI

## Usage
1. Right-click the ComfyUI canvas.
2. Choose **Export Workflow Image...**.
3. Adjust options.
4. Click **Export**.

## Options (Dialog)

> [!NOTE]
> Node 2.0 mode disables or simplifies options that cannot be reproduced by browser compositor capture.
> Transparent background, padding, selection scope, and node opacity are not available in Node 2.0 mode.

- **Format**: PNG / WebP  
  - Workflow embedding is **PNG only**.
- **Embed workflow**: include workflow JSON in PNG.
- **Background**:
  - Classic: UI / Transparent / Solid.
  - Node 2.0: UI / Solid.
- **Padding**: margin around the captured bounds (slider).
- **Scope** (when nodes are selected):
  - **Scope** toggle: crop to selection.
  - **Opacity**: dim unselected nodes (0–100).
- **Advanced**:
  - Output resolution, max long edge, exceed behavior.

## Notes
- Classic export uses the legacy LiteGraph renderer.
- Node 2.0 export uses Chromium browser compositor capture. The browser will ask you to share the current tab/window when exporting.
- Node 2.0 cannot preserve transparent pixels, so transparent background is Classic-only.
- Some Classic-only controls are disabled in Node 2.0 mode because browser compositor capture cannot faithfully reproduce them.
- Preview is a faster render path and may skip heavy things (like video thumbnails).
- DOM-backed widgets are handled best-effort.
- VHS previews and multiline widgets are supported in export.
- Markdown export is content-first, not full WYSIWYG. Export prefers rendered text with a stable background over raw markdown or broken overlay capture.

## Acknowledgments
- References [ComfyUI-Custom-Scripts](https://github.com/pythongosssss/ComfyUI-Custom-Scripts) by **pythongosssss**.

## License
MIT
