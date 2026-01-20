import { app } from "/scripts/app.js";
import {
  collectDomMediaElements,
  collectImageElementsFromDom,
  collectTextElementsFromDom,
  collectVideoElementsFromDom,
  getDomElementGraphRect,
  getNodeIdFromElement,
} from "../overlays/dom_utils.js";
import { toBlobAsync } from "../utils.js";

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

  const videos = collectVideoElementsFromDom(uiCanvas);
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

function parsePx(value, fallback = 0) {
  if (!value) return fallback;
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
}

function drawWidgetTextFallback({ exportCtx, graph, bounds, scale, coveredNodeIds, debugLog }) {
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
    if (!node || !Array.isArray(node.widgets)) continue;
    if (coveredNodeIds?.has?.(node.id)) {
      skippedCovered += 1;
      continue;
    }
    let drewForNode = false;
    const widgetsValues = Array.isArray(node.widgets_values)
      ? node.widgets_values
      : null;
    const nodePos = node.pos || node._pos || [0, 0];
    const nodeSize = node.size || node._size || [0, 0];
    const widgetBaseX = nodePos[0] + 15;
    const widgetWidth = Math.max(1, (nodeSize[0] || 0) - 30);
    const widgetsStartY =
      Number.isFinite(node.widgets_start_y) ? node.widgets_start_y : 0;

    for (let index = 0; index < node.widgets.length; index += 1) {
      const widget = node.widgets[index];
      if (!widget) continue;
      const isMultiline =
        widget?.options?.multiline ||
        widget.type === "textarea" ||
        widget.type === "markdown";
      if (!isMultiline) continue;
      const widgetValue =
        typeof widget.value === "string" && widget.value.trim()
          ? widget.value
          : typeof widgetsValues?.[index] === "string"
            ? widgetsValues[index]
            : "";
      if (!widgetValue.trim()) {
        skippedEmpty += 1;
        continue;
      }

      const widgetY = Number.isFinite(widget.y) ? widget.y : widgetsStartY;
      const widgetHeight = Number.isFinite(widget.height)
        ? widget.height
        : nodeWidgetHeight;

      const x = (widgetBaseX - bounds.left) * scale;
      const y = (nodePos[1] + widgetY - bounds.top) * scale;
      const w = widgetWidth * scale;
      const h = widgetHeight * scale;

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
      const isNoteNode = node.type === "Note" || node.type === "Notes";
      const hasVisibleWidgets = node.widgets && node.widgets.length > 0;

      if (candidate && (isNoteNode || !hasVisibleWidgets) && (candidate.length >= 20 || candidate.includes("\n"))) {
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
  return { drawn, skippedCovered, skippedEmpty };
}

function drawTextOverlays({ exportCtx, uiCanvas, graph, bounds, scale, nodeRects, debugLog }) {
  const elements = collectTextElementsFromDom(uiCanvas);
  debugLog?.("dom.text.count", { count: elements.length });
  debugLog?.("dom.widget.count", {
    count: document.querySelectorAll(".dom-widget").length,
  });
  let visibleCount = 0;
  let skippedNoRect = 0;
  let skippedEmpty = 0;
  const coveredNodeIds = new Set();
  const resolveNodeId = (rect, fallbackId) => {
    if (Number.isFinite(fallbackId)) return fallbackId;
    if (!rect || !nodeRects?.length) return null;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const node = findNodeForPoint(nodeRects, cx, cy);
    return node?.id ?? null;
  };

  let loggedSkips = 0;
  for (const el of elements) {
    const nodeId = getNodeIdFromElement(el);
    const rect = getDomElementGraphRect(el, uiCanvas);
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
    if (Number.isFinite(resolvedId)) {
      coveredNodeIds.add(resolvedId);
    }

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
    const bg = style.backgroundColor;
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

    debugLog?.("dom.text.item", {
      x,
      y,
      w,
      h,
      text: text.slice(0, 80),
    });
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

function drawImageOverlays({ exportCtx, uiCanvas, bounds, scale, debugLog }) {
  const elements = collectImageElementsFromDom(uiCanvas);
  if (!elements.length) return;

  debugLog?.("dom.image.count", { count: elements.length });

  for (const el of elements) {
    const rect = getDomElementGraphRect(el, uiCanvas);
    if (!rect) continue;

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

  // Use the exact same constructor as the UI canvas to ensure ComfyUI extensions/modifications are present
  const LGraphCanvasRef = uiCanvas.constructor || window?.LGraphCanvas || window?.LiteGraph?.LGraphCanvas;
  if (!LGraphCanvasRef) {
    throw new Error("Legacy capture: LGraphCanvas constructor not available.");
  }

  const offscreen = new LGraphCanvasRef(exportCanvas, graph);
  offscreen.canvas = exportCanvas;
  offscreen.ctx = exportCtx;

  copyRenderSettings(uiCanvas, offscreen);
  forceExportQuality(offscreen);
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
  drawImageOverlays({ exportCtx, uiCanvas, bounds, scale, debugLog });
  drawVideoOverlays({ exportCtx, uiCanvas, bounds, scale, nodeRects, debugLog });
  drawTextOverlays({ exportCtx, uiCanvas, graph, bounds, scale, nodeRects, debugLog });



  const blob = await toBlobAsync(exportCanvas, mime);
  return {
    type: "raster",
    mime,
    blob,
    width,
    height,
  };
}
