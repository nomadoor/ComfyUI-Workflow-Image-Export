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

export function isHugeRasterExport({ width, height, scale = 1 } = {}) {
  const s = Number(scale);
  const safeScale = Number.isFinite(s) && s > 0 ? s : 1;
  return shouldTile(
    normalizeCanvasDimension(width) * safeScale,
    normalizeCanvasDimension(height) * safeScale
  );
}

export function resolveRasterExceedPlan({
  width,
  height,
  scale = 1,
  maxLongEdge = 0,
  exceedMode = "downscale",
} = {}) {
  const safeScale = Number.isFinite(Number(scale)) && Number(scale) > 0
    ? Number(scale)
    : 1;
  const outputWidth = normalizeCanvasDimension(width) * safeScale;
  const outputHeight = normalizeCanvasDimension(height) * safeScale;
  const limit = Number(maxLongEdge);
  if (exceedMode === "downscale") {
    const longEdge = Math.max(outputWidth, outputHeight);
    if (Number.isFinite(limit) && limit > 0 && longEdge > limit) {
      const downscale = limit / longEdge;
      return {
        useTiledExport: shouldTile(outputWidth * downscale, outputHeight * downscale),
        renderScale: safeScale * downscale,
      };
    }
    return {
      useTiledExport: shouldTile(outputWidth, outputHeight),
      renderScale: safeScale,
    };
  }
  if (exceedMode !== "tile") {
    return { useTiledExport: false, renderScale: safeScale };
  }
  return {
    useTiledExport:
      shouldTile(outputWidth, outputHeight) ||
      (Number.isFinite(limit) && limit > 0 &&
        Math.max(outputWidth, outputHeight) > limit),
    renderScale: safeScale,
  };
}

export function shouldUseTiledExceedMode(options = {}) {
  return resolveRasterExceedPlan(options).useTiledExport;
}
