import {
  captureElementAsCanvas,
  drawTextBlockToRect,
  isCanvasBlank,
} from "./legacy_text_helpers.mjs";
import { drawMediaSafely } from "./safe_media_draw.mjs";

function intersectGraphRects(a, b) {
  if (!a || !b) return null;
  const aLeft = Number(a.left ?? a.x);
  const aTop = Number(a.top ?? a.y);
  const aRight = Number(a.right ?? (aLeft + Number(a.width ?? a.w)));
  const aBottom = Number(a.bottom ?? (aTop + Number(a.height ?? a.h)));
  const bLeft = Number(b.left ?? b.x);
  const bTop = Number(b.top ?? b.y);
  const bRight = Number(b.right ?? (bLeft + Number(b.width ?? b.w)));
  const bBottom = Number(b.bottom ?? (bTop + Number(b.height ?? b.h)));
  const left = Math.max(aLeft, bLeft);
  const top = Math.max(aTop, bTop);
  const right = Math.min(aRight, bRight);
  const bottom = Math.min(aBottom, bBottom);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function toExportRect(graphRect, bounds, scale) {
  return {
    x: (graphRect.x - bounds.left) * scale,
    y: (graphRect.y - bounds.top) * scale,
    w: graphRect.w * scale,
    h: graphRect.h * scale,
  };
}

function scaleTextStyle(style, scale) {
  const base = style || {};
  const scaleNumber = (value) => Number.isFinite(value) ? value * scale : value;
  const font = typeof base.font === "string"
    ? base.font.replace(
      /(\d+(?:\.\d+)?)px/,
      (_, size) => `${Number(size) * scale}px`
    )
    : base.font;
  return {
    ...base,
    font,
    fontSize: scaleNumber(base.fontSize),
    lineHeight: scaleNumber(base.lineHeight),
    paddingLeft: scaleNumber(base.paddingLeft),
    paddingTop: scaleNumber(base.paddingTop),
    paddingRight: scaleNumber(base.paddingRight),
    paddingBottom: scaleNumber(base.paddingBottom),
  };
}

function getEntryClipRect(entry, bounds) {
  const nodeClipped = intersectGraphRects(entry?.graphRect, entry?.nodeGraphRect);
  if (!nodeClipped) return null;
  return intersectGraphRects(nodeClipped, bounds);
}

async function withEntryClip(exportCtx, entry, bounds, scale, draw) {
  const clipped = getEntryClipRect(entry, bounds);
  if (!clipped) return false;
  const clipRect = toExportRect(clipped, bounds, scale);
  exportCtx.save();
  exportCtx.beginPath();
  exportCtx.rect(clipRect.x, clipRect.y, clipRect.w, clipRect.h);
  exportCtx.clip();
  try {
    return await draw();
  } finally {
    exportCtx.restore();
  }
}

function paintOwnedBackground(exportCtx, exportRect, style) {
  const background =
    style?.background ||
    globalThis.window?.LiteGraph?.WIDGET_BGCOLOR ||
    "#222222";
  exportCtx.fillStyle = background;
  exportCtx.fillRect(exportRect.x, exportRect.y, exportRect.w, exportRect.h);
}

async function drawCaptureEntry(exportCtx, entry, exportRect) {
  const element = entry.element;
  if (!element) return false;
  const clientRect = element.getBoundingClientRect?.();
  const captureWidth = clientRect?.width || entry.graphRect.w;
  const captureHeight = clientRect?.height || entry.graphRect.h;
  const captured = await captureElementAsCanvas(element, captureWidth, captureHeight, {
    stripLayoutProps: true,
  });
  if (!captured?.canvas || isCanvasBlank(captured.canvas)) return false;
  return drawMediaSafely(
    exportCtx,
    captured.canvas,
    exportRect.x,
    exportRect.y,
    exportRect.w,
    exportRect.h,
    { placeholderLabel: "widget blocked" }
  ).ok;
}

export async function drawPlannedWidgetOverlays({
  exportCtx,
  plan,
  bounds,
  scale,
  options = {},
  debugLog = null,
} = {}) {
  if (!exportCtx || !bounds || !Number.isFinite(scale) || scale <= 0) {
    return { planned: 0, drawn: 0, delegated: 0, skippedDuplicate: 0, skippedOutside: 0 };
  }

  const renderedKeys = new Set();
  let drawn = 0;
  let delegated = 0;
  let skippedDuplicate = 0;
  let skippedOutside = 0;

  // Offscreen tiled rendering rebuilds the plan for each tile. A widget may
  // therefore be drawn once in every tile it intersects; uniqueness is per tile.
  for (const entry of Array.isArray(plan) ? plan : []) {
    if (!entry?.key || renderedKeys.has(entry.key)) {
      skippedDuplicate += 1;
      continue;
    }
    renderedKeys.add(entry.key);

    if (!getEntryClipRect(entry, bounds)) {
      skippedOutside += 1;
      continue;
    }

    if (entry.source === "media") {
      // Existing media overlay paths remain responsible for actual media drawing.
      // ownedElement is a delegation hint only and is never a dedup key.
      delegated += 1;
      continue;
    }

    const exportRect = toExportRect(entry.graphRect, bounds, scale);
    let didDraw = false;
    await withEntryClip(exportCtx, entry, bounds, scale, async () => {
      // Pixel ownership closes paths such as node.onDrawForeground and cached
      // drawImage output that do not pass through widget.draw.
      paintOwnedBackground(exportCtx, exportRect, entry.style);
      if (entry.source === "capture" && options.skipWidgetCapture !== true) {
        didDraw = await drawCaptureEntry(exportCtx, entry, exportRect);
      }
      if (!didDraw) {
        // Textarea values are not serialized by outerHTML, so they are always
        // rendered as Canvas text rather than foreignObject captures.
        didDraw = drawTextBlockToRect(
          exportCtx,
          entry.text,
          exportRect,
          scaleTextStyle(entry.style, scale)
        );
      }
      return didDraw;
    });
    if (didDraw) drawn += 1;
  }

  const stats = {
    planned: renderedKeys.size,
    drawn,
    delegated,
    skippedDuplicate,
    skippedOutside,
  };
  debugLog?.("widget.plan.render", stats);
  return stats;
}
