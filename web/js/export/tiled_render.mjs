import { toBlobAsync } from "../core/utils.mjs";
import { TILE_SIZE } from "./limits.mjs";
import { encodePngFromTiles } from "./tiled_png_encoder.mjs";

function normalizeRenderScale(value) {
  const scale = Number(value);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export function resolveTiledPngOutputSize(bboxOverride, renderScaleFactor = 1) {
  const scale = normalizeRenderScale(renderScaleFactor);
  const baseWidth = Math.max(1, Math.ceil(Number(bboxOverride?.width) || 0));
  const baseHeight = Math.max(1, Math.ceil(Number(bboxOverride?.height) || 0));
  return {
    baseWidth,
    baseHeight,
    scale,
    width: Math.max(1, Math.ceil(baseWidth * scale)),
    height: Math.max(1, Math.ceil(baseHeight * scale)),
  };
}

export function resolveScaledTileGeometry({
  x,
  y,
  width,
  height,
  outputWidth,
  outputHeight,
  renderScaleFactor = 1,
  bleed = 64,
} = {}) {
  const scale = normalizeRenderScale(renderScaleFactor);
  const scaledBleed = Math.max(0, Number(bleed) || 0) * scale;
  const expandedX = Math.max(0, x - scaledBleed);
  const expandedY = Math.max(0, y - scaledBleed);
  const expandedWidth = Math.min(
    outputWidth - expandedX,
    width + (x - expandedX) + scaledBleed
  );
  const expandedHeight = Math.min(
    outputHeight - expandedY,
    height + (y - expandedY) + scaledBleed
  );
  return {
    tileRect: {
      x: expandedX / scale,
      y: expandedY / scale,
      width: expandedWidth / scale,
      height: expandedHeight / scale,
    },
    crop: {
      x: x - expandedX,
      y: y - expandedY,
      width,
      height,
    },
  };
}

export async function renderTiled({
  workflowJson,
  options,
  bboxOverride,
  onProgress,
  perfLog,
  renderOnce,
}) {
  const baseWidth = Math.max(1, Math.ceil(bboxOverride.width));
  const baseHeight = Math.max(1, Math.ceil(bboxOverride.height));
  const tiledCanvas = document.createElement("canvas");
  tiledCanvas.width = baseWidth;
  tiledCanvas.height = baseHeight;
  const tiledCtx = tiledCanvas.getContext("2d", { alpha: true });
  if (!tiledCtx) {
    return renderOnce(workflowJson, { ...options, bboxOverride });
  }

  if (options.backgroundMode === "solid" && options.backgroundColor) {
    tiledCtx.fillStyle = options.backgroundColor;
    tiledCtx.fillRect(0, 0, baseWidth, baseHeight);
  }

  const tilesX = Math.ceil(baseWidth / TILE_SIZE);
  const tilesY = Math.ceil(baseHeight / TILE_SIZE);
  const totalTiles = Math.max(1, tilesX * tilesY);
  const bleed = Number.isFinite(Number(options.tileBleed)) ? Math.max(0, Number(options.tileBleed)) : 64;

  perfLog?.("tile.render.start", { width: baseWidth, height: baseHeight, tilesX, tilesY, totalTiles, bleed });

  let completedTiles = 0;
  for (let y = 0; y < baseHeight; y += TILE_SIZE) {
    for (let x = 0; x < baseWidth; x += TILE_SIZE) {
      const w = Math.min(TILE_SIZE, baseWidth - x);
      const h = Math.min(TILE_SIZE, baseHeight - y);

      const ex = Math.max(0, x - bleed);
      const ey = Math.max(0, y - bleed);
      const ew = Math.min(baseWidth - ex, w + (x - ex) + bleed);
      const eh = Math.min(baseHeight - ey, h + (y - ey) + bleed);

      const expandedCanvas = await renderOnce(workflowJson, {
        ...options,
        bboxOverride,
        tileRect: { x: ex, y: ey, width: ew, height: eh },
        previewFast: false,
        maxPixels: 0,
      });

      const sx = x - ex;
      const sy = y - ey;
      tiledCtx.drawImage(expandedCanvas, sx, sy, w, h, x, y, w, h);

      completedTiles += 1;
      onProgress?.(completedTiles / totalTiles);
    }
  }
  perfLog?.("tile.render.done");
  return tiledCanvas;
}

export async function renderTiledPng({
  workflowJson,
  options,
  bboxOverride,
  onProgress,
  perfLog,
  compressionLevel,
  renderOnce,
}) {
  if (!bboxOverride) {
    const canvas = await renderOnce(workflowJson, options);
    return toBlobAsync(canvas, "image/png");
  }
  const {
    baseWidth,
    baseHeight,
    scale: renderScale,
    width: outputWidth,
    height: outputHeight,
  } = resolveTiledPngOutputSize(bboxOverride, options.renderScaleFactor);

  const tilesX = Math.ceil(outputWidth / TILE_SIZE);
  const tilesY = Math.ceil(outputHeight / TILE_SIZE);
  const bleed = Number.isFinite(Number(options.tileBleed)) ? Math.max(0, Number(options.tileBleed)) : 64;

  if (options.debug) {
    console.log(`[CWIE][Export] Tiled export: mode=png, tiles=${tilesX}x${tilesY}, size=${outputWidth}x${outputHeight}, scale=${renderScale}, ratio=${options.uiPxRatio}, bleed=${bleed}`);
  }

  return encodePngFromTiles(
    outputWidth,
    outputHeight,
    async (x, y, w, h) => {
      const geometry = resolveScaledTileGeometry({
        x,
        y,
        width: w,
        height: h,
        outputWidth,
        outputHeight,
        renderScaleFactor: renderScale,
        bleed,
      });

      const expandedCanvas = await renderOnce(workflowJson, {
        ...options,
        bboxOverride,
        tileRect: geometry.tileRect,
        previewFast: false,
        maxPixels: 0,
      });

      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = w;
      cropCanvas.height = h;
      const cropCtx = cropCanvas.getContext("2d", { alpha: true });
      if (cropCtx) {
        cropCtx.drawImage(
          expandedCanvas,
          geometry.crop.x,
          geometry.crop.y,
          geometry.crop.width,
          geometry.crop.height,
          0,
          0,
          w,
          h
        );
      }
      return cropCanvas;
    },
    onProgress,
    perfLog,
    compressionLevel
  );
}
