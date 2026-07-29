export function resolveNode2ExportPolicy(state = {}) {
  return {
    exceedMode: state.exceedMode,
    node2TiledCapture: state.exceedMode === "tile",
  };
}
