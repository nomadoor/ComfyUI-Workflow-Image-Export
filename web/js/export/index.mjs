import { toBlobAsync } from "../core/utils.mjs";

import {
  resolveUiBackgroundColor,
  resolveSolidBackgroundColor,
  EXTRACT_BG_1,
  EXTRACT_BG_2,
} from "./background_modes.mjs";
import { computeOffscreenBBox, renderGraphOffscreen } from "./render_graph_offscreen.mjs";
import { embedWorkflowInPngBlob } from "./png_embed_workflow.mjs";
import { shouldTile } from "./limits.mjs";
import { clampPngCompression } from "./tiled_png_encoder.mjs";
import { isCanvasTransparent, recoverTransparentCanvas } from "./transparent_recovery.mjs";
import { renderTiled, renderTiledPng } from "./tiled_render.mjs";

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

async function embedWorkflowIfEnabled(blob, { workflowJson, enabled, warnings, perfLog }) {
  if (!enabled) return blob;
  const json = toWorkflowJsonString(workflowJson);
  if (!json) {
    warnings.push("embed:failed");
    return blob;
  }
  try {
    const embedded = await timeSpan(
      perfLog,
      "embed.workflow",
      () => embedWorkflowInPngBlob(blob, json)
    );
    if (embedded) {
      return embedded;
    }
    warnings.push("embed:failed");
  } catch (error) {
    warnings.push(`embed:failed${error?.message ? `:${error.message}` : ""}`);
  }
  return blob;
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
  const nodeOpacityRaw = Number(options.nodeOpacity);
  const nodeOpacity = Number.isFinite(nodeOpacityRaw)
    ? Math.min(100, Math.max(0, nodeOpacityRaw))
    : 100;
  const previewFast = Boolean(options.previewFast);
  const pngCompression = clampPngCompression(options.pngCompression);
  const perfLog = createPerfLogger(debug, "[CWIE][ExportPng][perf]");
  perfLog?.("start", { format, scale, previewFast, backgroundMode, pngCompression });

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
    uiPxRatio: exportPxRatio,
    tileBleed,
    mediaMode,
    debug,
    selectedNodeIds,
    cropToSelection: scopeSelected,
    previewFast,
    maxPixels: 0,
    scale,
    nodeOpacity,
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

  if (huge && format === "webp") {
    const error = new Error("WebP is not supported for huge/tiled exports. Please use PNG or reduce the export size.");
    error.code = "WEBP_HUGE_UNSUPPORTED";
    error.cwie = {
      format,
      huge: true,
      width: bboxOverride?.width,
      height: bboxOverride?.height,
      scale,
    };
    throw error;
  }

  if (huge) {
    renderOptions = {
      ...renderOptions,
      renderScaleFactor: scale,
      includeDomOverlays: false,
      mediaMode: "off",
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
      () => renderTiledPng({
        workflowJson,
        options: renderOptions,
        bboxOverride,
        onProgress: reportProgress,
        perfLog,
        compressionLevel: pngCompression,
        renderOnce,
      })
    );
    reportProgress?.(1);
    blob = await embedWorkflowIfEnabled(blob, {
      workflowJson,
      enabled: options.embedWorkflow !== false,
      warnings,
      perfLog,
    });
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
        () => renderTiledPng({
          workflowJson,
          options: renderOptions,
          bboxOverride,
          onProgress: reportProgress,
          perfLog,
          compressionLevel: pngCompression,
          renderOnce,
        })
      );
      reportProgress?.(1);
      blob = await embedWorkflowIfEnabled(blob, {
        workflowJson,
        enabled: options.embedWorkflow !== false,
        warnings,
        perfLog,
      });
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
        () => renderTiled({
          workflowJson,
          options: opts,
          bboxOverride,
          onProgress: reportProgress,
          perfLog,
          renderOnce,
        })
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

  blob = await embedWorkflowIfEnabled(blob, {
    workflowJson,
    enabled: options.embedWorkflow !== false && format !== "webp",
    warnings,
    perfLog,
  });

  if (warnings.length) {
    blob.cwieWarnings = warnings;
  }

  return blob;
}
