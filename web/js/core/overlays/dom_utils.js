const NODE_SELECTORS = [
  ".comfy-node",
  ".litegraph-node",
  ".graph-node",
  "[data-node-id]",
  "[data-nodeid]",
].join(", ");

function classListToArray(element) {
  return Array.from(element?.classList || []);
}

function clipText(value, max = 200) {
  if (typeof value !== "string") return "";
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function getCanvasAndElementRects(uiCanvas, el) {
  const canvasRect = uiCanvas?.canvas?.getBoundingClientRect?.() || null;
  const elementRect = el?.getBoundingClientRect?.() || null;
  return {
    canvasRect: canvasRect
      ? {
        left: canvasRect.left,
        top: canvasRect.top,
        width: canvasRect.width,
        height: canvasRect.height,
        right: canvasRect.right,
        bottom: canvasRect.bottom,
      }
      : null,
    elementRect: elementRect
      ? {
        left: elementRect.left,
        top: elementRect.top,
        width: elementRect.width,
        height: elementRect.height,
        right: elementRect.right,
        bottom: elementRect.bottom,
      }
      : null,
  };
}

function getCanvasRelativeRect(uiCanvas, el) {
  const canvasEl = uiCanvas?.canvas;
  const ds = uiCanvas?.ds;
  if (!canvasEl || !ds) return null;
  const rect = canvasEl.getBoundingClientRect();
  const r = el?.getBoundingClientRect?.();
  if (!rect?.width || !rect?.height || !r?.width || !r?.height) return null;
  return {
    sx: r.left - rect.left,
    sy: r.top - rect.top,
    sw: r.width,
    sh: r.height,
  };
}

export function diagnoseDomElement(el, uiCanvas, extras = {}) {
  if (!el) return null;
  const nodeRoot = el.closest?.(NODE_SELECTORS) || null;
  const parentChain = [];
  let current = el.parentElement;
  let depth = 0;
  while (current && depth < 5) {
    parentChain.push({
      tagName: current.tagName,
      classList: classListToArray(current),
      dataNodeId:
        current.getAttribute?.("data-node-id") ??
        current.getAttribute?.("data-nodeid") ??
        null,
    });
    current = current.parentElement;
    depth += 1;
  }

  const rects = getCanvasAndElementRects(uiCanvas, el);
  const canvasRelative = getCanvasRelativeRect(uiCanvas, el);
  const ds = uiCanvas?.ds;
  const graphRect = canvasRelative
    ? {
      x: canvasRelative.sx / ds.scale - ds.offset[0],
      y: canvasRelative.sy / ds.scale - ds.offset[1],
      w: canvasRelative.sw / ds.scale,
      h: canvasRelative.sh / ds.scale,
    }
    : null;

  return {
    tagName: el.tagName,
    classList: classListToArray(el),
    outerHTML: clipText(el.outerHTML || ""),
    nodeId: getNodeIdFromElement(el),
    closestNode: nodeRoot
      ? {
        tagName: nodeRoot.tagName,
        classList: classListToArray(nodeRoot),
        dataNodeId:
          nodeRoot.getAttribute?.("data-node-id") ??
          nodeRoot.getAttribute?.("data-nodeid") ??
          null,
      }
      : null,
    parentChain,
    ...rects,
    canvasRelative,
    graphRect,
    dragScale: ds
      ? {
        scale: ds.scale,
        offset: Array.isArray(ds.offset) ? [ds.offset[0], ds.offset[1]] : null,
      }
      : null,
    ...extras,
  };
}

export function getCanvasRoot(uiCanvas) {
  const canvasEl = uiCanvas?.canvas;
  if (!canvasEl) return document;
  return canvasEl.closest?.(".graph-canvas-panel") || canvasEl.parentElement || document;
}

export function isElementInGraphNode(element) {
  return Boolean(element?.closest?.(NODE_SELECTORS));
}

export function getNodeIdFromElement(element) {
  const nodeRoot = element?.closest?.(NODE_SELECTORS);
  if (!nodeRoot) return null;
  const idAttr = nodeRoot.getAttribute?.("data-node-id") ?? nodeRoot.getAttribute?.("data-nodeid");
  if (!idAttr) return null;
  const id = Number.parseInt(idAttr, 10);
  return Number.isFinite(id) ? id : null;
}

export function resolveNodeIdForGraphRect(nodeRects, rect, fallbackId = null) {
  if (Number.isFinite(fallbackId)) return fallbackId;
  if (!rect || !nodeRects?.length) return null;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  for (let i = 0; i < nodeRects.length; i += 1) {
    const node = nodeRects[i];
    if (!node) continue;
    if (cx >= node.left && cx <= node.right && cy >= node.top && cy <= node.bottom) {
      return Number.isFinite(node.id) ? node.id : null;
    }
  }
  return null;
}

function collectElements({ selectors, filter, root = document, uiCanvas = null, debugLog = null, kind = "dom" }) {
  const elements = [];
  for (const selector of selectors) {
    for (const node of root.querySelectorAll(selector)) {
      if (!filter || filter(node)) {
        elements.push(node);
        debugLog?.("diag.collect", diagnoseDomElement(node, uiCanvas, { selector, kind }));
      }
    }
  }
  return elements;
}

export function collectTextElementsFromDom(uiCanvas, options = {}) {
  const root = getCanvasRoot(uiCanvas);
  const selectors = [
    ".dom-widget textarea",
    ".dom-widget .tiptap",
    ".dom-widget input[type='text']",
    ".dom-widget [contenteditable='true']",
    ".dom-widget .ProseMirror",
    ".dom-widget .cm-content",
    ".dom-widget .cm-line",
    ".dom-widget .markdown-editor",
    ".dom-widget .markdown-rendered",
    ".dom-widget .markdown",
    ".dom-widget .markdown-body",
    ".dom-widget .markdown-preview",
    // Modern ComfyUI frontend (WidgetMarkdown component) uses these classes:
    ".dom-widget .comfy-markdown-content",
    ".dom-widget .widget-markdown",
    ".dom-widget pre",
    "textarea",
    ".tiptap",
    "input[type='text']",
    "[contenteditable='true']",
    ".ProseMirror",
    ".cm-content",
    ".cm-line",
    ".markdown-editor",
    ".markdown-rendered",
    ".markdown",
    ".markdown-body",
    ".markdown-preview",
    ".comfy-markdown-content",
    "pre",
  ];
  const elements = collectElements({
    selectors,
    root,
    uiCanvas,
    debugLog: options.debugLog,
    kind: "text",
    filter: (node) =>
      (node instanceof HTMLTextAreaElement ||
        node instanceof HTMLInputElement ||
        node instanceof HTMLElement) &&
      (isElementInGraphNode(node) || Boolean(node.closest?.(".dom-widget"))),
  });
  return elements;
}

export function collectImageElementsFromDom(uiCanvas, options = {}) {
  const root = getCanvasRoot(uiCanvas);
  const selectors = ["img", "canvas"];
  const elements = collectElements({
    selectors,
    root,
    uiCanvas,
    debugLog: options.debugLog,
    kind: "image",
    filter: (node) =>
      (node instanceof HTMLImageElement || node instanceof HTMLCanvasElement) &&
      isElementInGraphNode(node),
  });
  return elements;
}

export function collectVideoElementsFromDom(uiCanvas, options = {}) {
  const root = getCanvasRoot(uiCanvas);
  const seen = new Set();
  const elements = [];
  const videoRoots = root && root !== document ? [root, document] : [document];
  const isVhsLikeVideo = (el) => {
    if (!(el instanceof HTMLVideoElement)) return false;
    if (el.closest?.(".vhs_preview")) return true;
    if (el.classList?.contains("VHS_loopedvideo")) return true;
    const src = `${el.currentSrc || ""} ${el.src || ""}`.toLowerCase();
    return src.includes("/api/vhs/viewvideo") || src.includes("viewvideo");
  };

  // VHS previews may live outside the standard node container hierarchy and
  // often do not carry a special class in newer frontends. Collect anything
  // that looks like a VHS preview unconditionally; position-based matching
  // handles the rest.
  for (const searchRoot of videoRoots) {
    for (const el of searchRoot.querySelectorAll("video")) {
      if (isVhsLikeVideo(el) && !seen.has(el)) {
        seen.add(el);
        elements.push(el);
        options.debugLog?.("diag.collect", diagnoseDomElement(el, uiCanvas, {
          selector: el.closest?.(".vhs_preview") ? ".vhs_preview video" : "video[src*='viewvideo']",
          kind: "video",
          isVhsLike: true,
        }));
      }
    }
  }

  // Standard video elements may be rendered either inside the node subtree or
  // inside a detached .dom-widget overlay. Collect both; node matching happens
  // later by graph position.
  for (const searchRoot of videoRoots) {
    for (const el of searchRoot.querySelectorAll("video")) {
      if (
        el instanceof HTMLVideoElement &&
        !seen.has(el) &&
        (isElementInGraphNode(el) || Boolean(el.closest?.(".dom-widget")))
      ) {
        seen.add(el);
        elements.push(el);
        options.debugLog?.("diag.collect", diagnoseDomElement(el, uiCanvas, {
          selector: el.closest?.(".dom-widget") ? ".dom-widget video" : "video",
          kind: "video",
          isVhsLike: false,
        }));
      }
    }
  }

  return elements;
}

/** Collect top-level .dom-widget containers from the graph canvas overlay. */
export function collectDomWidgetContainers(uiCanvas, options = {}) {
  const root = getCanvasRoot(uiCanvas);
  const elements = [];
  for (const el of root.querySelectorAll(".dom-widget")) {
    elements.push(el);
    options.debugLog?.("diag.collect", diagnoseDomElement(el, uiCanvas, {
      selector: ".dom-widget",
      kind: "widget",
    }));
  }
  return elements;
}

export function collectDomMediaElements(uiCanvas) {
  const root = getCanvasRoot(uiCanvas);
  const selectors = ["video", "canvas", "img"];
  const elements = collectElements({
    selectors,
    root,
    filter: (node) =>
      (node instanceof HTMLVideoElement ||
        node instanceof HTMLCanvasElement ||
        node instanceof HTMLImageElement) &&
      isElementInGraphNode(node),
  });
  return elements;
}

export function canvasPointToGraph(uiCanvas, x, y) {
  if (typeof uiCanvas?.convertCanvasToOffset === "function") {
    return uiCanvas.convertCanvasToOffset([x, y]);
  }
  const ds = uiCanvas?.ds;
  if (!ds) return [x, y];
  return [x / ds.scale - ds.offset[0], y / ds.scale - ds.offset[1]];
}

export function getEffectivePxRatio(canvas) {
  if (!canvas) return 1;
  const rect = canvas.getBoundingClientRect();
  return rect.width > 0 ? canvas.width / rect.width : 1;
}

export function getDomElementGraphRect(el, uiCanvas, options = null) {
  const canvasEl = uiCanvas?.canvas;
  const ds = uiCanvas?.ds;
  if (!canvasEl || !ds) return null;

  const rect = canvasEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;

  // ds.scale is in CSS-pixels/graph-unit (confirmed from LiteGraph fitToBounds:
  // it divides canvas.width by devicePixelRatio to get CSS width, then uses that
  // to compute scale). getBoundingClientRect() returns CSS pixel coordinates.
  // Do NOT multiply by devicePixelRatio / getEffectivePxRatio — that would
  // over-scale by DPR and produce graph coordinates 2× too large on HiDPI displays.
  const sx = r.left - rect.left;
  const sy = r.top - rect.top;
  const sw = r.width;
  const sh = r.height;

  const p0 = canvasPointToGraph(uiCanvas, sx, sy);
  const p1 = canvasPointToGraph(uiCanvas, sx + sw, sy + sh);
  const graphRect = {
    x: p0[0],
    y: p0[1],
    w: p1[0] - p0[0],
    h: p1[1] - p0[1],
  };
  options?.debugLog?.("diag.graphRect", diagnoseDomElement(el, uiCanvas, {
    kind: options?.kind || "dom",
    stage: options?.stage || "transform",
    selector: options?.selector || null,
    canvasRelative: { sx, sy, sw, sh },
    graphRect,
  }));
  return graphRect;
}
