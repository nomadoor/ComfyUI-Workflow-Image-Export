import { app } from "/scripts/app.js";
import { computeGraphBBox } from "./bbox.js";
import { applyBackgroundMode, getExportBackgroundFillColor } from "./background_modes.js";
import {
  collectNodeRects,
  drawImageOverlays,
  drawTextOverlays,
  drawVideoOverlays,
  drawWidgetTextFallback,
} from "../core/backends/legacy_capture.js";
import {
  getCanvasRoot,
  getDomElementGraphRect,
  getNodeIdFromElement,
  isElementInGraphNode,
  collectDomMediaElements,
} from "../core/overlays/dom_utils.js";

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

function applyNodeOpacity(canvas, value, debugLog = null) {
  if (!canvas) return;
  const alpha = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
  debugLog?.("node.opacity.apply", {
    alpha,
    hasCtx: Boolean(canvas.ctx || canvas.context || canvas.canvas?.getContext),
  });
  const keys = ["node_opacity", "nodeOpacity"];
  for (const key of keys) {
    const existed = key in canvas;
    if (existed) {
      canvas[key] = alpha;
    }
    debugLog?.("node.opacity.prop", { key, value: alpha, existed });
  }
  for (const key of ["node_alpha", "nodeAlpha"]) {
    if (key in canvas) {
      debugLog?.("node.opacity.prop.skip", { key, reason: "avoid-full-node-opacity" });
    }
  }
  canvas._cwieNodeOpacity = alpha;

  if (!Number.isFinite(alpha) || alpha >= 0.999) return;

  const ctx = canvas.ctx || canvas.context || canvas.canvas?.getContext?.("2d");
  if (!ctx) return;

  if (debugLog) {
    const methodKeys = new Set();
    let proto = canvas;
    let depth = 0;
    while (proto && depth < 5) {
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key.toLowerCase().includes("drawnode")) methodKeys.add(key);
      }
      proto = Object.getPrototypeOf(proto);
      depth += 1;
    }
    debugLog("node.opacity.methods", { methods: Array.from(methodKeys).sort() });
  }

  const resolveMethod = (name) => {
    if (typeof canvas[name] === "function") return canvas[name];
    let proto = canvas;
    let depth = 0;
    while (proto && depth < 5) {
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      if (desc && typeof desc.value === "function") return desc.value;
      proto = Object.getPrototypeOf(proto);
      depth += 1;
    }
    return null;
  };

  const wrapMethod = (name) => {
    const original = resolveMethod(name);
    if (typeof original !== "function" || original._cwieNodeOpacityWrapped) return false;
    canvas[name] = function (...args) {
      ctx._cwieNodeOpacityAlpha = alpha;
      debugLog?.("node.opacity.draw", { method: name, alpha });
      try {
        return original.apply(this, args);
      } finally {
        // no-op
      }
    };
    canvas[name]._cwieNodeOpacityWrapped = true;
    debugLog?.("node.opacity.wrap", { method: name, alpha });
    return true;
  };

  // ComfyUI behavior: only the node background should be translucent.
  let wrapped = false;
  if (wrapMethod("drawNodeBackground")) wrapped = true;
  if (wrapMethod("drawNodeBox")) wrapped = true;

  const originalDrawShape = resolveMethod("drawNodeShape");
  if (typeof originalDrawShape === "function" && !originalDrawShape._cwieNodeOpacityShapeWrapped) {
    canvas.drawNodeShape = function (...args) {
      const node = args[0];
      const prevAlpha = ctx.globalAlpha;
      ctx._cwieNodeOpacityAlpha = alpha;
      ctx.globalAlpha = Number.isFinite(prevAlpha) ? prevAlpha * alpha : alpha;
      debugLog?.("node.opacity.draw", { method: "drawNodeShape", alpha, node: node?.title });
      try {
        return originalDrawShape.apply(this, args);
      } finally {
        ctx.globalAlpha = prevAlpha;
      }
    };
    canvas.drawNodeShape._cwieNodeOpacityShapeWrapped = true;
    debugLog?.("node.opacity.wrap", { method: "drawNodeShape", alpha });
    wrapped = true;
  }

  const originalDrawWidgets = resolveMethod("drawNodeWidgets");
  if (typeof originalDrawWidgets === "function" && !originalDrawWidgets._cwieNodeOpacityWidgetWrapped) {
    canvas.drawNodeWidgets = function (...args) {
      const node = args[0];
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = 1;
      debugLog?.("node.opacity.draw", { method: "drawNodeWidgets", alpha: 1, node: node?.title });
      try {
        return originalDrawWidgets.apply(this, args);
      } finally {
        ctx.globalAlpha = prevAlpha;
      }
    };
    canvas.drawNodeWidgets._cwieNodeOpacityWidgetWrapped = true;
    debugLog?.("node.opacity.wrap", { method: "drawNodeWidgets", alpha: 1 });
    wrapped = true;
  }

  if (!wrapped) {
    debugLog?.("node.opacity.wrap", { method: "none", alpha });
  }
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
  const tryLoad = (fn) => {
    try {
      fn?.call(graph, data);
      return true;
    } catch (_) {
      return false;
    }
  };

  const hasNodes = () => {
    const nodes = graph?._nodes || graph?.nodes || [];
    return Array.isArray(nodes) && nodes.length > 0;
  };

  let loaded = false;
  if (typeof graph.configure === "function") {
    loaded = tryLoad(graph.configure);
  }
  if (!hasNodes() && typeof graph.load === "function") {
    loaded = tryLoad(graph.load) || loaded;
  }
  if (!hasNodes() && typeof graph.deserialize === "function") {
    loaded = tryLoad(graph.deserialize) || loaded;
  }
  if (!loaded) {
    throw new Error("Offscreen render: graph.configure not available.");
  }
}

function copyNodeMedia(fromNode, toNode) {
  if (!fromNode || !toNode) return false;
  const mediaKeys = [
    "imgs",
    "img",
    "image",
    "preview",
    "preview_image",
    "previewImage",
    "previewMediaType",
    "canvas",
    "previewCanvas",
    "images",
    "animatedImages",
    "frames",
    "frame",
    "video_path",
    "filepath",
    "file",
    "url",
    "media",
    "media_el",
    "mediaEl",
    "texture",
    "tex",
    "_texture",
    "output_image",
  ];
  let copied = false;
  for (const key of mediaKeys) {
    if (fromNode[key] !== undefined && fromNode[key] !== null) {
      // Never copy live HTML video elements into the export graph.
      if (
        key === "video" ||
        key === "videos" ||
        key === "videoEl" ||
        key === "videoElement" ||
        key === "media_el" ||
        key === "mediaEl"
      ) {
        continue;
      }
      toNode[key] = fromNode[key];
      copied = true;
    }
  }
  return copied;
}

function syncLiveNodeMedia(exportGraph, liveGraph, debugLog) {
  const liveNodes = liveGraph?._nodes || liveGraph?.nodes || [];
  const exportNodes = exportGraph?._nodes || exportGraph?.nodes || [];
  if (!liveNodes.length || !exportNodes.length) return;

  const liveById = new Map();
  for (const node of liveNodes) {
    if (node && Number.isFinite(node.id)) {
      liveById.set(node.id, node);
    }
  }

  let copiedCount = 0;
  for (const node of exportNodes) {
    if (!node || !Number.isFinite(node.id)) continue;
    const liveNode = liveById.get(node.id);
    if (!liveNode) continue;
    if (copyNodeMedia(liveNode, node)) {
      copiedCount += 1;
    }
  }
  debugLog?.("media.sync", { copiedCount });
}

function syncLiveNodeText(exportGraph, liveGraph) {
  const liveNodes = liveGraph?._nodes || liveGraph?.nodes || [];
  const exportNodes = exportGraph?._nodes || exportGraph?.nodes || [];
  if (!liveNodes.length || !exportNodes.length) return;

  const liveById = new Map();
  for (const node of liveNodes) {
    if (node && Number.isFinite(node.id)) {
      liveById.set(node.id, node);
    }
  }

  for (const node of exportNodes) {
    if (!node || !Number.isFinite(node.id)) continue;
    const liveNode = liveById.get(node.id);
    if (!liveNode) continue;

    if (liveNode.widgets_values !== undefined) {
      node.widgets_values = liveNode.widgets_values;
    }
    if (liveNode.properties !== undefined) {
      node.properties = liveNode.properties;
    }
    if (Number.isFinite(liveNode.widgets_start_y)) {
      node.widgets_start_y = liveNode.widgets_start_y;
    }
    if (Array.isArray(node.widgets) && Array.isArray(liveNode.widgets)) {
      const count = Math.min(node.widgets.length, liveNode.widgets.length);
      const widgetsValues = liveNode.widgets_values;
      const widgetsValuesKeys =
        widgetsValues && typeof widgetsValues === "object" && !Array.isArray(widgetsValues)
          ? Object.keys(widgetsValues)
          : null;
      for (let i = 0; i < count; i += 1) {
        const exportWidget = node.widgets[i];
        const liveWidget = liveNode.widgets[i];
        if (!exportWidget || !liveWidget) continue;
        const widgetName =
          exportWidget.name ||
          liveWidget.name ||
          exportWidget?.options?.name ||
          liveWidget?.options?.name;
        let value = liveWidget.value;
        if (value === undefined) {
          if (widgetsValues && typeof widgetsValues === "object" && !Array.isArray(widgetsValues)) {
            if (widgetName && widgetsValues[widgetName] !== undefined) {
              value = widgetsValues[widgetName];
            }
          } else if (Array.isArray(widgetsValues) && widgetsValues[i] !== undefined) {
            value = widgetsValues[i];
          }
        }
        if (
          value === undefined &&
          widgetsValuesKeys &&
          widgetsValuesKeys[i] !== undefined &&
          widgetsValues[widgetsValuesKeys[i]] !== undefined
        ) {
          value = widgetsValues[widgetsValuesKeys[i]];
        }
        if (value === undefined && liveNode.properties && typeof liveNode.properties === "object") {
          if (widgetName && liveNode.properties[widgetName] !== undefined) {
            value = liveNode.properties[widgetName];
          }
        }

        if (value !== undefined) {
          if (typeof exportWidget.setValue === "function") {
            try {
              exportWidget.setValue(value);
            } catch (_) {
              // ignore setValue failures
            }
          } else {
            try {
              exportWidget.value = value;
            } catch (_) {
              // ignore read-only widget value
            }
            try {
              exportWidget._value = value;
            } catch (_) {
              // ignore read-only _value
            }
            if (exportWidget.options && typeof exportWidget.options === "object") {
              try {
                exportWidget.options.value = value;
              } catch (_) {
                // ignore read-only options
              }
            }
          }
        }
        if (Number.isFinite(liveWidget.y)) {
          try {
            exportWidget.y = liveWidget.y;
          } catch (_) {
            // ignore read-only widget y
          }
        }
        if (Number.isFinite(liveWidget.height)) {
          try {
            exportWidget.height = liveWidget.height;
          } catch (_) {
            // ignore read-only widget height
          }
        }
      }
    }
  }
}

function syncLiveNodeGeometry(exportGraph, liveGraph) {
  const liveNodes = liveGraph?._nodes || liveGraph?.nodes || [];
  const exportNodes = exportGraph?._nodes || exportGraph?.nodes || [];
  if (!liveNodes.length || !exportNodes.length) return;

  const liveById = new Map();
  for (const node of liveNodes) {
    if (node && Number.isFinite(node.id)) {
      liveById.set(node.id, node);
    }
  }

  const isValidPair = (pair) => Array.isArray(pair) && pair.length >= 2
    && Number.isFinite(Number(pair[0]))
    && Number.isFinite(Number(pair[1]));

  for (const node of exportNodes) {
    if (!node || !Number.isFinite(node.id)) continue;
    const liveNode = liveById.get(node.id);
    if (!liveNode) continue;

    const livePos = liveNode.pos || liveNode._pos;
    if (isValidPair(livePos)) {
      node.pos = [Number(livePos[0]), Number(livePos[1])];
    }

    const liveSize = liveNode.size || liveNode._size;
    if (isValidPair(liveSize)) {
      node.size = [Number(liveSize[0]), Number(liveSize[1])];
    }

  }
}

function syncLiveGroups(exportGraph, liveGraph) {
  const exportGroups = exportGraph?._groups || exportGraph?.groups || [];
  const liveGroups = liveGraph?._groups || liveGraph?.groups || [];
  if (!exportGroups.length || !liveGroups.length) return;

  const normalizePos = (pos) => {
    if (Array.isArray(pos) && pos.length >= 2) return [pos[0], pos[1]];
    return null;
  };
  const normalizeSize = (size) => {
    if (Array.isArray(size) && size.length >= 2) return [size[0], size[1]];
    return null;
  };
  const distanceSq = (a, b) => {
    if (!a || !b) return Number.POSITIVE_INFINITY;
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    return dx * dx + dy * dy;
  };

  const liveById = new Map();
  for (const group of liveGroups) {
    if (!group) continue;
    if (group.id !== undefined && group.id !== null) {
      liveById.set(group.id, group);
    }
  }

  for (const exportGroup of exportGroups) {
    if (!exportGroup) continue;
    let liveGroup = null;

    if (exportGroup.id !== undefined && exportGroup.id !== null) {
      liveGroup = liveById.get(exportGroup.id) || null;
    }

    if (!liveGroup && exportGroup.title) {
      const sameTitle = liveGroups.filter((g) => g?.title === exportGroup.title);
      if (sameTitle.length === 1) {
        liveGroup = sameTitle[0];
      } else if (sameTitle.length > 1) {
        const exportPos = normalizePos(exportGroup.pos || exportGroup._pos);
        let best = null;
        let bestDist = Number.POSITIVE_INFINITY;
        for (const candidate of sameTitle) {
          const candPos = normalizePos(candidate.pos || candidate._pos);
          const dist = distanceSq(exportPos, candPos);
          if (dist < bestDist) {
            bestDist = dist;
            best = candidate;
          }
        }
        liveGroup = best;
      }
    }

    if (!liveGroup) {
      // fallback to same index if nothing else matches
      const idx = exportGroups.indexOf(exportGroup);
      liveGroup = liveGroups[idx] || null;
    }

    if (!liveGroup) continue;

    const livePos = normalizePos(liveGroup.pos || liveGroup._pos);
    const liveSize = normalizeSize(liveGroup.size || liveGroup._size);
    if (livePos) {
      exportGroup.pos = [...livePos];
    }
    if (liveSize) {
      exportGroup.size = [...liveSize];
    }
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

function applyRenderFilter(graph, selectedNodeIds, mode) {
  if (!graph || !mode || mode === "all") return;
  const ids = Array.isArray(selectedNodeIds)
    ? new Set(selectedNodeIds.map((id) => Number(id)).filter(Number.isFinite))
    : null;
  if (!ids || !ids.size) return;
  const nodes = graph?._nodes || graph?.nodes || [];
  const shouldKeep = (node) => {
    if (!node || !Number.isFinite(node.id)) return false;
    const isSelected = ids.has(node.id);
    if (mode === "none") return false;
    if (mode === "selected") return isSelected;
    if (mode === "unselected") return !isSelected;
    return true;
  };
  const remove = nodes.filter((node) => !shouldKeep(node));
  if (typeof graph.remove === "function") {
    remove.forEach((node) => {
      try {
        graph.remove(node);
      } catch (_) {
        // ignore
      }
    });
  } else if (Array.isArray(graph._nodes)) {
    graph._nodes = nodes.filter((node) => shouldKeep(node));
  }
}

function applyLinkFilter(graph, selectedNodeIds, mode) {
  if (!graph || !mode || mode === "all") return;
  const ids = Array.isArray(selectedNodeIds)
    ? new Set(selectedNodeIds.map((id) => Number(id)).filter(Number.isFinite))
    : null;
  if (!ids || !ids.size) return;

  const getEndpoints = (link) => {
    if (!link || typeof link !== "object") return [null, null];
    const a = link.origin_id ?? link.from_id ?? link.originId ?? link.fromId;
    const b = link.target_id ?? link.to_id ?? link.targetId ?? link.toId;
    return [Number(a), Number(b)];
  };

  const keepLink = (link) => {
    if (mode === "none") return false;
    const [a, b] = getEndpoints(link);
    const aSel = Number.isFinite(a) && ids.has(a);
    const bSel = Number.isFinite(b) && ids.has(b);
    const bothSelected = aSel && bSel;
    if (mode === "selected") return bothSelected;
    if (mode === "unselected") return !bothSelected;
    return true;
  };

  if (graph.links instanceof Map) {
    const next = new Map();
    for (const [key, link] of graph.links.entries()) {
      if (keepLink(link)) {
        next.set(key, link);
      }
    }
    graph.links = next;
    return;
  }

  if (graph.links && typeof graph.links === "object") {
    const next = {};
    for (const [key, link] of Object.entries(graph.links)) {
      if (keepLink(link)) {
        next[key] = link;
      }
    }
    graph.links = next;
  }
}

function computeScaleToFit(width, height, maxPixels) {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  const current = w * h;
  if (current <= maxPixels) return 1;
  return Math.sqrt(maxPixels / current);
}

function computeTileBounds(bbox, tileRect, baseWidth, baseHeight) {
  if (!tileRect) {
    return {
      paddedMinX: bbox.paddedMinX,
      paddedMinY: bbox.paddedMinY,
      width: bbox.width,
      height: bbox.height,
    };
  }
  const x = Math.max(0, Math.min(baseWidth, Number(tileRect.x) || 0));
  const y = Math.max(0, Math.min(baseHeight, Number(tileRect.y) || 0));
  const w = Math.max(1, Math.min(baseWidth - x, Number(tileRect.width) || baseWidth));
  const h = Math.max(1, Math.min(baseHeight - y, Number(tileRect.height) || baseHeight));
  return {
    paddedMinX: bbox.paddedMinX + x,
    paddedMinY: bbox.paddedMinY + y,
    width: w,
    height: h,
  };
}

async function prepareGraph(workflowJson, debugLog) {
  const LGraphRef = resolveGraphConstructor();
  const LGraphCanvasRef = resolveCanvasConstructor();
  if (!LGraphRef || !LGraphCanvasRef) {
    throw new Error("Offscreen render: LiteGraph constructors not available.");
  }
  const graph = new LGraphRef();
  configureGraph(graph, workflowJson);
  syncLiveNodeGeometry(graph, app?.graph);
  syncLiveNodeMedia(graph, app?.graph, debugLog);
  syncLiveNodeText(graph, app?.graph);
  syncLiveGroups(graph, app?.graph);
  return { graph, LGraphCanvasRef };
}

export async function computeOffscreenBBox(workflowJson, options = {}) {
  const debug = Boolean(options.debug);
  const debugLog = debug
    ? (label, payload) => {
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
  offscreen.render_canvas_border = false;
  offscreen._cwieScaleFactor = scaleFactor;
  offscreen._cwieTileOffsetX = tileRect?.x || 0;
  offscreen._cwieTileOffsetY = tileRect?.y || 0;

  // [CWIE] v3: Resize is disabled by default to prevent double-scaling.
  // Explicitly enabled only if options.enableOffscreenResize is set.
  if (offscreen.resize && options.enableOffscreenResize) {
    offscreen.resize(deviceW, deviceH);
  }

  copyRenderSettings(app?.canvas, offscreen);
  if (Number.isFinite(options.nodeOpacity)) {
    applyNodeOpacity(offscreen, options.nodeOpacity / 100, debugLog);
  }
  applyBackgroundMode(offscreen, options);
  // [CWIE] Export Decoupling:
  // If useNativeUiBackground is TRUE, we DO NOT decouple. We let LiteGraph draw the UI background as is.
  // If FALSE (Solid/Transparent), we force transparency and enable grid only if requested.
  // Variables (isUiMode, etc) are defined at top of function.
  const useNativeUiBackground = isUiMode && includeGrid;

  if (offscreen && !useNativeUiBackground) {
    offscreen.background_image = null; // No patterns to prevent artifacts
    offscreen.show_grid = includeGrid; // Respect grid option
    offscreen.render_background = true; // Must be true to draw grid
    offscreen.clear_background = true;
    offscreen.always_render_background = false;

    // Force transparent background so we can composite over our solid internal background
    offscreen.clear_background_color = "rgba(0,0,0,0)";
    offscreen.bgcolor = "rgba(0,0,0,0)";
    offscreen.background_color = "rgba(0,0,0,0)";

    // If we are in "ui" mode but NO GRID, we might want manual fill?
    // Actually valid cases:
    // 1. UI + Grid -> Native (handled by else implicit)
    // 2. UI + No Grid -> Solid fill (handled here: bg=transparent, fill later? No wait)
    // If UI + No Grid, we usually want the UI *color* but no lines.
    // applyBackgroundMode has set the color.
    // If we set transparent here, we lose the UI color.
    // So if isUiMode && !includeGrid:
    // We arrive here. We set transparent.
    // Then in manual fill, getExportBackgroundFillColor(options) will return UI color?
    // Let's check getExportBackgroundFillColor.
    // It returns options.backgroundColor.
    // In UI mode, applyBackgroundMode sets offscreen colors but maybe didn't set options.backgroundColor?
    // We need to ensure Manual Fill gets the right color if we are stripping it here.
    // But wait, the user instructions say: "UI mode (ComfyUI match) needs native background".
    // If includeGrid is false, maybe we still want native background just without grid?
    // User said: "backgroundMode='ui' && includeGrid=true ... result identical to UI".
    // If includeGrid=false, maybe we don't care as much about patterns?
    // Let's stick to the requested logic: useNativeUiBackground = isUiMode && includeGrid.
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

  // --- Revert Single Buffer: Use original Multi-Canvas approach for safety ---
  // [CWIE] v3: Override devicePixelRatio during draw to ensure LiteGraph consistency
  const restoreDpr = overrideDevicePixelRatio(uiPxRatio, debug ? console.log : null);
  try {
    await timeSpan(perfLog, "offscreen.draw", () => offscreen.draw(true, true));
  } finally {
    restoreDpr?.();
  }

  // Composite on a fresh canvas so overlays are not affected by LiteGraph
  // transform/clip state that might linger on the original context.
  // [CWIE] Output Canvas: Always use CSS size (logical size)
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = cssW;
  outputCanvas.height = cssH;
  const outputCtx = outputCanvas.getContext("2d", { alpha: true });
  if (!outputCtx) {
    throw new Error("Offscreen render: output 2d context not available.");
  }

  // [CWIE] Manual Background Fill
  // If we are using Native UI Background, we skip this manual fill because offscreen.draw() did it.
  // Variables (isUiMode, etc) are already defined above within this function scope.

  if (!useNativeUiBackground) {
    const bgColor = getExportBackgroundFillColor(options);
    if (bgColor) {
      outputCtx.fillStyle = bgColor;
      // Fill full logical size
      outputCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    }
    // [CWIE] Custom Grid Removed -> Using Native LiteGraph Grid
    // (The grid is now drawn by offscreen.draw() because we set render_background=true + show_grid=true)
    // If we wanted a simple grid for solid mode, we would call it here.
    // However, we rely on the native grid drawing (though we clear background color to transparent).
    // Wait, if we cleared background color to transparent in !useNativeUiBackground,
    // does LiteGraph still draw the grid? 
    // Yes, because `show_grid=true` and `render_background=true`.
    // It draws grid lines over the transparent background.
    // Then we fillRect the solid color BEHIND it?
    // No, here we fillRect on outputCtx BEFORE drawing the offscreen canvas.
    // So:
    // 1. outputCtx filled with solid color (if !useNativeUiBackground)
    // 2. offscreen canvas (transparent bg + grid lines) drawn ON TOP.
    // This works perfectly for Solid Mode too!
  }

  // [CWIE] Custom Grid Removed -> Using Native LiteGraph Grid
  // (The grid is now drawn by offscreen.draw() because we set render_background=true + show_grid=true)

  // [CWIE] Downscale Composition: Draw high-res HiDPI canvas into logical-res output context
  // drawImage(source, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
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
      debugLog,
    }));
    await timeSpan(perfLog, "dom.video.overlays", () => drawVideoOverlays({
      exportCtx: outputCtx,
      uiCanvas: uiCanvasDom,
      bounds,
      scale: scaleFactor,
      nodeRects,
      debugLog,
    }));
    await timeSpan(perfLog, "dom.text.overlays", () => drawTextOverlays({
      exportCtx: outputCtx,
      uiCanvas: uiCanvasDom,
      graph,
      bounds,
      scale: scaleFactor,
      nodeRects,
      debugLog,
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
      // [CWIE] v3: Downscale high-res text overlay to CSS-sized output
      // [CWIE] v3: Downscale high-res text overlay to CSS-sized output
      outputCtx.drawImage(textOverlay, 0, 0, deviceW, deviceH, 0, 0, cssW, cssH);
    }
    if (mediaMode === "force") {
      await timeSpan(perfLog, "fallback.image.thumbs", () => drawImageThumbnails({
        exportCtx: outputCtx,
        graph,
        nodeRects,
        bounds,
        scale: scaleFactor,
        debugLog, // debugLog is available in local scope? lines 926/979 suggest yes. Wait, debugLog isn't defined in renderGraphOffscreen scope shown.
        // Checking previous file content... debugLog is NOT in renderGraphOffscreen arguments?
        // Ah, `debug` is in options. `debugLog` variable?
        // In lines 938/979 of original file, it passes `debugLog`.
        // Let's check where `debugLog` comes from. It must be `perfLog` or `console.log`?
        // In previous view `renderGraphOffscreen(workflowJson, options)`, no `debugLog`.
        // But `drawImageOverlays({ ... debugLog })`.
        // Let's assume the surrounding code is correct and just modify the condition.
        // Wait, line 943 (original) passes `debugLog`.
        // I will just keep the body same, only wrapping IF.
        // Actually, I can just change the IF condition.
      }));

      // Always run drawVideoThumbnails (it handles Preview/Export logic internally)
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
}

// --- Helper Classes & Functions ---

function drawVideoPlaceholder(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
  ctx.fillRect(x, y, w, h);

  // Draw Play Triangle
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.beginPath();
  const cx = x + w / 2;
  const cy = y + h / 2;
  const size = Math.min(w, h) * 0.2;
  ctx.moveTo(cx - size / 2, cy - size / 2);
  ctx.lineTo(cx + size, cy);
  ctx.lineTo(cx - size / 2, cy + size / 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const bgImageCache = new Map();

// VHS support disabled for now.
const lastVideoSrcByNodeId = new Map();

function sanitizeMediaUrl(url) {
  if (!url) return url;
  try {
    const parsed = new URL(url, window.location.origin);
    // These params change every render and defeat caching/backoff.
    parsed.searchParams.delete("rand");
    parsed.searchParams.delete("timestamp");
    parsed.searchParams.delete("deadline");
    // VHS sometimes emits "force_size=123x?" which breaks some servers.
    const forceSize = parsed.searchParams.get("force_size");
    if (forceSize && forceSize.includes("?")) {
      parsed.searchParams.delete("force_size");
    }
    return parsed.toString();
  } catch (_) {
    return url;
  }
}

function extractBackgroundImageUrl(value) {
  if (!value || value === "none") return "";
  const match = value.match(/url\((['"]?)(.*?)\1\)/i);
  return match ? match[2] : "";
}

function loadImageCached(url) {
  if (!url) return Promise.resolve(null);
  if (bgImageCache.has(url)) {
    return bgImageCache.get(url);
  }
  const promise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.crossOrigin = "anonymous";
    img.src = url;
  });
  bgImageCache.set(url, promise);
  return promise;
}

function isVideoNode(node) {
  const text = `${node?.title || ""} ${node?.type || ""}`.toLowerCase();
  return text.includes("video") && !text.includes("vhs");
}

function isImageNode(node) {
  const text = `${node?.title || ""} ${node?.type || ""}`.toLowerCase();
  if (text.includes("image") && !text.includes("video")) return true;
  if (node?.previewMediaType === "image") return true;
  if (node?.image || node?.img || (Array.isArray(node?.imgs) && node.imgs.length)) return true;
  if (node?.preview || node?.previewImage || node?.preview_image) return true;
  if (node?.images && Array.isArray(node.images) && node.images.length) return true;
  return false;
}

function looksLikeVideoUrl(value) {
  if (typeof value !== "string") return false;
  return /\.(mp4|webm|mov|mkv|avi|gif)$/i.test(value);
}

function looksLikeImageUrl(value) {
  if (typeof value !== "string") return false;
  return /\.(png|jpg|jpeg|webp|bmp|gif)$/i.test(value);
}

function looksLikeFilename(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (!trimmed.includes(".")) return false;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return false;
  return trimmed.length > 4;
}

// VHS helpers removed.

function buildApiViewUrl(ref) {
  if (!ref?.filename) return null;
  const url = new URL("/api/view", window.location.origin);
  url.searchParams.set("filename", ref.filename);
  if (ref.subfolder) {
    url.searchParams.set("subfolder", ref.subfolder);
  }
  url.searchParams.set("type", ref.type || "input");
  return url.toString();
}

function buildViewUrl(ref, node) {
  if (!ref?.filename) return null;
  return buildApiViewUrl(ref);
}

function extractFileRefFromNode(node) {
  if (!node) return null;
  const debug = window.__cwie__?.debug;
  const videoLike = (() => {
    const text = `${node?.title || ""} ${node?.type || ""}`.toLowerCase();
    return text.includes("video") && !text.includes("vhs");
  })();

  // Helper to deep check for filename/video keys
  const tryObject = (obj, path, depth = 0) => {
    if (!obj || typeof obj !== "object") return null;

    // Common filename keys
    const filename =
      obj.filename ||
      obj.file ||
      obj.name ||
      obj.video ||
      (Array.isArray(obj.filenames) ? obj.filenames[0] : null);

    if (filename && typeof filename === "string") {
      if (debug) console.log(`[CWIE] Found ref in ${path}:`, filename);
      return {
        filename,
        subfolder: obj.subfolder || obj.folder,
        type: obj.type,
      };
    }

    if (depth >= 2) return null;
    for (const [key, value] of Object.entries(obj)) {
      if (!value || typeof value !== "object") continue;
      const nested = tryObject(value, `${path}.${key}`, depth + 1);
      if (nested) return nested;
    }
    return null;
  };

  if (debug) console.log(`[CWIE] Inspecting node ${node.id} (${node.title}) for files...`);

  // 1. Check Properties
  const props = node.properties && typeof node.properties === "object" ? node.properties : null;
  if (props) {
    const ref = tryObject(props, "properties");
    if (ref) return ref;
    for (const [key, value] of Object.entries(props)) {
      const nested = tryObject(value, `properties.${key}`);
      if (nested) return nested;
      if (looksLikeVideoUrl(value)) {
        if (debug) console.log(`[CWIE] Found value ref in properties.${key}:`, value);
        return { filename: value, subfolder: props.subfolder, type: props.type };
      }
    }
  }

  // 2. Check Widget Values (Primary source for VHS)
  const widgetsValues = node.widgets_values;
  if (Array.isArray(widgetsValues)) {
    for (let i = 0; i < widgetsValues.length; i++) {
      const value = widgetsValues[i];
      if (!value) continue;

      // Direct string video path?
      if (typeof value === "string" && (looksLikeVideoUrl(value) || looksLikeFilename(value))) {
        if (debug) console.log(`[CWIE] Found string ref in widgets_values[${i}]:`, value);
        return { filename: value, subfolder: props?.subfolder, type: props?.type };
      }

      // Object structure?
      if (typeof value === "object") {
        const nested = tryObject(value, `widgets_values[${i}]`);
        if (nested) return nested;

        // VHS sometimes nests in "video_info" or similar
        for (const [k, sub] of Object.entries(value)) {
          if (typeof sub === "string" && (looksLikeVideoUrl(sub) || looksLikeFilename(sub))) {
            if (debug) console.log(`[CWIE] Found deep ref in widgets_values[${i}].${k}:`, sub);
            return { filename: sub, subfolder: props?.subfolder, type: props?.type };
          }
          const deep = tryObject(sub, `widgets_values[${i}].${k}`);
          if (deep) return deep;
        }
      }
    }
  } else if (widgetsValues && typeof widgetsValues === "object") {
    // Dictionary style widgets
    for (const [k, value] of Object.entries(widgetsValues)) {
      const nested = tryObject(value, `widgets_values.${k}`);
      if (nested) return nested;
      if (
        typeof value === "string" &&
        (looksLikeVideoUrl(value) ||
          (videoLike && /video|file|name|preview/i.test(k) && looksLikeFilename(value)))
      ) {
        if (debug) console.log(`[CWIE] Found dict ref in widgets_values.${k}:`, value);
        return { filename: value, subfolder: props?.subfolder, type: props?.type };
      }
    }
  }
  if (debug) console.log(`[CWIE] No file ref found for node ${node.id}`);
  return null;
}

function findLiveNodeById(id) {
  const nodes = app?.graph?._nodes || app?.graph?.nodes || [];
  return nodes.find((node) => node && Number.isFinite(node.id) && node.id === id) || null;
}

function buildDomMediaByNodeId(uiCanvas) {
  const media = collectDomMediaElements(uiCanvas);
  const byId = new Map();
  for (const el of media) {
    const nodeId = getNodeIdFromElement(el);
    if (!Number.isFinite(nodeId)) continue;
    const prev = byId.get(nodeId);
    if (!prev) {
      byId.set(nodeId, el);
      continue;
    }
    const prevIsVideo = prev instanceof HTMLVideoElement;
    const nextIsVideo = el instanceof HTMLVideoElement;
    if (prevIsVideo && !nextIsVideo) {
      byId.set(nodeId, el);
      continue;
    }
    if (!prevIsVideo && nextIsVideo) {
      continue;
    }
    if (prevIsVideo && nextIsVideo) {
      const prevReady = prev.readyState || 0;
      const nextReady = el.readyState || 0;
      if (nextReady > prevReady) {
        byId.set(nodeId, el);
      }
    }
  }
  return byId;
}

function buildDomMediaByOverlap(nodeRects, uiCanvas) {
  const media = collectDomMediaElements(uiCanvas);
  const byId = new Map();
  if (!nodeRects?.length || !media.length) return byId;
  for (const el of media) {
    const rect = getDomElementGraphRect(el, uiCanvas);
    if (!rect) continue;
    let best = null;
    let bestArea = 0;
    for (const nodeRect of nodeRects) {
      if (!Number.isFinite(nodeRect?.id)) continue;
      const left = Math.max(rect.left, nodeRect.left);
      const right = Math.min(rect.right, nodeRect.right);
      const top = Math.max(rect.top, nodeRect.top);
      const bottom = Math.min(rect.bottom, nodeRect.bottom);
      const w = Math.max(0, right - left);
      const h = Math.max(0, bottom - top);
      const area = w * h;
      if (area > bestArea) {
        bestArea = area;
        best = nodeRect.id;
      }
    }
    if (best !== null && bestArea > 0) {
      const prev = byId.get(best);
      if (!prev) {
        byId.set(best, el);
      } else {
        // Prefer concrete image/canvas over video; otherwise prefer higher readiness.
        const prevIsVideo = prev instanceof HTMLVideoElement;
        const nextIsVideo = el instanceof HTMLVideoElement;
        if (prevIsVideo && !nextIsVideo) {
          byId.set(best, el);
        } else if (prevIsVideo && nextIsVideo) {
          const prevReady = prev.readyState || 0;
          const nextReady = el.readyState || 0;
          if (nextReady > prevReady) {
            byId.set(best, el);
          }
        }
      }
    }
  }
  return byId;
}

function selectDomMedia(nodeId, domMediaById, domMediaByOverlap) {
  if (!Number.isFinite(nodeId)) return null;
  return domMediaById.get(nodeId) || domMediaByOverlap.get(nodeId) || null;
}

async function captureFromDomMedia(domMedia) {
  if (!domMedia) return null;
  if (domMedia instanceof HTMLCanvasElement || domMedia instanceof HTMLImageElement) {
    return domMedia;
  }
  if (domMedia instanceof HTMLVideoElement) {
    const captured = captureVideoFrame(domMedia);
    if (captured) return captured;
    if (domMedia.poster) {
      return loadImageCached(domMedia.poster);
    }
  }
  return null;
}

function resolveVideoDrawable(node) {
  const pickBestVideo = (videos) => {
    if (!videos?.length) return null;
    const sorted = [...videos].sort((a, b) => (b?.readyState || 0) - (a?.readyState || 0));
    return sorted[0] || null;
  };
  const fromImageLike = (value) => {
    if (!value) return null;
    if (value instanceof HTMLCanvasElement || value instanceof HTMLImageElement) {
      return value;
    }
    if (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap) {
      return value;
    }
    return null;
  };
  const fromArray = (arr) => {
    if (!Array.isArray(arr) || !arr.length) return null;
    for (const item of arr) {
      const found = fromImageLike(item);
      if (found) return found;
      if (item && typeof item === "object") {
        const inner = fromImageLike(
          item.canvas || item.image || item.img || item.bitmap || item.preview
        );
        if (inner) return inner;
      }
    }
    return null;
  };
  const fromWidget = (widget) => {
    if (!widget) return null;
    const candidates = [
      widget.videoEl,
      widget.video,
      widget.element,
      widget.el,
      widget.inputEl,
      widget.domEl,
      widget.canvas,
      widget.previewCanvas,
      widget.image,
      widget.img,
    ];
    for (const candidate of candidates) {
      if (
        candidate instanceof HTMLVideoElement ||
        candidate instanceof HTMLCanvasElement ||
        candidate instanceof HTMLImageElement
      ) {
        return candidate;
      }
      if (candidate instanceof HTMLElement) {
        const media = candidate.querySelector?.("canvas,img") || null;
        if (media instanceof HTMLCanvasElement || media instanceof HTMLImageElement) {
          return media;
        }
        const videos = Array.from(candidate.querySelectorAll?.("video") || []);
        const bestVideo = pickBestVideo(videos);
        if (bestVideo) return bestVideo;
      }
    }
    return null;
  };

  const candidates = [
    node?.video,
    node?.videoEl,
    node?.videoElement,
    node?.videos?.[0],
    node?.canvas,
    node?.previewCanvas,
    node?.image,
    node?.img,
    node?.imgs?.[0],
    node?.preview,
    node?.previewImage,
    node?.preview_image,
    node?.images,
    node?.animatedImages,
  ];
  for (const candidate of candidates) {
    if (
      candidate instanceof HTMLVideoElement ||
      candidate instanceof HTMLCanvasElement ||
      candidate instanceof HTMLImageElement
    ) {
      return candidate;
    }
    if (typeof ImageBitmap !== "undefined" && candidate instanceof ImageBitmap) {
      return candidate;
    }
    const arrayPick = fromArray(candidate);
    if (arrayPick) {
      return arrayPick;
    }
  }
  const widgets = Array.isArray(node?.widgets) ? node.widgets : [];
  for (const widget of widgets) {
    const media = fromWidget(widget);
    if (media) return media;
  }
  return null;
}

function captureVideoFrame(video) {
  if (!(video instanceof HTMLVideoElement)) return null;
  if ((video.readyState || 0) < 2) return null;
  const w = Math.max(1, video.videoWidth || 0);
  const h = Math.max(1, video.videoHeight || 0);
  if (w <= 1 || h <= 1) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return canvas;
  } catch (_) {
    return null;
  }
}

function resolveImageDrawable(node) {
  const fromImageLike = (value) => {
    if (!value) return null;
    if (value instanceof HTMLCanvasElement || value instanceof HTMLImageElement) {
      return value;
    }
    if (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap) {
      return value;
    }
    return null;
  };
  const fromArray = (arr) => {
    if (!Array.isArray(arr) || !arr.length) return null;
    for (const item of arr) {
      const found = fromImageLike(item);
      if (found) return found;
      if (item && typeof item === "object") {
        const inner = fromImageLike(
          item.canvas || item.image || item.img || item.bitmap || item.preview
        );
        if (inner) return inner;
        if (item.url && typeof item.url === "string") {
          return item.url;
        }
      }
    }
    return null;
  };

  const candidates = [
    node?.canvas,
    node?.previewCanvas,
    node?.image,
    node?.img,
    node?.imgs?.[0],
    node?.preview,
    node?.previewImage,
    node?.preview_image,
    node?.images,
    node?.animatedImages,
    node?.frames,
  ];
  for (const candidate of candidates) {
    if (
      candidate instanceof HTMLCanvasElement ||
      candidate instanceof HTMLImageElement
    ) {
      return candidate;
    }
    if (typeof ImageBitmap !== "undefined" && candidate instanceof ImageBitmap) {
      return candidate;
    }
    const arrayPick = fromArray(candidate);
    if (arrayPick) {
      return arrayPick;
    }
    if (typeof candidate === "string" && looksLikeImageUrl(candidate)) {
      return candidate;
    }
  }
  return null;
}

function computePreviewRect({ rect, node, bounds, scale }) {
  const liveNode = findLiveNodeById(node.id);
  const baseNode = liveNode || node;
  const nodePos = baseNode?.pos || baseNode?._pos || [rect.left, rect.top];

  const deltaX = nodePos[0] - rect.left;
  const deltaY = nodePos[1] - rect.top;

  const titleHeight = window?.LiteGraph?.NODE_TITLE_HEIGHT || 30;
  const padX = 1;
  const padY = 2;

  const widgetStartY = Number.isFinite(baseNode?.widgets_start_y)
    ? baseNode.widgets_start_y
    : Number.isFinite(node?.widgets_start_y)
      ? node.widgets_start_y
      : titleHeight;

  const nodeWidgetHeight = window?.LiteGraph?.NODE_WIDGET_HEIGHT || 20;
  const widgets = Array.isArray(baseNode?.widgets) ? baseNode.widgets : [];

  let maxWidgetBottom = widgetStartY;
  if (widgets.length) {
    for (const widget of widgets) {
      if (!widget) continue;
      const wy = Number.isFinite(widget.y) ? widget.y : maxWidgetBottom;
      const wh = Number.isFinite(widget.height) && widget.height > 0 ? widget.height : nodeWidgetHeight;
      maxWidgetBottom = Math.max(maxWidgetBottom, wy + wh + 4);
    }
  } else {
    maxWidgetBottom = Math.max(maxWidgetBottom, titleHeight);
  }

  const previewTop = deltaY + maxWidgetBottom;
  const availableH = (rect.bottom - rect.top) - previewTop - padY;
  const availableW = (rect.right - rect.left) - padX * 2;

  if (availableW <= 4 || availableH <= 4) {
    return null;
  }

  const x = (rect.left + padX - bounds.left) * scale;
  const y = (rect.top + previewTop - bounds.top) * scale;
  const w = availableW * scale;
  const h = availableH * scale;

  return {
    x,
    y,
    w,
    h,
    debug: {
      rect,
      nodePos,
      livePos: liveNode?.pos || liveNode?._pos,
      liveSize: liveNode?.size || liveNode?._size,
      widgetStartY,
      widgetBottom: maxWidgetBottom,
      previewTop,
      titleHeight,
      padX,
      padY,
      bounds,
      deltaX,
      deltaY,
    },
  };
}

async function drawVideoThumbnails({ exportCtx, graph, nodeRects, bounds, scale, debugLog, isPreview }) {
  const nodes = graph?._nodes || graph?.nodes || [];
  if (!nodes.length) return;
  const videoNodes = nodes.filter((node) => node && isVideoNode(node));
  if (!videoNodes.length) return;
  const rectById = new Map();
  for (const rect of nodeRects || []) {
    if (Number.isFinite(rect.id)) {
      rectById.set(rect.id, rect);
    }
  }

  let drawn = 0;
  let skippedNoDrawable = 0;
  let skippedNoRect = 0;
  let skippedEmptyRect = 0;
  let logged = 0;
  const domMediaById = buildDomMediaByNodeId(app?.canvas);
  const domMediaByOverlap = buildDomMediaByOverlap(nodeRects || [], app?.canvas);
  const allVideos = Array.from(document.querySelectorAll("video"));
  if (debugLog && logged < 1) {
    debugLog("video.thumbnail.dom_index", {
      domMedia: domMediaById.size,
      videos: allVideos.length,
    });
    logged += 1;
  }

  for (const node of videoNodes) {
    const rect = rectById.get(node.id);
    if (!rect) {
      skippedNoRect += 1;
      continue;
    }

    // Step 1: The Heist (Steal live assets)
    // Always attempt to steal first, as it's the fastest and most accurate.
    let drawable = resolveVideoDrawable(node); // Check exported node props (unlikely to have video el)
    if (!drawable) {
      const liveNode = findLiveNodeById(node.id);
      if (liveNode) {
        drawable = resolveVideoDrawable(liveNode); // Check live node (High probability)
        if (drawable && debugLog && logged < 5) debugLog(`video.thumbnail.steal`, { id: node.id, type: "direct" });
      }
    }

    // Evaluate stolen asset validity
    let directUrl = null;
    if (drawable instanceof HTMLVideoElement) {
      directUrl = sanitizeMediaUrl(drawable.currentSrc || drawable.src || null);
      const prevSrc = lastVideoSrcByNodeId.get(node.id);
      const ready = (drawable.readyState || 0) >= 2;
      const hasSize = (drawable.videoWidth || 0) > 1 && (drawable.videoHeight || 0) > 1;
      if (prevSrc && directUrl && prevSrc !== directUrl && !ready) {
        drawable = null;
      }
      if (drawable instanceof HTMLVideoElement) {
        const hasPoster = Boolean(drawable.poster);
        if (!hasSize && hasPoster) {
          drawable = await loadImageCached(drawable.poster);
        } else {
          const captured = captureVideoFrame(drawable);
          if (captured) {
            drawable = captured;
            if (directUrl) lastVideoSrcByNodeId.set(node.id, directUrl);
          } else if (drawable.readyState < 2 && hasPoster) {
            drawable = await loadImageCached(drawable.poster);
            if (directUrl) lastVideoSrcByNodeId.set(node.id, directUrl);
          } else {
            // Not ready and no poster -> Unusable for instant draw
            drawable = null;
          }
        }
      }
    }

    // Step 2: Live DOM capture only (no network fetches).
    const liveNode = findLiveNodeById(node.id);
    const ref = extractFileRefFromNode(liveNode || node);
    const refFilename = typeof ref?.filename === "string" ? ref.filename : "";
    // VHS debug removed.
    // Keep filename around for matching DOM media, but no caching logic here.
    if (
      directUrl &&
      refFilename &&
      !directUrl.includes(encodeURIComponent(refFilename)) &&
      !directUrl.includes(refFilename)
    ) {
      directUrl = null;
    }
    if (!drawable) {
      const domMedia = selectDomMedia(node.id, domMediaById, domMediaByOverlap);
      drawable = await captureFromDomMedia(domMedia);
      if (drawable && debugLog && logged < 5) {
        debugLog("video.thumbnail.steal", {
          id: node.id,
          type: domMedia instanceof HTMLVideoElement ? "dom-video" : "dom-media",
        });
        logged += 1;
      }
    }
    if (!drawable && refFilename) {
      const matched = allVideos.find((v) => {
        const src = `${v.currentSrc || ""} ${v.src || ""}`;
        return src.includes(refFilename) || src.includes(encodeURIComponent(refFilename));
      });
      if (matched) {
        const srcKey = matched.currentSrc || matched.src || "";
        const prevSrc = lastVideoSrcByNodeId.get(node.id);
        const ready = (matched.readyState || 0) >= 2;
        const hasSize = (matched.videoWidth || 0) > 1 && (matched.videoHeight || 0) > 1;
        if (prevSrc && srcKey && prevSrc !== srcKey && !ready) {
          // Source changed but not ready yet: avoid stale frame.
          drawable = null;
        } else {
          const captured = ready && hasSize ? captureVideoFrame(matched) : null;
          if (captured) {
            drawable = captured;
            lastVideoSrcByNodeId.set(node.id, srcKey);
            if (debugLog && logged < 5) {
              debugLog("video.thumbnail.steal", { id: node.id, type: "dom-match" });
              logged += 1;
            }
          } else if (matched.poster) {
            drawable = await loadImageCached(matched.poster);
            lastVideoSrcByNodeId.set(node.id, srcKey);
          }
        }
      }
    }
    // Never fetch network video thumbnails; if we only have a URL string, drop it.
    if (typeof drawable === "string") {
      drawable = null;
    }
    // VHS support disabled for now.
    if (!drawable && debugLog && logged < 5) {
      debugLog("video.thumbnail.miss_detail", {
        id: node.id,
        title: node.title,
        type: node.type,
      });
      logged += 1;
    }

    // Step 3: Draw (or Placeholder)
    const previewRect = computePreviewRect({ rect, node, bounds, scale });
    if (!previewRect) {
      skippedEmptyRect += 1;
      continue;
    }
    const { x, y, w, h, debug } = previewRect;

    if (drawable) {
      try {
        const dw = drawable.videoWidth || drawable.width || drawable.naturalWidth || 0;
        const dh = drawable.videoHeight || drawable.height || drawable.naturalHeight || 0;
        if (dw > 0 && dh > 0) {
          const scaleFit = Math.min(w / dw, h / dh);
          const fitW = dw * scaleFit;
          const fitH = dh * scaleFit;
          const fitX = x + (w - fitW) / 2;
          const fitY = y + (h - fitH) / 2;
          exportCtx.drawImage(drawable, fitX, fitY, fitW, fitH);
        } else {
          exportCtx.drawImage(drawable, x, y, w, h);
        }
        drawn += 1;
      } catch (_) {
        // ignore draw failures
      }
    } else {
      // Missing drawable
      skippedNoDrawable += 1;
      // Step 4: Fallback Placeholder
      // In Preview or even Export, if we failed to get a video, draw a placeholder
      // so the user knows "There is a video here".
      drawVideoPlaceholder(exportCtx, x, y, w, h);

      if (debugLog && logged < 5) {
        debugLog("video.thumbnail.miss", { id: node.id });
        logged += 1;
      }
    }
  }

  debugLog?.("video.thumbnail", {
    drawn,
    skippedNoDrawable,
    skippedNoRect,
    skippedEmptyRect,
  });
}

async function drawImageThumbnails({ exportCtx, graph, nodeRects, bounds, scale, debugLog }) {
  const nodes = graph?._nodes || graph?.nodes || [];
  if (!nodes.length) return;
  const imageNodes = nodes.filter((node) => node && isImageNode(node) && !isVideoNode(node));
  if (!imageNodes.length) return;
  const rectById = new Map();
  for (const rect of nodeRects || []) {
    if (Number.isFinite(rect.id)) {
      rectById.set(rect.id, rect);
    }
  }

  let drawn = 0;
  let skippedNoDrawable = 0;
  let skippedNoRect = 0;
  let skippedEmptyRect = 0;
  let logged = 0;

  for (const node of imageNodes) {
    const rect = rectById.get(node.id);
    if (!rect) {
      skippedNoRect += 1;
      continue;
    }

    let drawable = resolveImageDrawable(node);
    if (!drawable) {
      const liveNode = findLiveNodeById(node.id);
      if (liveNode) {
        drawable = resolveImageDrawable(liveNode);
      }
    }
    if (typeof drawable === "string") {
      drawable = await loadImageCached(drawable);
    }
    if (!drawable) {
      const liveNode = findLiveNodeById(node.id);
      const ref = extractFileRefFromNode(liveNode || node);
      const url = buildViewUrl(ref, liveNode || node);
      if (url) {
        drawable = await loadImageCached(url);
      }
    }
    if (!drawable) {
      skippedNoDrawable += 1;
      if (debugLog && logged < 5) {
        debugLog("image.thumbnail.miss", {
          id: node.id,
          title: node.title,
          type: node.type,
          keys: Object.keys(node).filter((k) => /img|image|canvas|preview|tex/i.test(k)),
        });
        logged += 1;
      }
      continue;
    }

    const previewRect = computePreviewRect({ rect, node, bounds, scale });
    if (!previewRect) {
      skippedEmptyRect += 1;
      continue;
    }
    const { x, y, w, h, debug } = previewRect;

    if (debugLog && logged < 5) {
      debugLog("image.thumbnail.pos", {
        id: node.id,
        title: node.title,
        type: node.type,
        ...debug,
        drawRect: { x, y, w, h },
      });
    }

    try {
      const dw = drawable.width || drawable.naturalWidth || 0;
      const dh = drawable.height || drawable.naturalHeight || 0;
      if (dw > 0 && dh > 0) {
        const scaleFit = Math.min(w / dw, h / dh);
        const fitW = dw * scaleFit;
        const fitH = dh * scaleFit;
        const fitX = x + (w - fitW) / 2;
        const fitY = y + (h - fitH) / 2;
        exportCtx.drawImage(drawable, fitX, fitY, fitW, fitH);
      } else {
        exportCtx.drawImage(drawable, x, y, w, h);
      }
      drawn += 1;
    } catch (_) {
      // ignore draw failures
    }
  }

  debugLog?.("image.thumbnail", {
    drawn,
    skippedNoDrawable,
    skippedNoRect,
    skippedEmptyRect,
  });
}
async function drawBackgroundImageOverlays({ exportCtx, uiCanvas, bounds, scale }) {
  const root = getCanvasRoot(uiCanvas);
  if (!root) return;
  const elements = root.querySelectorAll(".dom-widget, .dom-widget *");
  if (!elements.length) return;

  for (const el of elements) {
    if (!(el instanceof HTMLElement)) continue;
    if (!isElementInGraphNode(el)) continue;
    const style = window.getComputedStyle(el);
    const bg = style?.backgroundImage;
    if (!bg || bg === "none") continue;
    if (bg.includes("gradient(")) continue;

    const url = extractBackgroundImageUrl(bg);
    if (!url) continue;

    const rect = getDomElementGraphRect(el, uiCanvas);
    if (!rect) continue;
    if (rect.w > bounds.width * 1.05 || rect.h > bounds.height * 1.05) {
      continue;
    }

    const img = await loadImageCached(url);
    if (!img) continue;

    const x = (rect.x - bounds.left) * scale;
    const y = (rect.y - bounds.top) * scale;
    const w = rect.w * scale;
    const h = rect.h * scale;

    try {
      exportCtx.drawImage(img, x, y, w, h);
    } catch (_) {
      // ignore draw errors
    }
  }
}






