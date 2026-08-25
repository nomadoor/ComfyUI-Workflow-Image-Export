import { resolveOutputResolutionScale } from "./output_scale.mjs?v=20260825-2";

export function resolveNode2ExportPolicy() {
  return {
    exceedMode: "tile",
    node2TiledCapture: true,
  };
}

export { resolveOutputResolutionScale as resolveNode2OutputScale };

export function formatNode2TilePixelLimitMessage({
  width,
  height,
  outputResolution,
} = {}) {
  const prefix =
    `Node 2.0 tiled capture requires ${width}x${height} pixels, ` +
    "which exceeds the 64 MP safety limit.";
  return outputResolution === "200%"
    ? `${prefix} Use 100% output resolution or reduce the workflow bounds.`
    : `${prefix} Reduce the workflow bounds.`;
}

export function resolveExportCaptureOptions(state = {}, {
  isNode2Backend = false,
  onProgress,
} = {}) {
  if (!isNode2Backend) {
    return { ...state, onProgress };
  }
  const node2Policy = resolveNode2ExportPolicy();
  return {
    ...state,
    padding: 0,
    nodeOpacity: 100,
    scopeSelected: false,
    exceedMode: node2Policy.exceedMode,
    node2TiledCapture: node2Policy.node2TiledCapture,
    onProgress,
  };
}
