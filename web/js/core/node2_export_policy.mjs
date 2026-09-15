export function resolveNode2ExportPolicy() {
  return {
    exceedMode: "tile",
    node2TiledCapture: true,
  };
}

export function resolveNode2TileScale(value) {
  const requested = Number(value);
  return Number.isFinite(requested) && requested > 0
    ? Math.max(0.25, Math.min(2, requested))
    : 1;
}

export function formatNode2TilePixelLimitMessage({
  width,
  height,
} = {}) {
  return (
    `Node 2.0 tiled capture requires ${width}x${height} pixels, ` +
    "which exceeds the 64 MP safety limit. Reduce the workflow bounds."
  );
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
