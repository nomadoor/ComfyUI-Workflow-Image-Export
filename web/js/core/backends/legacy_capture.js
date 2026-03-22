import { app } from "/scripts/app.js";
import {
  collectDomMediaElements,
  collectDomWidgetContainers,
  collectImageElementsFromDom,
  collectTextElementsFromDom,
  collectVideoElementsFromDom,
  diagnoseDomElement,
  getDomElementGraphRect,
  getNodeIdFromElement,
  resolveNodeIdForGraphRect,
} from "../overlays/dom_utils.js";
import { toBlobAsync } from "../utils.js";

export function collectNodeRects(graph, debugLog) {
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

function filterNodeRectsBySelected(nodeRects, selectedNodeIds) {
  const ids = Array.isArray(selectedNodeIds)
    ? new Set(selectedNodeIds.map((id) => Number(id)).filter(Number.isFinite))
    : null;
  if (!ids?.size) return [];
  return (nodeRects || []).filter((rect) => rect && Number.isFinite(rect.id) && ids.has(rect.id));
}

function boundsFromNodeRects(nodeRects, debugLog) {
  if (!nodeRects?.length) return null;
  let left = nodeRects[0].left;
  let top = nodeRects[0].top;
  let right = nodeRects[0].right;
  let bottom = nodeRects[0].bottom;
  for (let i = 1; i < nodeRects.length; i += 1) {
    const rect = nodeRects[i];
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  const bounds = { left, top, right, bottom, width: right - left, height: bottom - top };
  debugLog?.("bounds.selected.raw", bounds);
  return bounds;
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
  // Exhaustive list of known LiteGraph/ComfyUI rendering properties
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

  // Also include any instance property that looks like a rendering setting
  // The user log revealed several 'default_' prefixed properties in ComfyUI
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

function forceExportQuality(offscreen) {
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

function normalizeSelectedNodeIds(selectedNodeIds) {
  if (selectedNodeIds instanceof Set) return selectedNodeIds;
  if (!Array.isArray(selectedNodeIds)) return null;
  const ids = new Set(selectedNodeIds.map((id) => Number(id)).filter(Number.isFinite));
  return ids.size ? ids : null;
}

function shouldRenderResolvedNode(nodeId, selectedNodeIds, mode) {
  if (!mode || mode === "all") return true;
  if (mode === "none") return false;
  const ids = normalizeSelectedNodeIds(selectedNodeIds);
  if (!ids?.size || !Number.isFinite(nodeId)) return false;
  const isSelected = ids.has(Number(nodeId));
  if (mode === "selected") return isSelected;
  if (mode === "unselected") return !isSelected;
  return true;
}

function isVideoNodeTitle(title, type) {
  const text = `${title || ""} ${type || ""}`.toLowerCase();
  return text.includes("video");
}

function isVhsVideoElement(video) {
  if (!video) return false;
  if (video.classList?.contains("VHS_loopedvideo")) return true;
  const src = `${video.currentSrc || ""} ${video.src || ""}`.toLowerCase();
  return src.includes("/api/vhs/viewvideo") || src.includes("viewvideo");
}

export function drawVideoOverlays({
  exportCtx,
  uiCanvas,
  bounds,
  scale,
  nodeRects,
  debugLog,
  selectedNodeIds = null,
  renderFilter = "all",
}) {
  const selectedIdSet = normalizeSelectedNodeIds(selectedNodeIds);
  const canvasEl = uiCanvas?.canvas;
  const ds = uiCanvas?.ds;
  if (!canvasEl || !ds) return;

  const rect = canvasEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const videos = collectVideoElementsFromDom(uiCanvas, { debugLog });
  if (!videos.length) return;

  // ds.scale is in CSS-pixels/graph-unit (not device-pixels/graph-unit).
  // invScale converts a CSS pixel offset to graph units.
  const invScale = 1 / ds.scale;
  const standardVideos = videos.filter((video) => !isVhsVideoElement(video));

  for (const video of standardVideos) {
    if (video.readyState < 1) {
      debugLog?.("diag.draw.video", diagnoseDomElement(video, uiCanvas, {
        stage: "draw",
        reason: "readyState<1",
        readyState: video.readyState,
        kind: "video",
      }));
      continue;
    }
    const vrect = video.getBoundingClientRect();
    if (!vrect.width || !vrect.height) continue;

    if (
      vrect.right < rect.left - 1 ||
      vrect.left > rect.right + 1 ||
      vrect.bottom < rect.top - 1 ||
      vrect.top > rect.bottom + 1
    ) {
      debugLog?.("diag.draw.video", diagnoseDomElement(video, uiCanvas, {
        stage: "draw",
        reason: "off-canvas-viewport",
        readyState: video.readyState,
        kind: "video",
      }));
      continue;
    }

    const sx = vrect.left - rect.left;
    const sy = vrect.top - rect.top;
    const sw = vrect.width;
    const sh = vrect.height;

    const graphX = sx * invScale - ds.offset[0];
    const graphY = sy * invScale - ds.offset[1];
    const graphW = sw * invScale;
    const graphH = sh * invScale;

    const matchedNode = findNodeForPoint(nodeRects, graphX + graphW * 0.5, graphY + graphH * 0.5);
    if (!matchedNode || !isVideoNodeTitle(matchedNode.title, matchedNode.type)) {
      debugLog?.("diag.draw.video", diagnoseDomElement(video, uiCanvas, {
        stage: "draw",
        reason: !matchedNode ? "no-node-at-position" : "non-video-node",
        readyState: video.readyState,
        graphRect: { x: graphX, y: graphY, w: graphW, h: graphH },
        matchedNode: matchedNode
          ? { id: matchedNode.id, title: matchedNode.title, type: matchedNode.type }
          : null,
        kind: "video",
      }));
      continue;
    }
    if (!shouldRenderResolvedNode(matchedNode.id, selectedIdSet, renderFilter)) {
      continue;
    }

    const x = (graphX - bounds.left) * scale;
    const y = (graphY - bounds.top) * scale;
    const w = graphW * scale;
    const h = graphH * scale;

    try {
      exportCtx.drawImage(video, x, y, w, h);
      debugLog?.("diag.draw.video", diagnoseDomElement(video, uiCanvas, {
        stage: "draw",
        reason: "drawn",
        readyState: video.readyState,
        graphRect: { x: graphX, y: graphY, w: graphW, h: graphH },
        exportRect: { x, y, w, h },
        matchedNode: { id: matchedNode.id, title: matchedNode.title, type: matchedNode.type },
        kind: "video",
      }));
    } catch (error) {
      debugLog?.("diag.draw.video", diagnoseDomElement(video, uiCanvas, {
        stage: "draw",
        reason: "drawImage-error",
        readyState: video.readyState,
        message: error?.message || String(error),
        kind: "video",
      }));
    }
  }
}

export function drawVhsVideoOverlays({
  exportCtx,
  uiCanvas,
  bounds,
  scale,
  debugLog,
  nodeRects = null,
  selectedNodeIds = null,
  renderFilter = "all",
}) {
  const selectedIdSet = normalizeSelectedNodeIds(selectedNodeIds);
  const canvasEl = uiCanvas?.canvas;
  const ds = uiCanvas?.ds;
  if (!canvasEl || !ds) return;

  const rect = canvasEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const videos = collectVideoElementsFromDom(uiCanvas, { debugLog }).filter((video) =>
    isVhsVideoElement(video)
  );
  if (!videos.length) return;

  // ds.scale is in CSS-pixels/graph-unit (not device-pixels/graph-unit).
  // invScale converts a CSS pixel offset to graph units.
  const invScale = 1 / ds.scale;

  for (const video of videos) {
    if (video.readyState < 1) {
      debugLog?.("diag.draw.vhs", diagnoseDomElement(video, uiCanvas, {
        stage: "draw",
        reason: "readyState<1",
        readyState: video.readyState,
        kind: "vhs",
      }));
      continue;
    }
    const vrect = video.getBoundingClientRect();
    if (!vrect.width || !vrect.height) continue;

    if (
      vrect.right < rect.left - 1 ||
      vrect.left > rect.right + 1 ||
      vrect.bottom < rect.top - 1 ||
      vrect.top > rect.bottom + 1
    ) {
      debugLog?.("diag.draw.vhs", diagnoseDomElement(video, uiCanvas, {
        stage: "draw",
        reason: "off-canvas-viewport",
        readyState: video.readyState,
        kind: "vhs",
      }));
      continue;
    }

    const sx = vrect.left - rect.left;
    const sy = vrect.top - rect.top;
    const sw = vrect.width;
    const sh = vrect.height;

    const graphX = sx * invScale - ds.offset[0];
    const graphY = sy * invScale - ds.offset[1];
    const graphW = sw * invScale;
    const graphH = sh * invScale;
    const matchedNode = findNodeForPoint(nodeRects, graphX + graphW * 0.5, graphY + graphH * 0.5);
    if (!shouldRenderResolvedNode(matchedNode?.id, selectedIdSet, renderFilter)) {
      continue;
    }

    const x = (graphX - bounds.left) * scale;
    const y = (graphY - bounds.top) * scale;
    const w = graphW * scale;
    const h = graphH * scale;

    try {
      exportCtx.drawImage(video, x, y, w, h);
      debugLog?.("diag.draw.vhs", diagnoseDomElement(video, uiCanvas, {
        stage: "draw",
        reason: "drawn",
        readyState: video.readyState,
        graphRect: { x: graphX, y: graphY, w: graphW, h: graphH },
        exportRect: { x, y, w, h },
        kind: "vhs",
      }));
    } catch (error) {
      debugLog?.("diag.draw.vhs", diagnoseDomElement(video, uiCanvas, {
        stage: "draw",
        reason: "drawImage-error",
        readyState: video.readyState,
        message: error?.message || String(error),
        kind: "vhs",
      }));
    }
  }
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = Infinity) {
  const lines = [];
  const rawLines = text.split("\n");

  const pushWrappedWord = (word, currentLine) => {
    let line = currentLine;
    for (const ch of word) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    return line;
  };

  for (const raw of rawLines) {
    if (!raw) {
      lines.push("");
      continue;
    }

    const words = raw.split(" ");
    let line = "";
    for (const word of words) {
      if (!word) {
        const spaced = line + " ";
        if (ctx.measureText(spaced).width > maxWidth && line) {
          lines.push(line);
          line = "";
        } else {
          line = spaced;
        }
        continue;
      }

      const withSpace = line ? `${line} ${word}` : word;
      if (ctx.measureText(withSpace).width <= maxWidth) {
        line = withSpace;
        continue;
      }

      if (line) {
        lines.push(line);
        line = "";
      }

      if (ctx.measureText(word).width <= maxWidth) {
        line = word;
      } else {
        line = pushWrappedWord(word, line);
      }
    }
    lines.push(line);
  }

  let offsetY = y;
  for (const line of lines) {
    if (offsetY > y + lineHeight * (maxLines - 1) + 0.5) {
      break;
    }
    ctx.fillText(line, x, offsetY);
    offsetY += lineHeight;
  }
}

/**
 * Walk up the DOM to find the first non-transparent background-color.
 * Falls back to null if nothing opaque is found before <body>.
 */
function getEffectiveBackground(el) {
  let node = el;
  while (node && node !== document.body) {
    const bg = window.getComputedStyle(node).backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
      return bg;
    }
    node = node.parentElement;
  }
  return null;
}

function resolveOpaqueBackground(...elements) {
  for (const el of elements) {
    const bg = el ? getEffectiveBackground(el) : null;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
      return bg;
    }
  }
  const rootStyle = window.getComputedStyle(document.documentElement);
  const vars = [
    "--comfy-input-bg",
    "--comfy-menu-bg",
    "--p-surface-800",
    "--p-content-background",
  ];
  for (const name of vars) {
    const value = rootStyle.getPropertyValue(name)?.trim();
    if (value && value !== "transparent") {
      return value;
    }
  }
  return "rgb(32, 32, 36)";
}

function isEffectivelyVisibleElement(el) {
  if (!(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  if (!style) return true;
  if (style.display === "none") return false;
  if (style.visibility === "hidden" || style.visibility === "collapse") return false;
  const opacity = Number.parseFloat(style.opacity || "1");
  if (Number.isFinite(opacity) && opacity <= 0.01) return false;
  return true;
}


/**
 * Deep-clone an element and inline ALL its computed styles so the clone is
 * self-contained inside an SVG foreignObject (CSS variables / external
 * stylesheets don't apply there).
 *
 * Recursively inline styles so child markup keeps its computed appearance
 * inside SVG foreignObject capture.
 */
function cloneWithInlineStyles(src, options = {}, depth = 0) {
  const MAX_DEPTH = 100;
  if (depth > MAX_DEPTH) return src.cloneNode(false);
  if (src.nodeType !== 1 /* ELEMENT_NODE */) return src.cloneNode(true);
  const dst = src.cloneNode(false);
  try {
    const computed = window.getComputedStyle(src);
    let style = "";
    // Iterate ALL computed properties so that Tailwind utility classes and
    // CSS custom properties (--comfy-*, --p-*) are fully resolved and inlined.
    for (let i = 0; i < computed.length; i++) {
      const prop = computed[i];
      try {
        if (options.stripLayoutProps && (
          prop === "position" ||
          prop === "left" ||
          prop === "top" ||
          prop === "right" ||
          prop === "bottom" ||
          prop === "inset" ||
          prop === "inset-block" ||
          prop === "inset-block-end" ||
          prop === "inset-block-start" ||
          prop === "inset-inline" ||
          prop === "inset-inline-end" ||
          prop === "inset-inline-start" ||
          prop === "transform"
        )) {
          continue;
        }
        const val = computed.getPropertyValue(prop);
        if (val) style += `${prop}:${val};`;
      } catch (_) {}
    }
    dst.style.cssText = style;
  } catch (_) {}

  for (const child of src.childNodes) {
    dst.appendChild(cloneWithInlineStyles(child, options, depth + 1));
  }
  return dst;
}

function isCanvasBlank(canvas) {
  const ctx = canvas?.getContext?.("2d", { willReadFrequently: true });
  if (!ctx || !canvas.width || !canvas.height) return true;
  const { width, height } = canvas;
  const samplePoints = [
    [0, 0],
    [Math.max(0, Math.floor(width / 2)), Math.max(0, Math.floor(height / 2))],
    [Math.max(0, width - 1), Math.max(0, height - 1)],
    [Math.max(0, Math.floor(width / 4)), Math.max(0, Math.floor(height / 4))],
    [Math.max(0, Math.floor((width * 3) / 4)), Math.max(0, Math.floor((height * 3) / 4))],
  ];
  for (const [x, y] of samplePoints) {
    try {
      const data = ctx.getImageData(x, y, 1, 1).data;
      if ((data?.[3] || 0) > 0) return false;
    } catch (_) {
      return false;
    }
  }
  return true;
}

/**
 * Render a DOM element to an offscreen canvas using the SVG foreignObject
 * technique. Inlines computed styles so the clone is self-contained.
 * Returns a canvas, or null on failure.
 */
async function captureElementAsCanvas(el, width, height, options = {}) {
  const w = Math.ceil(Math.max(1, width));
  const h = Math.ceil(Math.max(1, height));

  let clone = null;
  try {
    clone = cloneWithInlineStyles(el, options);
  } catch (error) {
    return { canvas: null, stage: "clone", error: error?.message || String(error) };
  }

  // Strip cross-origin images that would taint the canvas.
  for (const img of clone.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    if (src.startsWith("http") || src.startsWith("//")) img.removeAttribute("src");
  }

  // Build the SVG using a Blob URL (avoids data-URI encoding issues and
  // some browser restrictions around SVG foreignObject + data URIs).
  const svgStr = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`,
    `<foreignObject width="${w}" height="${h}" x="0" y="0">`,
    `<div xmlns="http://www.w3.org/1999/xhtml" `,
    `style="width:${w}px;height:${h}px;overflow:hidden;margin:0;padding:0;box-sizing:border-box;">`,
    clone.outerHTML,
    `</div>`,
    `</foreignObject>`,
    `</svg>`,
  ].join("");

  return new Promise((resolve) => {
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve({ canvas: null, stage: "context", error: "2d context unavailable" }); return; }
      try {
        ctx.drawImage(img, 0, 0);
        resolve({ canvas, stage: "draw", error: null });
      } catch (error) {
        resolve({ canvas: null, stage: "draw", error: error?.message || String(error) });
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ canvas: null, stage: "image-load", error: "svg foreignObject image failed to load" });
    };
    img.src = url;
  });
}

function drawTextBlockToRect(exportCtx, text, rect, style = {}) {
  if (!text || !text.trim()) return false;
  const x = rect.x;
  const y = rect.y;
  const w = rect.w;
  const h = rect.h;
  const fontSize = Number.isFinite(style.fontSize) ? style.fontSize : 12;
  const lineHeight = Number.isFinite(style.lineHeight) ? style.lineHeight : fontSize * 1.35;
  const paddingLeft = Number.isFinite(style.paddingLeft) ? style.paddingLeft : 0;
  const paddingTop = Number.isFinite(style.paddingTop) ? style.paddingTop : 0;
  const paddingRight = Number.isFinite(style.paddingRight) ? style.paddingRight : 0;
  const paddingBottom = Number.isFinite(style.paddingBottom) ? style.paddingBottom : 0;

  exportCtx.save();
  exportCtx.textBaseline = "top";
  exportCtx.font = style.font || `${fontSize}px sans-serif`;
  if (style.background && style.background !== "rgba(0, 0, 0, 0)" && style.background !== "transparent") {
    exportCtx.fillStyle = style.background;
    exportCtx.fillRect(x, y, w, h);
  }
  exportCtx.beginPath();
  exportCtx.rect(x, y, w, h);
  exportCtx.clip();
  exportCtx.fillStyle = style.color || "#ffffff";
  const innerX = x + paddingLeft;
  const innerY = y + paddingTop;
  const innerW = Math.max(1, w - paddingLeft - paddingRight);
  const innerH = Math.max(1, h - paddingTop - paddingBottom);
  const maxLines = Math.max(1, Math.floor(innerH / lineHeight));
  wrapText(exportCtx, text, innerX, innerY, innerW, lineHeight, maxLines);
  exportCtx.restore();
  return true;
}

function findRenderedMarkdownElement(widget) {
  if (!(widget instanceof HTMLElement)) return null;
  const rendered =
    widget.matches?.(".comfy-markdown-content, .tiptap, .markdown-rendered, .markdown-preview")
      ? widget
      : widget.querySelector?.(".comfy-markdown-content, .tiptap, .markdown-rendered, .markdown-preview");
  return rendered instanceof HTMLElement ? rendered : null;
}

function isDomWidgetMarkdownElement(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.classList?.contains("comfy-markdown-content")) return true;
  if (el.classList?.contains("tiptap")) return true;
  if (el.closest?.(".widget-markdown")) return true;
  return false;
}

function formatCanvasFont(style, fallbackSize = 12) {
  const size = parsePx(style.fontSize, fallbackSize);
  return `${style.fontStyle || ""} ${style.fontVariant || ""} ${style.fontWeight || ""} ${size}px ${style.fontFamily || "sans-serif"}`.trim();
}

function resolveDirectWidgetMedia(widget, uiCanvas) {
  if (!(widget instanceof HTMLElement)) return null;
  const candidates = Array.from(widget.querySelectorAll("canvas, img, video"));
  if (!candidates.length) return null;

  let best = null;
  let bestArea = 0;

  for (const el of candidates) {
    if (
      !(el instanceof HTMLCanvasElement) &&
      !(el instanceof HTMLImageElement) &&
      !(el instanceof HTMLVideoElement)
    ) {
      continue;
    }
    if (!isEffectivelyVisibleElement(el)) continue;
    if (el instanceof HTMLVideoElement && (el.readyState || 0) < 1) continue;

    const rect = getDomElementGraphRect(el, uiCanvas);
    if (!rect || rect.w <= 0 || rect.h <= 0) continue;

    const area = rect.w * rect.h;
    if (area > bestArea) {
      best = { element: el, rect };
      bestArea = area;
    }
  }

  if (!best) return null;

  const widgetRect = getDomElementGraphRect(widget, uiCanvas);
  if (!widgetRect || widgetRect.w <= 0 || widgetRect.h <= 0) return best;

  const widgetArea = widgetRect.w * widgetRect.h;
  if (widgetArea <= 0) return best;

  // Ignore tiny decorative media; only treat it as a widget preview if it
  // occupies a meaningful portion of the widget.
  if (bestArea / widgetArea < 0.2) return null;
  return best;
}

/**
 * Draw DOM widget containers onto the export canvas.
 *
 * Current policy:
 * - multiline widgets are handled by text overlay drawing
 * - markdown prefers rendered DOM capture, but falls back to rendered text
 *   plus an opaque background when foreignObject capture is not reliable
 * - generic DOM widgets still use foreignObject as a best-effort path
 *
 * Returns a Set of node IDs that were successfully covered.
 */
export async function drawDomWidgetOverlays({
  exportCtx,
  uiCanvas,
  bounds,
  scale,
  nodeRects,
  debugLog,
  skipWidgetCapture = false,
  selectedNodeIds = null,
  renderFilter = "all",
}) {
  const selectedIdSet = normalizeSelectedNodeIds(selectedNodeIds);
  const coveredNodeIds = new Set();
  const widgets = collectDomWidgetContainers(uiCanvas, { debugLog });
  if (!widgets.length) return coveredNodeIds;

  debugLog?.("dom.widget.overlay.count", { count: widgets.length });

  for (const widget of widgets) {
    const rect = getDomElementGraphRect(widget, uiCanvas, {
      debugLog,
      stage: "transform",
      kind: "widget",
    });
    if (!rect || rect.w <= 0 || rect.h <= 0) continue;

    const multilineEl = widget.querySelector?.("textarea.comfy-multiline-input");
    if (multilineEl instanceof HTMLTextAreaElement) {
      debugLog?.("diag.draw.widget", diagnoseDomElement(multilineEl, uiCanvas, {
        stage: "draw",
        reason: "handled-by-text-overlay",
        kind: "widget-multiline",
      }));
      continue;
    }

    const x = (rect.x - bounds.left) * scale;
    const y = (rect.y - bounds.top) * scale;
    const w = rect.w * scale;
    const h = rect.h * scale;

    if (w < 1 || h < 1) continue;
    if (w > bounds.width * scale * 1.1 || h > bounds.height * scale * 1.1) continue;

    const nodeId = resolveNodeIdForGraphRect(
      nodeRects,
      rect,
      getNodeIdFromElement(widget)
    );
    if (!shouldRenderResolvedNode(nodeId, selectedIdSet, renderFilter)) {
      continue;
    }
    const renderedMarkdown = findRenderedMarkdownElement(widget);
    if (renderedMarkdown) {
      const renderedRect = getDomElementGraphRect(renderedMarkdown, uiCanvas, {
        debugLog,
        stage: "transform",
        kind: "widget-markdown",
      }) || rect;
      const renderedClientRect = renderedMarkdown.getBoundingClientRect();
      const rx = (renderedRect.x - bounds.left) * scale;
      const ry = (renderedRect.y - bounds.top) * scale;
      const rw = renderedRect.w * scale;
      const rh = renderedRect.h * scale;
      const captureWidth = Math.max(1, renderedClientRect.width || renderedRect.w || 1);
      const captureHeight = Math.max(1, renderedClientRect.height || renderedRect.h || 1);
      const captured = skipWidgetCapture
        ? { canvas: null, stage: "skipped", error: "widget capture skipped" }
        : await captureElementAsCanvas(renderedMarkdown, captureWidth, captureHeight, {
          stripLayoutProps: true,
        });
      let drawn = false;
      let reason = "rendered-capture-failed";
      const style = window.getComputedStyle(renderedMarkdown);
      const text = renderedMarkdown.innerText || renderedMarkdown.textContent || "";
      const fallbackBackground = resolveOpaqueBackground(renderedMarkdown, widget);
      const captureBlank = captured?.canvas ? isCanvasBlank(captured.canvas) : false;

      if (captured?.canvas && !captureBlank) {
        exportCtx.drawImage(captured.canvas, rx, ry, rw, rh);
        drawn = true;
        reason = "rendered-capture-drawn";
      } else {
        // Browser-only, dependency-free markdown export is content-first.
        // If foreignObject capture fails, prefer stable rendered text with an
        // opaque background over raw markdown or double-drawing artifacts.
        drawn = drawTextBlockToRect(
          exportCtx,
          text,
          { x: rx, y: ry, w: rw, h: rh },
          {
            fontSize: parsePx(style.fontSize, 12),
            lineHeight: parsePx(style.lineHeight, parsePx(style.fontSize, 12) * 1.35),
            paddingLeft: parsePx(style.paddingLeft, 0),
            paddingTop: parsePx(style.paddingTop, 0),
            paddingRight: parsePx(style.paddingRight, 0),
            paddingBottom: parsePx(style.paddingBottom, 0),
            background: fallbackBackground,
            color: style.color || "#ffffff",
            font: formatCanvasFont(style, 12),
          }
        );
        reason = drawn
          ? captureBlank
            ? "rendered-capture-blank-text-fallback"
            : "rendered-text-drawn"
          : "rendered-text-empty";
      }
      if (drawn && Number.isFinite(nodeId)) {
        coveredNodeIds.add(nodeId);
      }
      debugLog?.("diag.draw.widget", diagnoseDomElement(renderedMarkdown, uiCanvas, {
        stage: "draw",
        reason,
        captureStage: captured?.stage || null,
        captureError: captured?.error || null,
        captureBlank,
        captureSize: { width: captureWidth, height: captureHeight },
        exportRect: { x: rx, y: ry, w: rw, h: rh },
        resolvedNodeId: nodeId,
        effectiveBackground: fallbackBackground,
        textPreview: text.slice(0, 120),
        kind: "widget-markdown",
      }));
      continue;
    }

    // Attempt foreignObject SVG capture.
    const directMedia = skipWidgetCapture ? resolveDirectWidgetMedia(widget, uiCanvas) : null;
    const captured = skipWidgetCapture
      ? { canvas: null, stage: "skipped", error: "widget capture skipped" }
      : await captureElementAsCanvas(widget, w, h);
    if (directMedia?.element && directMedia?.rect) {
      const mx = (directMedia.rect.x - bounds.left) * scale;
      const my = (directMedia.rect.y - bounds.top) * scale;
      const mw = directMedia.rect.w * scale;
      const mh = directMedia.rect.h * scale;
      exportCtx.drawImage(directMedia.element, mx, my, mw, mh);
      debugLog?.("diag.draw.widget", diagnoseDomElement(directMedia.element, uiCanvas, {
        stage: "draw",
        reason: "direct-media-drawn",
        exportRect: { x: mx, y: my, w: mw, h: mh },
        resolvedNodeId: nodeId,
        kind: "widget-media",
      }));
      if (Number.isFinite(nodeId)) coveredNodeIds.add(nodeId);
    } else if (captured?.canvas) {
      exportCtx.drawImage(captured.canvas, x, y, w, h);
      debugLog?.("diag.draw.widget", diagnoseDomElement(widget, uiCanvas, {
        stage: "draw",
        reason: "capture-drawn",
        captureStage: captured.stage,
        exportRect: { x, y, w, h },
        resolvedNodeId: nodeId,
        kind: "widget",
      }));
      if (Number.isFinite(nodeId)) coveredNodeIds.add(nodeId);
    } else {
      debugLog?.("diag.draw.widget", diagnoseDomElement(widget, uiCanvas, {
        stage: "draw",
        reason: "capture-failed",
        captureStage: captured?.stage || null,
        captureError: captured?.error || null,
        exportRect: { x, y, w, h },
        resolvedNodeId: nodeId,
        kind: "widget",
      }));
    }
  }
  return coveredNodeIds;
}

function parsePx(value, fallback = 0) {
  if (!value) return fallback;
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
}

export function drawWidgetTextFallback({ exportCtx, graph, bounds, scale, coveredNodeIds, debugLog }) {
  const nodes = graph?._nodes || graph?.nodes || [];
  if (!nodes.length) {
    return { drawn: 0, skippedCovered: 0, skippedEmpty: 0 };
  }

  const nodeWidgetHeight = window?.LiteGraph?.NODE_WIDGET_HEIGHT || 20;
  let drawn = 0;
  let skippedCovered = 0;
  let skippedEmpty = 0;

  const getNodeTextCandidate = (node) => {
    const candidates = [];
    if (Array.isArray(node.widgets_values)) {
      for (const value of node.widgets_values) {
        if (typeof value === "string" && value.trim()) {
          candidates.push(value);
        }
      }
    }
    if (node.properties && typeof node.properties === "object") {
      for (const [key, value] of Object.entries(node.properties)) {
        if (typeof value === "string" && value.trim()) {
          const lower = key.toLowerCase();
          if (
            lower.includes("text") ||
            lower.includes("prompt") ||
            lower.includes("note") ||
            lower.includes("markdown")
          ) {
            candidates.push(value);
          }
        }
      }
    }
    if (!candidates.length) return "";
    const sorted = candidates.sort((a, b) => b.length - a.length);
    return sorted[0];
  };

  for (const node of nodes) {
    if (!node) continue;
    if (coveredNodeIds?.has?.(node.id)) {
      skippedCovered += 1;
      continue;
    }
    let drewForNode = false;
    const widgetsValues = Array.isArray(node.widgets_values)
      ? node.widgets_values
      : node.widgets_values && typeof node.widgets_values === "object"
        ? node.widgets_values
        : null;
    const nodePos = node.pos || node._pos || [0, 0];
    const nodeSize = node.size || node._size || [0, 0];
    const widgetBaseX = nodePos[0] + 15;
    const widgetWidth = Math.max(1, (nodeSize[0] || 0) - 30);
    const widgetsStartY =
      Number.isFinite(node.widgets_start_y) ? node.widgets_start_y : 0;

    const widgets = Array.isArray(node.widgets) ? node.widgets : [];
    if (debugLog) {
      debugLog("text.fallback.node", {
        id: node.id,
        type: node.type,
        title: node.title,
        pos: nodePos,
        size: nodeSize,
        widgets_len: widgets.length,
        widgets_start_y: widgetsStartY,
        widgets_values_type: Array.isArray(widgetsValues)
          ? "array"
          : widgetsValues && typeof widgetsValues === "object"
            ? "object"
            : typeof widgetsValues,
        widgets_values_keys: widgetsValues && typeof widgetsValues === "object"
          ? Object.keys(widgetsValues).slice(0, 20)
          : null,
        properties_keys: node.properties && typeof node.properties === "object"
          ? Object.keys(node.properties).slice(0, 20)
          : null,
      });
    }
    const standardWidgetTypes = ["string", "combo", "number", "toggle", "button", "slider"];
    const multilineWidgetTypes = ["textarea", "markdown", "customtext"];
    for (let index = 0; index < widgets.length; index += 1) {
      const widget = widgets[index];
      if (!widget) continue;

      const isMultiline =
        widget?.options?.multiline === true ||
        (widget.type && multilineWidgetTypes.includes(widget.type.toLowerCase()));

      // Debug specific text nodes to see why they might be skipped
      if (debugLog && (node.type === "Note" || node.title?.includes("Note") || node.type?.includes("Markdown"))) {
        debugLog("text.fallback.inspect", {
          id: node.id,
          type: node.type,
          widgetType: widget.type,
          isMultiline,
          value: widget.value,
          syncedValue: widgetsValues?.[index]
        });
      }

      if (!isMultiline) continue;

      const widgetValue =
        typeof widget.value === "string" && widget.value.trim()
          ? widget.value
          : typeof widgetsValues?.[index] === "string"
            ? widgetsValues[index]
            : "";
      const fontSize = Math.max(10, Math.round(11 * scale));
      const lineHeight = Math.max(fontSize * 1.2, 12 * scale);
      const paddingX = 6 * scale;
      const paddingY = 4 * scale;

      let widgetY = Number.isFinite(widget.y) ? widget.y : widgetsStartY;
      let widgetHeight = Number.isFinite(widget.height) && widget.height > 0
        ? widget.height
        : 0;

      // If height is missing or tiny for a multiline widget, it's likely a fallback case.
      // Use the rest of the node height as a safer default.
      if (widgetHeight < fontSize * 2) {
        // Fallback: Use the space from the widget start to the bottom of the node minus some margin.
        widgetHeight = Math.max(fontSize * 3, nodeSize[1] - widgetY - 5);
      }

      const x = (widgetBaseX - bounds.left) * scale;
      const y = (nodePos[1] + widgetY - bounds.top) * scale;
      const w = widgetWidth * scale;
      const h = widgetHeight * scale;

      const innerX = x + paddingX;
      const innerY = y + paddingY;
      const innerW = Math.max(1, w - paddingX * 2);
      const innerH = Math.max(1, h - paddingY * 2);
      const maxLines = Math.max(1, Math.floor(innerH / lineHeight) + 1);

      if (debugLog) {
        debugLog("widget.text.draw_attempt", {
          value: widgetValue.slice(0, 50),
          x: innerX, y: innerY, w: innerW, lines: maxLines,
          font: exportCtx.font,
          fill: exportCtx.fillStyle
        });
      }

      exportCtx.save();
      exportCtx.textBaseline = "top";
      exportCtx.font = `${fontSize}px ${window?.LiteGraph?.NODE_FONT || "sans-serif"}`;
      exportCtx.fillStyle = "#FFFFFF"; // Force Pure White

      exportCtx.beginPath();
      exportCtx.rect(x, y, w, h);
      exportCtx.clip();

      wrapText(exportCtx, widgetValue, innerX, innerY, innerW, lineHeight, maxLines);
      exportCtx.restore();

      drawn += 1;
      drewForNode = true;
      debugLog?.("widget.text.fallback", {
        node: { id: node.id, title: node.title, type: node.type },
        x,
        y,
        w,
        h,
      });
    }

    if (!drewForNode) {
      const candidate = getNodeTextCandidate(node);
      // Enhanced Note detection: check type AND title
      const typeLower = (node.type || "").toLowerCase();
      const titleLower = (node.title || "").toLowerCase();
      const isNoteNode =
        typeLower === "note" ||
        typeLower === "notes" ||
        typeLower.includes("note") ||
        titleLower.includes("note") ||
        titleLower.includes("comment");

      // Identify if the node has any standard widgets that we expect LiteGraph to draw.
      // If it does, we skip the generic fallback to avoid double-rendering (overlap).
      const hasStandardWidgets = widgets.some(w =>
        w && standardWidgetTypes.includes(w.type) && !w.options?.multiline
      );

      // Relaxed condition: Draw if it's a Note, OR if no standard widgets are handling it.
      // Also removed the arbitrary "20 chars" limit to catch shorter notes.
      if (candidate && (isNoteNode || !hasStandardWidgets || candidate.includes("\n") || candidate.length > 0)) {
        // Double-check: if it has standard widgets but is NOT a note, we usually avoid drawing distinct short text
        // unless it has a newline (multiline text often handled by custom logic).
        // If it IS a note, always draw.
        if (!isNoteNode && hasStandardWidgets && !candidate.includes("\n")) {
          // It's a standard node with a short string -> Let LiteGraph draw the widget.
          // Do nothing.
        } else {
          const titleHeight = window?.LiteGraph?.NODE_TITLE_HEIGHT || 30;
          const x = (widgetBaseX - bounds.left) * scale;
          const y = (nodePos[1] + titleHeight - bounds.top) * scale;
          const w = widgetWidth * scale;
          const h = Math.max(1, (nodeSize[1] - titleHeight - 6) * scale);
          const fontSize = Math.max(10, Math.round(11 * scale));
          const lineHeight = Math.max(fontSize * 1.2, 12 * scale);
          const paddingX = 6 * scale;
          const paddingY = 4 * scale;

          exportCtx.save();
          exportCtx.textBaseline = "top";
          exportCtx.font = `${fontSize}px ${window?.LiteGraph?.NODE_FONT || "sans-serif"}`;
          exportCtx.fillStyle = "#e6e6e6";
          exportCtx.beginPath();
          exportCtx.rect(x, y, w, h);
          exportCtx.clip();

          const innerX = x + paddingX;
          const innerY = y + paddingY;
          const innerW = Math.max(1, w - paddingX * 2);
          const innerH = Math.max(1, h - paddingY * 2);
          const maxLines = Math.max(1, Math.floor(innerH / lineHeight));
          wrapText(exportCtx, candidate, innerX, innerY, innerW, lineHeight, maxLines);
          exportCtx.restore();

          drawn += 1;
          debugLog?.("widget.text.generic", {
            node: { id: node.id, title: node.title, type: node.type },
            x,
            y,
            w,
            h,
          });
        }
      }
    }
  }
  return { drawn, skippedCovered, skippedEmpty };
}

export function drawTextOverlays({
  exportCtx,
  uiCanvas,
  graph,
  bounds,
  scale,
  nodeRects,
  debugLog,
  skipNodeIds = null,
  selectedNodeIds = null,
  renderFilter = "all",
}) {
  const selectedIdSet = normalizeSelectedNodeIds(selectedNodeIds);
  const elements = collectTextElementsFromDom(uiCanvas, { debugLog });
  const isRenderedMarkdown = (el) =>
    el.classList?.contains("tiptap") ||
    el.classList?.contains("markdown") ||
    el.classList?.contains("markdown-body") ||
    el.classList?.contains("markdown-preview") ||
    el.classList?.contains("markdown-rendered") ||
    // Modern ComfyUI frontend WidgetMarkdown component class:
    el.classList?.contains("comfy-markdown-content");
  const isEditorMarkdown = (el) =>
    el.classList?.contains("ProseMirror") ||
    el.classList?.contains("cm-content") ||
    el.classList?.contains("cm-line") ||
    el.classList?.contains("markdown-editor") ||
    el.getAttribute?.("contenteditable") === "true" ||
    el instanceof HTMLTextAreaElement;

  const elementsByGroup = new Map();
  const noNode = [];
  for (const el of elements) {
    const nodeId = getNodeIdFromElement(el);
    const domWidget = el.closest?.(".dom-widget");
    if (!Number.isFinite(nodeId) && !domWidget) {
      noNode.push(el);
      continue;
    }
    const key = Number.isFinite(nodeId) ? nodeId : domWidget;
    const list = elementsByGroup.get(key) || [];
    list.push(el);
    elementsByGroup.set(key, list);
  }

  const filtered = [];
  let groupIndex = 0;
  for (const [groupKey, list] of elementsByGroup.entries()) {
    const hasRendered = list.some(isRenderedMarkdown);
    const hasEditor = list.some(isEditorMarkdown);
    if (hasRendered) {
      list.forEach((el) => {
        if (isRenderedMarkdown(el)) {
          filtered.push(el);
        }
      });
    } else if (hasEditor) {
      list.forEach((el) => {
        if (isEditorMarkdown(el)) {
          filtered.push(el);
        }
      });
    } else {
      filtered.push(...list);
    }
    if (debugLog && groupIndex < 5) {
      debugLog("dom.text.group", {
        key: typeof groupKey === "number" ? `node:${groupKey}` : "dom-widget",
        count: list.length,
        hasRendered,
        hasEditor,
      });
    }
    groupIndex += 1;
  }
  filtered.push(...noNode);

  debugLog?.("dom.text.count", { count: filtered.length });
  debugLog?.("dom.widget.count", {
    count: document.querySelectorAll(".dom-widget").length,
  });
  let visibleCount = 0;
  let skippedNoRect = 0;
  let skippedEmpty = 0;
  const coveredNodeIds = new Set();
  const resolveNodeId = (rect, fallbackId) =>
    resolveNodeIdForGraphRect(nodeRects, rect, fallbackId);
  const findNodeRectById = (id) => {
    if (!Number.isFinite(id) || !nodeRects?.length) return null;
    return nodeRects.find((rect) => rect.id === id) || null;
  };
  const intersectRect = (a, b) => {
    if (!a || !b) return null;
    const x1 = Math.max(a.x, b.left);
    const y1 = Math.max(a.y, b.top);
    const x2 = Math.min(a.x + a.w, b.right);
    const y2 = Math.min(a.y + a.h, b.bottom);
    const w = x2 - x1;
    const h = y2 - y1;
    if (w <= 1 || h <= 1) return null;
    return { x: x1, y: y1, w, h };
  };

  let loggedSkips = 0;
  const pickKey = (rect, nodeId) => {
    const round = (v) => Math.round(v * 10) / 10;
    const id = Number.isFinite(nodeId) ? nodeId : "none";
    return `${id}:${round(rect.x)}:${round(rect.y)}:${round(rect.w)}:${round(rect.h)}`;
  };

  const scoreElement = (el) => {
    if (isRenderedMarkdown(el)) return 3;
    if (isEditorMarkdown(el)) return 1;
    return 2;
  };

  const picks = new Map();
  const skippedSet = skipNodeIds instanceof Set
    ? skipNodeIds
    : new Set(
      Array.isArray(skipNodeIds)
        ? skipNodeIds.map((id) => Number(id)).filter(Number.isFinite)
        : []
    );
  for (const skippedId of skippedSet) {
    coveredNodeIds.add(skippedId);
  }

  for (const el of filtered) {
    if (!isEffectivelyVisibleElement(el)) {
      continue;
    }
    if (isDomWidgetMarkdownElement(el)) {
      continue;
    }
    const nodeId = getNodeIdFromElement(el);
    const rect = getDomElementGraphRect(el, uiCanvas, {
      debugLog,
      stage: "transform",
      kind: "text",
    });
    if (!rect) {
      skippedNoRect += 1;
      if (debugLog && loggedSkips < 5) {
        const r = el.getBoundingClientRect?.();
        const canvasRect = uiCanvas?.canvas?.getBoundingClientRect?.();
        debugLog("dom.text.skip", {
          tag: el.tagName,
          className: el.className,
          nodeId,
          rect: r
            ? { left: r.left, top: r.top, width: r.width, height: r.height }
            : null,
          canvasRect: canvasRect
            ? {
              left: canvasRect.left,
              top: canvasRect.top,
              width: canvasRect.width,
              height: canvasRect.height,
            }
            : null,
        });
        loggedSkips += 1;
      }
      continue;
    }
    const resolvedId = resolveNodeId(rect, nodeId);
    if (!shouldRenderResolvedNode(resolvedId, selectedIdSet, renderFilter)) {
      continue;
    }
    if (Number.isFinite(resolvedId) && skippedSet.has(resolvedId)) {
      continue;
    }
    if (Number.isFinite(resolvedId)) {
      coveredNodeIds.add(resolvedId);
    }

    const nodeRect = Number.isFinite(resolvedId)
      ? findNodeRectById(resolvedId)
      : null;
    const clippedRect = nodeRect ? intersectRect(rect, nodeRect) : rect;
    if (!clippedRect) {
      skippedNoRect += 1;
      continue;
    }

    if (clippedRect.w > bounds.width * 1.05 || clippedRect.h > bounds.height * 1.05) {
      skippedNoRect += 1;
      continue;
    }
    const key = pickKey(clippedRect, resolvedId ?? nodeId);
    const score = scoreElement(el);
    const existing = picks.get(key);
    if (!existing || score > existing.score) {
      picks.set(key, { el, rect: clippedRect, score });
    }
  }

  for (const { el, rect } of picks.values()) {
    const x = (rect.x - bounds.left) * scale;
    const y = (rect.y - bounds.top) * scale;
    const w = rect.w * scale;
    const h = rect.h * scale;

    const style = window.getComputedStyle(el);
    const fontSize = parsePx(style.fontSize, 12);
    const lineHeight = parsePx(style.lineHeight, fontSize * 1.2);
    const paddingLeft = parsePx(style.paddingLeft, 0);
    const paddingTop = parsePx(style.paddingTop, 0);
    const paddingRight = parsePx(style.paddingRight, 0);
    const paddingBottom = parsePx(style.paddingBottom, 0);
    // Walk up the DOM to find the effective (non-transparent) background.
    // Textarea/input elements inside comfy-multiline-input report transparent.
    const bg = getEffectiveBackground(el);
    const color = style.color || "#ffffff";

    const text =
      el instanceof HTMLTextAreaElement
        ? el.value
        : el instanceof HTMLInputElement
          ? el.value
          : el.innerText || el.textContent || "";

    if (!text.trim()) {
      skippedEmpty += 1;
      continue;
    }
    visibleCount += 1;

    exportCtx.save();
    exportCtx.textBaseline = "top";
    exportCtx.font = `${style.fontStyle || ""} ${style.fontVariant || ""} ${style.fontWeight || ""} ${fontSize}px ${style.fontFamily || "sans-serif"}`.trim();

    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
      exportCtx.fillStyle = bg;
      exportCtx.fillRect(x, y, w, h);
    }

    exportCtx.beginPath();
    exportCtx.rect(x, y, w, h);
    exportCtx.clip();

    exportCtx.fillStyle = color;
    const innerX = x + paddingLeft;
    const innerY = y + paddingTop;
    const innerW = Math.max(1, w - paddingLeft - paddingRight);
    const innerH = Math.max(1, h - paddingTop - paddingBottom);
    const maxLines = Math.max(1, Math.floor(innerH / lineHeight));
    wrapText(exportCtx, text, innerX, innerY, innerW, lineHeight, maxLines);
    exportCtx.restore();

    debugLog?.("diag.draw.text", diagnoseDomElement(el, uiCanvas, {
      stage: "draw",
      reason: "drawn",
      exportRect: { x, y, w, h },
      effectiveBackground: bg,
      drawColor: color,
      textPreview: text.slice(0, 120),
      kind: "text",
    }));
  }

  if (visibleCount === 0) {
    debugLog?.("dom.text.fallback", { reason: "no-visible-dom-text" });
  }
  const widgetStats = drawWidgetTextFallback({
    exportCtx,
    graph,
    bounds,
    scale,
    coveredNodeIds,
    debugLog,
  });

  debugLog?.("dom.text.summary", {
    visible: visibleCount,
    skippedNoRect,
    skippedEmpty,
    coveredNodes: coveredNodeIds.size,
    widgetDrawn: widgetStats?.drawn ?? 0,
    widgetSkippedCovered: widgetStats?.skippedCovered ?? 0,
    widgetSkippedEmpty: widgetStats?.skippedEmpty ?? 0,
  });
}

export function drawImageOverlays({
  exportCtx,
  uiCanvas,
  bounds,
  scale,
  debugLog,
  nodeRects = null,
  selectedNodeIds = null,
  renderFilter = "all",
}) {
  const selectedIdSet = normalizeSelectedNodeIds(selectedNodeIds);
  const elements = collectImageElementsFromDom(uiCanvas, { debugLog });
  if (!elements.length) return;

  debugLog?.("dom.image.count", { count: elements.length });

  for (const el of elements) {
    const rect = getDomElementGraphRect(el, uiCanvas, {
      debugLog,
      stage: "transform",
      kind: "image",
    });
    if (!rect) continue;
    const resolvedId = resolveNodeIdForGraphRect(nodeRects, rect, getNodeIdFromElement(el));
    if (!shouldRenderResolvedNode(resolvedId, selectedIdSet, renderFilter)) {
      continue;
    }

    const x = (rect.x - bounds.left) * scale;
    const y = (rect.y - bounds.top) * scale;
    const w = rect.w * scale;
    const h = rect.h * scale;

    try {
      exportCtx.drawImage(el, x, y, w, h);
      debugLog?.("dom.image.item", { x, y, w, h });
    } catch (error) {
      debugLog?.("dom.image.error", { message: error?.message || String(error) });
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

function logDomMedia(debugLog, uiCanvas) {
  if (!debugLog) return;
  const elements = collectDomMediaElements(uiCanvas);
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
    if (!rect || ids.has(Number(rect.id))) continue;
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

  const { bounds: graphBounds, nodeRects } = collectGraphBounds(graph, debugLog);
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
  exportCanvas.width = width;
  exportCanvas.height = height;
  const exportCtx = ensure2DContext(exportCanvas);
  if (!exportCtx) {
    throw new Error("Legacy capture: export context missing.");
  }

  // Use the exact same constructor as the UI canvas to ensure ComfyUI extensions/modifications are present
  const LGraphCanvasRef = uiCanvas.constructor || window?.LGraphCanvas || window?.LiteGraph?.LGraphCanvas;
  if (!LGraphCanvasRef) {
    throw new Error("Legacy capture: LGraphCanvas constructor not available.");
  }

  const offscreen = new LGraphCanvasRef(exportCanvas, graph);
  offscreen.canvas = exportCanvas;
  offscreen.ctx = exportCtx;

  try {
    copyRenderSettings(uiCanvas, offscreen);
    forceExportQuality(offscreen);
    const mode = applyBackgroundMode(offscreen, options);
    disableCanvasInfoOverlay(offscreen);
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
    drawImageOverlays({ exportCtx, uiCanvas, bounds, scale, debugLog });
    drawVideoOverlays({ exportCtx, uiCanvas, bounds, scale, nodeRects, debugLog });
    drawVhsVideoOverlays({ exportCtx, uiCanvas, bounds, scale, debugLog });
    const domWidgetCoveredNodeIds =
      options?.skipDomWidgetOverlays === true
        ? new Set()
        : await drawDomWidgetOverlays({
          exportCtx,
          uiCanvas,
          bounds,
          scale,
          nodeRects,
          debugLog,
          skipWidgetCapture: options?.skipWidgetCapture === true,
        });
    drawTextOverlays({
      exportCtx,
      uiCanvas,
      graph,
      bounds,
      scale,
      nodeRects,
      debugLog,
      skipNodeIds: domWidgetCoveredNodeIds,
    });

    if (options?.scopeSelected === true) {
      applyScopeOpacityFallback(
        exportCtx,
        bounds,
        scale,
        nodeRects,
        options.selectedNodeIds,
        options.scopeOpacity,
        mode === "solid"
          ? (options?.solidColor || "#1f1f1f")
          : (offscreen.bgcolor || offscreen.background_color || "#1f1f1f")
      );
    }

    const blob = await toBlobAsync(exportCanvas, mime);
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
  }
}
