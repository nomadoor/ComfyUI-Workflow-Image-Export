import { app } from "/scripts/app.js";
import { computeGraphBBox } from "./bbox.js";
import { applyBackgroundMode } from "./background_modes.js";
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
  isElementInGraphNode,
} from "../core/overlays/dom_utils.js";

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
    "video",
    "videos",
    "videoEl",
    "videoElement",
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
  ds.scale = 1;
  ds.offset[0] = -bbox.minX + padding;
  ds.offset[1] = -bbox.minY + padding;
}

function configureVisibleArea(offscreen, bbox) {
  if (!offscreen) return;
  // Let LiteGraph compute visible area from ds + canvas size when possible.
  if (typeof offscreen.computeVisibleArea === "function") {
    offscreen.computeVisibleArea();
    return;
  }
  const visibleArea = [bbox.paddedMinX, bbox.paddedMinY, bbox.width, bbox.height];
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

export async function renderGraphOffscreen(workflowJson, options = {}) {
  const debug = Boolean(options.debug);
  const debugLog = debug
    ? (label, payload) => {
      console.log(`[CWIE][Offscreen][dom] ${label}`, payload);
    }
    : null;
  const LGraphRef = resolveGraphConstructor();
  const LGraphCanvasRef = resolveCanvasConstructor();
  if (!LGraphRef || !LGraphCanvasRef) {
    throw new Error("Offscreen render: LiteGraph constructors not available.");
  }

  const padding = Number(options.padding) || 0;
  const graph = new LGraphRef();
  configureGraph(graph, workflowJson);
  syncLiveNodeMedia(graph, app?.graph, debugLog);
  syncLiveNodeText(graph, app?.graph);
  syncLiveGroups(graph, app?.graph);
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
      if (n.type === "VHS_LoadVideo") {
        console.log("[CWIE][Offscreen] vhs.widgets", {
          id: n.id,
          widget_names: Array.isArray(n.widgets) ? n.widgets.map((w) => w?.name || w?.options?.name) : [],
          widget_values: Array.isArray(n.widgets) ? n.widgets.map((w) => w?.value ?? w?._value) : [],
          widgets_values: n.widgets_values,
        });
      }
    });
  }

  const bbox = computeGraphBBox(graph, {
    padding,
    debug,
    selectedNodeIds: options.selectedNodeIds,
    useSelectionOnly: options.cropToSelection,
  });
  applyRenderFilter(graph, options.selectedNodeIds, options.renderFilter);
  applyLinkFilter(graph, options.selectedNodeIds, options.linkFilter);
  const width = Math.max(1, Math.ceil(bbox.width));
  const height = Math.max(1, Math.ceil(bbox.height));
  if (debug) {
    console.log("[CWIE][Offscreen] bbox", bbox);
    console.log("[CWIE][Offscreen] canvas", { width, height, padding });
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) {
    throw new Error("Offscreen render: 2d context not available.");
  }

  const offscreen = new LGraphCanvasRef(canvas, graph);
  offscreen.canvas = canvas;
  offscreen.ctx = ctx;
  offscreen.render_canvas_border = false;

  if (typeof offscreen.resize === "function") {
    offscreen.resize(width, height);
  }

  copyRenderSettings(app?.canvas, offscreen);
  applyBackgroundMode(offscreen, options);
  configureTransform(offscreen, bbox, padding);
  configureVisibleArea(offscreen, bbox);
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

  offscreen.draw(true, true);

  // Composite on a fresh canvas so overlays are not affected by LiteGraph
  // transform/clip state that might linger on the original context.
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = canvas.width;
  outputCanvas.height = canvas.height;
  const outputCtx = outputCanvas.getContext("2d", { alpha: true });
  if (!outputCtx) {
    throw new Error("Offscreen render: output 2d context not available.");
  }
  outputCtx.drawImage(canvas, 0, 0);

  if (options.includeDomOverlays !== false) {
    const bounds = {
      left: bbox.paddedMinX,
      top: bbox.paddedMinY,
      right: bbox.paddedMinX + bbox.width,
      bottom: bbox.paddedMinY + bbox.height,
      width: bbox.width,
      height: bbox.height,
    };
    const nodeRects = collectNodeRects(graph);
    await drawBackgroundImageOverlays({ exportCtx: outputCtx, uiCanvas: app?.canvas, bounds, scale: 1 });
    drawImageOverlays({ exportCtx: outputCtx, uiCanvas: app?.canvas, bounds, scale: 1, debugLog });
    drawVideoOverlays({ exportCtx: outputCtx, uiCanvas: app?.canvas, bounds, scale: 1, nodeRects, debugLog });
    drawTextOverlays({
      exportCtx: outputCtx,
      uiCanvas: app?.canvas,
      graph,
      bounds,
      scale: 1,
      nodeRects,
      debugLog,
    });
  } else {
    const bounds = {
      left: bbox.paddedMinX,
      top: bbox.paddedMinY,
      right: bbox.paddedMinX + bbox.width,
      bottom: bbox.paddedMinY + bbox.height,
      width: bbox.width,
      height: bbox.height,
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
    if (textCtx) {
      textCtx.setTransform(1, 0, 0, 1, 0, 0);
      textCtx.globalAlpha = 1;
      drawWidgetTextFallback({
        exportCtx: textCtx,
        graph,
        bounds,
        scale: 1,
        coveredNodeIds: null,
        debugLog,
      });
      outputCtx.drawImage(textOverlay, 0, 0);
    }
    await drawImageThumbnails({
      exportCtx: outputCtx,
      graph,
      nodeRects,
      bounds,
      scale: 1,
      debugLog,
    });
    if (!options.previewFast) {
      await drawVideoThumbnails({
        exportCtx: outputCtx,
        graph,
        nodeRects,
        bounds,
        scale: 1,
        debugLog,
      });
    }
  }

  return {
    canvas: outputCanvas,
    ctx: outputCtx,
    bbox,
    cleanup: () => safeCleanup(offscreen, graph),
  };
}

const bgImageCache = new Map();
const videoThumbCache = new Map();

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

function loadVideoThumbnail(url) {
  if (!url) return Promise.resolve(null);
  if (videoThumbCache.has(url)) {
    return videoThumbCache.get(url);
  }
  const promise = new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto"; // Force load

    let resolved = false;
    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
    };

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    // Fast-fail missing resources before spinning up a <video>.
    fetch(url, { method: "HEAD" })
      .then((resp) => {
        if (!resp.ok) {
          finish(null);
        }
      })
      .catch(() => {
        // Ignore fetch errors; the video element may still load.
      });

    // Safety timeout
    const timeout = setTimeout(() => {
      if (window.__cwie__?.debug) console.warn(`[CWIE] Video load timeout: ${url}`);
      finish(null);
    }, 1200);

    video.addEventListener("loadeddata", () => {
      // Seek to a little bit in to avoid black start frames
      video.currentTime = 0.5;
    }, { once: true });

    video.addEventListener("seeked", () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 1;
        canvas.height = video.videoHeight || 1;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          finish(null);
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas);
      } catch (e) {
        if (window.__cwie__?.debug) console.error(`[CWIE] Video draw failed:`, e);
        finish(null);
      }
    }, { once: true });

    video.addEventListener("error", (e) => {
      clearTimeout(timeout);
      if (window.__cwie__?.debug) console.error(`[CWIE] Video load error: ${url}`, e);
      finish(null);
    }, { once: true });

    video.src = url;
  });
  videoThumbCache.set(url, promise);
  return promise;
}

function isVideoNode(node) {
  const text = `${node?.title || ""} ${node?.type || ""}`.toLowerCase();
  return text.includes("video") || text.includes("vhs");
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

function buildViewUrl(ref) {
  if (!ref?.filename) return null;
  const url = new URL("/view", window.location.origin);
  url.searchParams.set("filename", ref.filename);
  if (ref.subfolder) {
    url.searchParams.set("subfolder", ref.subfolder);
  }
  if (ref.type) {
    url.searchParams.set("type", ref.type);
  } else {
    url.searchParams.set("type", "input");
  }
  return url.toString();
}

function extractFileRefFromNode(node) {
  if (!node) return null;
  const debug = window.__cwie__?.debug;
  const videoLike = (() => {
    const text = `${node?.title || ""} ${node?.type || ""}`.toLowerCase();
    return text.includes("video") || text.includes("vhs");
  })();

  // Helper to deep check for filename/video keys
  const tryObject = (obj, path, depth = 0) => {
    if (!obj || typeof obj !== "object") return null;

    // VHS often uses 'video' or 'filenames' keys
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

function resolveVideoDrawable(node) {
  const toMediaUrl = (item) => {
    if (!item || typeof item !== "object") return null;
    const filename = item.filename || item.file || item.name;
    if (!filename) return null;
    const url = new URL("/view", window.location.origin);
    url.searchParams.set("filename", filename);
    if (item.subfolder) {
      url.searchParams.set("subfolder", item.subfolder);
    }
    if (item.type) {
      url.searchParams.set("type", item.type);
    }
    return url.toString();
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
        const url = toMediaUrl(item);
        if (url) return url;
        if (item.url && typeof item.url === "string") {
          return item.url;
        }
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
  return null;
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

async function drawVideoThumbnails({ exportCtx, graph, nodeRects, bounds, scale, debugLog }) {
  const nodes = graph?._nodes || graph?.nodes || [];
  if (!nodes.length) return;
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
  for (const node of nodes) {
    if (!node || !isVideoNode(node)) continue;
    const rect = rectById.get(node.id);
    if (!rect) {
      skippedNoRect += 1;
      continue;
    }

    let drawable = resolveVideoDrawable(node);
    if (!drawable) {
      const liveNode = findLiveNodeById(node.id);
      if (liveNode) {
        drawable = resolveVideoDrawable(liveNode);
      }
    }
    if (!drawable && debugLog && logged < 5) {
      const images = node?.images;
      const animated = node?.animatedImages;
      debugLog("video.thumbnail.inspect", {
        id: node.id,
        title: node.title,
        type: node.type,
        previewMediaType: node?.previewMediaType,
        imagesType: Array.isArray(images) ? "array" : typeof images,
        imagesLen: Array.isArray(images) ? images.length : 0,
        images0: images?.[0] ? Object.keys(images[0]) : null,
        animatedType: Array.isArray(animated) ? "array" : typeof animated,
        animatedLen: Array.isArray(animated) ? animated.length : 0,
        animated0: animated?.[0] ? Object.keys(animated[0]) : null,
      });
    }
    if (drawable instanceof HTMLVideoElement) {
      if (drawable.readyState < 2 && drawable.poster) {
        drawable = await loadImageCached(drawable.poster);
      }
    }
    if (typeof drawable === "string") {
      if (looksLikeVideoUrl(drawable)) {
        drawable = await loadVideoThumbnail(drawable);
      } else {
        drawable = await loadImageCached(drawable);
      }
    }
    if (!drawable) {
      const liveNode = findLiveNodeById(node.id);
      const ref = extractFileRefFromNode(liveNode || node);
      const url = buildViewUrl(ref);
      if (url) {
        if (looksLikeVideoUrl(ref?.filename)) {
          drawable = await loadVideoThumbnail(url);
        } else {
          drawable = await loadImageCached(url);
        }
      }
    }
    if (!drawable) {
      skippedNoDrawable += 1;
      if (debugLog && logged < 5) {
        debugLog("video.thumbnail.miss", {
          id: node.id,
          title: node.title,
          type: node.type,
          keys: Object.keys(node).filter((k) => /video|img|image|canvas|preview|tex/i.test(k)),
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
      debugLog("video.thumbnail.pos", {
        id: node.id,
        title: node.title,
        type: node.type,
        ...debug,
        drawRect: { x, y, w, h },
      });
    }

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

  for (const node of nodes) {
    if (!node || !isImageNode(node) || isVideoNode(node)) continue;
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
      const url = buildViewUrl(ref);
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
