import { app } from "/scripts/app.js";

function collectNodeRects(graph, debugLog) {
  const rects = [];
  const nodes = graph?._nodes || graph?.nodes || [];

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
        id: node.id,
        title: node.title,
        type: node.type,
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
      id: node.id,
      title: node.title,
      type: node.type,
    });
    debugLog?.("node.pos", {
      index,
      id: node.id,
      title: node.title,
      pos: [...pos],
      size: [...size],
    });
  });

  return rects;
}

function collectGraphBounds(graph, debugLog) {
  const rects = collectNodeRects(graph, debugLog);
  const groups = graph?._groups || graph?.groups || [];

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
    return { bounds: null, nodeRects: [] };
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
  return { bounds, nodeRects: rects };
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

function applyBackgroundFill(mode, width, height, exportCtx, bgctx, solidColor) {
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
  const applyArea = (target, values) => {
    if (target && typeof target.set === "function") {
      target.set(values);
      return target;
    }
    return new Float32Array(values);
  };

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

async function drawOffscreen(offscreen, options = {}) {
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

function collectVideoElementsFromDom() {
  const selectors = [
    ".dom-widget video",
    "video.VHS_loopedvideo",
    "video",
  ];
  const elements = new Set();
  for (const selector of selectors) {
    for (const node of document.querySelectorAll(selector)) {
      if (node instanceof HTMLVideoElement) {
        elements.add(node);
      }
    }
  }
  return Array.from(elements);
}

function findNodeForPoint(nodeRects, x, y) {
  if (!nodeRects?.length) return null;
  for (let i = 0; i < nodeRects.length; i += 1) {
    const rect = nodeRects[i];
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return rect;
    }
  }
  return null;
}

function isVideoNodeTitle(title, type) {
  const text = `${title || ""} ${type || ""}`.toLowerCase();
  return text.includes("video");
}

function drawVideoOverlays({ exportCtx, uiCanvas, bounds, scale, nodeRects, debugLog }) {
  const canvasEl = uiCanvas?.canvas;
  const ds = uiCanvas?.ds;
  if (!canvasEl || !ds) return;

  const rect = canvasEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const scaleX = canvasEl.width / rect.width;
  const scaleY = canvasEl.height / rect.height;

  const videos = collectVideoElementsFromDom();
  if (!videos.length) return;

  const invScale = 1 / ds.scale;

  for (const video of videos) {
    if (video.readyState < 2) continue;
    const vrect = video.getBoundingClientRect();
    if (!vrect.width || !vrect.height) continue;

    // DOM rects are CSS pixels relative to viewport.
    const sx = (vrect.left - rect.left) * scaleX;
    const sy = (vrect.top - rect.top) * scaleY;
    const sw = vrect.width * scaleX;
    const sh = vrect.height * scaleY;

    const graphX = sx * invScale - ds.offset[0];
    const graphY = sy * invScale - ds.offset[1];
    const graphW = sw * invScale;
    const graphH = sh * invScale;

    const node = findNodeForPoint(nodeRects, graphX + graphW * 0.5, graphY + graphH * 0.5);
    if (!node || !isVideoNodeTitle(node.title, node.type)) {
      debugLog?.("video.overlay.skip", {
        reason: "non-video-node",
        node: node
          ? { id: node.id, title: node.title, type: node.type }
          : null,
      });
      continue;
    }

    const x = (graphX - bounds.left) * scale;
    const y = (graphY - bounds.top) * scale;
    const w = graphW * scale;
    const h = graphH * scale;

    try {
      exportCtx.drawImage(video, x, y, w, h);
      debugLog?.("video.overlay", {
        x,
        y,
        w,
        h,
        node: { id: node.id, title: node.title, type: node.type },
        rect: { left: vrect.left, top: vrect.top, width: vrect.width, height: vrect.height },
      });
    } catch (error) {
      debugLog?.("video.overlay.error", { message: error?.message || String(error) });
    }
  }
}
function resolveNodeTitleFromElement(element) {
  const nodeRoot = element.closest(
    ".comfy-node, .litegraph-node, .graph-node, .node, [data-node-id], [data-nodeid]"
  );
  if (!nodeRoot) return "";
  const titleEl =
    nodeRoot.querySelector(".title, .node-title, .node-header, .litegraph-title, header") ||
    nodeRoot.querySelector("[title]");
  const title = titleEl?.textContent || titleEl?.getAttribute?.("title") || "";
  return String(title).trim();
}

function collectDomMediaElements() {
  const selectors = [
    ".dom-widget video",
    ".dom-widget canvas",
    ".dom-widget img",
  ];
  const elements = [];
  for (const selector of selectors) {
    for (const node of document.querySelectorAll(selector)) {
      if (
        node instanceof HTMLVideoElement ||
        node instanceof HTMLCanvasElement ||
        node instanceof HTMLImageElement
      ) {
        elements.push(node);
      }
    }
  }
  return elements;
}

function logDomMedia(debugLog, uiCanvas) {
  if (!debugLog) return;
  const elements = collectDomMediaElements();
  const canvasEl = uiCanvas?.canvas;
  const rect = canvasEl?.getBoundingClientRect?.();
  debugLog("dom.media.count", { count: elements.length });
  if (rect) {
    debugLog("ui.canvas.rect", {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }
  elements.slice(0, 50).forEach((el, index) => {
    const r = el.getBoundingClientRect();
    debugLog("dom.media.item", {
      index,
      type: el.tagName?.toLowerCase?.() || "unknown",
      title: resolveNodeTitleFromElement(el),
      rect: {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
      },
    });
  });
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

  const { bounds: graphBounds, nodeRects } = collectGraphBounds(graph, debugLog);
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

  applyBackgroundFill(
    mode,
    width,
    height,
    exportCtx,
    offscreen.bgctx,
    options?.solidColor
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

  await drawOffscreen(offscreen, {
    mode,
    width,
    height,
    exportCtx,
    bgctx: offscreen.bgctx,
    solidColor: options?.solidColor,
    resetTransform: () => configureTransform(offscreen, bounds, width, height, scale, debugLog),
  });
  drawVideoOverlays({ exportCtx, uiCanvas, bounds, scale, nodeRects, debugLog });

  const blob = await toBlobAsync(exportCanvas, mime);
  return {
    type: "raster",
    mime,
    blob,
    width,
    height,
  };
}
