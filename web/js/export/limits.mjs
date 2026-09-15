export const TILE_THRESHOLD_EDGE = 6144;
export const TILE_THRESHOLD_PIXELS = 24 * 1024 * 1024;
export const TILE_SIZE = 2048;
export const MAX_CANVAS_EDGE = 16384;
export const PREVIEW_MAX_PIXELS = 1024 * 1024;

export function normalizeCanvasDimension(value) {
  const num = Math.ceil(Number(value));
  return Number.isFinite(num) ? Math.max(1, num) : 1;
}

export function shouldTile(width, height) {
  const w = normalizeCanvasDimension(width);
  const h = normalizeCanvasDimension(height);
  if (Math.max(w, h) > MAX_CANVAS_EDGE) return true;
  return w * h > TILE_THRESHOLD_PIXELS || Math.max(w, h) > TILE_THRESHOLD_EDGE;
}

/**
 * Choose the Classic raster renderer from the final output size only.
 * `exceedMode` controls scale: `downscale` fits the configured edge, while
 * `tile` keeps the requested resolution. The tiled offscreen renderer is used
 * only when one safe canvas cannot hold the output.
 */
export function resolveClassicRasterRoute({
  width,
  height,
  maxLongEdge = 0,
  exceedMode = "downscale",
} = {}) {
  const outputWidth = normalizeCanvasDimension(width);
  const outputHeight = normalizeCanvasDimension(height);
  if (exceedMode === "tile") {
    return {
      renderer: shouldTile(outputWidth, outputHeight) ? "tiled-offscreen" : "live",
      renderScale: 1,
      legacyMaxLongEdge: 0,
    };
  }
  if (exceedMode !== "downscale") {
    return { renderer: "live", renderScale: 1, legacyMaxLongEdge: maxLongEdge };
  }
  const limit = Number(maxLongEdge);
  const longEdge = Math.max(outputWidth, outputHeight);
  const downscale = Number.isFinite(limit) && limit > 0 && longEdge > limit
    ? limit / longEdge
    : 1;
  return {
    renderer: shouldTile(outputWidth * downscale, outputHeight * downscale)
      ? "tiled-offscreen"
      : "live",
    renderScale: downscale,
    legacyMaxLongEdge: maxLongEdge,
  };
}
