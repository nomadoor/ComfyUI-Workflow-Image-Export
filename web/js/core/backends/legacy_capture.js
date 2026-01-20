import { app } from "/scripts/app.js";

function collectGraphBounds(graph, debugLog) {
  const rects = [];
  const nodes = graph?._nodes || graph?.nodes || [];
  const groups = graph?._groups || graph?.groups || [];

  nodes.forEach((node, index) => {
    if (!node) return;
    const bounding =
      (typeof node.getBounding === "function" && node.getBounding()) ||
      node.bounding ||
      node._bounding;
    if (Array.isArray(bounding) && bounding.length >= 4) {
      rects.push({
        left: bounding[0],
        top: bounding[1],
        right: bounding[0] + bounding[2],
        bottom: bounding[1] + bounding[3],
      });
      debugLog?.("node.bounding", {
        index,
        id: node.id,
        title: node.title,
        bounding: [...bounding],
      });
      return;
    }
    const pos = node.pos || node._pos || [0, 0];
    const size = node.size || node._size || [140, 30];
    if (!pos || pos.length < 2 || !size || size.length < 2) return;
    rects.push({
      left: pos[0],
      top: pos[1],
      right: pos[0] + size[0],
      bottom: pos[1] + size[1],
    });
    debugLog?.("node.pos", {
      index,
      id: node.id,
      title: node.title,
      pos: [...pos],
      size: [...size],
    });
  });

  groups.forEach((group, index) => {
    if (!group) return;
    const pos = group.pos || group._pos || [0, 0];
    const size = group.size || group._size || [140, 80];
    if (!pos || pos.length < 2 || !size || size.length < 2) return;
    rects.push({
      left: pos[0],
      top: pos[1],
      right: pos[0] + size[0],
      bottom: pos[1] + size[1],
    });
    debugLog?.("group.pos", {
      index,
      title: group.title,
      pos: [...pos],
      size: [...size],
    });
  });

  if (!rects.length) {
    return null;
  }

  let left = rects[0].left;
  let top = rects[0].top;
  let right = rects[0].right;
  let bottom = rects[0].bottom;
  for (let i = 1; i < rects.length; i += 1) {
    const rect = rects[i];
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  const bounds = { left, top, right, bottom, width: right - left, height: bottom - top };
  debugLog?.("bounds.raw", bounds);
  return bounds;
}

function applyPadding(bounds, padding, debugLog) {
  if (!bounds) return null;
  const pad = Number.isFinite(padding) ? padding : 0;
  const padded = {
    left: bounds.left - pad,
    top: bounds.top - pad,
    right: bounds.right + pad,
    bottom: bounds.bottom + pad,
    width: bounds.width + pad * 2,
    height: bounds.height + pad * 2,
  };
  debugLog?.("bounds.padded", padded);
  return padded;
}

function toBlobAsync(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to create blob."));
        return;
      }
      resolve(blob);
    }, type);
  });
}

function ensure2DContext(canvas) {
  return canvas.getContext("2d", { alpha: true });
}

function ensureBgCanvas(offscreen, width, height) {
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

function copyRenderSettings(fromCanvas, toCanvas) {
  [
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
    "high_quality",
  ].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(fromCanvas, key)) {
      toCanvas[key] = fromCanvas[key];
    }
  });
}

function applyBackgroundMode(offscreen, options) {
  const mode = options?.background || "ui";
  if (mode === "ui") return "ui";
  offscreen.render_background = false;
  offscreen.clear_background = false;
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
    offscreen.clear_background_color = null;
    return mode;
  }
  return "ui";
}

function configureTransform(offscreen, bounds, viewportW, viewportH, scale, debugLog) {
  if (offscreen.ds) {
    offscreen.ds.scale = scale;
    if (!Array.isArray(offscreen.ds.offset)) {
      offscreen.ds.offset = [0, 0];
    }
    offscreen.ds.offset[0] = -bounds.left * scale;
    offscreen.ds.offset[1] = -bounds.top * scale;
    debugLog?.("ds", {
      scale: offscreen.ds.scale,
      offset: Array.isArray(offscreen.ds.offset) ? [...offscreen.ds.offset] : null,
    });
  }
  const visibleArea = [bounds.left, bounds.top, bounds.width, bounds.height];
  const viewport = [0, 0, viewportW, viewportH];
  offscreen.visible_area = visibleArea;
  offscreen.viewport = viewport;
  offscreen.last_drawn_area = visibleArea;
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

async function drawOffscreen(offscreen) {
  offscreen.draw(true, true);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  offscreen.draw(true, true);
}

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
        console.log(`[CWIE][Legacy][dbg] ${label}`, payload);
        try {
          console.log(`[CWIE][Legacy][dbg:raw] ${label}`, JSON.stringify(payload));
        } catch (e) {
          console.log(`[CWIE][Legacy][dbg:raw] ${label}`, String(payload));
        }
      }
    : null;

  const graphBounds = collectGraphBounds(graph, debugLog);
  const bounds = applyPadding(graphBounds, padding, debugLog);
  if (!bounds) {
    throw new Error("Legacy capture: bounds not available.");
  }

  const srcW = Math.max(1, Math.ceil(bounds.width));
  const srcH = Math.max(1, Math.ceil(bounds.height));
  const { scale, outW: width, outH: height } = computeExportScale(srcW, srcH, options, debugLog);
  debugLog?.("export.size", { width, height });

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = width;
  exportCanvas.height = height;
  const exportCtx = ensure2DContext(exportCanvas);
  if (!exportCtx) {
    throw new Error("Legacy capture: export context missing.");
  }

  const LGraphCanvas = window?.LGraphCanvas || window?.LiteGraph?.LGraphCanvas;
  if (!LGraphCanvas) {
    throw new Error("Legacy capture: LGraphCanvas not available.");
  }

  const offscreen = new LGraphCanvas(exportCanvas, graph);
  offscreen.canvas = exportCanvas;
  offscreen.ctx = exportCtx;

  copyRenderSettings(uiCanvas, offscreen);
  const mode = applyBackgroundMode(offscreen, options);
  offscreen.render_canvas_border = false;
  if (typeof offscreen.resize === "function") {
    offscreen.resize(width, height);
    debugLog?.("offscreen.resize", { width, height });
  }
  ensureBgCanvas(offscreen, width, height);
  configureTransform(offscreen, bounds, width, height, scale, debugLog);

  if (mode === "transparent") {
    exportCtx.clearRect(0, 0, width, height);
    if (offscreen.bgctx) {
      offscreen.bgctx.clearRect(0, 0, width, height);
    }
  } else if (mode === "solid") {
    const solid = options?.solidColor || "#1f1f1f";
    exportCtx.fillStyle = solid;
    exportCtx.fillRect(0, 0, width, height);
    if (offscreen.bgctx) {
      offscreen.bgctx.fillStyle = solid;
      offscreen.bgctx.fillRect(0, 0, width, height);
    }
  }

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
  }

  await drawOffscreen(offscreen);

  const blob = await toBlobAsync(exportCanvas, mime);
  return {
    type: "raster",
    mime,
    blob,
    width,
    height,
  };
}