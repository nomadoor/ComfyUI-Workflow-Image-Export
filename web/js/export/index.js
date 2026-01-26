import { toBlobAsync } from "../core/utils.js";
import {
  resolveUiBackgroundColor,
  resolveSolidBackgroundColor,
  EXTRACT_BG_1,
  EXTRACT_BG_2,
} from "./background_modes.js";
import { renderGraphOffscreen } from "./render_graph_offscreen.js";
import { embedWorkflowInPngBlob } from "./png_embed_workflow.js";

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
  if (s <= 1) {
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
  const backgroundMode = options.backgroundMode || "ui";
  const padding = Number(options.padding) || 0;
  const includeGrid = options.includeGrid !== false;
  const scale = Number(options.scale) || 1;
  const debug = Boolean(options.debug);
  const selectedNodeIds = normalizeSelectedIds(options.selectedNodeIds);
  const scopeSelected = Boolean(options.scopeSelected) && selectedNodeIds.length > 0;
  const scopeOpacityRaw = Number(options.scopeOpacity);
  const scopeOpacity = Number.isFinite(scopeOpacityRaw)
    ? Math.min(100, Math.max(0, scopeOpacityRaw))
    : 30;
  const previewFast = Boolean(options.previewFast);

  let renderOptions = {
    backgroundMode,
    backgroundColor: options.backgroundColor,
    includeGrid,
    padding,
    includeDomOverlays: options.includeDomOverlays !== false,
    debug,
    selectedNodeIds,
    cropToSelection: scopeSelected,
    previewFast,
  };

  let canvas = await renderOnce(workflowJson, renderOptions);

  if (scopeSelected) {
    const dimAlpha = scopeOpacity / 100;
    if (dimAlpha < 0.999) {
      const selectedCanvas = await renderOnce(workflowJson, {
        ...renderOptions,
        backgroundMode: "transparent",
        includeGrid: false,
        renderFilter: "selected",
      });
      const output = document.createElement("canvas");
      output.width = canvas.width;
      output.height = canvas.height;
      const ctx = output.getContext("2d", { alpha: true });
      if (ctx) {
        ctx.globalAlpha = dimAlpha;
        ctx.drawImage(canvas, 0, 0);
        ctx.globalAlpha = 1;
        ctx.drawImage(selectedCanvas, 0, 0);
        canvas = output;
      }
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

  const finalCanvas = scaleCanvas(canvas, scale);
  if (debug) {
    console.log("[CWIE][Offscreen] final canvas", {
      width: finalCanvas?.width,
      height: finalCanvas?.height,
      scale,
    });
  }
  let blob = await toBlobAsync(finalCanvas, "image/png");

  if (options.embedWorkflow !== false) {
    const json = toWorkflowJsonString(workflowJson);
    if (json) {
      try {
        const embedded = await embedWorkflowInPngBlob(blob, json);
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
