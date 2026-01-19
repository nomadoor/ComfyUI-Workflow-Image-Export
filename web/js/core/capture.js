import { findGraphCanvas, findWorkflowRoot, getLiteGraphAccess } from "./detect.js";
import { getWorkflowBounds } from "./bounds.js";
import { createSvgSnapshot, renderDomToCanvas } from "./dom_capture.js";

function createFallbackCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#1f1f1f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#e5e5e5";
    ctx.font = "14px sans-serif";
    ctx.fillText("Workflow export placeholder", 16, 90);
  }
  return canvas;
}

function isTransparent(color) {
  if (!color) {
    return true;
  }
  const value = String(color).toLowerCase();
  return value === "transparent" || value === "rgba(0, 0, 0, 0)";
}

function resolveBackgroundColor(state, root) {
  if (state.background === "transparent") {
    return null;
  }
  if (state.background === "solid") {
    return state.solidColor || "#1f1f1f";
  }
  const target = root || document.body;
  const style = target ? window.getComputedStyle(target) : null;
  const color = style?.backgroundColor;
  if (!color || isTransparent(color)) {
    return "#1f1f1f";
  }
  return color;
}

function getScaleFromState(state, width, height) {
  const resolutionScale = state.outputResolution === "200%" ? 2 : 1;
  let scale = resolutionScale;

  const maxLongEdge = Number(state.maxLongEdge) || 0;
  if (maxLongEdge > 0) {
    const longEdge = Math.max(width * scale, height * scale);
    if (longEdge > maxLongEdge) {
      const downscale = maxLongEdge / longEdge;
      if (state.exceedMode === "tile") {
        // TODO: tile capture; fallback to downscale for now.
        scale *= downscale;
      } else {
        scale *= downscale;
      }
    }
  }

  return scale;
}

function scaleCanvas(source, scale) {
  if (scale === 1) {
    return source;
  }
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return source;
  }
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

function renderCanvasFromGraph(bounds, backgroundColor, space = "dom") {
  const graphCanvas = findGraphCanvas();
  if (!graphCanvas) {
    return null;
  }

  let screenBounds = bounds;

  if (space === "graph") {
    const access = getLiteGraphAccess();
    const ds = access?.canvas?.ds;
    if (ds) {
      // Create a local copy of bounds projected to screen space
      // LiteGraph: screen = (world + offset) * scale
      // But acts on the context.
      // Logic: x = (node.x + ds.offset[0]) * ds.scale
      screenBounds = {
        left: (bounds.left + ds.offset[0]) * ds.scale,
        top: (bounds.top + ds.offset[1]) * ds.scale,
        width: bounds.width * ds.scale,
        height: bounds.height * ds.scale,
      };

      // Since these are essentially relative to the canvas 0,0 (drawing surface),
      // we need to adjust for the fact that the next step subtracts rect.left.
      // Actually, if we use the canvas DS, we get coordinates relative to the canvas origin (0,0 of the canvas element).
      // checking below logic: 
      // sx = (screenBounds.left - rect.left) * scaleX is for GLOBAL screen coordinates (like getBoundingClientRect).

      // So we need to convert our Canvas-Relative coords to Global Screen Coords?
      // screenBounds.left IS relative to Canvas Top-Left (in CSS pixels effectively, assuming scale=1 of canvas element)

      const rect = graphCanvas.getBoundingClientRect();
      screenBounds.left += rect.left;
      screenBounds.top += rect.top;

    } else {
      // Cannot transform; safest is to abort or try raw (likely fail)
      // defaulting to bounds as is.
    }
  }

  const rect = graphCanvas.getBoundingClientRect();
  const scaleX = graphCanvas.width / rect.width;
  const scaleY = graphCanvas.height / rect.height;

  const sx = (screenBounds.left - rect.left) * scaleX;
  const sy = (screenBounds.top - rect.top) * scaleY;
  const sw = screenBounds.width * scaleX;
  const sh = screenBounds.height * scaleY;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(sw));
  canvas.height = Math.max(1, Math.ceil(sh));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  if (backgroundColor) {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Draw the section of the main canvas
  ctx.drawImage(graphCanvas, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function renderGraphFromLiteGraph(bounds, backgroundColor) {
  const access = getLiteGraphAccess();
  if (!access) {
    return null;
  }
  const { graph, LGraphCanvas } = access;
  if (!graph || !LGraphCanvas) {
    return null;
  }

  const width = Math.max(1, Math.ceil(bounds.width));
  const height = Math.max(1, Math.ceil(bounds.height));
  const offscreen = document.createElement("canvas");
  offscreen.width = width;
  offscreen.height = height;

  let liteCanvas = null;
  try {
    liteCanvas = new LGraphCanvas(offscreen, graph);
    if (liteCanvas?.ds) {
      liteCanvas.ds.scale = 1;
      liteCanvas.ds.offset = [-bounds.left, -bounds.top];
    }
    liteCanvas.pause_rendering = true;
    liteCanvas.draw(true, true);
  } catch (error) {
    return null;
  }

  if (!backgroundColor) {
    return offscreen;
  }

  const finalCanvas = document.createElement("canvas");
  finalCanvas.width = width;
  finalCanvas.height = height;
  const ctx = finalCanvas.getContext("2d");
  if (!ctx) {
    return offscreen;
  }
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(offscreen, 0, 0);
  return finalCanvas;
}

export async function captureWorkflowImage(state, { log } = {}) {
  const { bounds, root, hasDomNodes, space } = getWorkflowBounds({ padding: state.padding });

  if (!bounds) {
    return {
      error: "Failed to resolve workflow bounds.",
    };
  }

  const workflowRoot = root || findWorkflowRoot();
  const backgroundColor = resolveBackgroundColor(state, workflowRoot);

  if (state.format === "svg") {
    try {
      const svgUrl = createSvgSnapshot(workflowRoot, bounds, backgroundColor);
      return { dataUrl: svgUrl, format: "svg" };
    } catch (error) {
      log?.("svg capture failed, falling back to png", error);
    }
  }

  let canvas = null;
  const rootIsCanvas = workflowRoot instanceof HTMLCanvasElement;
  if (space === "dom" && workflowRoot && hasDomNodes && !rootIsCanvas) {
    try {
      canvas = await renderDomToCanvas(workflowRoot, bounds, backgroundColor);
    } catch (error) {
      log?.("dom capture failed, falling back to canvas", error);
    }
  }

  if (!canvas && space === "graph") {
    canvas = renderGraphFromLiteGraph(bounds, backgroundColor);
  }

  if (!canvas) {
    canvas = renderCanvasFromGraph(bounds, backgroundColor, space) || createFallbackCanvas();
  }

  const scale = getScaleFromState(state, canvas.width, canvas.height);
  const scaled = scaleCanvas(canvas, scale);

  const mime = state.format === "webp" ? "image/webp" : "image/png";
  const dataUrl = scaled.toDataURL(mime);
  return { dataUrl, format: state.format === "webp" ? "webp" : "png" };
}
