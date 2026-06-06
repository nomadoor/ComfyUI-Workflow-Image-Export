import { toBlobAsync } from "../core/utils.mjs";
import { TILE_SIZE } from "./limits.mjs";
import { encodePngFromTiles } from "./tiled_png_encoder.mjs";

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
  const baseWidth = Math.max(1, Math.ceil(bboxOverride.width));
  const baseHeight = Math.max(1, Math.ceil(bboxOverride.height));

  const tilesX = Math.ceil(baseWidth / TILE_SIZE);
  const tilesY = Math.ceil(baseHeight / TILE_SIZE);
  const bleed = Number.isFinite(Number(options.tileBleed)) ? Math.max(0, Number(options.tileBleed)) : 64;

  if (options.debug) {
    console.log(`[CWIE][Export] Tiled export: mode=png, tiles=${tilesX}x${tilesY}, size=${baseWidth}x${baseHeight}, ratio=${options.uiPxRatio}, bleed=${bleed}`);
  }

  return encodePngFromTiles(
    baseWidth,
    baseHeight,
    async (x, y, w, h) => {
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
      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = w;
      cropCanvas.height = h;
      const cropCtx = cropCanvas.getContext("2d", { alpha: true });
      if (cropCtx) {
        cropCtx.drawImage(expandedCanvas, sx, sy, w, h, 0, 0, w, h);
      }
      return cropCanvas;
    },
    onProgress,
    perfLog,
    compressionLevel
  );
}
