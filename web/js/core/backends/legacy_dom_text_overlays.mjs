import {
  collectDomWidgetContainers,
  collectTextElementsFromDom,
  diagnoseDomElement,
  getDomElementGraphRect,
  getNodeIdFromElement,
  resolveNodeIdForGraphRect,
} from "../overlays/dom_utils.mjs";
import {
  normalizeSelectedNodeIds,
  shouldRenderResolvedNode,
} from "./legacy_overlay_utils.mjs";
import { drawMediaSafely } from "./safe_media_draw.mjs";
import {
  captureElementAsCanvas,
  drawTextBlockToRect,
  formatCanvasFont,
  getEffectiveBackground,
  isCanvasBlank,
  isEffectivelyVisibleElement,
  parsePx,
  resolveOpaqueBackground,
  wrapText,
} from "./legacy_text_helpers.mjs";
import { drawWidgetTextFallback } from "./legacy_widget_text_fallback.mjs";

export { drawWidgetTextFallback } from "./legacy_widget_text_fallback.mjs";

function findRenderedMarkdownElement(widget) {
  if (!(widget instanceof HTMLElement)) return null;
  const rendered =
    widget.matches?.(".comfy-markdown-content, .tiptap, .markdown-rendered, .markdown-preview")
      ? widget
      : widget.querySelector?.(".comfy-markdown-content, .tiptap, .markdown-rendered, .markdown-preview");
  return rendered instanceof HTMLElement ? rendered : null;
}

function isDomWidgetMarkdownElement(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.classList?.contains("comfy-markdown-content")) return true;
  if (el.classList?.contains("tiptap")) return true;
  if (el.closest?.(".widget-markdown")) return true;
  return false;
}

function resolveDirectWidgetMedia(widget, uiCanvas) {
  if (!(widget instanceof HTMLElement)) return null;
  const candidates = Array.from(widget.querySelectorAll("canvas, img, video"));
  if (!candidates.length) return null;

  let best = null;
  let bestArea = 0;

  for (const el of candidates) {
    if (
      !(el instanceof HTMLCanvasElement) &&
      !(el instanceof HTMLImageElement) &&
      !(el instanceof HTMLVideoElement)
    ) {
      continue;
    }
    if (!isEffectivelyVisibleElement(el)) continue;
    if (el instanceof HTMLVideoElement && (el.readyState || 0) < 1) continue;

    const rect = getDomElementGraphRect(el, uiCanvas);
    if (!rect || rect.w <= 0 || rect.h <= 0) continue;

    const area = rect.w * rect.h;
    if (area > bestArea) {
      best = { element: el, rect };
      bestArea = area;
    }
  }

  if (!best) return null;

  const widgetRect = getDomElementGraphRect(widget, uiCanvas);
  if (!widgetRect || widgetRect.w <= 0 || widgetRect.h <= 0) return best;

  const widgetArea = widgetRect.w * widgetRect.h;
  if (widgetArea <= 0) return best;

  // Ignore tiny decorative media; only treat it as a widget preview if it
  // occupies a meaningful portion of the widget.
  if (bestArea / widgetArea < 0.2) return null;
  return best;
}

export async function drawDomWidgetOverlays({
  exportCtx,
  uiCanvas,
  bounds,
  scale,
  nodeRects,
  debugLog,
  skipWidgetCapture = false,
  selectedNodeIds = null,
  renderFilter = "all",
}) {
  const skipAllWidgetCapture = skipWidgetCapture === true;
  const skipMediaWidgetCapture = skipWidgetCapture === "media-only";
  const selectedIdSet = normalizeSelectedNodeIds(selectedNodeIds);
  const coveredNodeIds = new Set();
  const widgets = collectDomWidgetContainers(uiCanvas, { debugLog });
  if (!widgets.length) return coveredNodeIds;

  debugLog?.("dom.widget.overlay.count", { count: widgets.length });

  for (const widget of widgets) {
    const rect = getDomElementGraphRect(widget, uiCanvas, {
      debugLog,
      stage: "transform",
      kind: "widget",
    });
    if (!rect || rect.w <= 0 || rect.h <= 0) continue;

    const multilineEl = widget.querySelector?.("textarea.comfy-multiline-input");
    if (multilineEl instanceof HTMLTextAreaElement) {
      debugLog?.("diag.draw.widget", diagnoseDomElement(multilineEl, uiCanvas, {
        stage: "draw",
        reason: "handled-by-text-overlay",
        kind: "widget-multiline",
      }));
      continue;
    }

    const x = (rect.x - bounds.left) * scale;
    const y = (rect.y - bounds.top) * scale;
    const w = rect.w * scale;
    const h = rect.h * scale;

    if (w < 1 || h < 1) continue;
    if (w > bounds.width * scale * 1.1 || h > bounds.height * scale * 1.1) continue;

    const nodeId = resolveNodeIdForGraphRect(
      nodeRects,
      rect,
      getNodeIdFromElement(widget)
    );
    if (!shouldRenderResolvedNode(nodeId, selectedIdSet, renderFilter)) {
      continue;
    }
    const renderedMarkdown = findRenderedMarkdownElement(widget);
    if (renderedMarkdown) {
      const renderedRect = getDomElementGraphRect(renderedMarkdown, uiCanvas, {
        debugLog,
        stage: "transform",
        kind: "widget-markdown",
      }) || rect;
      const renderedClientRect = renderedMarkdown.getBoundingClientRect();
      const rx = (renderedRect.x - bounds.left) * scale;
      const ry = (renderedRect.y - bounds.top) * scale;
      const rw = renderedRect.w * scale;
      const rh = renderedRect.h * scale;
      const captureWidth = Math.max(1, renderedClientRect.width || renderedRect.w || 1);
      const captureHeight = Math.max(1, renderedClientRect.height || renderedRect.h || 1);
      const captured = skipAllWidgetCapture
        ? { canvas: null, stage: "skipped", error: "widget capture skipped" }
        : await captureElementAsCanvas(renderedMarkdown, captureWidth, captureHeight, {
          stripLayoutProps: true,
        });
      let drawn = false;
      let reason = "rendered-capture-failed";
      const style = window.getComputedStyle(renderedMarkdown);
      const text = renderedMarkdown.innerText || renderedMarkdown.textContent || "";
      const fallbackBackground = resolveOpaqueBackground(renderedMarkdown, widget);
      const captureBlank = captured?.canvas ? isCanvasBlank(captured.canvas) : false;

      if (captured?.canvas && !captureBlank) {
        const result = drawMediaSafely(exportCtx, captured.canvas, rx, ry, rw, rh, {
          placeholderLabel: "widget blocked",
        });
        drawn = result.ok;
        reason = result.ok ? "rendered-capture-drawn" : `rendered-capture-${result.reason}`;
      } else {
        // Browser-only, dependency-free markdown export is content-first.
        // If foreignObject capture fails, prefer stable rendered text with an
        // opaque background over raw markdown or double-drawing artifacts.
        drawn = drawTextBlockToRect(
          exportCtx,
          text,
          { x: rx, y: ry, w: rw, h: rh },
          {
            fontSize: parsePx(style.fontSize, 12),
            lineHeight: parsePx(style.lineHeight, parsePx(style.fontSize, 12) * 1.35),
            paddingLeft: parsePx(style.paddingLeft, 0),
            paddingTop: parsePx(style.paddingTop, 0),
            paddingRight: parsePx(style.paddingRight, 0),
            paddingBottom: parsePx(style.paddingBottom, 0),
            background: fallbackBackground,
            color: style.color || "#ffffff",
            font: formatCanvasFont(style, 12),
          }
        );
        reason = drawn
          ? captureBlank
            ? "rendered-capture-blank-text-fallback"
            : "rendered-text-drawn"
          : "rendered-text-empty";
      }
      if (drawn && Number.isFinite(nodeId)) {
        coveredNodeIds.add(nodeId);
      }
      debugLog?.("diag.draw.widget", diagnoseDomElement(renderedMarkdown, uiCanvas, {
        stage: "draw",
        reason,
        captureStage: captured?.stage || null,
        captureError: captured?.error || null,
        captureBlank,
        captureSize: { width: captureWidth, height: captureHeight },
        exportRect: { x: rx, y: ry, w: rw, h: rh },
        resolvedNodeId: nodeId,
        effectiveBackground: fallbackBackground,
        textPreview: text.slice(0, 120),
        kind: "widget-markdown",
      }));
      continue;
    }

    // Attempt foreignObject SVG capture.
    const directMedia =
      skipAllWidgetCapture || skipMediaWidgetCapture
        ? resolveDirectWidgetMedia(widget, uiCanvas)
        : null;
    const shouldSkipCaptureForWidget =
      skipAllWidgetCapture || (skipMediaWidgetCapture && Boolean(directMedia?.element));
    const captured = shouldSkipCaptureForWidget
      ? null
      : await captureElementAsCanvas(widget, w, h);
    if (directMedia?.element && directMedia?.rect) {
      const mx = (directMedia.rect.x - bounds.left) * scale;
      const my = (directMedia.rect.y - bounds.top) * scale;
      const mw = directMedia.rect.w * scale;
      const mh = directMedia.rect.h * scale;
      const result = drawMediaSafely(exportCtx, directMedia.element, mx, my, mw, mh);
      debugLog?.("diag.draw.widget", diagnoseDomElement(directMedia.element, uiCanvas, {
        stage: "draw",
        reason: result.ok ? "direct-media-drawn" : `direct-media-${result.reason}`,
        exportRect: { x: mx, y: my, w: mw, h: mh },
        resolvedNodeId: nodeId,
        kind: "widget-media",
      }));
      if (result.ok && Number.isFinite(nodeId)) coveredNodeIds.add(nodeId);
    } else if (captured?.canvas) {
      const result = drawMediaSafely(exportCtx, captured.canvas, x, y, w, h, {
        placeholderLabel: "widget blocked",
      });
      debugLog?.("diag.draw.widget", diagnoseDomElement(widget, uiCanvas, {
        stage: "draw",
        reason: result.ok ? "capture-drawn" : `capture-${result.reason}`,
        captureStage: captured.stage,
        exportRect: { x, y, w, h },
        resolvedNodeId: nodeId,
        kind: "widget",
      }));
      if (result.ok && Number.isFinite(nodeId)) coveredNodeIds.add(nodeId);
    } else {
      debugLog?.("diag.draw.widget", diagnoseDomElement(widget, uiCanvas, {
        stage: "draw",
        reason: shouldSkipCaptureForWidget ? "capture-skipped-no-fallback" : "capture-failed",
        captureStage: captured?.stage || (shouldSkipCaptureForWidget ? "skipped" : null),
        captureError: captured?.error || (shouldSkipCaptureForWidget ? "widget capture skipped" : null),
        exportRect: { x, y, w, h },
        resolvedNodeId: nodeId,
        kind: "widget",
      }));
    }
  }
  return coveredNodeIds;
}

export function drawTextOverlays({
  exportCtx,
  uiCanvas,
  graph,
  bounds,
  scale,
  nodeRects,
  debugLog,
  skipNodeIds = null,
  selectedNodeIds = null,
  renderFilter = "all",
}) {
  const selectedIdSet = normalizeSelectedNodeIds(selectedNodeIds);
  const elements = collectTextElementsFromDom(uiCanvas, { debugLog });
  const isRenderedMarkdown = (el) =>
    el.classList?.contains("tiptap") ||
    el.classList?.contains("markdown") ||
    el.classList?.contains("markdown-body") ||
    el.classList?.contains("markdown-preview") ||
    el.classList?.contains("markdown-rendered") ||
    // Modern ComfyUI frontend WidgetMarkdown component class:
    el.classList?.contains("comfy-markdown-content");
  const isEditorMarkdown = (el) =>
    el.classList?.contains("ProseMirror") ||
    el.classList?.contains("cm-content") ||
    el.classList?.contains("cm-line") ||
    el.classList?.contains("markdown-editor") ||
    el.getAttribute?.("contenteditable") === "true" ||
    el instanceof HTMLTextAreaElement;
  const isSingleLineInput = (el) =>
    el instanceof HTMLInputElement && el.type !== "hidden";

  const elementsByGroup = new Map();
  const noNode = [];
  for (const el of elements) {
    const nodeId = getNodeIdFromElement(el);
    const domWidget = el.closest?.(".dom-widget");
    if (!Number.isFinite(nodeId) && !domWidget) {
      noNode.push(el);
      continue;
    }
    const key = Number.isFinite(nodeId) ? nodeId : domWidget;
    const list = elementsByGroup.get(key) || [];
    list.push(el);
    elementsByGroup.set(key, list);
  }

  const filtered = [];
  let groupIndex = 0;
  for (const [groupKey, list] of elementsByGroup.entries()) {
    const hasRendered = list.some(isRenderedMarkdown);
    const hasEditor = list.some(isEditorMarkdown);
    if (hasRendered) {
      list.forEach((el) => {
        if (isRenderedMarkdown(el)) {
          filtered.push(el);
        }
      });
    } else if (hasEditor) {
      list.forEach((el) => {
        if (isEditorMarkdown(el)) {
          filtered.push(el);
        }
      });
    } else {
      filtered.push(...list);
    }
    if (debugLog && groupIndex < 5) {
      debugLog("dom.text.group", {
        key: typeof groupKey === "number" ? `node:${groupKey}` : "dom-widget",
        count: list.length,
        hasRendered,
        hasEditor,
      });
    }
    groupIndex += 1;
  }
  filtered.push(...noNode);

  debugLog?.("dom.text.count", { count: filtered.length });
  debugLog?.("dom.widget.count", {
    count: document.querySelectorAll(".dom-widget").length,
  });
  let visibleCount = 0;
  let skippedNoRect = 0;
  let skippedEmpty = 0;
  const coveredNodeIds = new Set();
  const resolveNodeId = (rect, fallbackId) =>
    resolveNodeIdForGraphRect(nodeRects, rect, fallbackId);
  const findNodeRectById = (id) => {
    if (!Number.isFinite(id) || !nodeRects?.length) return null;
    return nodeRects.find((rect) => rect.id === id) || null;
  };
  const intersectRect = (a, b) => {
    if (!a || !b) return null;
    const x1 = Math.max(a.x, b.left);
    const y1 = Math.max(a.y, b.top);
    const x2 = Math.min(a.x + a.w, b.right);
    const y2 = Math.min(a.y + a.h, b.bottom);
    const w = x2 - x1;
    const h = y2 - y1;
    if (w <= 1 || h <= 1) return null;
    return { x: x1, y: y1, w, h };
  };

  let loggedSkips = 0;
  const pickKey = (rect, nodeId) => {
    const round = (v) => Math.round(v * 10) / 10;
    const id = Number.isFinite(nodeId) ? nodeId : "none";
    return `${id}:${round(rect.x)}:${round(rect.y)}:${round(rect.w)}:${round(rect.h)}`;
  };

  const scoreElement = (el) => {
    if (isRenderedMarkdown(el)) return 3;
    if (isEditorMarkdown(el)) return 1;
    return 2;
  };

  const picks = new Map();
  const skippedSet = skipNodeIds instanceof Set
    ? skipNodeIds
    : new Set(
      Array.isArray(skipNodeIds)
        ? skipNodeIds.map((id) => Number(id)).filter(Number.isFinite)
        : []
    );
  for (const skippedId of skippedSet) {
    coveredNodeIds.add(skippedId);
  }

  for (const el of filtered) {
    if (isSingleLineInput(el)) {
      continue;
    }
    if (!isEffectivelyVisibleElement(el)) {
      continue;
    }
    if (isDomWidgetMarkdownElement(el)) {
      continue;
    }
    const nodeId = getNodeIdFromElement(el);
    const rect = getDomElementGraphRect(el, uiCanvas, {
      debugLog,
      stage: "transform",
      kind: "text",
    });
    if (!rect) {
      skippedNoRect += 1;
      if (debugLog && loggedSkips < 5) {
        const r = el.getBoundingClientRect?.();
        const canvasRect = uiCanvas?.canvas?.getBoundingClientRect?.();
        debugLog("dom.text.skip", {
          tag: el.tagName,
          className: el.className,
          nodeId,
          rect: r
            ? { left: r.left, top: r.top, width: r.width, height: r.height }
            : null,
          canvasRect: canvasRect
            ? {
              left: canvasRect.left,
              top: canvasRect.top,
              width: canvasRect.width,
              height: canvasRect.height,
            }
            : null,
        });
        loggedSkips += 1;
      }
      continue;
    }
    const resolvedId = resolveNodeId(rect, nodeId);
    if (!shouldRenderResolvedNode(resolvedId, selectedIdSet, renderFilter)) {
      continue;
    }
    if (Number.isFinite(resolvedId) && skippedSet.has(resolvedId)) {
      continue;
    }
    if (Number.isFinite(resolvedId)) {
      coveredNodeIds.add(resolvedId);
    }

    const nodeRect = Number.isFinite(resolvedId)
      ? findNodeRectById(resolvedId)
      : null;
    const clippedRect = nodeRect ? intersectRect(rect, nodeRect) : rect;
    if (!clippedRect) {
      skippedNoRect += 1;
      continue;
    }

    if (clippedRect.w > bounds.width * 1.05 || clippedRect.h > bounds.height * 1.05) {
      skippedNoRect += 1;
      continue;
    }
    const key = pickKey(clippedRect, resolvedId ?? nodeId);
    const score = scoreElement(el);
    const existing = picks.get(key);
    if (!existing || score > existing.score) {
      picks.set(key, { el, rect: clippedRect, score });
    }
  }

  for (const { el, rect } of picks.values()) {
    const x = (rect.x - bounds.left) * scale;
    const y = (rect.y - bounds.top) * scale;
    const w = rect.w * scale;
    const h = rect.h * scale;

    const style = window.getComputedStyle(el);
    const fontSize = parsePx(style.fontSize, 12);
    const lineHeight = parsePx(style.lineHeight, fontSize * 1.2);
    const paddingLeft = parsePx(style.paddingLeft, 0);
    const paddingTop = parsePx(style.paddingTop, 0);
    const paddingRight = parsePx(style.paddingRight, 0);
    const paddingBottom = parsePx(style.paddingBottom, 0);
    // Walk up the DOM to find the effective (non-transparent) background.
    // Textarea/input elements inside comfy-multiline-input report transparent.
    const bg = getEffectiveBackground(el);
    const color = style.color || "#ffffff";

    const text =
      el instanceof HTMLTextAreaElement
        ? el.value
        : el.innerText || el.textContent || "";

    if (!text.trim()) {
      skippedEmpty += 1;
      continue;
    }
    visibleCount += 1;

    exportCtx.save();
    exportCtx.textBaseline = "top";
    exportCtx.font = `${style.fontStyle || ""} ${style.fontVariant || ""} ${style.fontWeight || ""} ${fontSize}px ${style.fontFamily || "sans-serif"}`.trim();

    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
      exportCtx.fillStyle = bg;
      exportCtx.fillRect(x, y, w, h);
    }

    exportCtx.beginPath();
    exportCtx.rect(x, y, w, h);
    exportCtx.clip();

    exportCtx.fillStyle = color;
    const innerX = x + paddingLeft;
    const innerY = y + paddingTop;
    const innerW = Math.max(1, w - paddingLeft - paddingRight);
    const innerH = Math.max(1, h - paddingTop - paddingBottom);
    const maxLines = Math.max(1, Math.floor(innerH / lineHeight));
    wrapText(exportCtx, text, innerX, innerY, innerW, lineHeight, maxLines);
    exportCtx.restore();

    debugLog?.("diag.draw.text", diagnoseDomElement(el, uiCanvas, {
      stage: "draw",
      reason: "drawn",
      exportRect: { x, y, w, h },
      effectiveBackground: bg,
      drawColor: color,
      textPreview: text.slice(0, 120),
      kind: "text",
    }));
  }

  if (visibleCount === 0) {
    debugLog?.("dom.text.fallback", { reason: "no-visible-dom-text" });
  }
  const widgetStats = drawWidgetTextFallback({
    exportCtx,
    graph,
    bounds,
    scale,
    coveredNodeIds,
    debugLog,
  });

  debugLog?.("dom.text.summary", {
    visible: visibleCount,
    skippedNoRect,
    skippedEmpty,
    coveredNodes: coveredNodeIds.size,
    widgetDrawn: widgetStats?.drawn ?? 0,
    widgetSkippedCovered: widgetStats?.skippedCovered ?? 0,
    widgetSkippedEmpty: widgetStats?.skippedEmpty ?? 0,
  });
}
