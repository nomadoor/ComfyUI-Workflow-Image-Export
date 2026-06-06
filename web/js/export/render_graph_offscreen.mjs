import { app } from "/scripts/app.js";
import { computeGraphBBox } from "./bbox.mjs";
import { applyBackgroundMode, getExportBackgroundFillColor } from "./background_modes.mjs";
import {
  drawBackgroundImageOverlays,
  drawImageThumbnails,
  drawVideoThumbnails,
} from "./fallback_media_overlays.mjs";
import {
  applyLinkFilter,
  applyRenderFilter,
  computeScaleToFit,
  computeTileBounds,
} from "./offscreen_render_utils.mjs";
import { applyNodeOpacity } from "./offscreen_node_opacity.mjs";
import { syncLiveGraphState } from "./live_graph_sync.mjs";
import { collectNodeRects } from "../core/backends/legacy_bounds.mjs";
import {
  drawDomWidgetOverlays,
  drawTextOverlays,
  drawWidgetTextFallback,
} from "../core/backends/legacy_dom_text_overlays.mjs";
import {
  drawImageOverlays,
  drawVideoOverlays,
  drawVhsVideoOverlays,
} from "../core/backends/legacy_media_overlays.mjs";

const PREVIEW_MAX_PIXELS = 2048 * 2048;

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

function resolveGraphConstructor() {
  if (app?.graph?.constructor) {
    return app.graph.constructor;
  }
  return window?.LGraph || window?.LiteGraph?.LGraph || null;
}

function resolveCanvasConstructor() {
  if (app?.canvas?.constructor) {
    return app.canvas.constructor;
  }
  return window?.LGraphCanvas || window?.LiteGraph?.LGraphCanvas || null;
}

function copyRenderSettings(fromCanvas, toCanvas) {
  if (!fromCanvas || !toCanvas) return;
  const renderKeys = [
    "render_background",
    "clear_background",
    "clear_background_color",
    "background_image",
    "show_grid",
    "bgcolor",
    "background_color",
    "grid_size",
    "link_color",
    "link_shadow_color",
    "link_brightness",
    "default_link_color",
    "link_type",
    "render_connections_border",
    "render_connections_shadows",
    "render_curved_connections",
    "always_render_background",
    "use_slot_types_default_colors",
    "use_slot_types_color",
    "NODE_WIDGET_COLOR",
    "NODE_TEXT_COLOR",
    "NODE_DEFAULT_COLOR",
    "NODE_SELECTED_COLOR",
    "NODE_BOX_OUTLINE_COLOR",
    "NODE_TITLE_COLOR",
    "NODE_TEXT_SIZE",
    "NODE_SLOT_RGB",
  ];

  for (const key in fromCanvas) {
    if (
      key.startsWith("NODE_") ||
      key.startsWith("link_") ||
      key.startsWith("render_") ||
      key.startsWith("use_slot_") ||
      key.startsWith("default_")
    ) {
      if (!renderKeys.includes(key)) {
        renderKeys.push(key);
      }
    }
  }

  renderKeys.forEach((key) => {
    if (fromCanvas[key] !== undefined) {
      toCanvas[key] = fromCanvas[key];
    } else if (fromCanvas.constructor && fromCanvas.constructor[key] !== undefined) {
      toCanvas[key] = fromCanvas.constructor[key];
    }
  });
}

function disableCanvasInfoOverlay(canvas) {
  if (!canvas) return;
  const forceFalseKeys = [
    "render_canvas_border",
    "render_canvas_info",
    "show_canvas_info",
    "render_info",
    "show_info",
    "draw_info",
    "render_fps",
    "show_fps",
    "show_stats",
    "render_stats",
  ];
  for (const key of forceFalseKeys) {
    try {
      if (key in canvas || Object.getOwnPropertyDescriptor(canvas, key)?.writable !== false) {
        canvas[key] = false;
      }
    } catch (_) {}
  }
}

function configureGraph(graph, workflowJson) {
  if (!graph) {
    throw new Error("Offscreen render: LGraph is not available.");
  }
  let data = workflowJson;
  if (typeof workflowJson === "string") {
    try {
      data = JSON.parse(workflowJson);
    } catch (error) {
      throw new Error("Offscreen render: workflow JSON parse failed.");
    }
  }
  const isObjectData = data && typeof data === "object";
  const clonedData = isObjectData && typeof structuredClone === "function"
    ? structuredClone(data)
    : data;
  const errors = [];
  const tryLoad = (label, fn, ...args) => {
    try {
      fn?.call(graph, ...args);
      return true;
    } catch (error) {
      errors.push({ label, error });
      return false;
    }
  };

  const hasNodes = () => {
    const nodes = graph?._nodes || graph?.nodes || [];
    return Array.isArray(nodes) && nodes.length > 0;
  };

  let loaded = false;
  if (typeof graph.configure === "function") {
    // Fresh offscreen graphs do not need a pre-load clear(), and newer
    // frontends tie clear() into shared layout/widget stores.
    loaded = tryLoad("configure(keep_old=true)", graph.configure, clonedData, true);
  }
  if (!hasNodes() && typeof graph.deserialize === "function") {
    loaded = tryLoad("deserialize", graph.deserialize, clonedData) || loaded;
  }
  if (!hasNodes() && typeof workflowJson === "string" && typeof graph.load === "function") {
    loaded = tryLoad("load(string)", graph.load, workflowJson) || loaded;
  }
  if (!loaded && !hasNodes()) {
    const detail = errors
      .map(({ label, error }) => `${label}: ${error?.message || String(error)}`)
      .join(" | ");
    throw new Error(
      detail
        ? `Offscreen render: graph.configure failed. ${detail}`
        : "Offscreen render: graph.configure not available."
    );
  }
}

function configureTransform(offscreen, bbox, padding) {
  if (!offscreen || !offscreen.ds) {
    return;
  }
  const ds = offscreen.ds;
  if (!Array.isArray(ds.offset)) {
    ds.offset = [0, 0];
  }
  const scaleFactor = Number(offscreen._cwieScaleFactor) || 1;
  const tileOffsetX = Number(offscreen._cwieTileOffsetX) || 0;
  const tileOffsetY = Number(offscreen._cwieTileOffsetY) || 0;
  // DragAndScale.toCanvasContext does: scale() then translate().
  // That means screen = (world + offset) * scale.
  // Therefore offset must be in unscaled world units.
  ds.scale = scaleFactor;
  ds.offset[0] = -bbox.minX + padding - (tileOffsetX / scaleFactor);
  ds.offset[1] = -bbox.minY + padding - (tileOffsetY / scaleFactor);
}

function configureVisibleArea(offscreen, bbox, visibleBounds = null) {
  if (!offscreen) return;
  // Let LiteGraph compute visible area from ds + canvas size when possible.
  if (typeof offscreen.computeVisibleArea === "function") {
    try {
      offscreen.computeVisibleArea();
    } catch (_) {
      // fall back to manual visible area below
    }
  }
  const source = visibleBounds || bbox;
  const visibleArea = [source.paddedMinX, source.paddedMinY, source.width, source.height];
  if (offscreen.visible_area && typeof offscreen.visible_area.set === "function") {
    offscreen.visible_area.set(visibleArea);
  } else {
    offscreen.visible_area = new Float32Array(visibleArea);
  }
  if (offscreen.last_drawn_area && typeof offscreen.last_drawn_area.set === "function") {
    offscreen.last_drawn_area.set(visibleArea);
  } else {
    offscreen.last_drawn_area = new Float32Array(visibleArea);
  }
}

function safeCleanup(offscreen, graph) {
  try {
    if (typeof offscreen?.stopRendering === "function") {
      offscreen.stopRendering();
    }
  } catch (_) {
    // ignore
  }
  try {
    if (typeof offscreen?.setCanvas === "function") {
      offscreen.setCanvas(null);
    }
  } catch (_) {
    // ignore
  }
  try {
    if (typeof offscreen?.unbind_events === "function") {
      offscreen.unbind_events();
    }
  } catch (_) {
    // ignore
  }
  try {
    if (typeof offscreen?.clear === "function") {
      offscreen.clear();
    }
  } catch (_) {
    // ignore
  }
  try {
    if (typeof graph?.clear === "function") {
      graph.clear();
    }
  } catch (_) {
    // ignore
  }
  try {
    if (typeof graph?.stop === "function") {
      graph.stop();
    }
  } catch (_) {
    // ignore
  }
}

async function prepareGraph(workflowJson, debugLog) {
  const LGraphRef = resolveGraphConstructor();
  const LGraphCanvasRef = resolveCanvasConstructor();
  if (!LGraphRef || !LGraphCanvasRef) {
    throw new Error("Offscreen render: LiteGraph constructors not available.");
  }
  const graph = new LGraphRef();
  configureGraph(graph, workflowJson);
  syncLiveGraphState(graph, app?.graph, app?.canvas, debugLog);
  return { graph, LGraphCanvasRef };
}

export async function computeOffscreenBBox(workflowJson, options = {}) {
  const debug = Boolean(options.debug);
  const debugLog = debug
    ? (label, payload) => {
      if (String(label).startsWith("diag.")) return;
      console.log(`[CWIE][Offscreen][dom] ${label}`, payload);
    }
    : null;
  const padding = Number(options.padding) || 0;
  const { graph } = await prepareGraph(workflowJson, debugLog);
  try {
    return computeGraphBBox(graph, {
      padding,
      debug,
      selectedNodeIds: options.selectedNodeIds,
      useSelectionOnly: options.cropToSelection,
    });
  } finally {
    safeCleanup(null, graph);
  }
}

export async function renderGraphOffscreen(workflowJson, options = {}) {
  const debug = Boolean(options.debug);
  const debugLog = debug
    ? (label, payload) => {
      if (String(label).startsWith("diag.")) return;
      console.log(`[CWIE][Offscreen][dom] ${label}`, payload);
    }
    : null;
  const perfLog = createPerfLogger(debug, "[CWIE][Offscreen][perf]");
  perfLog?.("start");

  const padding = Number(options.padding) || 0;
  const { graph, LGraphCanvasRef } = await timeSpan(
    perfLog,
    "prepareGraph",
    () => prepareGraph(workflowJson, debugLog)
  );
  perfLog?.("graph.ready");
  if (debug) {
    const nodes = graph?._nodes || graph?.nodes || [];
    const liveNodes = app?.graph?._nodes || app?.graph?.nodes || [];
    console.log("[CWIE][Offscreen] graph nodes", { count: nodes?.length || 0 });
    console.log("[CWIE][Offscreen] live nodes", { count: liveNodes?.length || 0 });
    nodes.slice(0, 20).forEach((n) => {
      if (!n) return;
      console.log("[CWIE][Offscreen] node.inspect", {
        id: n.id,
        type: n.type,
        title: n.title,
        pos: n.pos || n._pos,
        size: n.size || n._size,
        widgets_len: Array.isArray(n.widgets) ? n.widgets.length : 0,
        widgets_start_y: n.widgets_start_y,
        widgets_values_type: Array.isArray(n.widgets_values)
          ? "array"
          : n.widgets_values && typeof n.widgets_values === "object"
            ? "object"
            : typeof n.widgets_values,
        widgets_values_keys: n.widgets_values && typeof n.widgets_values === "object"
          ? Object.keys(n.widgets_values).slice(0, 20)
          : null,
        properties_keys: n.properties && typeof n.properties === "object"
          ? Object.keys(n.properties).slice(0, 20)
          : null,
      });
      // VHS debug removed: VHS support disabled for now.
    });
  }

  const bbox =
    options.bboxOverride ||
    await timeSpan(perfLog, "computeGraphBBox", () => computeGraphBBox(graph, {
      padding,
      debug,
      selectedNodeIds: options.selectedNodeIds,
      useSelectionOnly: options.cropToSelection,
      useBounding: options.previewFast ? false : undefined,
    }));
  perfLog?.("bbox.ready", { width: bbox.width, height: bbox.height });
  applyRenderFilter(graph, options.selectedNodeIds, options.renderFilter);
  applyLinkFilter(graph, options.selectedNodeIds, options.linkFilter);
  const baseWidth = Math.max(1, Math.ceil(bbox.width));
  const baseHeight = Math.max(1, Math.ceil(bbox.height));
  const tileRect = options.tileRect || null;
  const maxPixels =
    Number(options.maxPixels) ||
    (options.previewFast ? PREVIEW_MAX_PIXELS : 0);
  const previewScale = maxPixels > 0 ? Math.min(1, computeScaleToFit(baseWidth, baseHeight, maxPixels)) : 1;
  const renderScale = Number(options.renderScaleFactor);
  const scaleFactor = Number.isFinite(renderScale) && renderScale > 0 ? renderScale : previewScale;
  const tileBounds = computeTileBounds(bbox, tileRect, baseWidth, baseHeight);
  const tileWidth = Math.max(1, Math.ceil(tileBounds.width * scaleFactor));
  const tileHeight = Math.max(1, Math.ceil(tileBounds.height * scaleFactor));
  if (debug) {
    console.log("[CWIE][Offscreen] bbox", bbox);
    console.log("[CWIE][Offscreen] canvas", {
      width: tileWidth,
      height: tileHeight,
      scaleFactor,
      tileRect,
    });
  }

  function overrideDevicePixelRatio(tempDpr, debugLog) {
    const w = window;
    const hadOwn = Object.prototype.hasOwnProperty.call(w, "devicePixelRatio");
    const prevDesc = Object.getOwnPropertyDescriptor(w, "devicePixelRatio");
    let defined = false;

    try {
      Object.defineProperty(w, "devicePixelRatio", {
        configurable: true,
        get: () => tempDpr,
      });
      defined = true;
      debugLog?.("dpr.override", { tempDpr });
    } catch (e) {
      debugLog?.("dpr.override.failed", { message: String(e) });
      return () => { };
    }

    return () => {
      if (!defined) return;
      try {
        if (hadOwn) {
          // Restore original property
          if (prevDesc) Object.defineProperty(w, "devicePixelRatio", prevDesc);
        } else {
          // Remove override (was not own property)
          delete w.devicePixelRatio;
        }
        debugLog?.("dpr.restore", { ok: true });
      } catch (e) {
        debugLog?.("dpr.restore.failed", { message: String(e) });
      }
    };
  }

  // [CWIE] DPR-Invariant Fix:
  // Create backing store using UI pixel ratio to match LiteGraph's internal scaling.
  const uiPxRatio = options.uiPxRatio || 1;
  // [CWIE] DOM Canvas Unification: Use LGraphCanvas instance for overlays properties
  const uiCanvasDom = app?.canvas;

  const canvas = document.createElement("canvas");
  const deviceW = Math.ceil(tileWidth * uiPxRatio);
  const deviceH = Math.ceil(tileHeight * uiPxRatio);
  const cssW = tileWidth;
  const cssH = tileHeight;

  canvas.width = deviceW;
  canvas.height = deviceH;
  // Set CSS size so LiteGraph methods that check style size work (if any)
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";

  // [CWIE] Export Modes Logic
  const backgroundMode = options.backgroundMode || "ui";
  const isUiMode = backgroundMode === "ui";
  const includeGrid = options.includeGrid !== false;

  const mediaMode = (options.mediaMode === "force" || options.mediaMode === "off" || options.mediaMode === "auto")
    ? options.mediaMode
    : "off";

  // Patch getBoundingClientRect to allow LiteGraph to compute current scale correctly
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: cssW,
    height: cssH,
    right: cssW,
    bottom: cssH,
    x: 0,
    y: 0,
  });

  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) {
    throw new Error("Offscreen render: 2d context not available.");
  }

  // NOTE: We do NOT scale context here (ctx.scale). LiteGraph handles its own DPI scaling internally
  // if it detects High-DPI canvas. Since we provide a large backing store + GBCR match,
  // LiteGraph should render at high resolution automatically.

  const offscreen = new LGraphCanvasRef(canvas, graph);
  offscreen.canvas = canvas;
  offscreen.ctx = ctx;
  disableCanvasInfoOverlay(offscreen);
  offscreen._cwieScaleFactor = scaleFactor;
  offscreen._cwieTileOffsetX = tileRect?.x || 0;
  offscreen._cwieTileOffsetY = tileRect?.y || 0;

  let _exportOk = false;
  try {
  // Keep resize opt-in; current ComfyUI/LiteGraph can double-scale offscreen canvases.
  if (offscreen.resize && options.enableOffscreenResize) {
    offscreen.resize(deviceW, deviceH);
  }

  copyRenderSettings(app?.canvas, offscreen);
  disableCanvasInfoOverlay(offscreen);
  if (Number.isFinite(options.nodeOpacity)) {
    applyNodeOpacity(offscreen, options.nodeOpacity / 100, debugLog);
  }
  applyBackgroundMode(offscreen, options);
  const useNativeUiBackground = isUiMode && includeGrid;

  if (offscreen && !useNativeUiBackground) {
    offscreen.background_image = null;
    offscreen.show_grid = includeGrid;
    offscreen.render_background = true;
    offscreen.clear_background = true;
    offscreen.always_render_background = false;

    // Draw LiteGraph grid/links over a transparent backing, then composite it
    // over the requested export background below.
    offscreen.clear_background_color = "rgba(0,0,0,0)";
    offscreen.bgcolor = "rgba(0,0,0,0)";
    offscreen.background_color = "rgba(0,0,0,0)";
  }
  configureTransform(offscreen, bbox, padding);
  configureVisibleArea(offscreen, bbox, tileBounds);
  if (debug) {
    console.log("[CWIE][Offscreen] ds", {
      scale: offscreen?.ds?.scale,
      offset: Array.isArray(offscreen?.ds?.offset) ? [...offscreen.ds.offset] : null,
    });
    console.log("[CWIE][Offscreen] visible_area", offscreen?.visible_area);
  }

  if (typeof offscreen.setDirtyCanvas === "function") {
    offscreen.setDirtyCanvas(true);
  } else {
    offscreen.dirty_canvas = true;
    offscreen.dirty_bg = true;
  }
  if ("pause_rendering" in offscreen) {
    offscreen.pause_rendering = true;
  }

  if (document?.fonts?.ready) {
    await document.fonts.ready;
  }

  // Override devicePixelRatio during draw to keep LiteGraph canvas math stable.
  const restoreDpr = overrideDevicePixelRatio(uiPxRatio, debug ? console.log : null);
  try {
    await timeSpan(perfLog, "offscreen.draw", () => offscreen.draw(true, true));
  } finally {
    restoreDpr?.();
  }

  // Composite on a fresh canvas so overlays are not affected by LiteGraph
  // transform/clip state that might linger on the original context.
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = cssW;
  outputCanvas.height = cssH;
  const outputCtx = outputCanvas.getContext("2d", { alpha: true });
  if (!outputCtx) {
    throw new Error("Offscreen render: output 2d context not available.");
  }

  if (!useNativeUiBackground) {
    const bgColor = getExportBackgroundFillColor(options);
    if (bgColor) {
      outputCtx.fillStyle = bgColor;
      outputCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    }
  }

  // Draw high-res HiDPI canvas into the logical-size output canvas.
  outputCtx.drawImage(canvas, 0, 0, deviceW, deviceH, 0, 0, cssW, cssH);

  if (debug) {
    console.log("[CWIE] DprInvariant", {
      uiPxRatio,
      css: [cssW, cssH],
      dev: [deviceW, deviceH],
      scaleFactor,
    });
  }

  if (options.includeDomOverlays !== false) {
    const bounds = {
      left: tileBounds.paddedMinX,
      top: tileBounds.paddedMinY,
      right: tileBounds.paddedMinX + tileBounds.width,
      bottom: tileBounds.paddedMinY + tileBounds.height,
      width: tileBounds.width,
      height: tileBounds.height,
    };
    const nodeRects = collectNodeRects(graph);
    await timeSpan(perfLog, "dom.bg.overlays", () => drawBackgroundImageOverlays({
      exportCtx: outputCtx,
      uiCanvas: uiCanvasDom,
      bounds,
      scale: scaleFactor,
    }));
    await timeSpan(perfLog, "dom.image.overlays", () => drawImageOverlays({
      exportCtx: outputCtx,
      uiCanvas: uiCanvasDom,
      bounds,
      scale: scaleFactor,
      nodeRects,
      debugLog,
      selectedNodeIds: options.selectedNodeIds,
      renderFilter: options.renderFilter || "all",
    }));
    await timeSpan(perfLog, "dom.video.overlays", async () => {
      const drawnVideoNodeIds = drawVideoOverlays({
        exportCtx: outputCtx,
        uiCanvas: uiCanvasDom,
        graph,
        bounds,
        scale: scaleFactor,
        nodeRects,
        debugLog,
        selectedNodeIds: options.selectedNodeIds,
        renderFilter: options.renderFilter || "all",
      });
      await drawVideoThumbnails({
        exportCtx: outputCtx,
        graph,
        nodeRects,
        bounds,
        scale: scaleFactor,
        debugLog,
        skipNodeIds: drawnVideoNodeIds,
        drawPlaceholderOnMiss: false,
        selectedNodeIds: options.selectedNodeIds,
        renderFilter: options.renderFilter || "all",
      });
    });
    await timeSpan(perfLog, "dom.vhs.overlays", () => drawVhsVideoOverlays({
      exportCtx: outputCtx,
      uiCanvas: uiCanvasDom,
      bounds,
      scale: scaleFactor,
      debugLog,
      nodeRects,
      selectedNodeIds: options.selectedNodeIds,
      renderFilter: options.renderFilter || "all",
    }));
    const domWidgetCoveredNodeIds = await timeSpan(perfLog, "dom.widget.overlays", () => drawDomWidgetOverlays({
      exportCtx: outputCtx,
      uiCanvas: uiCanvasDom,
      bounds,
      scale: scaleFactor,
      nodeRects,
      debugLog,
      skipWidgetCapture: "media-only",
      selectedNodeIds: options.selectedNodeIds,
      renderFilter: options.renderFilter || "all",
    }));
    await timeSpan(perfLog, "dom.text.overlays", () => drawTextOverlays({
      exportCtx: outputCtx,
      uiCanvas: uiCanvasDom,
      graph,
      bounds,
      scale: scaleFactor,
      nodeRects,
      skipNodeIds: domWidgetCoveredNodeIds,
      debugLog,
      selectedNodeIds: options.selectedNodeIds,
      renderFilter: options.renderFilter || "all",
    }));
  } else {
    // Standard mode (Legacy Capture fallback logic)
    const bounds = {
      left: tileBounds.paddedMinX,
      top: tileBounds.paddedMinY,
      right: tileBounds.paddedMinX + tileBounds.width,
      bottom: tileBounds.paddedMinY + tileBounds.height,
      width: tileBounds.width,
      height: tileBounds.height,
    };
    const nodeRects = collectNodeRects(graph);

    // Draw text overlays on a fresh canvas to avoid any lingering clip state.
    // Ensure output ctx has a clean state before compositing overlays.
    if (outputCtx?.setTransform) {
      outputCtx.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (outputCtx) {
      outputCtx.globalAlpha = 1;
      outputCtx.globalCompositeOperation = "source-over";
      outputCtx.shadowColor = "transparent";
      outputCtx.shadowBlur = 0;
    }

    const textOverlay = document.createElement("canvas");
    textOverlay.width = canvas.width;
    textOverlay.height = canvas.height;
    const textCtx = textOverlay.getContext("2d", { alpha: true });
    if (textCtx && !options.skipTextFallback) {
      textCtx.setTransform(1, 0, 0, 1, 0, 0);
      textCtx.globalAlpha = 1;
      await timeSpan(perfLog, "fallback.text", () => drawWidgetTextFallback({
        exportCtx: textCtx,
        graph,
        bounds,
        scale: scaleFactor,
        coveredNodeIds: null,
        debugLog,
      }));
      outputCtx.drawImage(textOverlay, 0, 0, deviceW, deviceH, 0, 0, cssW, cssH);
    }
    if (mediaMode === "force") {
      await timeSpan(perfLog, "fallback.image.thumbs", () => drawImageThumbnails({
        exportCtx: outputCtx,
        graph,
        nodeRects,
        bounds,
        scale: scaleFactor,
        debugLog,
      }));

      await timeSpan(perfLog, "fallback.video.thumbs", () => drawVideoThumbnails({
        exportCtx: outputCtx,
        graph,
        nodeRects,
        bounds,
        scale: scaleFactor,
        debugLog,
        isPreview: !!options.previewFast,
      }));
    }
  }

  perfLog?.("done");
  _exportOk = true;
  return {
    canvas: outputCanvas,
    ctx: outputCtx,
    bbox,
    scaleFactor,
    tileRect,
    cleanup: () => {
      if (debug) {
        console.log("[CWIE][Offscreen] cleanup");
      }
      safeCleanup(offscreen, graph);
    },
  };
  } finally {
    if (!_exportOk) {
      safeCleanup(offscreen, graph);
    }
  }
}

