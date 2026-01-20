export function getCanvasRoot(uiCanvas) {
  const canvasEl = uiCanvas?.canvas;
  if (!canvasEl) return document;
  return canvasEl.closest?.(".graph-canvas-panel") || canvasEl.parentElement || document;
}

export function isElementInGraphNode(element) {
  return Boolean(
    element?.closest?.(
      ".comfy-node, .litegraph-node, .graph-node, .node, .dom-widget, [data-node-id], [data-nodeid]"
    )
  );
}

export function getNodeIdFromElement(element) {
  const nodeRoot = element?.closest?.(
    ".comfy-node, .litegraph-node, .graph-node, .node, [data-node-id], [data-nodeid]"
  );
  if (!nodeRoot) return null;
  const idAttr = nodeRoot.getAttribute?.("data-node-id") ?? nodeRoot.getAttribute?.("data-nodeid");
  if (!idAttr) return null;
  const id = Number.parseInt(idAttr, 10);
  return Number.isFinite(id) ? id : null;
}

function collectElements({ selectors, filter, root = document }) {
  const elements = [];
  for (const selector of selectors) {
    for (const node of root.querySelectorAll(selector)) {
      if (!filter || filter(node)) {
        elements.push(node);
      }
    }
  }
  return elements;
}

export function collectTextElementsFromDom() {
  const selectors = [
    ".dom-widget textarea",
    ".dom-widget input[type='text']",
    ".dom-widget .markdown",
    ".dom-widget .markdown-body",
    ".dom-widget .markdown-preview",
    ".dom-widget pre",
    "textarea",
    "input[type='text']",
    ".markdown",
    ".markdown-body",
    ".markdown-preview",
    "pre",
  ];
  const elements = collectElements({
    selectors,
    filter: (node) =>
      (node instanceof HTMLTextAreaElement ||
        node instanceof HTMLInputElement ||
        node instanceof HTMLElement) &&
      isElementInGraphNode(node),
  });
  return elements;
}

export function collectImageElementsFromDom() {
  const selectors = ["img", "canvas"];
  const elements = collectElements({
    selectors,
    filter: (node) =>
      (node instanceof HTMLImageElement || node instanceof HTMLCanvasElement) &&
      isElementInGraphNode(node),
  });
  return elements;
}

export function collectVideoElementsFromDom() {
  const selectors = ["video.VHS_loopedvideo", "video"];
  const elements = collectElements({
    selectors,
    filter: (node) => node instanceof HTMLVideoElement && isElementInGraphNode(node),
  });
  return elements;
}

export function collectDomMediaElements() {
  const selectors = ["video", "canvas", "img"];
  const elements = collectElements({
    selectors,
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

export function getDomElementGraphRect(el, uiCanvas) {
  const canvasEl = uiCanvas?.canvas;
  const ds = uiCanvas?.ds;
  if (!canvasEl || !ds) return null;

  const rect = canvasEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;

  const scaleX = canvasEl.width / rect.width;
  const scaleY = canvasEl.height / rect.height;

  const sx = (r.left - rect.left) * scaleX;
  const sy = (r.top - rect.top) * scaleY;
  const sw = r.width * scaleX;
  const sh = r.height * scaleY;

  const p0 = canvasPointToGraph(uiCanvas, sx, sy);
  const p1 = canvasPointToGraph(uiCanvas, sx + sw, sy + sh);
  return {
    x: p0[0],
    y: p0[1],
    w: p1[0] - p0[0],
    h: p1[1] - p0[1],
  };
}
