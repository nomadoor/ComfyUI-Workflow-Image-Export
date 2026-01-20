# ComfyUI Workflow Image Export

A ComfyUI extension to export high-quality images of your workflows with embedded JSON data.

## Features
- **Full Workflow Capture**: Automatically calculates bounds to capture all nodes and groups in a single image.
- **Workflow Embedding**: Embeds the workflow JSON data directly into the exported image (supported for PNG).
- **Customizable Appearance**: Adjust background styles, padding, and more to create clean documentation or sharing-ready images.

## Usage
1. Right-click on the ComfyUI canvas.
2. Select **Export Workflow Image...** from the context menu.
3. Adjust the export settings in the dialog.
4. Click **Export** to save your image.

## Settings
- **Format**: Choose between **PNG** or **WebP**.
- **Embed Workflow**: Toggle whether to include the workflow JSON data in the file.
- **Background**:
  - **UI**: Uses the current ComfyUI theme background.
  - **Transparent**: Exports with a transparent background.
  - **Solid**: Uses a custom solid color.
- **Padding**: Adjust the margin around the workflow nodes.

## Compatibility
> [!IMPORTANT]
> **Node 2.0 (New Frontend) is not supported yet.** 
> This extension currently works with the classic LiteGraph-based frontend.

## Acknowledgments
- Inspired by and references [ComfyUI-Custom-Scripts](https://github.com/pythongosssss/ComfyUI-Custom-Scripts) by **pythongosssss**. Special thanks for the great work!

## License
MIT
