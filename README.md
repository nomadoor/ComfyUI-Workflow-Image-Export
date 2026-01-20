# ComfyUI Workflow Image Export

A simple ComfyUI extension to export images of your workflows with embedded JSON data.

## Features
- **Workflow Capture**: Automatically calculates bounds to capture all nodes and groups in one image.
- **Output Customization**: You can adjust the background, padding, and more to your liking.
- **Workflow Embedding**: Embeds the workflow JSON data into the image.

## Usage
1. Right-click on the ComfyUI canvas.
2. Select **Export Workflow Image...**.
3. Tweak the settings in the dialog.
4. Hit **Export**!

## Settings
- **Format**: **PNG** or **WebP**.
  - *Note: Workflow embedding is NOT supported for WebP.*
- **Embed Workflow**: Toggle whether to include the workflow JSON data in the file.
- **Background**:
  - **UI**: Uses the current ComfyUI theme background.
  - **Transparent**: Exports with a transparent background.
  - **Solid**: Uses a custom color.
- **Padding**: Margin around your workflow.

## Compatibility
> [!IMPORTANT]
> **Node 2.0 (New Frontend) is not supported.** 
> To be honest, I don't know how to implement this for the new frontend yet. Sorry! m(_ _)m

## Acknowledgments
- This project references [ComfyUI-Custom-Scripts](https://github.com/pythongosssss/ComfyUI-Custom-Scripts) by **pythongosssss**. Thanks for the great reference!

## License
MIT
