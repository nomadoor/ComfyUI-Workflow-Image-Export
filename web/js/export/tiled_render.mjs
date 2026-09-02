import { toBlobAsync } from "../core/utils.mjs";
import { TILE_SIZE } from "./limits.mjs?v=20260825-2";
import { encodePngFromTiles } from "./tiled_png_encoder.mjs";
import {
  resolveTileGeometry,
  resolveTiledOutputSize,
} from "./tile_plan.mjs?v=20260903-16";

export function resolveTiledPngOutputSize(bboxOverride, renderScaleFactor = 1) {
  return resolveTiledOutputSize(bboxOverride, renderScaleFactor);
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
  const plan = resolveTileGeometry({
    tileOutputX: x,
    tileOutputY: y,
    tileOutputWidth: width,
    tileOutputHeight: height,
    outputWidth,
    outputHeight,
    renderScale: renderScaleFactor,
    bleedGraph: bleed,
  });
  return {
    tileRect: plan.tileGraphRect,
    crop: plan.cropOutputRect,
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
  const {
    scale: renderScale,
    width: outputWidth,
    height: outputHeight,
  } = resolveTiledPngOutputSize(bboxOverride, options.renderScaleFactor);
  const tiledCanvas = document.createElement("canvas");
  tiledCanvas.width = outputWidth;
  tiledCanvas.height = outputHeight;
  const tiledCtx = tiledCanvas.getContext("2d", { alpha: true });
  if (!tiledCtx) {
    return renderOnce(workflowJson, { ...options, bboxOverride });
  }

  if (options.backgroundMode === "solid" && options.backgroundColor) {
    tiledCtx.fillStyle = options.backgroundColor;
    tiledCtx.fillRect(0, 0, outputWidth, outputHeight);
  }

  const tilesX = Math.ceil(outputWidth / TILE_SIZE);
  const tilesY = Math.ceil(outputHeight / TILE_SIZE);
  const totalTiles = Math.max(1, tilesX * tilesY);
  const bleed = Number.isFinite(Number(options.tileBleed)) ? Math.max(0, Number(options.tileBleed)) : 64;

  perfLog?.("tile.render.start", {
    width: outputWidth,
    height: outputHeight,
    renderScale,
    tilesX,
    tilesY,
    totalTiles,
    bleed,
  });

  let completedTiles = 0;
  for (let y = 0; y < outputHeight; y += TILE_SIZE) {
    for (let x = 0; x < outputWidth; x += TILE_SIZE) {
      const w = Math.min(TILE_SIZE, outputWidth - x);
      const h = Math.min(TILE_SIZE, outputHeight - y);
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

      tiledCtx.drawImage(
        expandedCanvas,
        geometry.crop.x,
        geometry.crop.y,
        geometry.crop.width,
        geometry.crop.height,
        x,
        y,
        w,
        h
      );

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
