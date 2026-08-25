import { shouldTile } from "../export/limits.mjs?v=20260825-2";
import { resolveOutputResolutionScale } from "../core/output_scale.mjs?v=20260825-2";

export { resolveOutputResolutionScale as getOutputResolutionScale };

export function evaluateWebpAvailability({
  format,
  bbox,
  scale = 1,
  shouldTileFn = shouldTile,
} = {}) {
  if (String(format || "png").toLowerCase() !== "webp") {
    return { blocked: false, checking: false, message: "" };
  }

  if (!bbox) {
    return { blocked: false, checking: false, message: "" };
  }

  const safeScale = Number.isFinite(Number(scale)) && Number(scale) > 0
    ? Number(scale)
    : 1;
  const width = Number(bbox.width) * safeScale;
  const height = Number(bbox.height) * safeScale;
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
