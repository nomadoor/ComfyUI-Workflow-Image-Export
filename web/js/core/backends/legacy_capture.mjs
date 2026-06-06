import { app } from "/scripts/app.js";
import { toBlobAsync } from "../utils.mjs";
import {
  applyBackgroundFill,
  applyBackgroundMode,
  configureTransform,
  copyRenderSettings,
  createPerfLogger,
  disableCanvasInfoOverlay,
  drawOffscreen,
  ensure2DContext,
  ensureBgCanvas,
  forceExportQuality,
  measurePerf,
  measurePerfAsync,
  overrideDevicePixelRatio,
  setCanvasPixelSize,
  syncOffscreenCanvasSize,
} from "./legacy_support.mjs";
import {
  applyPadding,
  boundsFromNodeRects,
  collectGraphBounds,
  filterNodeRectsBySelected,
} from "./legacy_bounds.mjs";
import {
  drawDomWidgetOverlays,
  drawTextOverlays,
} from "./legacy_dom_text_overlays.mjs";
import {
  drawImageOverlays,
  drawVideoOverlays,
  drawVhsVideoOverlays,
  logDomMedia,
} from "./legacy_media_overlays.mjs";
import { drawVideoThumbnails } from "../../export/fallback_media_overlays.mjs";

function computeExportScale(srcW, srcH, options, debugLog) {
  const resolutionScale = options?.outputResolution === "200%" ? 2 : 1;
  let scale = resolutionScale;

  const maxLongEdge = Number(options?.maxLongEdge) || 0;
  if (maxLongEdge > 0) {
    const longEdge = Math.max(srcW, srcH) * scale;
    if (longEdge > maxLongEdge) {
      scale *= maxLongEdge / longEdge;
    }
  }

  const outW = Math.max(1, Math.ceil(srcW * scale));
  const outH = Math.max(1, Math.ceil(srcH * scale));
  debugLog?.("export.scale", { scale, outW, outH, srcW, srcH });
  return { scale, outW, outH };
}

function applyScopeOpacityFallback(exportCtx, bounds, scale, nodeRects, selectedNodeIds, scopeOpacity, backgroundColor) {
  const ids = Array.isArray(selectedNodeIds)
    ? new Set(selectedNodeIds.map((id) => Number(id)).filter(Number.isFinite))
    : null;
  if (!exportCtx || !bounds || !ids?.size) return;
  const dimAlpha = Math.min(1, Math.max(0, Number(scopeOpacity) / 100));
  const fadeAlpha = 1 - dimAlpha;
  if (!(fadeAlpha > 0.001)) return;
  if (!backgroundColor || String(backgroundColor).startsWith("rgba(0, 0, 0, 0")) return;

  exportCtx.save();
  exportCtx.fillStyle = backgroundColor;
  exportCtx.globalAlpha = fadeAlpha;

  for (const rect of nodeRects || []) {
    if (!rect) continue;
    const rectId = Number(rect.id);
    if (!Number.isFinite(rectId)) continue;
    if (ids.has(rectId)) continue;
    const x = Math.round((rect.left - bounds.left) * scale);
    const y = Math.round((rect.top - bounds.top) * scale);
    const w = Math.max(1, Math.round((rect.right - rect.left) * scale));
    const h = Math.max(1, Math.round((rect.bottom - rect.top) * scale));
    exportCtx.fillRect(x, y, w, h);
  }

  exportCtx.restore();
}

export async function captureLegacy(options = {}) {
  const format = options.format || "png";
  if (format === "svg") {
    throw new Error("Legacy capture: SVG is not supported.");
  }
  const mime = format === "webp" ? "image/webp" : "image/png";
  const padding = Number(options.padding) || 0;
  const debug = Boolean(options.debug);

  const uiCanvas = app?.canvas;
  const graph = app?.graph;
  if (!uiCanvas || !graph) {
    throw new Error("Legacy capture: app.canvas or app.graph missing.");
  }

  const debugLog = debug
    ? (label, payload) => {
      if (String(label).startsWith("diag.")) return;
      console.log(`[CWIE][Legacy][dbg] ${label}`, payload);
    }
    : null;
  const perfLog = createPerfLogger(debug);
  perfLog?.("start", {
    format,
    background: options.background || "ui",
    padding,
    outputResolution: options.outputResolution || "100%",
    skipWidgetCapture: options?.skipWidgetCapture === true,
  });

  const { bounds: graphBounds, nodeRects } = measurePerf(
    perfLog,
    "bounds.collect",
    () => collectGraphBounds(graph, debugLog)
  );
  const selectedNodeRects =
    options?.scopeSelected === true
      ? filterNodeRectsBySelected(nodeRects, options.selectedNodeIds)
      : [];
  const effectiveBoundsSource =
    options?.scopeSelected === true && selectedNodeRects.length
      ? boundsFromNodeRects(selectedNodeRects, debugLog)
      : graphBounds;
  const bounds = applyPadding(effectiveBoundsSource, padding, debugLog);
  if (!bounds) {
    throw new Error("Legacy capture: bounds not available.");
  }

  const srcW = Math.max(1, Math.ceil(bounds.width));
  const srcH = Math.max(1, Math.ceil(bounds.height));
  const { scale, outW: width, outH: height } = computeExportScale(srcW, srcH, options, debugLog);
  debugLog?.("export.size", { width, height });

  const exportCanvas = document.createElement("canvas");
  setCanvasPixelSize(exportCanvas, width, height);
  let exportCtx = ensure2DContext(exportCanvas);
  if (!exportCtx) {
    throw new Error("Legacy capture: export context missing.");
  }

  // Use the exact same constructor as the UI canvas to ensure ComfyUI extensions/modifications are present
  const LGraphCanvasRef = uiCanvas.constructor || window?.LGraphCanvas || window?.LiteGraph?.LGraphCanvas;
  if (!LGraphCanvasRef) {
    throw new Error("Legacy capture: LGraphCanvas constructor not available.");
  }

  const restoreDpr = overrideDevicePixelRatio(1, debugLog);
  const offscreen = new LGraphCanvasRef(exportCanvas, graph);
  offscreen.canvas = exportCanvas;
  offscreen.ctx = exportCtx;

  try {
    const mode = measurePerf(perfLog, "offscreen.setup", () => {
      copyRenderSettings(uiCanvas, offscreen);
      forceExportQuality(offscreen);
      disableCanvasInfoOverlay(offscreen);
      if (typeof offscreen.resize === "function") {
        offscreen.resize(width, height);
        debugLog?.("offscreen.resize", { width, height });
      }
      exportCtx = syncOffscreenCanvasSize(offscreen, exportCanvas, width, height);
      if (!exportCtx) {
        throw new Error("Legacy capture: export context missing after resize.");
      }
      ensureBgCanvas(offscreen, width, height);
      const nextMode = applyBackgroundMode(offscreen, options);
      configureTransform(offscreen, bounds, width, height, scale, debugLog);
      return nextMode;
    });

    measurePerf(
      perfLog,
      "background.fill",
      () => applyBackgroundFill(
        mode,
        width,
        height,
        exportCtx,
        offscreen.bgctx,
        options?.solidColor
      )
    );

    if (debug) {
      console.log("[CWIE][Legacy] export:bounds", bounds);
      console.log("[CWIE][Legacy] export:canvas", {
        width: exportCanvas.width,
        height: exportCanvas.height,
        ctxCanvasIsExport: offscreen.ctx?.canvas === exportCanvas,
      });
      console.log(
        "[CWIE][Legacy] export:bgcanvas",
        offscreen.bgcanvas
          ? {
            width: offscreen.bgcanvas.width,
            height: offscreen.bgcanvas.height,
            alpha: offscreen.bgctx?.getContextAttributes?.()?.alpha,
          }
          : null
      );
      console.log("[CWIE][Legacy] export:mode", mode);
      debugLog?.("render.flags", {
        render_background: offscreen.render_background,
        clear_background: offscreen.clear_background,
        clear_background_color: offscreen.clear_background_color,
        show_grid: offscreen.show_grid,
        bgcolor: offscreen.bgcolor,
        background_color: offscreen.background_color,
        background_image: offscreen.background_image,
      });
      debugLog?.("ui.ds", {
        scale: uiCanvas.ds?.scale,
        offset: Array.isArray(uiCanvas.ds?.offset) ? [...uiCanvas.ds.offset] : null,
      });
      debugLog?.("ui.flags", {
        render_background: uiCanvas.render_background,
        clear_background: uiCanvas.clear_background,
        show_grid: uiCanvas.show_grid,
        bgcolor: uiCanvas.bgcolor,
        background_color: uiCanvas.background_color,
      });
      logDomMedia(debugLog, uiCanvas);
    }

    await measurePerfAsync(
      perfLog,
      "offscreen.draw",
      () => drawOffscreen(offscreen, {
        mode,
        width,
        height,
        exportCtx,
        bgctx: offscreen.bgctx,
        solidColor: options?.solidColor,
        resetTransform: () => configureTransform(offscreen, bounds, width, height, scale, debugLog),
      })
    );
    measurePerf(
      perfLog,
      "dom.image.overlays",
      () => drawImageOverlays({ exportCtx, uiCanvas, bounds, scale, debugLog })
    );
    await measurePerfAsync(
      perfLog,
      "dom.video.overlays",
      async () => {
        const drawnVideoNodeIds = drawVideoOverlays({
          exportCtx,
          uiCanvas,
          graph,
          bounds,
          scale,
          nodeRects,
          debugLog,
        });
        await drawVideoThumbnails({
          exportCtx,
          graph,
          nodeRects,
          bounds,
          scale,
          debugLog,
          skipNodeIds: drawnVideoNodeIds,
          drawPlaceholderOnMiss: false,
          selectedNodeIds: options.selectedNodeIds,
          renderFilter: options.renderFilter || "all",
        });
      }
    );
    measurePerf(
      perfLog,
      "dom.vhs.overlays",
      () => drawVhsVideoOverlays({ exportCtx, uiCanvas, bounds, scale, debugLog })
    );
    const domWidgetCoveredNodeIds =
      options?.skipDomWidgetOverlays === true
        ? new Set()
        : await measurePerfAsync(perfLog, "dom.widget.overlays", () => drawDomWidgetOverlays({
          exportCtx,
          uiCanvas,
          bounds,
          scale,
          nodeRects,
          debugLog,
          skipWidgetCapture: options?.skipWidgetCapture === true,
        }));
    measurePerf(
      perfLog,
      "dom.text.overlays",
      () => drawTextOverlays({
        exportCtx,
        uiCanvas,
        graph,
        bounds,
        scale,
        nodeRects,
        debugLog,
        skipNodeIds: domWidgetCoveredNodeIds,
      })
    );

    if (options?.scopeSelected === true) {
      measurePerf(
        perfLog,
        "scope.opacity",
        () => applyScopeOpacityFallback(
          exportCtx,
          bounds,
          scale,
          nodeRects,
          options.selectedNodeIds,
          options.scopeOpacity,
          mode === "solid"
            ? (options?.solidColor || "#1f1f1f")
            : (offscreen.bgcolor || offscreen.background_color || "#1f1f1f")
        )
      );
    }

    if (options?.deferBlob === true) {
      perfLog?.("toBlob.deferred");
      perfLog?.("done", { width, height, deferredBlob: true });
      return {
        type: "raster",
        mime,
        blob: null,
        canvas: exportCanvas,
        width,
        height,
      };
    }

    const blob = await measurePerfAsync(perfLog, "toBlob", () => toBlobAsync(exportCanvas, mime));
    perfLog?.("done", { width, height });
    return {
      type: "raster",
      mime,
      blob,
      width,
      height,
    };
  } finally {
    try { if (typeof offscreen.stopRendering === "function") offscreen.stopRendering(); } catch (_) {}
    try { if (typeof offscreen.setCanvas === "function") offscreen.setCanvas(null); } catch (_) {}
    try { if (typeof offscreen.unbind_events === "function") offscreen.unbind_events(); } catch (_) {}
    restoreDpr?.();
  }
}
