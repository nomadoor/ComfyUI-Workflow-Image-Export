import { resolveUiBackgroundColor } from "../../export/background_modes.mjs";
import { createExportDragAndScale } from "../graph_transform.mjs";

export function ensure2DContext(canvas) {
  return canvas.getContext("2d", { alpha: true });
}

export function setCanvasPixelSize(canvas, width, height) {
  if (!canvas) return;
  if (canvas.width !== width) {
    canvas.width = width;
  }
  if (canvas.height !== height) {
    canvas.height = height;
  }
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
}

export function syncOffscreenCanvasSize(offscreen, canvas, width, height) {
  setCanvasPixelSize(canvas, width, height);
  const ctx = ensure2DContext(canvas);
  if (offscreen) {
    offscreen.canvas = canvas;
    offscreen.ctx = ctx;
  }
  return ctx;
}

export function overrideDevicePixelRatio(tempDpr, debugLog) {
  const w = window;
  const hadOwn = Object.prototype.hasOwnProperty.call(w, "devicePixelRatio");
  const prevDesc = Object.getOwnPropertyDescriptor(w, "devicePixelRatio");
  let active = false;

  try {
    Object.defineProperty(w, "devicePixelRatio", {
      configurable: true,
      get: () => tempDpr,
    });
    active = true;
    debugLog?.("dpr.override", { tempDpr });
  } catch (error) {
    debugLog?.("dpr.override.failed", { message: String(error) });
  }

  return () => {
    if (!active) return;
    try {
      if (hadOwn && prevDesc) {
        Object.defineProperty(w, "devicePixelRatio", prevDesc);
      } else {
        delete w.devicePixelRatio;
      }
      debugLog?.("dpr.restore", { ok: true });
    } catch (error) {
      debugLog?.("dpr.restore.failed", { message: String(error) });
    }
  };
}

export function ensureBgCanvas(offscreen, width, height) {
  // NOTE: call this AFTER offscreen.resize(), because resize may recreate bgcanvas.
  if (!offscreen.bgcanvas) {
    offscreen.bgcanvas = document.createElement("canvas");
  }
  if (offscreen.bgcanvas.width !== width) {
    offscreen.bgcanvas.width = width;
  }
  if (offscreen.bgcanvas.height !== height) {
    offscreen.bgcanvas.height = height;
  }
  const bgctx = offscreen.bgcanvas.getContext("2d", { alpha: true });
  if (bgctx) {
    offscreen.bgctx = bgctx;
  }
}

export function applyBackgroundFill(mode, width, height, exportCtx, bgctx, solidColor) {
  if (!exportCtx || !width || !height) return;
  if (mode === "transparent") {
    exportCtx.clearRect(0, 0, width, height);
    if (bgctx) bgctx.clearRect(0, 0, width, height);
    return;
  }
  if (mode === "solid") {
    const solid = solidColor || "#1f1f1f";
    exportCtx.fillStyle = solid;
    exportCtx.fillRect(0, 0, width, height);
    if (bgctx) {
      bgctx.fillStyle = solid;
      bgctx.fillRect(0, 0, width, height);
    }
  }
  if (mode === "ui") {
    const uiColor = resolveUiBackgroundColor("#1f1f1f");
    exportCtx.fillStyle = uiColor;
    exportCtx.fillRect(0, 0, width, height);
    if (bgctx) {
      bgctx.fillStyle = uiColor;
      bgctx.fillRect(0, 0, width, height);
    }
  }
}

export function copyRenderSettings(fromCanvas, toCanvas) {
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

export function disableCanvasInfoOverlay(canvas) {
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

export function createPerfLogger(enabled) {
  if (!enabled) return null;
  const start = performance.now?.() ?? Date.now();
  let last = start;
  return (label, payload = null) => {
    const now = performance.now?.() ?? Date.now();
    const entry = {
      stepMs: Math.round((now - last) * 10) / 10,
      totalMs: Math.round((now - start) * 10) / 10,
      ...(payload || {}),
    };
    last = now;
    console.log(`[CWIE][Legacy][perf] ${label}`, entry);
  };
}

export function measurePerf(perfLog, label, fn) {
  if (!perfLog) return fn();
  const start = performance.now?.() ?? Date.now();
  try {
    return fn();
  } finally {
    const now = performance.now?.() ?? Date.now();
    perfLog(label, { durationMs: Math.round((now - start) * 10) / 10 });
  }
}

export async function measurePerfAsync(perfLog, label, fn) {
  if (!perfLog) return fn();
  const start = performance.now?.() ?? Date.now();
  try {
    return await fn();
  } finally {
    const now = performance.now?.() ?? Date.now();
    perfLog(label, { durationMs: Math.round((now - start) * 10) / 10 });
  }
}

export function forceExportQuality(offscreen) {
  const setProp = (key, value) => {
    try {
      const desc = Object.getOwnPropertyDescriptor(offscreen, key);
      if (desc && desc.set) {
        offscreen[key] = value;
        return;
      }
      if (!desc || desc.writable) {
        offscreen[key] = value;
      }
    } catch (_) {
      // Some properties are getter-only in newer LiteGraph builds.
    }
  };

  if ("high_quality" in offscreen) {
    setProp("high_quality", true);
  }
  if ("low_quality" in offscreen) {
    setProp("low_quality", false);
  }
  if ("render_shadows" in offscreen) {
    setProp("render_shadows", true);
  }
  if ("disable_rendering" in offscreen) {
    setProp("disable_rendering", false);
  }
}

export function applyBackgroundMode(offscreen, options) {
  const mode = options?.background || "ui";
  if (offscreen && "_pattern" in offscreen) {
    offscreen._pattern = null;
  }
  if (mode === "ui") {
    const uiColor = resolveUiBackgroundColor("#1f1f1f");
    offscreen.render_background = true;
    offscreen.clear_background = true;
    offscreen.always_render_background = true;
    offscreen.bgcolor = uiColor;
    offscreen.background_color = uiColor;
    offscreen.clear_background_color = uiColor;
    return "ui";
  }
  // LiteGraph draws links on the background pass in some frontend builds.
  // Keep that pass enabled, but replace the native canvas/grid background.
  offscreen.render_background = true;
  offscreen.clear_background = true;
  offscreen.always_render_background = true;
  offscreen.background_image = null;
  offscreen.show_grid = false;
  if (mode === "solid") {
    const solid = options?.solidColor || "#1f1f1f";
    offscreen.bgcolor = solid;
    offscreen.background_color = solid;
    offscreen.clear_background_color = solid;
    return mode;
  }
  if (mode === "transparent") {
    offscreen.bgcolor = "rgba(0, 0, 0, 0)";
    offscreen.background_color = "rgba(0, 0, 0, 0)";
    offscreen.clear_background_color = "rgba(0, 0, 0, 0)";
    return mode;
  }
  return "ui";
}

export function configureTransform(offscreen, bounds, viewportW, viewportH, scale, debugLog) {
  const applyArea = (target, values) => {
    if (target && typeof target.set === "function") {
      target.set(values);
      return target;
    }
    return new Float32Array(values);
  };

  if (offscreen.ds) {
    const transform = createExportDragAndScale(bounds, scale);
    offscreen.ds.scale = transform.scale;
    if (!Array.isArray(offscreen.ds.offset)) {
      offscreen.ds.offset = [0, 0];
    }
    offscreen.ds.offset[0] = transform.offset[0];
    offscreen.ds.offset[1] = transform.offset[1];
    debugLog?.("ds", {
      scale: offscreen.ds.scale,
      offset: Array.isArray(offscreen.ds.offset) ? [...offscreen.ds.offset] : null,
    });
  }
  const visibleArea = [bounds.left, bounds.top, bounds.width, bounds.height];
  const viewport = [0, 0, viewportW, viewportH];
  offscreen.visible_area = applyArea(offscreen.visible_area, visibleArea);
  offscreen.viewport = applyArea(offscreen.viewport, viewport);
  offscreen.last_drawn_area = applyArea(offscreen.last_drawn_area, visibleArea);
  debugLog?.("visible_area", {
    visible_area: [...visibleArea],
    viewport: [...viewport],
    last_drawn_area: [...visibleArea],
  });
  if (typeof offscreen.setDirtyCanvas === "function") {
    offscreen.setDirtyCanvas(true);
  } else {
    offscreen.dirty_canvas = true;
    offscreen.dirty_bg = true;
  }
}

export async function drawOffscreen(offscreen, options = {}) {
  offscreen.draw(true, true);
  await new Promise((resolve) => requestAnimationFrame(resolve));

  if (typeof options.resetTransform === "function") {
    options.resetTransform();
  }

  applyBackgroundFill(
    options.mode,
    options.width,
    options.height,
    options.exportCtx,
    options.bgctx,
    options.solidColor
  );

  offscreen.draw(true, true);
}
