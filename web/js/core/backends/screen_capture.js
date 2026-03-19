import { app } from "/scripts/app.js";
import { computeGraphBBox } from "../../export/bbox.js";
import {
  getEffectivePxRatio,
  getDomElementGraphRect,
  collectWidgetElementsFromNodes,
} from "../overlays/dom_utils.js";
import { toBlobAsync } from "../utils.js";

function captureVideoFrame(video) {
  if (!(video instanceof HTMLVideoElement)) return null;
  if ((video.readyState || 0) < 2) return null;
  const w = Math.max(1, video.videoWidth || 0);
  const h = Math.max(1, video.videoHeight || 0);
  if (w <= 1 || h <= 1) return null;
  try {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")?.drawImage(video, 0, 0, w, h);
    return c;
  } catch (_) {
    return null;
  }
}

async function tryCaptureDivAsImage(el) {
  if (!(el instanceof HTMLElement)) return null;
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  try {
    const clone = el.cloneNode(true);
    const style = window.getComputedStyle(el);
    const inlineStyles = [];
    for (const prop of style) {
      try { inlineStyles.push(`${prop}:${style.getPropertyValue(prop)}`); } catch (_) {}
    }
    clone.style.cssText = inlineStyles.join(";");
    const svgStr = [
      `<svg xmlns="http://www.w3.org/2000/svg"`,
      ` width="${Math.ceil(rect.width)}" height="${Math.ceil(rect.height)}">`,
      `<foreignObject width="100%" height="100%">`,
      `<body xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:0">`,
      clone.outerHTML,
      `</body></foreignObject></svg>`,
    ].join("");
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  } catch (_) {
    return null;
  }
}

function resolveDrawable(el) {
  if (el instanceof HTMLCanvasElement) return el;
  if (el instanceof HTMLImageElement) return el;
  if (el instanceof HTMLVideoElement) return captureVideoFrame(el);
  return null;
}

function computeFitTransform(bbox, canvasRect, padding) {
  const cssW = canvasRect.width;
  const cssH = canvasRect.height;
  if (!cssW || !cssH) return null;

  const paddedMinX = bbox.minX - padding;
  const paddedMinY = bbox.minY - padding;
  const graphW = bbox.maxX - bbox.minX + padding * 2;
  const graphH = bbox.maxY - bbox.minY + padding * 2;

  const scale = Math.min(cssW / graphW, cssH / graphH);

  // screen_css = (graphCoord + offset) * scale
  // Center: paddedMinX should appear at (cssW - graphW * scale) / 2
  // => offset = (cssW - graphW * scale) / (2 * scale) - paddedMinX
  const offsetX = (cssW - graphW * scale) / (2 * scale) - paddedMinX;
  const offsetY = (cssH - graphH * scale) / (2 * scale) - paddedMinY;

  return { scale, offsetX, offsetY, paddedMinX, paddedMinY, graphW, graphH };
}

export async function captureScreen(options = {}) {
  const padding = Number.isFinite(Number(options.padding)) ? Number(options.padding) : 20;
  const uiCanvas = app.canvas;
  const canvasEl = uiCanvas?.canvas;
  const ds = uiCanvas?.ds;
  const graph = app.graph;

  if (!canvasEl || !ds || !graph) {
    throw new Error("Screen capture: ComfyUI canvas not available.");
  }

  const bbox = computeGraphBBox(graph, { padding: 0 });
  const pxRatio = getEffectivePxRatio(canvasEl);
  const canvasRect = canvasEl.getBoundingClientRect();

  const fit = computeFitTransform(bbox, canvasRect, padding);
  if (!fit) throw new Error("Screen capture: canvas has no dimensions.");

  // Collect DOM widget elements and their graph-space rects BEFORE changing transform.
  // getDomElementGraphRect uses the live ds, so positions are accurate right now.
  const rawCaptures = [];
  for (const { element: el } of collectWidgetElementsFromNodes(graph)) {
    const graphRect = getDomElementGraphRect(el, uiCanvas);
    if (!graphRect || graphRect.w <= 0 || graphRect.h <= 0) continue;
    rawCaptures.push({ el, graphRect });
  }

  // Resolve drawables. Async div capture (foreignObject) must happen before
  // we mutate ds, because getBoundingClientRect is used inside tryCaptureDivAsImage.
  const captures = [];
  for (const { el, graphRect } of rawCaptures) {
    const immediate = resolveDrawable(el);
    if (immediate) {
      captures.push({ drawable: immediate, graphRect });
    } else {
      // HTMLElement (div, custom widget) — try foreignObject
      const drawable = await tryCaptureDivAsImage(el);
      if (drawable) {
        captures.push({ drawable, graphRect });
      }
    }
  }

  // Apply fit transform and draw synchronously.
  // LiteGraph draw() is synchronous; the browser does not paint until the next
  // animation frame, so the user never sees the intermediate state.
  const savedScale = ds.scale;
  const savedOffset = [ds.offset[0], ds.offset[1]];

  ds.scale = fit.scale;
  ds.offset[0] = fit.offsetX;
  ds.offset[1] = fit.offsetY;

  if (typeof uiCanvas.draw === "function") {
    uiCanvas.draw(true, true);
  }

  // Source rect in device pixels (center of canvas = center of graph).
  const marginX = (canvasRect.width - fit.graphW * fit.scale) / 2;
  const marginY = (canvasRect.height - fit.graphH * fit.scale) / 2;
  const srcX = marginX * pxRatio;
  const srcY = marginY * pxRatio;
  const srcW = fit.graphW * fit.scale * pxRatio;
  const srcH = fit.graphH * fit.scale * pxRatio;

  const outW = Math.max(1, Math.ceil(srcW));
  const outH = Math.max(1, Math.ceil(srcH));

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = outW;
  outputCanvas.height = outH;
  const outputCtx = outputCanvas.getContext("2d", { alpha: true });

  outputCtx.drawImage(canvasEl, srcX, srcY, srcW, srcH, 0, 0, outW, outH);

  // Restore live canvas transform immediately and schedule a repaint.
  ds.scale = savedScale;
  ds.offset[0] = savedOffset[0];
  ds.offset[1] = savedOffset[1];
  if (typeof uiCanvas.setDirtyCanvas === "function") {
    uiCanvas.setDirtyCanvas(true, true);
  } else if (typeof uiCanvas.draw === "function") {
    uiCanvas.draw(false, false);
  }

  // Composite DOM widget elements onto the output canvas.
  for (const { drawable, graphRect } of captures) {
    const x = (graphRect.x - fit.paddedMinX) * fit.scale * pxRatio;
    const y = (graphRect.y - fit.paddedMinY) * fit.scale * pxRatio;
    const w = graphRect.w * fit.scale * pxRatio;
    const h = graphRect.h * fit.scale * pxRatio;
    if (w <= 0 || h <= 0) continue;
    try {
      const sw = drawable.videoWidth || drawable.width || drawable.naturalWidth || 0;
      const sh = drawable.videoHeight || drawable.height || drawable.naturalHeight || 0;
      if (sw > 0 && sh > 0) {
        outputCtx.drawImage(drawable, 0, 0, sw, sh, x, y, w, h);
      } else {
        outputCtx.drawImage(drawable, x, y, w, h);
      }
    } catch (_) {
      // Tainted canvas or security error — skip this element.
    }
  }

  const mime = options.format === "webp" ? "image/webp" : "image/png";
  try {
    return await toBlobAsync(outputCanvas, mime);
  } catch (e) {
    if (e.name === "SecurityError") {
      // Cross-origin content tainted the canvas. Return canvas-only result.
      console.warn("[CWIE][Screen] Canvas tainted by cross-origin content; DOM overlays skipped.");
      const fallback = document.createElement("canvas");
      fallback.width = outW;
      fallback.height = outH;
      fallback.getContext("2d").drawImage(canvasEl, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
      return toBlobAsync(fallback, mime);
    }
    throw e;
  }
}
