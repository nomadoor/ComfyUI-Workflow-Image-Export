# ComfyUI Workflow Image Export

Export clean workflow images from **ComfyUI Classic (LiteGraph)** with optional embedded JSON metadata.

https://github.com/user-attachments/assets/f705aae4-d082-4d68-a1be-57c0d3076327

## Features
- Export workflow as PNG or WebP image
- Customizable background and padding
- Embed workflow JSON metadata (PNG only)
- Selection-based cropping with opacity control

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
- **Format**: PNG / WebP  
  - Workflow embedding is **PNG only**.
- **Embed workflow**: include workflow JSON in PNG.
- **Background**: UI / Transparent / Solid.
- **Padding**: margin around the captured bounds (slider).
- **Scope** (when nodes are selected):
  - **Scope** toggle: crop to selection.
  - **Opacity**: dim unselected nodes (0–100).
- **Advanced**:
  - Output resolution, max long edge, exceed behavior.

## Notes
- Classic only. Node 2.0 / new frontend is not supported. I tried, I failed. Sorry.
- Preview is a faster render path and may skip heavy things (like video thumbnails).

## Acknowledgments
- References [ComfyUI-Custom-Scripts](https://github.com/pythongosssss/ComfyUI-Custom-Scripts) by **pythongosssss**.

## License
MIT
