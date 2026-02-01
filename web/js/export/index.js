import { toBlobAsync, toUint32, concatUint8, crc32 } from "../core/utils.js";

import {
  resolveUiBackgroundColor,
  resolveSolidBackgroundColor,
  EXTRACT_BG_1,
  EXTRACT_BG_2,
} from "./background_modes.js";
import { computeOffscreenBBox, renderGraphOffscreen } from "./render_graph_offscreen.js";
import { embedWorkflowInPngBlob } from "./png_embed_workflow.js";

const TILE_THRESHOLD_EDGE = 6144;
const TILE_THRESHOLD_PIXELS = 24 * 1024 * 1024;
const TILE_SIZE = 2048;
const MAX_CANVAS_EDGE = 16384;
const ADLER_MOD = 65521;
const ADLER_NMAX = 5552;

function getNowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function createPerfLogger(enabled, prefix) {
  if (!enabled) return null;
  const t0 = getNowMs();
  return (label, payload) => {
    const dt = Math.round(getNowMs() - t0);
    if (payload !== undefined) {
      console.log(`${prefix} ${label} +${dt}ms`, payload);
      return;
    }
    console.log(`${prefix} ${label} +${dt}ms`);
  };
}

function timeSpan(log, label, fn) {
  if (!log) return fn();
  const t0 = getNowMs();
  const result = fn();
  return Promise.resolve(result).finally(() => {
    log(label, { ms: Math.round(getNowMs() - t0) });
  });
}

function clampPngCompression(value) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return 6;
  return Math.min(9, Math.max(0, num));
}

async function resolvePako() {
  if (window?.pako) return window.pako;
  try {
    const mod = await import("../vendor/pako.min.js");
    return mod?.default || mod?.pako || window?.pako || null;
  } catch (_) {
    return null;
  }
}

function toWorkflowJsonString(workflowJson) {
  if (typeof workflowJson === "string") {
    return workflowJson;
  }
  try {
    return JSON.stringify(workflowJson);
  } catch (_) {
    return null;
  }
}

function parseHexColor(color) {
  if (!color || typeof color !== "string") return null;
  const hex = color.trim().replace("#", "");
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    if (![r, g, b].every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) {
      return null;
    }
    return { r, g, b };
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if (![r, g, b].every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) {
      return null;
    }
    return { r, g, b };
  }
  return null;
}

function parseRgbColor(color) {
  if (!color || typeof color !== "string") return null;
  const match = color.match(/rgba?\(([^)]+)\)/i);
  if (!match) return null;
  const parts = match[1].split(",").map((v) => v.trim());
  if (parts.length < 3) return null;
  const r = Number.parseFloat(parts[0]);
  const g = Number.parseFloat(parts[1]);
  const b = Number.parseFloat(parts[2]);
  if (![r, g, b].every((v) => Number.isFinite(v))) return null;
  return { r, g, b };
}

function parseColorToRgb(color) {
  return parseHexColor(color) || parseRgbColor(color);
}

function isCanvasTransparent(canvas) {
  if (!canvas) return false;
  const sampleSize = 16;
  const sample = document.createElement("canvas");
  sample.width = sampleSize;
  sample.height = sampleSize;
  const sampleCtx = sample.getContext("2d", { alpha: true });
  if (!sampleCtx) return false;
  try {
    sampleCtx.clearRect(0, 0, sampleSize, sampleSize);
    sampleCtx.drawImage(canvas, 0, 0, sampleSize, sampleSize);
    const data = sampleCtx.getImageData(0, 0, sampleSize, sampleSize).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) {
        return true;
      }
    }
    return false;
  } catch (_) {
    return false;
  }
}

function scaleCanvas(baseCanvas, scale) {
  const s = Number(scale) || 1;
  if (!Number.isFinite(s) || s <= 0 || s === 1) {
    return baseCanvas;
  }
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(baseCanvas.width * s));
  out.height = Math.max(1, Math.round(baseCanvas.height * s));
  const ctx = out.getContext("2d", { alpha: true });
  if (!ctx) {
    return baseCanvas;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(baseCanvas, 0, 0, out.width, out.height);
  return out;
}

function normalizeSelectedIds(value) {
  if (!Array.isArray(value)) return [];
  return value.map((id) => Number(id)).filter(Number.isFinite);
}

function shouldTile(width, height) {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  if (Math.max(w, h) > MAX_CANVAS_EDGE) return true;
  return (
    w * h > TILE_THRESHOLD_PIXELS ||
    Math.max(w, h) > TILE_THRESHOLD_EDGE
  );
}

function createPngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const lengthBytes = toUint32(data.length);
  const crcBytes = toUint32(crc32(concatUint8(typeBytes, data)));
  return concatUint8(lengthBytes, typeBytes, data, crcBytes);
}

function adler32Update(state, data) {
  let a = state.a;
  let b = state.b;
  let index = 0;
  const len = data.length;
  while (index < len) {
    const end = Math.min(index + ADLER_NMAX, len);
    for (; index < end; index += 1) {
      a += data[index];
      b += a;
    }
    a %= ADLER_MOD;
    b %= ADLER_MOD;
  }
  state.a = a;
  state.b = b;
}

function createStoreDeflateStream() {
  if (typeof TransformStream === "undefined") {
    return null;
  }
  const MAX_BLOCK = 0xffff;
  const adler = { a: 1, b: 0 };
  let block = new Uint8Array(MAX_BLOCK);
  let blockLen = 0;

  const flushBlock = (controller, isFinal) => {
    const len = blockLen;
    const header = new Uint8Array(5 + len);
    header[0] = isFinal ? 0x01 : 0x00;
    header[1] = len & 0xff;
    header[2] = (len >>> 8) & 0xff;
    const nlen = (~len) & 0xffff;
    header[3] = nlen & 0xff;
    header[4] = (nlen >>> 8) & 0xff;
    if (len > 0) {
      header.set(block.subarray(0, len), 5);
    }
    controller.enqueue(header);
    blockLen = 0;
  };

  return new TransformStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0x78, 0x01]));
    },
    transform(chunk, controller) {
      const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      adler32Update(adler, data);
      let offset = 0;
      while (offset < data.length) {
        const space = MAX_BLOCK - blockLen;
        const take = Math.min(space, data.length - offset);
        block.set(data.subarray(offset, offset + take), blockLen);
        blockLen += take;
        offset += take;
        if (blockLen === MAX_BLOCK) {
          flushBlock(controller, false);
        }
      }
    },
    flush(controller) {
      flushBlock(controller, true);
      const adlerValue = (adler.b << 16) | adler.a;
      controller.enqueue(toUint32(adlerValue >>> 0));
    },
  });
}

async function encodePngFromTiles(width, height, renderTile, onProgress, perfLog, compressionLevel) {
  const level = clampPngCompression(compressionLevel);
  const useStored = level === 0;
  const storedStream = useStored ? createStoreDeflateStream() : null;
  const useStoredStream = Boolean(storedStream);
  const pako = useStoredStream ? null : await resolvePako();
  const usePako = Boolean(pako);
  const hasCompressionStream = typeof CompressionStream !== "undefined";
  if (!useStoredStream && !usePako && !hasCompressionStream) {
    throw new Error("CompressionStream not available for tiled PNG export.");
  }
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  ihdr.set(toUint32(width), 0);
  ihdr.set(toUint32(height), 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = createPngChunk("IHDR", ihdr);

  const tilesX = Math.ceil(width / TILE_SIZE);
  const tilesY = Math.ceil(height / TILE_SIZE);
  const totalTiles = Math.max(1, tilesX * tilesY);
  perfLog?.("tile.encode.start", {
    width,
    height,
    tilesX,
    tilesY,
    totalTiles,
    compression: level,
    encoder: useStoredStream ? "store" : usePako ? "pako" : "stream",
  });
  let completedTiles = 0;

  if (usePako) {
    const deflater = new pako.Deflate({ level });
    const chunks = [];
    deflater.onData = (chunk) => {
      chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
    };

    for (let tileY = 0; tileY < height; tileY += TILE_SIZE) {
      const tileH = Math.min(TILE_SIZE, height - tileY);
      const rowTiles = [];
      for (let tileX = 0; tileX < width; tileX += TILE_SIZE) {
        const tileW = Math.min(TILE_SIZE, width - tileX);
        const tileCanvas = await renderTile(tileX, tileY, tileW, tileH);
        const tileCtx = tileCanvas.getContext("2d", { alpha: true });
        if (!tileCtx) {
          throw new Error("tile context unavailable");
        }
        const data = tileCtx.getImageData(0, 0, tileW, tileH).data;
        rowTiles.push({ tileW, data });
        completedTiles += 1;
        if (onProgress) {
          onProgress(completedTiles / totalTiles);
        }
      }
      for (let row = 0; row < tileH; row += 1) {
        const line = new Uint8Array(1 + width * 4);
        line[0] = 0;
        let offset = 1;
        for (const tile of rowTiles) {
          const start = row * tile.tileW * 4;
          const end = start + tile.tileW * 4;
          line.set(tile.data.subarray(start, end), offset);
          offset += tile.tileW * 4;
        }
        deflater.push(line, false);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    deflater.push(new Uint8Array(0), true);
    if (deflater.err) {
      throw new Error(deflater.msg || "pako deflate failed");
    }
    const compressed = concatUint8(...chunks);
    const idatChunk = createPngChunk("IDAT", compressed);
    const iendChunk = createPngChunk("IEND", new Uint8Array());
    const png = concatUint8(signature, ihdrChunk, idatChunk, iendChunk);
    perfLog?.("tile.encode.done");
    return new Blob([png], { type: "image/png" });
  }

  const rawStream = new ReadableStream({
    start(controller) {
      (async () => {
        for (let tileY = 0; tileY < height; tileY += TILE_SIZE) {
          const tileH = Math.min(TILE_SIZE, height - tileY);
          const rowTiles = [];
          for (let tileX = 0; tileX < width; tileX += TILE_SIZE) {
            const tileW = Math.min(TILE_SIZE, width - tileX);
            const tileCanvas = await renderTile(tileX, tileY, tileW, tileH);
            const tileCtx = tileCanvas.getContext("2d", { alpha: true });
            if (!tileCtx) {
              controller.error(new Error("tile context unavailable"));
              return;
            }
            const data = tileCtx.getImageData(0, 0, tileW, tileH).data;
            rowTiles.push({ tileW, data });
            completedTiles += 1;
            if (onProgress) {
              onProgress(completedTiles / totalTiles);
            }
          }
          for (let row = 0; row < tileH; row += 1) {
            const line = new Uint8Array(1 + width * 4);
            line[0] = 0; // no filter
            let offset = 1;
            for (const tile of rowTiles) {
              const start = row * tile.tileW * 4;
              const end = start + tile.tileW * 4;
              line.set(tile.data.subarray(start, end), offset);
              offset += tile.tileW * 4;
            }
            controller.enqueue(line);
          }
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        controller.close();
      })().catch((err) => controller.error(err));
    },
  });

    const compressed = await timeSpan(
      perfLog,
      useStoredStream ? "tile.encode.store" : "tile.encode.compress",
      () => {
        const stream = useStoredStream
          ? rawStream.pipeThrough(storedStream)
          : rawStream.pipeThrough(new CompressionStream("deflate"));
        return new Response(stream).arrayBuffer();
      }
    );

  const idatChunk = createPngChunk("IDAT", new Uint8Array(compressed));
  const iendChunk = createPngChunk("IEND", new Uint8Array());
  const png = concatUint8(signature, ihdrChunk, idatChunk, iendChunk);
  perfLog?.("tile.encode.done");
  return new Blob([png], { type: "image/png" });
}

async function renderTiled(workflowJson, options, bboxOverride, onProgress, perfLog) {
  const baseWidth = Math.max(1, Math.ceil(bboxOverride.width));
  const baseHeight = Math.max(1, Math.ceil(bboxOverride.height));
  const tiledCanvas = document.createElement("canvas");
  tiledCanvas.width = baseWidth;
  tiledCanvas.height = baseHeight;
  const tiledCtx = tiledCanvas.getContext("2d", { alpha: true });
  if (!tiledCtx) {
    return renderOnce(workflowJson, { ...options, bboxOverride });
  }

  // --- Fix D: Solid Background Fill ---
  if (options.backgroundMode === "solid" && options.backgroundColor) {
    tiledCtx.fillStyle = options.backgroundColor;
    tiledCtx.fillRect(0, 0, baseWidth, baseHeight);
  }

  const tilesX = Math.ceil(baseWidth / TILE_SIZE);
  const tilesY = Math.ceil(baseHeight / TILE_SIZE);
  const totalTiles = Math.max(1, tilesX * tilesY);

  // [CWIE] v3: Tile Bleed Implementation
  // [CWIE] v3: Tile Bleed Implementation (Center Crop)
  const bleed = Number.isFinite(Number(options.tileBleed)) ? Math.max(0, Number(options.tileBleed)) : 64;

  perfLog?.("tile.render.start", { width: baseWidth, height: baseHeight, tilesX, tilesY, totalTiles, bleed });

  let completedTiles = 0;
  for (let y = 0; y < baseHeight; y += TILE_SIZE) {
    for (let x = 0; x < baseWidth; x += TILE_SIZE) {
      // Logical tile size
      const w = Math.min(TILE_SIZE, baseWidth - x);
      const h = Math.min(TILE_SIZE, baseHeight - y);

      // Expanded rect with bleed
      const ex = Math.max(0, x - bleed);
      const ey = Math.max(0, y - bleed);
      const ew = Math.min(baseWidth - ex, w + (x - ex) + bleed);
      const eh = Math.min(baseHeight - ey, h + (y - ey) + bleed);

      const expandedRect = {
        x: ex,
        y: ey,
        width: ew,
        height: eh,
      };

      const expandedCanvas = await renderOnce(workflowJson, {
        ...options,
        bboxOverride,
        tileRect: expandedRect,
        previewFast: false,
        maxPixels: 0,
      });

      // Crop source coords from bleeding canvas (Source X/Y)
      const sx = x - ex;
      const sy = y - ey;

      // Draw cropped tile to final canvas
      // tiledCtx.drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
      tiledCtx.drawImage(expandedCanvas, sx, sy, w, h, x, y, w, h);

      completedTiles += 1;
      if (onProgress) {
        onProgress(completedTiles / totalTiles);
      }
    }
  }
  perfLog?.("tile.render.done");
  return tiledCanvas;
}

async function renderTiledPng(workflowJson, options, bboxOverride, onProgress, perfLog, compressionLevel) {
  if (!bboxOverride) {
    const canvas = await renderOnce(workflowJson, options);
    return toBlobAsync(canvas, "image/png");
  }
  const baseWidth = Math.max(1, Math.ceil(bboxOverride.width));
  const baseHeight = Math.max(1, Math.ceil(bboxOverride.height));

  const tilesX = Math.ceil(baseWidth / TILE_SIZE);
  const tilesY = Math.ceil(baseHeight / TILE_SIZE);

  // [CWIE] v3: Tile Bleed for PNG
  const bleed = Number.isFinite(Number(options.tileBleed)) ? Math.max(0, Number(options.tileBleed)) : 64;
  if (options.debug) {
    console.log(`[CWIE][Export] Tiled export: mode=png, tiles=${tilesX}x${tilesY}, size=${baseWidth}x${baseHeight}, ratio=${options.uiPxRatio}, bleed=${bleed}`);
  }

  return encodePngFromTiles(
    baseWidth,
    baseHeight,
    async (x, y, w, h) => {
      // Expanded rect with bleed
      const ex = Math.max(0, x - bleed);
      const ey = Math.max(0, y - bleed);
      const ew = Math.min(baseWidth - ex, w + (x - ex) + bleed);
      const eh = Math.min(baseHeight - ey, h + (y - ey) + bleed);

      const expandedRect = { x: ex, y: ey, width: ew, height: eh };

      const expandedCanvas = await renderOnce(workflowJson, {
        ...options,
        bboxOverride,
        tileRect: expandedRect,
        previewFast: false,
        maxPixels: 0,
      });

      const sx = x - ex;
      const sy = y - ey;

      // Crop to returning canvas
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

async function renderOnce(workflowJson, options) {
  const rendered = await renderGraphOffscreen(workflowJson, options);
  try {
    if (options?.debug) {
      console.log("[CWIE][Offscreen] rendered canvas", {
        width: rendered.canvas?.width,
        height: rendered.canvas?.height,
      });
    }
    return rendered.canvas;
  } finally {
    rendered.cleanup?.();
  }
}

function recoverTransparentCanvas(canvasA, canvasB, colorA, colorB) {
  const rgbA = parseColorToRgb(colorA);
  const rgbB = parseColorToRgb(colorB);
  if (!rgbA || !rgbB) return null;

  const w = canvasA.width;
  const h = canvasA.height;
  if (w !== canvasB.width || h !== canvasB.height) return null;

  const ctxA = canvasA.getContext("2d", { alpha: true });
  const ctxB = canvasB.getContext("2d", { alpha: true });
  if (!ctxA || !ctxB) return null;

  let dataA;
  let dataB;
  try {
    dataA = ctxA.getImageData(0, 0, w, h).data;
    dataB = ctxB.getImageData(0, 0, w, h).data;
  } catch (_) {
    return null;
  }

  const output = new ImageData(w, h);
  const out = output.data;

  const b1 = [rgbA.r, rgbA.g, rgbA.b];
  const b2 = [rgbB.r, rgbB.g, rgbB.b];

  for (let i = 0; i < dataA.length; i += 4) {
    const c1 = [dataA[i], dataA[i + 1], dataA[i + 2]];
    const c2 = [dataB[i], dataB[i + 1], dataB[i + 2]];
    const alphas = [];
    for (let c = 0; c < 3; c += 1) {
      const denom = b1[c] - b2[c];
      if (denom === 0) continue;
      const alpha = 1 - (c1[c] - c2[c]) / denom;
      if (Number.isFinite(alpha)) {
        alphas.push(alpha);
      }
    }
    let alpha = alphas.length
      ? alphas.reduce((sum, v) => sum + v, 0) / alphas.length
      : 1;
    alpha = Math.min(1, Math.max(0, alpha));

    if (alpha <= 0.001) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
      continue;
    }

    const invAlpha = 1 / alpha;
    const r = (c1[0] - (1 - alpha) * b1[0]) * invAlpha;
    const g = (c1[1] - (1 - alpha) * b1[1]) * invAlpha;
    const b = (c1[2] - (1 - alpha) * b1[2]) * invAlpha;
    out[i] = Math.min(255, Math.max(0, Math.round(r)));
    out[i + 1] = Math.min(255, Math.max(0, Math.round(g)));
    out[i + 2] = Math.min(255, Math.max(0, Math.round(b)));
    out[i + 3] = Math.min(255, Math.max(0, Math.round(alpha * 255)));
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return null;
  ctx.putImageData(output, 0, 0);
  return canvas;
}

async function renderTransparentFallback(workflowJson, options, warnings) {
  const optsA = { ...options, backgroundMode: "solid", backgroundColor: EXTRACT_BG_1 };
  const optsB = { ...options, backgroundMode: "solid", backgroundColor: EXTRACT_BG_2 };

  const canvasA = await renderOnce(workflowJson, optsA);
  const canvasB = await renderOnce(workflowJson, optsB);

  const recovered = recoverTransparentCanvas(canvasA, canvasB, EXTRACT_BG_1, EXTRACT_BG_2);
  if (!recovered) {
    warnings.push("transparent:recovery_failed");
  }
  return recovered;
}

export async function exportWorkflowPng(workflowJson, options = {}) {
  const warnings = [];
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const reportProgress = onProgress
    ? (() => {
      let lastPercent = -1;
      return (value) => {
        const clamped = Math.max(0, Math.min(1, Number(value)));
        if (!Number.isFinite(clamped)) return;
        const percent = Math.floor(clamped * 100);
        if (percent === lastPercent) return;
        lastPercent = percent;
        onProgress({ value: clamped, percent });
      };
    })()
    : null;
  const backgroundMode = options.backgroundMode || "ui";
  const padding = Number(options.padding) || 0;
  const includeGrid = options.includeGrid !== false;
  const scale = Number(options.scale) || 1;
  const debug = Boolean(options.debug);
  const format = String(options.format || "png").toLowerCase();
  const selectedNodeIds = normalizeSelectedIds(options.selectedNodeIds);
  const scopeSelected = Boolean(options.scopeSelected) && selectedNodeIds.length > 0;
  const scopeOpacityRaw = Number(options.scopeOpacity);
  const scopeOpacity = Number.isFinite(scopeOpacityRaw)
    ? Math.min(100, Math.max(0, scopeOpacityRaw))
    : 30;
  // [CWIE] v3: Fixed Ratio & Tile Bleed - Declarations moved below (consolidated)
  const previewFast = Boolean(options.previewFast);
  const pngCompression = clampPngCompression(options.pngCompression);
  const perfLog = createPerfLogger(debug, "[CWIE][ExportPng][perf]");
  perfLog?.("start", { format, scale, previewFast, backgroundMode, pngCompression });

  // [CWIE] v3: Compute unified export settings
  const exportPxRatioRaw = Number(options.exportPxRatio);
  const exportPxRatio = Number.isFinite(exportPxRatioRaw)
    ? Math.min(4, Math.max(1, exportPxRatioRaw))
    : 1;

  const tileBleedRaw = Number(options.tileBleed);
  const tileBleed = Number.isFinite(tileBleedRaw)
    ? Math.max(0, tileBleedRaw)
    : 64;

  const mediaMode = (options.mediaMode === "force" || options.mediaMode === "off" || options.mediaMode === "auto")
    ? options.mediaMode
    : "off";

  let renderOptions = {
    backgroundMode,
    backgroundColor: options.backgroundColor,
    includeGrid,
    padding,
    includeDomOverlays: options.includeDomOverlays !== false,
    uiPxRatio: exportPxRatio,     // Fixed DPR (Zoom Invariant)
    tileBleed,                   // Tile Bleed
    mediaMode,                   // Media Render Mode
    debug,
    selectedNodeIds,
    cropToSelection: scopeSelected,
    previewFast,
    maxPixels: 0, // Max pixels is only used for previewFast, otherwise it's 0
    scale,
  };



  let bboxOverride = null;
  if (!previewFast) {
    try {
      bboxOverride = await timeSpan(
        perfLog,
        "bbox",
        () => computeOffscreenBBox(workflowJson, renderOptions)
      );
    } catch (_) {
      bboxOverride = null;
    }
  }

  const tileEnabled =
    !previewFast && bboxOverride && shouldTile(bboxOverride.width, bboxOverride.height);
  if (tileEnabled) {
    warnings.push("render:tiled");
  }
  perfLog?.("tile.check", { tileEnabled, bbox: bboxOverride ? { w: bboxOverride.width, h: bboxOverride.height } : null });

  const huge =
    bboxOverride && shouldTile(bboxOverride.width * scale, bboxOverride.height * scale);

  if (huge) {
    renderOptions = {
      ...renderOptions,
      includeDomOverlays: false, // Force disable overlays
      // skipTextFallback: true, // Keep text valid in huge mode
      mediaMode: "off",          // Force disable media
    };
  }

  if (huge && scopeSelected) {
    warnings.push("scope:disabled_for_huge");
    renderOptions = {
      ...renderOptions,
      renderFilter: "none",
      linkFilter: "none",
      cropToSelection: false,
      includeDomOverlays: false,
      ...(previewFast
        ? {
          skipTextFallback: true,
          skipMediaThumbnails: true,
        }
        : {}),
    };
  }

  if (huge && backgroundMode === "transparent") {
    warnings.push("transparent:unchecked");
  }

  if (huge) {
    const forcePng = format === "webp";
    if (!scopeSelected && previewFast) {
      renderOptions = {
        ...renderOptions,
        includeDomOverlays: false,
        skipTextFallback: true,
        skipMediaThumbnails: true,
      };
    }
    if (forcePng) {
      warnings.push("format:force-png");
    }
    warnings.push("render:tiled-png");
    reportProgress?.(0);
    let blob = await timeSpan(
      perfLog,
      "tile.png",
      () => renderTiledPng(workflowJson, renderOptions, bboxOverride, reportProgress, perfLog, pngCompression)
    );
    reportProgress?.(1);
    if (options.embedWorkflow !== false) {
      const json = toWorkflowJsonString(workflowJson);
      if (json) {
        try {
          const embedded = await timeSpan(
            perfLog,
            "embed.workflow",
            () => embedWorkflowInPngBlob(blob, json)
          );
          if (embedded) {
            blob = embedded;
          } else {
            warnings.push("embed:failed");
          }
        } catch (error) {
          warnings.push(
            `embed:failed${error?.message ? `:${error.message}` : ""}`
          );
        }
      } else {
        warnings.push("embed:failed");
      }
    }
    if (forcePng) {
      const withType = blob?.type === "image/png" ? blob : new Blob([blob], { type: "image/png" });
      withType.cwieFormat = "png";
      blob = withType;
    }
    if (warnings.length) {
      blob.cwieWarnings = warnings;
    }
    return blob;
  }

  const canFastTilePng =
    tileEnabled &&
    format === "png" &&
    scale === 1 &&
    !previewFast &&
    !scopeSelected &&
    backgroundMode !== "transparent";
  if (canFastTilePng) {
    try {
      reportProgress?.(0);
      let blob = await timeSpan(
        perfLog,
        "tile.png.fast",
        () => renderTiledPng(workflowJson, renderOptions, bboxOverride, reportProgress, perfLog, pngCompression)
      );
      reportProgress?.(1);
      if (options.embedWorkflow !== false) {
        const json = toWorkflowJsonString(workflowJson);
        if (json) {
          try {
            const embedded = await timeSpan(
              perfLog,
              "embed.workflow",
              () => embedWorkflowInPngBlob(blob, json)
            );
            if (embedded) {
              blob = embedded;
            } else {
              warnings.push("embed:failed");
            }
          } catch (error) {
            warnings.push(
              `embed:failed${error?.message ? `:${error.message}` : ""}`
            );
          }
        } else {
          warnings.push("embed:failed");
        }
      }
      if (warnings.length) {
        blob.cwieWarnings = warnings;
      }
      return blob;
    } catch (_) {
      // Fall back to standard render path if tiled PNG fails.
    }
  }

  const renderPass = async (passOptions, label) => {
    const opts = bboxOverride ? { ...passOptions, bboxOverride } : passOptions;
    if (tileEnabled) {
      reportProgress?.(0);
      const canvas = await timeSpan(
        perfLog,
        label || "render.tiled",
        () => renderTiled(workflowJson, opts, bboxOverride, reportProgress, perfLog)
      );
      reportProgress?.(1);
      return canvas;
    }
    return timeSpan(perfLog, label || "render.once", () => renderOnce(workflowJson, opts));
  };

  let canvas = await renderPass(renderOptions, "render.base");

  if (scopeSelected) {
    const dimAlpha = scopeOpacity / 100;
    const backgroundCanvas = await renderPass({
      ...renderOptions,
      renderFilter: "none",
      linkFilter: "none",
    }, "render.scope.background");
    const dimCanvas = await renderPass({
      ...renderOptions,
      backgroundMode: "transparent",
      includeGrid: false,
    }, "render.scope.dim");
    const selectedCanvas = await renderPass({
      ...renderOptions,
      backgroundMode: "transparent",
      includeGrid: false,
      renderFilter: "selected",
      linkFilter: "selected",
    }, "render.scope.selected");
    const output = document.createElement("canvas");
    output.width = backgroundCanvas.width;
    output.height = backgroundCanvas.height;
    const ctx = output.getContext("2d", { alpha: true });
    if (ctx) {
      ctx.drawImage(backgroundCanvas, 0, 0);
      if (dimAlpha > 0) {
        ctx.globalAlpha = dimAlpha;
        ctx.drawImage(dimCanvas, 0, 0);
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(selectedCanvas, 0, 0);
      canvas = output;
    }
  }

  if (backgroundMode === "transparent") {
    const transparent = isCanvasTransparent(canvas);
    if (debug) {
      console.log("[CWIE][Offscreen] transparent check", { ok: transparent });
    }
    if (!transparent && !previewFast) {
      warnings.push("transparent:failed");
      const recovered = await renderTransparentFallback(workflowJson, renderOptions, warnings);
      if (recovered) {
        canvas = recovered;
      } else {
        warnings.push("transparent:degraded_to_solid");
        renderOptions = {
          ...renderOptions,
          backgroundMode: "solid",
          backgroundColor:
            options.backgroundColor || resolveUiBackgroundColor(resolveSolidBackgroundColor()),
        };
        canvas = await renderOnce(workflowJson, renderOptions);
      }
    }
  }

  const finalCanvas = await timeSpan(
    perfLog,
    "scale.canvas",
    () => scaleCanvas(canvas, scale)
  );
  if (debug) {
    console.log("[CWIE][Offscreen] final canvas", {
      width: finalCanvas?.width,
      height: finalCanvas?.height,
      scale,
    });
  }
  const mime = format === "webp" ? "image/webp" : "image/png";
  let blob = await timeSpan(perfLog, "toBlob", () => toBlobAsync(finalCanvas, mime));

  if (options.embedWorkflow !== false && format !== "webp") {
    const json = toWorkflowJsonString(workflowJson);
    if (json) {
      try {
        const embedded = await timeSpan(
          perfLog,
          "embed.workflow",
          () => embedWorkflowInPngBlob(blob, json)
        );
        if (embedded) {
          blob = embedded;
        } else {
          warnings.push("embed:failed");
        }
      } catch (error) {
        warnings.push(
          `embed:failed${error?.message ? `:${error.message}` : ""}`
        );
      }
    } else {
      warnings.push("embed:failed");
    }
  }

  if (warnings.length) {
    blob.cwieWarnings = warnings;
  }

  return blob;
}
