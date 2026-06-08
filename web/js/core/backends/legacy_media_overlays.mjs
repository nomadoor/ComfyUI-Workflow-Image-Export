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
import { drawMediaSafely } from "./safe_media_draw.mjs";

function findGraphNodeById(graph, id) {
  if (!Number.isFinite(id)) return null;
  const nodes = graph?._nodes || graph?.nodes || [];
  return nodes.find((node) => node && Number.isFinite(node.id) && node.id === id) || null;
}

function findNodeRectById(nodeRects, id) {
  if (!Number.isFinite(id)) return null;
  return (nodeRects || []).find((rect) => rect && Number.isFinite(rect.id) && rect.id === id) || null;
}

function resolveVideoNodeFromElement({ video, uiCanvas, nodeRects, graphRect, graph }) {
  const directId = getNodeIdFromElement(video);
  let nodeRect = findNodeRectById(nodeRects, directId);
  if (!nodeRect && graphRect) {
    const resolvedId = resolveNodeIdForGraphRect(nodeRects, graphRect, directId);
    nodeRect = findNodeRectById(nodeRects, resolvedId);
  }
  if (!nodeRect || !isVideoNodeTitle(nodeRect.title, nodeRect.type)) {
    return null;
  }
  return {
    nodeRect,
    liveNode: findGraphNodeById(graph || uiCanvas?.graph, nodeRect.id),
  };
}

function computeVideoPreviewGraphRect(nodeRect, liveNode = null) {
  if (!nodeRect) return null;
  const nodeW = nodeRect.right - nodeRect.left;
  const nodeH = nodeRect.bottom - nodeRect.top;
  if (nodeW <= 4 || nodeH <= 4) return null;

  const titleHeight = window?.LiteGraph?.NODE_TITLE_HEIGHT || 30;
  const nodeWidgetHeight = window?.LiteGraph?.NODE_WIDGET_HEIGHT || 20;
  const widgets = Array.isArray(liveNode?.widgets) ? liveNode.widgets : [];
  const widgetStartY = Number.isFinite(liveNode?.widgets_start_y)
    ? liveNode.widgets_start_y
    : titleHeight;

  let maxWidgetBottom = widgetStartY;
  for (const widget of widgets) {
    if (!widget) continue;
    const wy = Number.isFinite(widget.y) ? widget.y : maxWidgetBottom;
    const wh = Number.isFinite(widget.height) && widget.height > 0 ? widget.height : nodeWidgetHeight;
    maxWidgetBottom = Math.max(maxWidgetBottom, wy + wh + 4);
  }

  const padX = 1;
  const padY = 2;
  const previewTop = Math.max(titleHeight, maxWidgetBottom);
  const w = nodeW - padX * 2;
  const h = nodeH - previewTop - padY;
  if (w <= 4 || h <= 4) return null;
  return {
    x: nodeRect.left + padX,
    y: nodeRect.top + previewTop,
    w,
    h,
  };
}

function drawVideoIntoGraphRect({ exportCtx, video, graphRect, bounds, scale }) {
  const x = (graphRect.x - bounds.left) * scale;
  const y = (graphRect.y - bounds.top) * scale;
  const w = graphRect.w * scale;
  const h = graphRect.h * scale;

  const sourceW = video.videoWidth || 0;
  const sourceH = video.videoHeight || 0;
  if (sourceW > 0 && sourceH > 0) {
    const fit = Math.min(w / sourceW, h / sourceH);
    const fitW = sourceW * fit;
    const fitH = sourceH * fit;
    const fitX = x + (w - fitW) / 2;
    const fitY = y + (h - fitH) / 2;
    const result = drawMediaSafely(exportCtx, video, fitX, fitY, fitW, fitH);
    return { x: fitX, y: fitY, w: fitW, h: fitH, safeDraw: result };
  }

  const result = drawMediaSafely(exportCtx, video, x, y, w, h);
  return { x, y, w, h, safeDraw: result };
}

export function drawVideoOverlays({
  exportCtx,
  uiCanvas,
  bounds,
  scale,
  nodeRects,
  debugLog,
  graph = null,
  selectedNodeIds = null,
  renderFilter = "all",
}) {
  const drawnNodeIds = new Set();
  const selectedIdSet = normalizeSelectedNodeIds(selectedNodeIds);
  const canvasEl = uiCanvas?.canvas;
  const ds = uiCanvas?.ds;
  if (!canvasEl || !ds) return drawnNodeIds;

  const rect = canvasEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return drawnNodeIds;

  const videos = collectVideoElementsFromDom(uiCanvas, { debugLog });
  if (!videos.length) return drawnNodeIds;

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

    const drawNodeFallback = (reason, graphRect = null) => {
      const resolved = resolveVideoNodeFromElement({ video, uiCanvas, nodeRects, graphRect, graph });
      if (!resolved) {
        debugLog?.("diag.draw.video", diagnoseDomElement(video, uiCanvas, {
          stage: "draw",
          reason: `${reason}:no-node-id-fallback`,
          readyState: video.readyState,
          kind: "video",
        }));
        return false;
      }
      if (!shouldRenderResolvedNode(resolved.nodeRect.id, selectedIdSet, renderFilter)) {
        return true;
      }
      const previewRect = computeVideoPreviewGraphRect(resolved.nodeRect, resolved.liveNode);
      if (!previewRect) return false;
      try {
        const exportRect = drawVideoIntoGraphRect({ exportCtx, video, graphRect: previewRect, bounds, scale });
        debugLog?.("diag.draw.video", diagnoseDomElement(video, uiCanvas, {
          stage: "draw",
          reason: exportRect.safeDraw?.ok ? reason : `${reason}:${exportRect.safeDraw?.reason || "media-blocked"}`,
          readyState: video.readyState,
          graphRect: previewRect,
          exportRect,
          matchedNode: {
            id: resolved.nodeRect.id,
            title: resolved.nodeRect.title,
            type: resolved.nodeRect.type,
          },
          kind: "video",
        }));
        if (exportRect.safeDraw?.ok) {
          drawnNodeIds.add(resolved.nodeRect.id);
        }
        return true;
      } catch (error) {
        debugLog?.("diag.draw.video", diagnoseDomElement(video, uiCanvas, {
          stage: "draw",
          reason: `${reason}:drawImage-error`,
          readyState: video.readyState,
          message: error?.message || String(error),
          kind: "video",
        }));
        return false;
      }
    };

    const vrect = video.getBoundingClientRect();
    if (!vrect.width || !vrect.height) {
      drawNodeFallback("node-fallback-zero-dom-rect");
      continue;
    }

    if (
      vrect.right < rect.left - 1 ||
      vrect.left > rect.right + 1 ||
      vrect.bottom < rect.top - 1 ||
      vrect.top > rect.bottom + 1
    ) {
      drawNodeFallback("node-fallback-off-canvas-viewport");
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
    const graphRect = { x: graphX, y: graphY, w: graphW, h: graphH };

    const matchedNode = findNodeForPoint(nodeRects, graphX + graphW * 0.5, graphY + graphH * 0.5);
    if (!matchedNode || !isVideoNodeTitle(matchedNode.title, matchedNode.type)) {
      if (drawNodeFallback(!matchedNode ? "node-fallback-no-node-at-position" : "node-fallback-non-video-node", graphRect)) {
        continue;
      }
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
      const result = drawMediaSafely(exportCtx, video, x, y, w, h);
      if (result.ok) {
        drawnNodeIds.add(matchedNode.id);
      }
      debugLog?.("diag.draw.video", diagnoseDomElement(video, uiCanvas, {
        stage: "draw",
        reason: result.ok ? "drawn" : result.reason,
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
  return drawnNodeIds;
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
      const result = drawMediaSafely(exportCtx, video, x, y, w, h);
      debugLog?.("diag.draw.vhs", diagnoseDomElement(video, uiCanvas, {
        stage: "draw",
        reason: result.ok ? "drawn" : result.reason,
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
      const result = drawMediaSafely(exportCtx, el, x, y, w, h);
      debugLog?.("dom.image.item", { x, y, w, h, safeDraw: result.reason });
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
