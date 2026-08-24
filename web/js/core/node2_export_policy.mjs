export function resolveNode2ExportPolicy() {
  return {
    exceedMode: "tile",
    node2TiledCapture: true,
  };
}

export function resolveNode2OutputScale(outputResolution) {
  return outputResolution === "200%" ? 2 : 1;
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
