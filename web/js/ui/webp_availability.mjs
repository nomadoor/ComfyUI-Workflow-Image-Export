import { shouldTile } from "../export/limits.mjs?v=20260915-3";

export function evaluateWebpAvailability({
  format,
  bbox,
  shouldTileFn = shouldTile,
} = {}) {
  if (String(format || "png").toLowerCase() !== "webp") {
    return { blocked: false, checking: false, message: "" };
  }

  if (!bbox) {
    return { blocked: false, checking: false, message: "" };
  }

  const width = Number(bbox.width);
  const height = Number(bbox.height);
  const blocked = shouldTileFn(width, height);

  return {
    blocked,
    checking: false,
    message: blocked
      ? `WebP is unavailable for huge exports (${Math.round(width)}x${Math.round(height)}). Use PNG or reduce size.`
      : "",
    width,
    height,
  };
}
