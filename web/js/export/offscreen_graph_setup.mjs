import { app } from "/scripts/app.js";
import { syncLiveGraphState } from "./live_graph_sync.mjs";

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

export function copyRenderSettings(fromCanvas, toCanvas) {
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

export function configureTransform(offscreen, bbox, padding) {
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
  ds.scale = scaleFactor;
  ds.offset[0] = -bbox.minX + padding - (tileOffsetX / scaleFactor);
  ds.offset[1] = -bbox.minY + padding - (tileOffsetY / scaleFactor);
}

export function configureVisibleArea(offscreen, bbox, visibleBounds = null) {
  if (!offscreen) return;
  if (typeof offscreen.computeVisibleArea === "function") {
    try {
      offscreen.computeVisibleArea();
    } catch (_) {}
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

export function safeCleanup(offscreen, graph) {
  try {
    if (typeof offscreen?.stopRendering === "function") {
      offscreen.stopRendering();
    }
  } catch (_) {}
  try {
    if (typeof offscreen?.setCanvas === "function") {
      offscreen.setCanvas(null);
    }
  } catch (_) {}
  try {
    if (typeof offscreen?.unbind_events === "function") {
      offscreen.unbind_events();
    }
  } catch (_) {}
  try {
    if (typeof offscreen?.clear === "function") {
      offscreen.clear();
    }
  } catch (_) {}
  try {
    if (typeof graph?.clear === "function") {
      graph.clear();
    }
  } catch (_) {}
  try {
    if (typeof graph?.stop === "function") {
      graph.stop();
    }
  } catch (_) {}
}

export async function prepareGraph(workflowJson, debugLog) {
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
