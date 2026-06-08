import { app } from "/scripts/app.js";
import { getSettingsAccess } from "../detect.mjs";
import { computeGraphBBox } from "../../export/bbox.mjs";

const NODE2_CAPTURE_STYLE_ID = "cwie-node2-capture-style";
const NODE2_CAPTURE_VERSION = "node2-faster-tiles-2026-06-07-1";
const NODE2_TILE_MAX_PIXELS = 64 * 1024 * 1024;
const NODE2_TILE_SETTLE_MS = 180;
const NODE2_TILE_POLL_MIN_WAIT_MS = 80;
const NODE2_TILE_POLL_INTERVAL_MS = 60;

let node2CaptureInFlight = false;

function logStep(log, label, payload) {
  if (!log) return;
  log(`[CWIE][Node2] ${label}`, typeof payload === "function" ? payload() : payload);
}

function asArray(value) {
  return Array.from(value || []);
}

function describeElement(el) {
  if (!el) return null;
  const rect = el.getBoundingClientRect?.();
  return {
    tagName: el.tagName,
    id: el.id || "",
    className: typeof el.className === "string" ? el.className : "",
    testId: el.getAttribute?.("data-testid") || "",
    rect: rect
      ? {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      }
      : null,
  };
}

function describeRect(rect) {
  if (!rect) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.right,
    bottom: rect.bottom,
  };
}

function snapshotNode2RawRects(root, limit = 8) {
  if (!root) return [];
  return asArray(root.querySelectorAll("[data-node-id]"))
    .slice(0, Math.max(1, limit))
    .map((node) => ({
      id: node.getAttribute("data-node-id") || "",
      title: (node.textContent || "").trim().split(/\n/)[0] || "",
      rect: describeRect(node.getBoundingClientRect()),
    }));
}

function getViewportRect() {
  const vv = window.visualViewport;
  return {
    left: vv?.offsetLeft || 0,
    top: vv?.offsetTop || 0,
    width: vv?.width || window.innerWidth || document.documentElement.clientWidth || 1,
    height: vv?.height || window.innerHeight || document.documentElement.clientHeight || 1,
  };
}

function getCapturableRootRect(root) {
  const rootRect = root?.getBoundingClientRect?.();
  if (!rootRect) return null;
  const viewport = getViewportRect();
  const left = Math.max(rootRect.left, viewport.left);
  const top = Math.max(rootRect.top, viewport.top);
  const right = Math.min(rootRect.right, viewport.left + viewport.width);
  const bottom = Math.min(rootRect.bottom, viewport.top + viewport.height);
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
    rootLeft: rootRect.left,
    rootTop: rootRect.top,
    rootWidth: rootRect.width,
    rootHeight: rootRect.height,
    viewport,
  };
}

function getEffectiveCapturableRootRect(root, source = null) {
  const rect = getCapturableRootRect(root);
  if (!rect || !source) return rect;
  const sourceWidth = Number(source.videoWidth || source.width);
  const sourceHeight = Number(source.videoHeight || source.height);
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    return rect;
  }
  const viewport = getViewportRect();
  const pxPerCss = sourceWidth / Math.max(1, viewport.width);
  if (!Number.isFinite(pxPerCss) || pxPerCss <= 0) return rect;
  const effectiveViewportBottom = viewport.top + (sourceHeight / pxPerCss);
  const bottom = Math.min(rect.bottom, effectiveViewportBottom);
  return {
    ...rect,
    bottom,
    height: Math.max(1, bottom - rect.top),
  };
}

function getApiSupport() {
  const proto = typeof BrowserCaptureMediaStreamTrack !== "undefined"
    ? BrowserCaptureMediaStreamTrack.prototype
    : null;
  return {
    userAgent: navigator.userAgent,
    isSecureContext: Boolean(window.isSecureContext),
    displayMedia: typeof navigator.mediaDevices?.getDisplayMedia === "function",
    captureHandleConfig: typeof navigator.mediaDevices?.setCaptureHandleConfig === "function",
    restrictionTarget: typeof window.RestrictionTarget?.fromElement === "function",
    restrictTo: typeof proto?.restrictTo === "function",
    cropTarget: typeof window.CropTarget?.fromElement === "function",
    cropTo: typeof proto?.cropTo === "function",
    imageCapture: typeof window.ImageCapture === "function",
    mediaStreamTrackProcessor: typeof window.MediaStreamTrackProcessor === "function",
    requestVideoFrameCallback: typeof HTMLVideoElement !== "undefined" &&
      typeof HTMLVideoElement.prototype.requestVideoFrameCallback === "function",
  };
}

function getGraphRootFromTransformPane(transformPane) {
  let node = transformPane?.parentElement || null;
  while (node && node !== document.body) {
    if (node.querySelector?.("#graph-canvas") && node.querySelector?.('[data-testid="transform-pane"]')) {
      return node;
    }
    node = node.parentElement;
  }
  return document.querySelector("#graph-canvas")?.parentElement || null;
}

export function inspectNode2Targets() {
  const graphCanvas = document.querySelector("#graph-canvas") || app?.canvas?.canvas || null;
  const transformPane = document.querySelector('[data-testid="transform-pane"]');
  const root = getGraphRootFromTransformPane(transformPane);
  const siblingCanvases = root ? asArray(root.querySelectorAll("canvas")) : [];
  const linkOverlayCanvas = siblingCanvases.find((canvas) => canvas !== graphCanvas && !canvas.id) || null;
  const vueNodeCount = transformPane?.querySelectorAll?.("[data-node-id]")?.length || 0;

  const candidates = {
    commonRoot: root,
    transformPane,
    linkOverlayCanvas,
    graphCanvas,
  };

  return {
    version: NODE2_CAPTURE_VERSION,
    api: getApiSupport(),
    appCanvas: describeElement(app?.canvas?.canvas || null),
    candidates: Object.fromEntries(
      Object.entries(candidates).map(([key, value]) => [key, describeElement(value)])
    ),
    counts: {
      rootCanvases: siblingCanvases.length,
      vueNodes: vueNodeCount,
    },
    likelyNode2: Boolean(transformPane && linkOverlayCanvas),
    fit: inspectNode2FitMetrics(),
  };
}

function resolveTarget(name = "commonRoot") {
  const graphCanvas = document.querySelector("#graph-canvas") || app?.canvas?.canvas || null;
  const transformPane = document.querySelector('[data-testid="transform-pane"]');
  const commonRoot = getGraphRootFromTransformPane(transformPane);
  const siblingCanvases = commonRoot ? asArray(commonRoot.querySelectorAll("canvas")) : [];
  const linkOverlayCanvas = siblingCanvases.find((canvas) => canvas !== graphCanvas && !canvas.id) || null;
  const targets = {
    commonRoot,
    transformPane,
    linkOverlayCanvas,
    graphCanvas,
  };
  return targets[name] || commonRoot || transformPane || graphCanvas;
}

function ensureNode2CaptureStyle() {
  if (document.getElementById(NODE2_CAPTURE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = NODE2_CAPTURE_STYLE_ID;
  style.textContent = `
    html.cwie-node2-capturing [data-testid="selection-toolbox"],
    html.cwie-node2-capturing [data-testid="node-searchbox-popover"],
    html.cwie-node2-capturing .p-tooltip,
    html.cwie-node2-capturing .p-contextmenu,
    html.cwie-node2-capturing .litegraph.litecontextmenu,
    html.cwie-node2-capturing .cwie-backdrop,
    html.cwie-node2-capturing .cwie-dialog-backdrop,
    html.cwie-node2-capturing #comfyui-body-top,
    html.cwie-node2-capturing #comfyui-body-left,
    html.cwie-node2-capturing #comfyui-body-right,
    html.cwie-node2-capturing #comfyui-body-bottom,
    html.cwie-node2-capturing [data-testid*="toolbar" i],
    html.cwie-node2-capturing [data-testid*="menu" i],
    html.cwie-node2-capturing [data-testid*="selection" i],
    html.cwie-node2-capturing [class*="toolbar" i],
    html.cwie-node2-capturing [class*="palette" i],
    html.cwie-node2-capturing [class*="actionbar" i],
    html.cwie-node2-capturing [class*="topbar" i] {
      visibility: hidden !important;
      pointer-events: none !important;
    }

    html.cwie-node2-capturing #graph-canvas-container > :not(#graph-canvas):not([data-testid="transform-pane"]):not(canvas:not([id])) {
      visibility: hidden !important;
    }

    html.cwie-node2-capturing,
    html.cwie-node2-capturing * {
      cursor: none !important;
    }

    html.cwie-node2-capturing #graph-canvas-container {
      isolation: isolate !important;
      pointer-events: none !important;
      user-select: none !important;
    }

    html.cwie-node2-capturing #graph-canvas-container *,
    html.cwie-node2-capturing #graph-canvas-container *::before,
    html.cwie-node2-capturing #graph-canvas-container *::after {
      pointer-events: none !important;
      transition-property: none !important;
      transition-duration: 0s !important;
      animation: none !important;
    }

    .cwie-node2-pointer-shield {
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483647 !important;
      cursor: none !important;
      pointer-events: auto !important;
      background: transparent !important;
    }
  `;
  document.head.appendChild(style);
}

function createNode2InteractionShield() {
  const shield = document.createElement("div");
  shield.className = "cwie-node2-pointer-shield";
  shield.setAttribute("aria-hidden", "true");
  const stop = (event) => {
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
  };
  const events = [
    "pointermove",
    "pointerdown",
    "pointerup",
    "pointercancel",
    "mousemove",
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
    "contextmenu",
    "wheel",
    "touchstart",
    "touchmove",
    "touchend",
  ];
  for (const type of events) {
    shield.addEventListener(type, stop, { capture: true, passive: false });
    window.addEventListener(type, stop, { capture: true, passive: false });
  }
  document.body.appendChild(shield);
  return {
    remove() {
      for (const type of events) {
        shield.removeEventListener(type, stop, { capture: true });
        window.removeEventListener(type, stop, { capture: true });
      }
      shield.remove();
    },
  };
}

function createNode2InlineCursorHider(root) {
  const targets = [document.documentElement, document.body, root].filter((el) => el instanceof HTMLElement);
  const changed = new Map();
  for (const el of targets) {
    changed.set(el, el.style.cursor);
    el.style.cursor = "none";
  }
  return {
    remove() {
      for (const [el, cursor] of changed.entries()) {
        el.style.cursor = cursor;
      }
      changed.clear();
    },
  };
}

function getNode2Layers() {
  const graphCanvas = document.querySelector("#graph-canvas") || app?.canvas?.canvas || null;
  const transformPane = document.querySelector('[data-testid="transform-pane"]');
  const root = getGraphRootFromTransformPane(transformPane);
  const siblingCanvases = root ? asArray(root.querySelectorAll("canvas")) : [];
  const linkOverlayCanvas = siblingCanvases.find((canvas) => canvas !== graphCanvas && !canvas.id) || null;
  const vueNodes = transformPane ? asArray(transformPane.querySelectorAll("[data-node-id]")) : [];
  return { root, graphCanvas, transformPane, linkOverlayCanvas, vueNodes };
}

function createNode2ChromeHider() {
  const changed = new Map();
  return {
    hide(el) {
      if (!(el instanceof HTMLElement)) return;
      if (!changed.has(el)) {
        changed.set(el, {
          visibility: el.style.visibility,
          pointerEvents: el.style.pointerEvents,
        });
      }
      el.style.visibility = "hidden";
      el.style.pointerEvents = "none";
    },
    restore() {
      for (const [el, style] of Array.from(changed.entries()).reverse()) {
        el.style.visibility = style.visibility;
        el.style.pointerEvents = style.pointerEvents;
      }
      changed.clear();
    },
  };
}

function createNode2CanvasInfoHider(canvas) {
  const settings = getSettingsAccess(app);
  const canvasInfoSettingId = "Comfy.Graph.CanvasInfo";
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
  const changed = new Map();
  let originalCanvasInfoSetting;
  let changedCanvasInfoSetting = false;
  return {
    async hide() {
      if (settings?.set) {
        try {
          originalCanvasInfoSetting = settings.get?.(canvasInfoSettingId);
          if (originalCanvasInfoSetting !== undefined) {
            changedCanvasInfoSetting = true;
            await settings.set(canvasInfoSettingId, false);
          }
        } catch (_) {}
      }
      if (!canvas) return;
      for (const key of forceFalseKeys) {
        try {
          if (key in canvas && !changed.has(key)) {
            changed.set(key, canvas[key]);
            canvas[key] = false;
          }
        } catch (_) {}
      }
      canvas.setDirty?.(true, true);
      canvas.setDirtyCanvas?.(true, true);
      try {
        canvas.draw?.(true, true);
      } catch (_) {}
    },
    async restore() {
      if (canvas) {
        for (const [key, value] of changed.entries()) {
          try {
            canvas[key] = value;
          } catch (_) {}
        }
        changed.clear();
        canvas.setDirty?.(true, true);
        canvas.setDirtyCanvas?.(true, true);
        try {
          canvas.draw?.(true, true);
        } catch (_) {}
      }
      if (changedCanvasInfoSetting && settings?.set) {
        try {
          await settings.set(canvasInfoSettingId, originalCanvasInfoSetting);
        } catch (_) {}
      }
      changedCanvasInfoSetting = false;
    },
  };
}

async function waitForNode2CaptureUiSettle(ms = 120) {
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  if (ms > 0) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function createNode2BackgroundOverride(options = {}) {
  const mode = String(options.background || "ui");
  if (mode !== "solid") {
    return { async apply() {}, async restore() {} };
  }
  const color = typeof options.solidColor === "string" && options.solidColor.trim()
    ? options.solidColor.trim()
    : "#000000";
  const solidDataUrl = createSolidBackgroundDataUrl(color);
  const changedElements = new Map();
  const changedCanvas = new Map();
  let documentBgImg = null;
  let documentBgImgPriority = "";

  const saveElement = (el) => {
    if (!(el instanceof HTMLElement) || changedElements.has(el)) return;
    changedElements.set(el, {
      background: el.style.background,
      backgroundColor: el.style.backgroundColor,
      backgroundImage: el.style.backgroundImage,
    });
  };
  const saveCanvasProp = (canvas, key) => {
    if (!canvas || changedCanvas.has(key)) return;
    changedCanvas.set(key, canvas[key]);
  };
  const redraw = () => {
    const canvas = app?.canvas;
    canvas?.setDirty?.(true, true);
    canvas?.setDirtyCanvas?.(true, true);
    try {
      canvas?.draw?.(true, true);
    } catch (_) {}
  };
  return {
    async apply() {
      const { root } = getNode2Layers();
      const graphContainer = document.querySelector("#graph-canvas-container");
      documentBgImg = document.documentElement.style.getPropertyValue("--bg-img");
      documentBgImgPriority = document.documentElement.style.getPropertyPriority("--bg-img");
      document.documentElement.style.setProperty("--bg-img", `url("${solidDataUrl}")`);
      for (const el of [root, graphContainer]) {
        if (!(el instanceof HTMLElement)) continue;
        saveElement(el);
        // ComfyUI's Canvas.BackgroundImage mode makes the canvas clear transparent
        // so the CSS background behind the graph remains visible while links/nodes draw on top.
        el.style.background = `${color} url("${solidDataUrl}") repeat`;
        el.style.backgroundColor = color;
        el.style.backgroundImage = `url("${solidDataUrl}")`;
      }
      const canvas = app?.canvas;
      if (canvas) {
        saveCanvasProp(canvas, "clear_background_color");
        saveCanvasProp(canvas, "background_image");
        saveCanvasProp(canvas, "_pattern");
        canvas.clear_background_color = "transparent";
        canvas.background_image = null;
        canvas._pattern = undefined;
      }
      redraw();
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    },
    async restore() {
      if (documentBgImg === "") {
        document.documentElement.style.removeProperty("--bg-img");
      } else if (documentBgImg !== null) {
        document.documentElement.style.setProperty("--bg-img", documentBgImg, documentBgImgPriority);
      }
      for (const [el, style] of Array.from(changedElements.entries()).reverse()) {
        el.style.background = style.background;
        el.style.backgroundColor = style.backgroundColor;
        el.style.backgroundImage = style.backgroundImage;
      }
      const canvas = app?.canvas;
      for (const [key, value] of changedCanvas.entries()) {
        try {
          canvas[key] = value;
        } catch (_) {}
      }
      changedElements.clear();
      changedCanvas.clear();
      documentBgImg = null;
      documentBgImgPriority = "";
      redraw();
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    },
  };
}

function createSolidBackgroundDataUrl(color) {
  const safeColor = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(color) ? color : "#000000";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="${safeColor}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function hideNode2CaptureChrome(hider) {
  const { root, graphCanvas, transformPane, linkOverlayCanvas, vueNodes } = getNode2Layers();
  if (!root) return;
  const keepTree = [graphCanvas, linkOverlayCanvas].filter(Boolean);
  const shouldKeep = (el) => {
    if (!el || el === root || el === transformPane) return true;
    if (keepTree.some((keep) => el === keep || keep.contains(el))) return true;
    return vueNodes.some((node) => el === node || node.contains(el) || el.contains(node));
  };
  for (const el of asArray(root.querySelectorAll("*"))) {
    if (!(el instanceof HTMLElement) || shouldKeep(el)) continue;
    hider.hide(el);
  }
}

function hideKnownComfyChrome(hider) {
  const selectors = [
    "#comfyui-body-top",
    "#comfyui-body-left",
    "#comfyui-body-right",
    "#comfyui-body-bottom",
    '[data-testid*="toolbar" i]',
    '[data-testid*="menu" i]',
    '[data-testid*="selection" i]',
    '[class*="toolbar" i]',
    '[class*="palette" i]',
    '[class*="actionbar" i]',
    '[class*="topbar" i]',
  ];
  for (const el of asArray(document.querySelectorAll(selectors.join(",")))) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.closest("[data-node-id]")) continue;
    hider.hide(el);
  }
}

function rectsIntersect(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function isVisibleElement(el) {
  if (!(el instanceof Element)) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
    return false;
  }
  const opacity = Number.parseFloat(style.opacity);
  return !Number.isFinite(opacity) || opacity > 0.01;
}

function hideIntersectingChrome(hider) {
  const { root, graphCanvas, transformPane, linkOverlayCanvas, vueNodes } = getNode2Layers();
  if (!root) return;
  const rootRect = root.getBoundingClientRect();
  const keep = [root, graphCanvas, transformPane, linkOverlayCanvas].filter(Boolean);
  for (const el of asArray(document.body.querySelectorAll("*"))) {
    if (!(el instanceof HTMLElement)) continue;
    if (keep.includes(el)) continue;
    if (vueNodes.some((node) => el === node || node.contains(el) || el.contains(node))) continue;
    if (el.closest(".cwie-dialog") || el.closest(".cwie-backdrop")) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || !rectsIntersect(rect, rootRect)) continue;
    const text = (el.textContent || "").trim();
    if (text.length <= 80 && /\b\d+(?:\.\d+)?px\s*[×x]\s*\d+(?:\.\d+)?px\b/i.test(text)) {
      hider.hide(el);
      continue;
    }
    const style = window.getComputedStyle(el);
    const zIndex = Number.parseInt(style.zIndex, 10);
    const positioned = style.position === "fixed" ||
      style.position === "sticky" ||
      style.position === "absolute" ||
      Number.isFinite(zIndex);
    if (!positioned) continue;
    hider.hide(el);
  }
}

function collectNode2VisualRects(root) {
  if (!root) return null;
  const rootRect = root.getBoundingClientRect();
  const rects = [];
  for (const node of asArray(root.querySelectorAll("[data-node-id]"))) {
    const candidates = [node, ...asArray(node.querySelectorAll("*"))];
    for (const el of candidates) {
      if (!isVisibleElement(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1 || !rectsIntersect(rect, rootRect)) continue;
      const coversRoot =
        rect.width >= rootRect.width * 0.92 ||
        rect.height >= rootRect.height * 0.92;
      if (coversRoot) continue;
      rects.push(rect);
    }
  }
  return { rootRect, rects };
}

function measureNode2DomCropRect(root, paddingPx) {
  const measured = collectNode2VisualRects(root);
  if (!measured?.rects?.length) return null;
  const { rootRect, rects } = measured;
  const captureRect = getCapturableRootRect(root) || rootRect;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.left - rootRect.left);
    top = Math.min(top, rect.top - rootRect.top);
    right = Math.max(right, rect.right - rootRect.left);
    bottom = Math.max(bottom, rect.bottom - rootRect.top);
  }
  const pad = Math.max(8, Math.min(128, Number(paddingPx) || 56));
  return {
    left: Math.max(0, left - pad),
    top: Math.max(0, top - pad),
    right: Math.min(captureRect.width, right + pad),
    bottom: Math.min(captureRect.height, bottom + pad),
  };
}

function measureNode2DomGraphBBox(root, ds) {
  if (!root || !ds || !Array.isArray(ds.offset)) return null;
  const scale = Number(ds.scale) || 1;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const measured = collectNode2VisualRects(root);
  if (!measured?.rects?.length) return null;
  const { rootRect, rects } = measured;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    const left = ((rect.left - rootRect.left) / scale) - ds.offset[0];
    const top = ((rect.top - rootRect.top) / scale) - ds.offset[1];
    const right = ((rect.right - rootRect.left) / scale) - ds.offset[0];
    const bottom = ((rect.bottom - rootRect.top) / scale) - ds.offset[1];
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, right);
    maxY = Math.max(maxY, bottom);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    measuredRects: rects.length,
  };
}

function mapNode2DomElementsById(root) {
  const map = new Map();
  if (!root) return map;
  for (const el of asArray(root.querySelectorAll("[data-node-id]"))) {
    const id = el.getAttribute("data-node-id");
    if (id != null && id !== "") {
      map.set(String(id), el);
    }
  }
  return map;
}

function getNodePos(node) {
  if (Array.isArray(node?.pos)) return node.pos;
  if (Array.isArray(node?.pos2)) return node.pos2;
  if (Number.isFinite(Number(node?.x)) && Number.isFinite(Number(node?.y))) {
    return [Number(node.x), Number(node.y)];
  }
  return null;
}

function getNodeSize(node) {
  if (Array.isArray(node?.size)) return node.size;
  if (Array.isArray(node?.bounding)) return [node.bounding[2], node.bounding[3]];
  if (Number.isFinite(Number(node?.width)) && Number.isFinite(Number(node?.height))) {
    return [Number(node.width), Number(node.height)];
  }
  return null;
}

function getGraphNodes(graph) {
  return asArray(graph?._nodes || graph?.nodes);
}

function getNodeId(node) {
  return node?.id == null ? null : String(node.id);
}

function normalizeNodeId(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const numeric = text.match(/(?:^|[^0-9])([0-9]+)(?:[^0-9]|$)/);
  return numeric ? numeric[1] : text;
}

function getNodeTitle(node) {
  return String(node?.title || node?.type || node?.comfyClass || "").trim();
}

function getDomNodeTitle(el) {
  return String(el?.textContent || "").trim().split(/\n/)[0]?.trim() || "";
}

function normalizeTitle(value) {
  return String(value || "").trim().toLowerCase();
}

function measureNode2GraphBBox(graph) {
  const nodes = getGraphNodes(graph);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let measuredNodes = 0;

  for (const node of nodes) {
    const pos = getNodePos(node);
    const size = getNodeSize(node);
    const left = Number(pos?.[0]);
    const top = Number(pos?.[1]);
    const width = Number(size?.[0]);
    const height = Number(size?.[1]);
    if (!Number.isFinite(left) || !Number.isFinite(top) ||
      !Number.isFinite(width) || !Number.isFinite(height) ||
      width <= 0 || height <= 0) {
      continue;
    }
    measuredNodes += 1;
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, left + width);
    maxY = Math.max(maxY, top + height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    measuredNodes,
  };
}

function buildNode2DomLookup(root) {
  const byId = new Map();
  const byTitle = new Map();
  const nodes = [];
  if (!root) return { byId, byTitle, nodes };
  for (const el of asArray(root.querySelectorAll("[data-node-id]"))) {
    const rawId = el.getAttribute("data-node-id");
    const idKeys = new Set([
      rawId,
      rawId == null ? null : String(rawId),
      normalizeNodeId(rawId),
    ].filter(Boolean));
    for (const key of idKeys) {
      if (!byId.has(key)) byId.set(key, el);
    }
    const title = normalizeTitle(getDomNodeTitle(el));
    if (title && !byTitle.has(title)) byTitle.set(title, el);
    nodes.push({
      rawId,
      normalizedId: normalizeNodeId(rawId),
      title: getDomNodeTitle(el),
      el,
    });
  }
  return { byId, byTitle, nodes };
}

function resolveNode2DomForGraphNode(lookup, node) {
  const id = getNodeId(node);
  const idKeys = [
    id,
    normalizeNodeId(id),
  ].filter(Boolean);
  for (const key of idKeys) {
    const found = lookup.byId.get(key);
    if (found) return found;
  }
  const title = normalizeTitle(getNodeTitle(node));
  return title ? lookup.byTitle.get(title) || null : null;
}

function buildNode2GraphLookup(graph) {
  const byId = new Map();
  const byTitle = new Map();
  const nodes = [];
  for (const node of getGraphNodes(graph)) {
    const id = getNodeId(node);
    const idKeys = [
      id,
      normalizeNodeId(id),
    ].filter(Boolean);
    for (const key of idKeys) {
      if (!byId.has(key)) byId.set(key, node);
    }
    const title = normalizeTitle(getNodeTitle(node));
    if (title && !byTitle.has(title)) byTitle.set(title, node);
    nodes.push(node);
  }
  return { byId, byTitle, nodes };
}

function resolveNode2GraphForDomNode(lookup, domNode) {
  const rawId = domNode?.rawId;
  const idKeys = [
    rawId,
    normalizeNodeId(rawId),
  ].filter(Boolean);
  for (const key of idKeys) {
    const found = lookup.byId.get(key);
    if (found) return found;
  }
  const title = normalizeTitle(domNode?.title);
  return title ? lookup.byTitle.get(title) || null : null;
}

function measureNode2CameraAlignment(root, graph, offset, scale, limit = 6) {
  if (!root || !graph || !Array.isArray(offset)) {
    return { ok: false, reason: "missing_root_graph_or_offset", samples: [] };
  }
  const rootRect = root.getBoundingClientRect();
  const domLookup = buildNode2DomLookup(root);
  const graphLookup = buildNode2GraphLookup(graph);
  const samples = [];
  const missing = [];
  for (const domNode of domLookup.nodes) {
    if (samples.length >= limit) break;
    const node = resolveNode2GraphForDomNode(graphLookup, domNode);
    const id = getNodeId(node);
    const pos = getNodePos(node);
    const dom = domNode.el;
    if (!id || !pos || !dom) {
      if (missing.length < limit) {
        missing.push({
          domRawId: domNode.rawId,
          domNormalizedId: domNode.normalizedId,
          domTitle: domNode.title,
          graphId: id,
          graphTitle: getNodeTitle(node),
          hasPos: Boolean(pos),
          hasDom: Boolean(dom),
        });
      }
      continue;
    }
    const rect = dom.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) continue;
    const expectedLeft = (Number(pos[0]) + offset[0]) * scale;
    const expectedTop = (Number(pos[1]) + offset[1]) * scale;
    const actualLeft = rect.left - rootRect.left;
    const actualTop = rect.top - rootRect.top;
    samples.push({
      id,
      dx: actualLeft - expectedLeft,
      dy: actualTop - expectedTop,
      expectedLeft,
      expectedTop,
      actualLeft,
      actualTop,
    });
  }
  if (!samples.length) {
    return {
      ok: false,
      reason: "no_matched_dom_nodes",
      domIds: domLookup.nodes.slice(0, limit).map((node) => ({
        rawId: node.rawId,
        normalizedId: node.normalizedId,
        title: node.title,
      })),
      graphIds: graphLookup.nodes.map((node) => ({
        id: getNodeId(node),
        normalizedId: normalizeNodeId(getNodeId(node)),
        title: getNodeTitle(node),
      })).filter((node) => node.id || node.title).slice(0, limit),
      missing,
      samples,
    };
  }
  const maxAbsDx = Math.max(...samples.map((sample) => Math.abs(sample.dx)));
  const maxAbsDy = Math.max(...samples.map((sample) => Math.abs(sample.dy)));
  return {
    ok: maxAbsDx <= 3 && maxAbsDy <= 3,
    maxAbsDx,
    maxAbsDy,
    samples,
  };
}

async function setAndWaitNode2CanvasView(canvas, ds, root, graph, offset, scale, log, options = {}) {
  setNode2CanvasView(canvas, ds, offset, scale);
  await waitForNode2CameraSettle(Math.max(180, Number(options.settleMs) || 420));
  const alignment = log ? measureNode2CameraAlignment(root, graph, offset, scale) : null;
  logStep(log, "capture.tile.camera", {
    attempts: 1,
    offset: [offset[0], offset[1]],
    scale,
    alignment,
  });
  return alignment;
}

function measureNode2StableGraphBBox(root, ds, graph) {
  const nodes = asArray(graph?._nodes || graph?.nodes);
  if (!nodes.length || !ds) return null;
  const scale = Number(ds.scale) || 1;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const domById = mapNode2DomElementsById(root);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let measuredDomNodes = 0;
  let measuredGraphNodes = 0;

  for (const node of nodes) {
    const pos = getNodePos(node);
    if (!pos) continue;
    const left = Number(pos[0]);
    const top = Number(pos[1]);
    if (!Number.isFinite(left) || !Number.isFinite(top)) continue;

    const dom = domById.get(String(node.id));
    const rect = dom?.getBoundingClientRect?.();
    let width = rect && rect.width > 1 ? rect.width / scale : null;
    let height = rect && rect.height > 1 ? rect.height / scale : null;
    if (Number.isFinite(width) && Number.isFinite(height)) {
      measuredDomNodes += 1;
    } else {
      const size = getNodeSize(node);
      width = Number(size?.[0]);
      height = Number(size?.[1]);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        measuredGraphNodes += 1;
      }
    }
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      continue;
    }
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, left + width);
    maxY = Math.max(maxY, top + height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    measuredDomNodes,
    measuredGraphNodes,
  };
}

export function inspectNode2FitMetrics() {
  const { root } = getNode2Layers();
  const canvas = app?.canvas;
  const ds = canvas?.ds;
  const graph = app?.graph || canvas?.graph;
  const rootRect = root?.getBoundingClientRect?.() || null;
  const domGraphBBox = root && ds ? measureNode2DomGraphBBox(root, ds) : null;
  const stableGraphBBox = root && ds && graph ? measureNode2StableGraphBBox(root, ds, graph) : null;
  let graphBBox = null;
  try {
    graphBBox = graph ? computeGraphBBox(graph, { padding: 0, useBounding: true }) : null;
  } catch (_) {
    graphBBox = null;
  }
  return {
    version: NODE2_CAPTURE_VERSION,
    rootRect: rootRect
      ? {
        width: rootRect.width,
        height: rootRect.height,
        left: rootRect.left,
        top: rootRect.top,
      }
      : null,
    currentTransform: ds
      ? {
        scale: ds.scale,
        offset: Array.isArray(ds.offset) ? [ds.offset[0], ds.offset[1]] : null,
      }
      : null,
    nodeCount: root?.querySelectorAll?.("[data-node-id]")?.length || 0,
    rawNodeRects: snapshotNode2RawRects(root, 8),
    stableGraphBBox,
    domGraphBBox,
    graphBBox,
  };
}

function stopStream(stream) {
  for (const track of stream?.getTracks?.() || []) {
    try {
      track.stop();
    } catch (_) {
      // Ignore cleanup failures. The browser may already have ended the track.
    }
  }
}

function releaseHiddenVideo(video) {
  if (!video) return;
  try {
    video.pause?.();
  } catch (_) {
    // best-effort cleanup
  }
  try {
    video.srcObject = null;
  } catch (_) {
    // best-effort cleanup
  }
  try {
    video.removeAttribute?.("src");
  } catch (_) {
    // best-effort cleanup
  }
  try {
    video.load?.();
  } catch (_) {
    // best-effort cleanup
  }
  try {
    video.remove?.();
  } catch (_) {
    // best-effort cleanup
  }
}

function releaseCanvasResource(canvas) {
  if (!canvas) return;
  try {
    const ctx = canvas.getContext?.("2d");
    ctx?.clearRect?.(0, 0, canvas.width || 0, canvas.height || 0);
  } catch (_) {
    // best-effort cleanup
  }
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch (_) {
    // best-effort cleanup
  }
}

function timeoutError(label, timeoutMs) {
  return new Error(`${label} timed out after ${timeoutMs}ms`);
}

async function withTimeout(promise, label, timeoutMs = 3000) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(label, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitVideoMetadata(video, log) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth && video.videoHeight) {
    return;
  }
  logStep(log, "video.metadata.wait", {
    readyState: video.readyState,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
  });
  await withTimeout(new Promise((resolve, reject) => {
    video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    video.addEventListener("resize", () => {
      if (video.videoWidth && video.videoHeight) resolve();
    }, { once: true });
    video.addEventListener("error", () => {
      reject(new Error(video.error?.message || "hidden video failed to load capture stream"));
    }, { once: true });
  }), "hidden video metadata");
}

async function waitVideoFrame(video, count = 2, log, timeoutMs = 3000) {
  for (let i = 0; i < count; i += 1) {
    if (typeof video.requestVideoFrameCallback === "function") {
      try {
        await withTimeout(new Promise((resolve) => {
          video.requestVideoFrameCallback(() => resolve());
        }), `video frame ${i + 1}`, timeoutMs);
      } catch (error) {
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
          throw error;
        }
        logStep(log, "video.frame.fallback", {
          frame: i + 1,
          message: error?.message || String(error),
          readyState: video.readyState,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
        });
        await withTimeout(new Promise((resolve) => requestAnimationFrame(() => resolve())), `animation frame fallback ${i + 1}`);
      }
    } else {
      await withTimeout(new Promise((resolve) => requestAnimationFrame(() => resolve())), `animation frame ${i + 1}`);
    }
    logStep(log, "video.frame.waited", {
      frame: i + 1,
      readyState: video.readyState,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
    });
  }
}

async function attachHiddenVideo(stream, log) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.style.cssText = [
    "position:fixed",
    "left:8px",
    "top:8px",
    "width:320px",
    "height:180px",
    "opacity:0.02",
    "z-index:2147483647",
    "pointer-events:none",
  ].join(";");
  video.srcObject = stream;
  document.body.appendChild(video);
  logStep(log, "video.attach", {
    readyState: video.readyState,
    paused: video.paused,
  });
  await waitVideoMetadata(video, log);
  await withTimeout(video.play(), "hidden video play");
  logStep(log, "video.play.ok", {
    readyState: video.readyState,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
  });
  return video;
}

function drawVideoToCanvas(video) {
  const width = Math.max(1, video.videoWidth || video.clientWidth || 1);
  const height = Math.max(1, video.videoHeight || video.clientHeight || 1);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!ctx) throw new Error("2d context unavailable");
  ctx.drawImage(video, 0, 0, width, height);
  return { canvas, ctx, width, height };
}

async function canvasProbe(canvas, ctx, width, height) {
  const sample = ctx.getImageData(
    Math.max(0, Math.floor(width / 2)),
    Math.max(0, Math.floor(height / 2)),
    1,
    1
  ).data;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return {
    blobOk: Boolean(blob),
    blobType: blob?.type || null,
    blobSize: blob?.size || 0,
    sampleAlpha: sample[3],
    hasAlphaChannelData: sample[3] < 255,
  };
}

function sampleCanvasSignature(ctx, width, height) {
  const sampleCols = 96;
  const sampleRows = 54;
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = sampleCols;
  sampleCanvas.height = sampleRows;
  const sampleCtx = sampleCanvas.getContext("2d", {
    alpha: true,
    willReadFrequently: true,
  });
  if (!sampleCtx) return null;
  sampleCtx.drawImage(ctx.canvas, 0, 0, width, height, 0, 0, sampleCols, sampleRows);
  const pixels = sampleCtx.getImageData(0, 0, sampleCols, sampleRows).data;
  let hash = 2166136261;
  for (let i = 0; i < pixels.length; i += 4) {
    hash ^= pixels[i];
    hash = Math.imul(hash, 16777619);
    hash ^= pixels[i + 1];
    hash = Math.imul(hash, 16777619);
    hash ^= pixels[i + 2];
    hash = Math.imul(hash, 16777619);
    hash ^= pixels[i + 3];
    hash = Math.imul(hash, 16777619);
  }
  return `${sampleCols}x${sampleRows}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

async function captureChangedVideoFrame(prepared, options, log) {
  const timeoutMs = Math.max(500, Number(options.frameTimeoutMs) || 3000);
  const intervalMs = Math.max(40, Math.min(250, Number(options.pollIntervalMs) || 120));
  const minWaitMs = Math.max(0, Number(options.pollMinWaitMs) || 240);
  const started = performance.now();
  let last = null;
  let attempts = 0;

  while (performance.now() - started < timeoutMs) {
    attempts += 1;
    await waitVideoPollDelay(attempts === 1 ? minWaitMs : intervalMs);
    const { canvas, ctx, width, height } = drawVideoToCanvas(prepared.video);
    const signature = sampleCanvasSignature(ctx, width, height);
    if (last?.canvas && last.canvas !== canvas) {
      releaseCanvasResource(last.canvas);
    }
    last = { canvas, ctx, width, height, signature };
    if (!prepared.lastFrameSignature || signature !== prepared.lastFrameSignature) {
      prepared.lastFrameSignature = signature;
      const probe = options.probe === false
        ? { blobOk: true, blobType: null, blobSize: 0, probed: false }
        : await canvasProbe(canvas, ctx, width, height);
      const frame = {
        width,
        height,
        dpr: window.devicePixelRatio || 1,
        polledFrame: true,
        signature,
        attempts,
        ...probe,
      };
      logStep(log, "frame.polled.ok", frame);
      return {
        startedAt: new Date().toISOString(),
        targetName: prepared.targetName,
        before: inspectNode2Targets(),
        track: prepared.track,
        restriction: prepared.restriction,
        frame,
        canvas,
      };
    }
    logStep(log, "frame.polled.stale", {
      signature,
      attempts,
      elapsedMs: Math.round(performance.now() - started),
    });
  }

  if (!last) {
    throw new Error(`polled video frame unavailable after ${timeoutMs}ms`);
  }

  const probe = options.probe === false
    ? { blobOk: true, blobType: null, blobSize: 0, probed: false }
    : await canvasProbe(last.canvas, last.ctx, last.width, last.height);
  const frame = {
    width: last.width,
    height: last.height,
    dpr: window.devicePixelRatio || 1,
    polledFrame: true,
    unchangedFrame: true,
    signature: last.signature,
    attempts,
    ...probe,
  };
  logStep(log, "frame.polled.unchanged.accept", {
    ...frame,
    elapsedMs: Math.round(performance.now() - started),
  });
  return {
    startedAt: new Date().toISOString(),
    targetName: prepared.targetName,
    before: inspectNode2Targets(),
    track: prepared.track,
    restriction: prepared.restriction,
    frame,
    canvas: last.canvas,
  };
}

async function seedPreparedFrameSignature(prepared, log) {
  if (!prepared?.video) return null;
  await waitVideoPollDelay(180);
  const { canvas, ctx, width, height } = drawVideoToCanvas(prepared.video);
  const signature = sampleCanvasSignature(ctx, width, height);
  releaseCanvasResource(canvas);
  prepared.lastFrameSignature = signature;
  const seed = { width, height, signature };
  logStep(log, "frame.seed", seed);
  return seed;
}

async function maybeSetCaptureHandle(log) {
  const handle = `cwie-node2-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (typeof navigator.mediaDevices?.setCaptureHandleConfig !== "function") {
    return { configured: false, handle };
  }
  try {
    navigator.mediaDevices.setCaptureHandleConfig({
      handle,
      permittedOrigins: ["*"],
    });
    return { configured: true, handle };
  } catch (error) {
    logStep(log, "captureHandleConfig.failed", { message: error?.message || String(error) });
    return { configured: false, handle, error: error?.message || String(error) };
  }
}

async function requestDisplayMedia(log) {
  const preferredOptions = {
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    surfaceSwitching: "exclude",
    audio: false,
    video: {
      cursor: "never",
    },
  };
  try {
    return await navigator.mediaDevices.getDisplayMedia(preferredOptions);
  } catch (error) {
    if (error?.name !== "TypeError") {
      throw error;
    }
    logStep(log, "displayMedia.preferredOptions.failed", {
      name: error.name,
      message: error.message,
    });
    return navigator.mediaDevices.getDisplayMedia({ audio: false, video: true });
  }
}

async function captureFrameFromStream(stream, target, targetName, captureHandle, options, log) {
  const report = {
    startedAt: new Date().toISOString(),
    targetName,
    before: inspectNode2Targets(),
    captureHandle,
    track: null,
    restriction: null,
    frame: null,
  };

  const [track] = stream.getVideoTracks();
  const settings = track?.getSettings?.() || {};
  const captureHandleInfo = track?.getCaptureHandle?.() || null;
  report.track = {
    label: track?.label || "",
    settings,
    captureHandle: captureHandleInfo,
    isLikelySelfCapture: captureHandleInfo?.handle === captureHandle.handle ||
      settings.displaySurface === "browser",
  };
  logStep(log, "displayMedia.ok", report.track);

  const video = await attachHiddenVideo(stream, log);
  try {
    report.restriction = await applyTargetRestriction(track, target, {
      prefer: options.prefer || "restriction",
      log,
    });
    logStep(log, "target.apply", report.restriction);
    const frameCount = Math.max(1, Number(options.frameCount) || 2);
    const frameTimeoutMs = Math.max(50, Number(options.frameTimeoutMs) || 3000);
    await waitVideoFrame(video, frameCount, log, frameTimeoutMs);
    const { canvas, ctx, width, height } = drawVideoToCanvas(video);
    const probe = options.probe === false
      ? { blobOk: true, blobType: null, blobSize: 0, probed: false }
      : await canvasProbe(canvas, ctx, width, height);
    report.frame = {
      width,
      height,
      dpr: window.devicePixelRatio || 1,
      ...probe,
    };
    if (options.includeCanvas) {
      report.canvas = canvas;
    }
    logStep(log, "frame.ok", report.frame);
    return report;
  } catch (error) {
    report.error = {
      name: error?.name || "",
      message: error?.message || String(error),
    };
    logStep(log, "frame.failed", report.error);
    return report;
  } finally {
    releaseHiddenVideo(video);
  }
}

async function prepareFrameCaptureFromStream(stream, target, targetName, captureHandle, options, log) {
  const [track] = stream.getVideoTracks();
  const settings = track?.getSettings?.() || {};
  const captureHandleInfo = track?.getCaptureHandle?.() || null;
  const trackReport = {
    label: track?.label || "",
    settings,
    captureHandle: captureHandleInfo,
    isLikelySelfCapture: captureHandleInfo?.handle === captureHandle.handle ||
      settings.displaySurface === "browser",
  };
  logStep(log, "displayMedia.ok", trackReport);

  const video = await attachHiddenVideo(stream, log);
  try {
    const restriction = await applyTargetRestriction(track, target, {
      prefer: options.prefer || "restriction",
      requireRestriction: Boolean(options.requireRestriction),
      log,
    });
    logStep(log, "target.apply", restriction);
    return {
      targetName,
      trackObject: track,
      track: trackReport,
      restriction,
      video,
      lastFrameSignature: null,
    };
  } catch (error) {
    releaseHiddenVideo(video);
    throw error;
  }
}

async function waitVideoPollDelay(ms = 900) {
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise((resolve) => setTimeout(resolve, ms));
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function captureFrameFromPreparedVideo(prepared, options, log) {
  if (options.pollChangedFrame) {
    return captureChangedVideoFrame(prepared, options, log);
  }
  const frameCount = Math.max(1, Number(options.frameCount) || 2);
  const frameTimeoutMs = Math.max(50, Number(options.frameTimeoutMs) || 3000);
  await waitVideoFrame(prepared.video, frameCount, log, frameTimeoutMs);
  const { canvas, ctx, width, height } = drawVideoToCanvas(prepared.video);
  const probe = options.probe === false
    ? { blobOk: true, blobType: null, blobSize: 0, probed: false }
    : await canvasProbe(canvas, ctx, width, height);
  const frame = {
    width,
    height,
    dpr: window.devicePixelRatio || 1,
    ...probe,
  };
  logStep(log, "frame.ok", frame);
  return {
    startedAt: new Date().toISOString(),
    targetName: prepared.targetName,
    before: inspectNode2Targets(),
    track: prepared.track,
    restriction: prepared.restriction,
    frame,
    canvas,
  };
}

async function applyTargetRestriction(track, target, { prefer = "restriction", requireRestriction = false, log } = {}) {
  const result = {
    target: describeElement(target),
    attempted: null,
    ok: false,
    error: null,
  };
  if (!target) {
    result.error = "target not found";
    return result;
  }

  const canRestrict =
    prefer !== "crop" &&
    typeof window.RestrictionTarget?.fromElement === "function" &&
    typeof track.restrictTo === "function";
  if (canRestrict) {
    result.attempted = "restriction";
    try {
      const restrictionTarget = await window.RestrictionTarget.fromElement(target);
      await track.restrictTo(restrictionTarget);
      result.ok = true;
      return result;
    } catch (error) {
      result.error = error?.message || String(error);
      logStep(log, "restrict.failed", result);
      if (requireRestriction) {
        throw new Error(`Node 2.0 capture requires RestrictionTarget/restrictTo: ${result.error}`);
      }
    }
  }

  if (requireRestriction) {
    if (!result.attempted) {
      result.error = "RestrictionTarget/restrictTo is unavailable";
    }
    throw new Error(`Node 2.0 capture requires RestrictionTarget/restrictTo: ${result.error || "restriction failed"}`);
  }

  const canCrop =
    typeof window.CropTarget?.fromElement === "function" &&
    typeof track.cropTo === "function";
  if (canCrop) {
    result.attempted = result.attempted ? `${result.attempted}->crop` : "crop";
    try {
      const cropTarget = await window.CropTarget.fromElement(target);
      await track.cropTo(cropTarget);
      result.ok = true;
      return result;
    } catch (error) {
      result.error = error?.message || String(error);
      logStep(log, "crop.failed", result);
    }
  }

  if (!result.attempted) {
    result.error = "RestrictionTarget/restrictTo and CropTarget/cropTo are unavailable";
  }
  return result;
}

export async function captureNode2SingleFrame(options = {}) {
  const log = Object.hasOwn(options, "log") ? options.log : console.log;
  const targetName = options.target || "commonRoot";
  const target = resolveTarget(targetName);
  const report = { startedAt: new Date().toISOString(), targetName, before: inspectNode2Targets() };

  ensureNode2CaptureStyle();
  const captureHandle = await maybeSetCaptureHandle(log);
  const chromeHider = createNode2ChromeHider();
  const canvasInfoHider = createNode2CanvasInfoHider(app?.canvas);
  const backgroundOverride = createNode2BackgroundOverride(options);

  let stream = null;
  let interactionShield = null;
  let cursorHider = null;
  try {
    stream = await requestDisplayMedia(log);
    document.documentElement.classList.add("cwie-node2-capturing");
    interactionShield = createNode2InteractionShield();
    cursorHider = createNode2InlineCursorHider(target);
    await backgroundOverride.apply();
    await canvasInfoHider.hide();
    hideNode2CaptureChrome(chromeHider);
    hideKnownComfyChrome(chromeHider);
    hideIntersectingChrome(chromeHider);
    await waitForNode2CaptureUiSettle();
    return await captureFrameFromStream(stream, target, targetName, captureHandle, options, log);
  } catch (error) {
    report.error = {
      name: error?.name || "",
      message: error?.message || String(error),
    };
    logStep(log, "failed", report.error);
    return report;
  } finally {
    interactionShield?.remove();
    cursorHider?.remove();
    stopStream(stream);
    chromeHider.restore();
    await backgroundOverride.restore();
    await canvasInfoHider.restore();
    document.documentElement.classList.remove("cwie-node2-capturing");
  }
}

async function waitForNode2CameraSettle(ms = 320) {
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise((resolve) => setTimeout(resolve, ms));
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function setNode2CanvasView(canvas, ds, offset, scale) {
  ds.scale = scale;
  ds.offset[0] = offset[0];
  ds.offset[1] = offset[1];
  const transformPane = getNode2Layers().transformPane;
  if (transformPane) {
    transformPane.style.transform = `scale3d(${scale}, ${scale}, ${scale}) translate3d(${offset[0]}px, ${offset[1]}px, 0)`;
    transformPane.style.transformOrigin = "0 0";
  }
  canvas.setDirty?.(true, true);
  canvas.setDirtyCanvas?.(true, true);
  try {
    canvas.draw?.(true, true);
  } catch (_) {
    // Some Node 2.0 builds keep DOM/canvas rendering on their own scheduler.
  }
}

async function withFitNode2View(options, fn) {
  if (options.fitView === false) {
    return fn(null);
  }
  const canvas = app?.canvas;
  const ds = canvas?.ds;
  const root = getNode2Layers().root;
  const graph = app?.graph || canvas?.graph;
  if (!canvas?.canvas || !ds || !Array.isArray(ds.offset) || !graph || !root) {
    return fn(null);
  }

  const original = {
    offset: [ds.offset[0], ds.offset[1]],
    scale: ds.scale || 1,
  };
  const rect = getCapturableRootRect(root) || root.getBoundingClientRect();
  const paddingPx = Math.max(24, Math.min(96, Number(options.fitPaddingPx) || 64));
  const bbox = measureNode2DomGraphBBox(root, ds) || computeGraphBBox(graph, {
    padding: 0,
    useBounding: true,
    debug: Boolean(options.debug),
  });
  const availableWidth = Math.max(1, rect.width - paddingPx * 2);
  const availableHeight = Math.max(1, rect.height - paddingPx * 2);
  const scale = Math.max(
    0.05,
    Math.min(1.2, availableWidth / bbox.width, availableHeight / bbox.height)
  );
  const visibleGraphWidth = rect.width / scale;
  const visibleGraphHeight = rect.height / scale;
  setNode2CanvasView(canvas, ds, [
    ((visibleGraphWidth - bbox.width) / 2) - bbox.minX,
    ((visibleGraphHeight - bbox.height) / 2) - bbox.minY,
  ], scale);
  await waitForNode2CameraSettle();
  const fitInfo = {
    version: NODE2_CAPTURE_VERSION,
    bbox,
    rootRect: {
      width: rect.width,
      height: rect.height,
      left: rect.left,
      top: rect.top,
      rootLeft: rect.rootLeft ?? rect.left,
      rootTop: rect.rootTop ?? rect.top,
    },
    cropRectCss: measureNode2DomCropRect(root, options.cropPaddingPx),
    scale,
    offset: [ds.offset[0], ds.offset[1]],
    cropPaddingPx: Math.max(8, Math.min(128, Number(options.cropPaddingPx) || 56)),
    metricsAfterFit: inspectNode2FitMetrics(),
  };
  try {
    return await fn(fitInfo);
  } finally {
    setNode2CanvasView(canvas, ds, original.offset, original.scale);
    await waitForNode2CameraSettle(120);
  }
}

function cropNode2CanvasToFit(canvas, fitInfo) {
  if (!canvas || !fitInfo?.bbox || !fitInfo?.rootRect) return canvas;
  const { bbox, scale, offset, rootRect, cropPaddingPx, cropRectCss } = fitInfo;
  const viewport = getViewportRect();
  const ratioX = canvas.width / Math.max(1, viewport.width);
  const ratioY = canvas.height / Math.max(1, viewport.height);
  const leftCss = cropRectCss?.left ?? ((bbox.minX + offset[0]) * scale - cropPaddingPx);
  const topCss = cropRectCss?.top ?? ((bbox.minY + offset[1]) * scale - cropPaddingPx);
  const rightCss = cropRectCss?.right ?? ((bbox.maxX + offset[0]) * scale + cropPaddingPx);
  const bottomCss = cropRectCss?.bottom ?? ((bbox.maxY + offset[1]) * scale + cropPaddingPx);
  const rootLeft = rootRect.rootLeft ?? rootRect.left ?? 0;
  const rootTop = rootRect.rootTop ?? rootRect.top ?? 0;
  const viewportLeftCss = rootLeft + leftCss - viewport.left;
  const viewportTopCss = rootTop + topCss - viewport.top;
  const viewportRightCss = rootLeft + rightCss - viewport.left;
  const viewportBottomCss = rootTop + bottomCss - viewport.top;
  const sx = Math.max(0, Math.floor(viewportLeftCss * ratioX));
  const sy = Math.max(0, Math.floor(viewportTopCss * ratioY));
  const ex = Math.min(canvas.width, Math.ceil(viewportRightCss * ratioX));
  const ey = Math.min(canvas.height, Math.ceil(viewportBottomCss * ratioY));
  const width = Math.max(1, ex - sx);
  const height = Math.max(1, ey - sy);
  fitInfo.cropGeometry = {
    sourceCanvas: {
      width: canvas.width,
      height: canvas.height,
    },
    rootRect,
    viewport,
    ratio: {
      x: ratioX,
      y: ratioY,
    },
    css: {
      left: leftCss,
      top: topCss,
      right: rightCss,
      bottom: bottomCss,
      width: rightCss - leftCss,
      height: bottomCss - topCss,
    },
    viewportCss: {
      left: viewportLeftCss,
      top: viewportTopCss,
      right: viewportRightCss,
      bottom: viewportBottomCss,
      width: viewportRightCss - viewportLeftCss,
      height: viewportBottomCss - viewportTopCss,
    },
    px: {
      sx,
      sy,
      ex,
      ey,
      width,
      height,
    },
  };
  if (width >= canvas.width && height >= canvas.height) {
    return canvas;
  }
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d", { alpha: true });
  if (!ctx) return canvas;
  ctx.drawImage(canvas, sx, sy, width, height, 0, 0, width, height);
  return out;
}

function cropNode2CanvasToRoot(canvas, root) {
  const captureRect = getEffectiveCapturableRootRect(root, canvas);
  if (!canvas || !captureRect) return { canvas, crop: null };
  const viewport = getViewportRect();
  const ratioX = canvas.width / Math.max(1, viewport.width);
  const ratioY = canvas.height / Math.max(1, viewport.height);
  const leftCss = captureRect.left - viewport.left;
  const topCss = captureRect.top - viewport.top;
  const rightCss = captureRect.right - viewport.left;
  const bottomCss = captureRect.bottom - viewport.top;
  const sx = Math.max(0, Math.floor(leftCss * ratioX));
  const sy = Math.max(0, Math.floor(topCss * ratioY));
  const ex = Math.min(canvas.width, Math.ceil(rightCss * ratioX));
  const ey = Math.min(canvas.height, Math.ceil(bottomCss * ratioY));
  const width = Math.max(1, ex - sx);
  const height = Math.max(1, ey - sy);
  if (sx === 0 && sy === 0 && width === canvas.width && height === canvas.height) {
    return {
      canvas,
      crop: {
        captureRect,
        ratioX,
        ratioY,
      },
    };
  }
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d", { alpha: true });
  if (!ctx) {
    return { canvas, crop: null };
  }
  ctx.drawImage(canvas, sx, sy, width, height, 0, 0, width, height);
  return {
    canvas: out,
    crop: {
      captureRect,
      ratioX,
      ratioY,
      sx,
      sy,
      width,
      height,
    },
  };
}

function useRestrictedFrameAsTile(canvas, captureRect) {
  if (!canvas || !captureRect) return { canvas, crop: null };
  const ratioX = canvas.width / Math.max(1, captureRect.width);
  const ratioY = canvas.height / Math.max(1, captureRect.height);
  return {
    canvas,
    crop: {
      captureRect,
      ratioX,
      ratioY,
      width: canvas.width,
      height: canvas.height,
      restrictedFrame: true,
    },
  };
}

function getNode2TileScale(options = {}) {
  const requested = Number(options.node2TileScale);
  if (Number.isFinite(requested) && requested > 0) {
    return Math.max(0.25, Math.min(1.25, requested));
  }
  return options.outputResolution === "200%" ? 1.25 : 1;
}

function shouldUseNode2TiledCapture(options, fitInfo, root) {
  const requested = options.node2TiledCapture === true ||
    options.node2TiledCapture === "debug" ||
    options.exceedMode === "tile";
  if (!requested || !fitInfo?.bbox || !root) return false;
  const captureRect = getCapturableRootRect(root);
  if (!captureRect) return false;
  const tileScale = getNode2TileScale(options);
  const padGraph = Math.max(8, Math.min(128, Number(options.cropPaddingPx) || 56)) / tileScale;
  const graphWidth = fitInfo.bbox.width + padGraph * 2;
  const graphHeight = fitInfo.bbox.height + padGraph * 2;
  const dpr = window.devicePixelRatio || 1;
  return graphWidth * tileScale * dpr * graphHeight * tileScale * dpr <= NODE2_TILE_MAX_PIXELS;
}

function getNode2CurrentGraphBBox() {
  const { root } = getNode2Layers();
  const canvas = app?.canvas;
  const ds = canvas?.ds;
  const graph = app?.graph || canvas?.graph;
  let bbox = graph ? measureNode2GraphBBox(graph) : null;
  const domGraphBBox = root && ds ? measureNode2DomGraphBBox(root, ds) : null;
  if (!bbox && graph) {
    try {
      bbox = computeGraphBBox(graph, { padding: 0, useBounding: true });
    } catch (_) {
      bbox = null;
    }
  }
  if (!bbox) return null;
  return {
    version: NODE2_CAPTURE_VERSION,
    rootRect: root?.getBoundingClientRect?.() || null,
    currentTransform: ds
      ? {
        scale: ds.scale,
        offset: Array.isArray(ds.offset) ? [ds.offset[0], ds.offset[1]] : null,
      }
      : null,
    bbox,
    domGraphBBox,
    metricsAfterFit: inspectNode2FitMetrics(),
  };
}

async function captureNode2TiledFromFit(fitInfo, options = {}) {
  const canvas = app?.canvas;
  const ds = canvas?.ds;
  const graph = app?.graph || canvas?.graph;
  const { root } = getNode2Layers();
  if (!canvas?.canvas || !ds || !Array.isArray(ds.offset) || !root || !graph || !fitInfo?.bbox) {
    return null;
  }

  const targetName = options.target || "commonRoot";
  const target = resolveTarget(targetName);
  const tileScale = getNode2TileScale(options);
  const cropPaddingPx = Math.max(8, Math.min(128, Number(options.cropPaddingPx) || 56));
  const padGraph = cropPaddingPx / tileScale;
  const bbox = fitInfo.bbox;
  const minX = bbox.minX - padGraph;
  const minY = bbox.minY - padGraph;
  const maxX = bbox.maxX + padGraph;
  const maxY = bbox.maxY + padGraph;
  const graphWidth = Math.max(1, maxX - minX);
  const graphHeight = Math.max(1, maxY - minY);
  const saved = {
    offset: [ds.offset[0], ds.offset[1]],
    scale: ds.scale || 1,
  };
  let output = null;
  let outputCtx = null;
  const log = options.debug ? console.log : null;
  const captureHandle = await maybeSetCaptureHandle(log);
  const chromeHider = createNode2ChromeHider();
  const canvasInfoHider = createNode2CanvasInfoHider(canvas);
  const backgroundOverride = createNode2BackgroundOverride(options);

  ensureNode2CaptureStyle();

  let stream = null;
  let prepared = null;
  let interactionShield = null;
  let cursorHider = null;
  try {
    stream = await requestDisplayMedia(log);
    document.documentElement.classList.add("cwie-node2-capturing");
    interactionShield = createNode2InteractionShield();
    cursorHider = createNode2InlineCursorHider(root);
    await backgroundOverride.apply();
    await canvasInfoHider.hide();
    hideNode2CaptureChrome(chromeHider);
    hideKnownComfyChrome(chromeHider);
    hideIntersectingChrome(chromeHider);
    await waitForNode2CaptureUiSettle();
    prepared = await prepareFrameCaptureFromStream(
      stream,
      target,
      targetName,
      captureHandle,
      {
        ...options,
        frameCount: 1,
        frameTimeoutMs: 1500,
        probe: false,
        prefer: "restriction",
        requireRestriction: true,
      },
      log
    );
    const seedFrame = await seedPreparedFrameSignature(prepared, log);
    const rootRect = root.getBoundingClientRect();
    const captureRect = getEffectiveCapturableRootRect(root, prepared.video);
    if (!rootRect || rootRect.width <= 0 || rootRect.height <= 0 || !captureRect) {
      return { error: { message: "Node 2.0 tiled capture failed: graph root has no size." } };
    }
    const frameCssRatioX = prepared.video.videoWidth / Math.max(1, captureRect.width);
    const frameCssRatioY = prepared.video.videoHeight / Math.max(1, captureRect.height);
    const captureOriginX = captureRect.left - rootRect.left;
    const captureOriginY = captureRect.top - rootRect.top;
    const visibleGraphWidth = captureRect.width / tileScale;
    const visibleGraphHeight = captureRect.height / tileScale;
    const overlapPx = Math.max(0, Math.min(64, Number(options.node2TileOverlapPx) || 16));
    const overlapGraph = overlapPx / tileScale;
    const tileStepX = Math.max(1, visibleGraphWidth - overlapGraph * 2);
    const tileStepY = Math.max(1, visibleGraphHeight - overlapGraph * 2);
    const cols = graphWidth <= visibleGraphWidth
      ? 1
      : Math.ceil((graphWidth - visibleGraphWidth) / tileStepX) + 1;
    const rows = graphHeight <= visibleGraphHeight
      ? 1
      : Math.ceil((graphHeight - visibleGraphHeight) / tileStepY) + 1;
    const pxPerGraphX = frameCssRatioX * tileScale;
    const pxPerGraphY = frameCssRatioY * tileScale;
    const outputWidth = Math.max(1, Math.ceil(graphWidth * pxPerGraphX));
    const outputHeight = Math.max(1, Math.ceil(graphHeight * pxPerGraphY));
    output = document.createElement("canvas");
    output.width = outputWidth;
    output.height = outputHeight;
    outputCtx = output.getContext("2d", { alpha: true });
    if (!outputCtx) {
      return { error: { message: "Node 2.0 tiled capture failed: 2d context unavailable." } };
    }
    outputCtx.clearRect(0, 0, output.width, output.height);

    const tileXs = Array.from({ length: cols }, (_, col) => {
      const planned = minX + col * tileStepX;
      return col === cols - 1 ? Math.max(minX, maxX - visibleGraphWidth) : planned;
    });
    const tileYs = Array.from({ length: rows }, (_, row) => {
      const planned = minY + row * tileStepY;
      return row === rows - 1 ? Math.max(minY, maxY - visibleGraphHeight) : planned;
    });
    logStep(log, "capture.tile.plan", () => ({
      graphWidth,
      graphHeight,
      tileStepX,
      tileStepY,
      overlapPx,
      overlapGraph,
      visibleGraphWidth,
      visibleGraphHeight,
      cols,
      rows,
      tileXs,
      tileYs,
      rootRect: describeRect(rootRect),
      captureRect,
      captureOrigin: {
        x: captureOriginX,
        y: captureOriginY,
      },
      seedFrame,
      bboxSource: {
        graph: fitInfo.bbox,
        dom: fitInfo.domGraphBBox || null,
      },
      video: {
        width: prepared.video.videoWidth,
        height: prepared.video.videoHeight,
      },
      frameCssRatio: {
        x: frameCssRatioX,
        y: frameCssRatioY,
      },
      output: {
        width: output.width,
        height: output.height,
        pxPerGraphX,
        pxPerGraphY,
      },
    }));
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const tileStarted = performance.now();
        const tileIndex = row * cols + col;
        options.onProgress?.({
          value: tileIndex / Math.max(1, rows * cols),
          percent: Math.round((tileIndex / Math.max(1, rows * cols)) * 100),
        });
        const tileX = tileXs[col];
        const tileY = tileYs[row];
        const tileOffset = [
          (captureOriginX / tileScale) - tileX,
          (captureOriginY / tileScale) - tileY,
        ];
        const settleStarted = performance.now();
        await setAndWaitNode2CanvasView(canvas, ds, root, graph, tileOffset, tileScale, log, {
          settleMs: Number(options.node2TileSettleMs) || NODE2_TILE_SETTLE_MS,
        });
        const settleElapsedMs = Math.round(performance.now() - settleStarted);
        logStep(log, "capture.tile.view", () => ({
          row,
          col,
          tileX,
          tileY,
          scale: ds.scale,
          offset: [ds.offset[0], ds.offset[1]],
          rawNodeRects: snapshotNode2RawRects(root, 4),
          domGraphBBox: measureNode2DomGraphBBox(root, ds),
        }));

        const frameStarted = performance.now();
        const frame = await captureFrameFromPreparedVideo(prepared, {
          ...options,
          frameCount: 1,
          frameTimeoutMs: 5000,
          probe: false,
          pollChangedFrame: true,
          pollMinWaitMs: Number(options.node2TilePollMinWaitMs) || NODE2_TILE_POLL_MIN_WAIT_MS,
          pollIntervalMs: Number(options.node2TilePollIntervalMs) || NODE2_TILE_POLL_INTERVAL_MS,
        }, log);
        const frameElapsedMs = Math.round(performance.now() - frameStarted);
        if (frame.error || !frame.canvas) {
          return {
            error: frame.error || { message: "Node 2.0 tiled capture failed: no captured frame." },
          };
        }
        const tileLeft = tileX;
        const tileTop = tileY;
        const tileRight = tileX + visibleGraphWidth;
        const tileBottom = tileY + visibleGraphHeight;
        const cellLeft = col === 0 ? minX : minX + col * tileStepX;
        const cellTop = row === 0 ? minY : minY + row * tileStepY;
        const cellRight = col === cols - 1 ? maxX : Math.min(maxX, minX + (col + 1) * tileStepX);
        const cellBottom = row === rows - 1 ? maxY : Math.min(maxY, minY + (row + 1) * tileStepY);
        const drawLeft = Math.max(cellLeft, tileLeft);
        const drawTop = Math.max(cellTop, tileTop);
        const drawRight = Math.min(cellRight, tileRight);
        const drawBottom = Math.min(cellBottom, tileBottom);
        if (drawRight <= drawLeft || drawBottom <= drawTop) {
          releaseCanvasResource(frame.canvas);
          continue;
        }

        const sx = Math.max(0, Math.floor((drawLeft - tileLeft) * pxPerGraphX));
        const sy = Math.max(0, Math.floor((drawTop - tileTop) * pxPerGraphY));
        const sw = Math.max(1, Math.min(frame.canvas.width - sx, Math.ceil((drawRight - drawLeft) * pxPerGraphX)));
        const sh = Math.max(1, Math.min(frame.canvas.height - sy, Math.ceil((drawBottom - drawTop) * pxPerGraphY)));
        const dx = Math.round((drawLeft - minX) * pxPerGraphX);
        const dy = Math.round((drawTop - minY) * pxPerGraphY);
        const dw = Math.max(1, Math.round((drawRight - drawLeft) * pxPerGraphX));
        const dh = Math.max(1, Math.round((drawBottom - drawTop) * pxPerGraphY));
        outputCtx.drawImage(frame.canvas, sx, sy, sw, sh, dx, dy, dw, dh);
        releaseCanvasResource(frame.canvas);
        logStep(log, "capture.tile.blit", () => ({
          row,
          col,
          source: { sx, sy, sw, sh },
          dest: { dx, dy, dw, dh },
          pxPerGraph: { x: pxPerGraphX, y: pxPerGraphY },
          drawGraphRect: { left: drawLeft, top: drawTop, right: drawRight, bottom: drawBottom },
          cellGraphRect: { left: cellLeft, top: cellTop, right: cellRight, bottom: cellBottom },
          tileGraphRect: { left: tileLeft, top: tileTop, right: tileRight, bottom: tileBottom },
          actualTransform: { scale: ds.scale, offset: [ds.offset[0], ds.offset[1]] },
          elapsedMs: Math.round(performance.now() - tileStarted),
          settleElapsedMs,
          frameElapsedMs,
        }));
      }
    }
    options.onProgress?.({ value: 1, percent: 100 });

    return {
      type: "raster",
      canvas: output,
      frame: {
        blobOk: Boolean(output),
        width: output?.width || 0,
        height: output?.height || 0,
        tiled: true,
        cols,
        rows,
        tileScale,
      },
      fit: {
        ...fitInfo,
        tiled: {
          cols,
          rows,
          tileScale,
          outputWidth: output?.width || 0,
          outputHeight: output?.height || 0,
        },
      },
      restriction: { attempted: "restriction", ok: true },
    };
  } catch (error) {
    return {
      error: {
        name: error?.name || "",
        message: error?.message || String(error),
      },
    };
  } finally {
    interactionShield?.remove();
    cursorHider?.remove();
    releaseHiddenVideo(prepared?.video);
    stopStream(stream);
    chromeHider.restore();
    await backgroundOverride.restore();
    await canvasInfoHider.restore();
    document.documentElement.classList.remove("cwie-node2-capturing");
    setNode2CanvasView(canvas, ds, saved.offset, saved.scale);
    await waitForNode2CameraSettle(120);
  }
}

function toBlob(canvas, mime) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Node 2.0 capture failed: canvas encoding returned no blob."));
        return;
      }
      resolve(blob);
    }, mime);
  });
}

function collectNode2Warnings(options = {}) {
  const warnings = [];
  if (options.background === "transparent") {
    warnings.push("node2:transparent_background_unsupported");
  }
  if (Number(options.padding) > 0) {
    warnings.push("node2:padding_unsupported");
  }
  if (Boolean(options.scopeSelected)) {
    warnings.push("node2:selection_crop_unsupported");
  }
  if (Number(options.nodeOpacity) < 100) {
    warnings.push("node2:node_opacity_unsupported");
  }
  return warnings;
}

export async function captureNode2(options = {}) {
  if (node2CaptureInFlight) {
    throw new Error("Node 2.0 capture is already running.");
  }
  node2CaptureInFlight = true;
  try {
    const format = String(options.format || "png").toLowerCase();
    const mime = format === "webp" ? "image/webp" : "image/png";
    const root = getNode2Layers().root;
    const tileInfo = getNode2CurrentGraphBBox();
    let report = null;
    if (shouldUseNode2TiledCapture(options, tileInfo, root)) {
      logStep(options.debug ? console.log : null, "capture.tile.start", {
        version: NODE2_CAPTURE_VERSION,
        bbox: tileInfo?.bbox,
        tileScale: getNode2TileScale(options),
      });
      const tiled = await captureNode2TiledFromFit(tileInfo, options);
      if (tiled?.canvas && !tiled.error) {
        logStep(options.debug ? console.log : null, "capture.tile.done", {
          version: NODE2_CAPTURE_VERSION,
          frame: tiled.frame,
          fit: tiled.fit?.tiled,
        });
        report = tiled;
      } else {
        logStep(options.debug ? console.log : null, "capture.tile.failed", {
          version: NODE2_CAPTURE_VERSION,
          error: tiled?.error || null,
        });
        throw new Error(`Node 2.0 tiled capture failed: ${tiled?.error?.message || "unknown error"}`);
      }
    } else if (options.node2TiledCapture === true || options.exceedMode === "tile") {
      logStep(options.debug ? console.log : null, "capture.tile.skip", {
        version: NODE2_CAPTURE_VERSION,
        reason: "node2_tiled_display_media_capture_unavailable",
      });
    }

    if (!report) {
      report = await withFitNode2View(options, async (fitInfo) => {
        logStep(options.debug ? console.log : null, "capture.fit", fitInfo);
        const captured = await captureNode2SingleFrame({
          ...options,
          target: options.target || "commonRoot",
          includeCanvas: true,
          frameCount: 1,
          frameTimeoutMs: 250,
          probe: false,
          log: options.debug ? console.log : null,
        });
        if (captured.canvas && fitInfo) {
          captured.canvas = cropNode2CanvasToFit(captured.canvas, fitInfo);
          captured.frame = {
            ...captured.frame,
            croppedWidth: captured.canvas.width,
            croppedHeight: captured.canvas.height,
          };
          captured.fit = fitInfo;
          logStep(options.debug ? console.log : null, "capture.crop", {
            version: NODE2_CAPTURE_VERSION,
            croppedWidth: captured.canvas.width,
            croppedHeight: captured.canvas.height,
            cropRectCss: fitInfo.cropRectCss,
            cropGeometry: fitInfo.cropGeometry,
            bbox: fitInfo.bbox,
            metricsAfterFit: fitInfo.metricsAfterFit,
          });
        }
        return captured;
      });
    }
    if (report.error) {
      throw new Error(`Node 2.0 capture failed: ${report.error.message || "unknown error"}`);
    }
    if (!report.canvas || !report.frame?.blobOk) {
      throw new Error("Node 2.0 capture failed: no captured frame was produced.");
    }
    logStep(options.debug ? console.log : null, "capture.encode.start", {
      width: report.canvas.width,
      height: report.canvas.height,
      tiled: Boolean(report.frame?.tiled),
      mime,
    });
    const width = report.canvas.width;
    const height = report.canvas.height;
    const blob = await toBlob(report.canvas, mime);
    releaseCanvasResource(report.canvas);
    report.canvas = null;
    logStep(options.debug ? console.log : null, "capture.encode.done", {
      size: blob.size,
      type: blob.type,
    });
    const warnings = collectNode2Warnings(options);
    if (report.restriction?.attempted && !report.restriction.ok) {
      warnings.push(`node2:target_restriction_failed:${report.restriction.attempted}`);
    }
    if (report.frame?.tiled) {
      warnings.push("node2:compositor_tiled_capture");
    } else if (options.exceedMode === "tile") {
      warnings.push("node2:tiled_export_unsupported");
    }
    return {
      type: "raster",
      mime,
      blob,
      width,
      height,
      cwieWarnings: warnings,
      node2Report: report,
    };
  } finally {
    node2CaptureInFlight = false;
  }
}

async function waitAfterCameraMove() {
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise((resolve) => setTimeout(resolve, 280));
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function setCanvasView(ds, offset, scale) {
  const canvas = app?.canvas;
  if (canvas) {
    setNode2CanvasView(canvas, ds, offset, scale);
    return;
  }
  ds.scale = scale;
  ds.offset[0] = offset[0];
  ds.offset[1] = offset[1];
}

export async function runNode2TileProbe(options = {}) {
  const log = Object.hasOwn(options, "log") ? options.log : console.log;
  const canvas = app?.canvas;
  const ds = canvas?.ds;
  if (!canvas?.canvas || !ds || !Array.isArray(ds.offset)) {
    return { ok: false, error: "app.canvas.ds unavailable" };
  }
  const original = {
    offset: [ds.offset[0], ds.offset[1]],
    scale: ds.scale || 1,
  };
  const tileCount = Math.max(1, Math.min(3, Number(options.tiles) || 2));
  const viewport = canvas.canvas.getBoundingClientRect();
  const stepX = viewport.width / original.scale;
  const stepY = viewport.height / original.scale;
  const targetName = options.target || "commonRoot";
  const target = resolveTarget(targetName);
  const captures = [];
  ensureNode2CaptureStyle();
  const captureHandle = await maybeSetCaptureHandle(log);
  let stream = null;
  let interactionShield = null;
  let cursorHider = null;
  try {
    stream = await requestDisplayMedia(log);
    document.documentElement.classList.add("cwie-node2-capturing");
    interactionShield = createNode2InteractionShield();
    cursorHider = createNode2InlineCursorHider(target);
    await waitForNode2CaptureUiSettle();
    for (let y = 0; y < tileCount; y += 1) {
      for (let x = 0; x < tileCount; x += 1) {
        setCanvasView(ds, [
          original.offset[0] - x * stepX,
          original.offset[1] - y * stepY,
        ], original.scale);
        await waitAfterCameraMove();
        const frame = await captureFrameFromStream(
          stream,
          target,
          targetName,
          captureHandle,
          options,
          log
        );
        captures.push({ x, y, frame });
      }
    }
    return { ok: true, original, viewport: describeElement(canvas.canvas), captures };
  } catch (error) {
    return {
      ok: false,
      original,
      viewport: describeElement(canvas.canvas),
      captures,
      error: {
        name: error?.name || "",
        message: error?.message || String(error),
      },
    };
  } finally {
    interactionShield?.remove();
    cursorHider?.remove();
    stopStream(stream);
    document.documentElement.classList.remove("cwie-node2-capturing");
    setCanvasView(ds, original.offset, original.scale);
    await waitAfterCameraMove();
  }
}

export async function runNode2CameraMoveProbe(options = {}) {
  const canvas = app?.canvas;
  const ds = canvas?.ds;
  const { root } = getNode2Layers();
  if (!canvas?.canvas || !ds || !Array.isArray(ds.offset) || !root) {
    return { ok: false, error: "Node 2.0 canvas/root unavailable" };
  }

  const original = {
    offset: [ds.offset[0], ds.offset[1]],
    scale: ds.scale || 1,
  };
  const deltaGraphX = Number.isFinite(Number(options.deltaGraphX))
    ? Number(options.deltaGraphX)
    : 240;
  const deltaGraphY = Number.isFinite(Number(options.deltaGraphY))
    ? Number(options.deltaGraphY)
    : 120;
  const targetScale = Number.isFinite(Number(options.targetScale))
    ? Math.max(0.05, Math.min(4, Number(options.targetScale)))
    : original.scale;
  const sampleBefore = snapshotNode2RawRects(root, 6);
  try {
    setNode2CanvasView(canvas, ds, [
      original.offset[0] + deltaGraphX,
      original.offset[1] + deltaGraphY,
    ], targetScale);
    await waitForNode2CameraSettle(Math.max(120, Number(options.settleMs) || 360));
    const sampleAfter = snapshotNode2RawRects(root, 6);
    const beforeById = new Map(sampleBefore.map((item) => [item.id, item]));
    const deltas = sampleAfter.map((after) => {
      const before = beforeById.get(after.id);
      return {
        id: after.id,
        title: after.title,
        dx: before?.rect && after.rect ? after.rect.left - before.rect.left : null,
        dy: before?.rect && after.rect ? after.rect.top - before.rect.top : null,
        widthRatio: before?.rect && after.rect && before.rect.width
          ? after.rect.width / before.rect.width
          : null,
        heightRatio: before?.rect && after.rect && before.rect.height
          ? after.rect.height / before.rect.height
          : null,
      };
    });
    return {
      ok: true,
      version: NODE2_CAPTURE_VERSION,
      original,
      applied: {
        offset: [ds.offset[0], ds.offset[1]],
        scale: ds.scale || 1,
        targetScale,
        deltaGraphX,
        deltaGraphY,
        expectedCssDx: deltaGraphX * targetScale,
        expectedCssDy: deltaGraphY * targetScale,
        expectedSizeRatio: targetScale / original.scale,
      },
      before: sampleBefore,
      after: sampleAfter,
      deltas,
    };
  } finally {
    setNode2CanvasView(canvas, ds, original.offset, original.scale);
    await waitForNode2CameraSettle(120);
  }
}
