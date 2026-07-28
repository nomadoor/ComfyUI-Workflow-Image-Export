export function resolveNode2ExportPolicy(state = {}) {
  const transparentFit = state.background === "transparent";
  return {
    transparentFit,
    exceedMode: transparentFit ? "downscale" : state.exceedMode,
    node2TiledCapture: transparentFit ? false : state.exceedMode === "tile",
  };
}
