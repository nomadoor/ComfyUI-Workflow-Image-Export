import {
  collectDomMediaElements,
  collectImageElementsFromDom,
  collectVideoElementsFromDom,
  diagnoseDomElement,
  getDomElementGraphRect,
  getNodeIdFromElement,
  resolveNodeIdForGraphRect,
} from "../overlays/dom_utils.mjs";
import {
  findNodeForPoint,
  isVhsVideoElement,
  isVideoNodeTitle,
  normalizeSelectedNodeIds,
  shouldRenderResolvedNode,
} from "./legacy_overlay_utils.mjs";

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

export function logDomMedia(debugLog, uiCanvas) {
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
