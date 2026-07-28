import {
  collectTextElementsFromDom,
  diagnoseDomElement,
  getDomElementGraphRect,
  resolveNodeIdForGraphRect,
} from "../overlays/dom_utils.mjs";
import {
  normalizeSelectedNodeIds,
  shouldRenderResolvedNode,
} from "./legacy_overlay_utils.mjs";
import {
  drawTextBlockToRect,
  formatCanvasFont,
  getEffectiveBackground,
  isEffectivelyVisibleElement,
  parsePx,
} from "./legacy_text_helpers.mjs";

export function isExternalTextOverlayEnabled(options = {}) {
  return options?.allowExternalDomText === true;
}

function intersectWithNodeRect(rect, nodeRect) {
  if (!nodeRect) return rect;
  const left = Math.max(rect.x, nodeRect.left);
  const top = Math.max(rect.y, nodeRect.top);
  const right = Math.min(rect.x + rect.w, nodeRect.right);
  const bottom = Math.min(rect.y + rect.h, nodeRect.bottom);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function buildPickKey(rect, nodeId) {
  const round = (value) => Math.round(value * 10) / 10;
  return [
    Number.isFinite(nodeId) ? nodeId : "none",
    round(rect.x),
    round(rect.y),
    round(rect.w),
    round(rect.h),
  ].join(":");
}

function getElementText(element) {
  if (element instanceof HTMLTextAreaElement) return element.value || "";
  return element.innerText || element.textContent || "";
}

function getScaledTextStyle(element, scale) {
  const computed = window.getComputedStyle(element);
  const fontSize = parsePx(computed.fontSize, 12) * scale;
  const lineHeight = parsePx(
    computed.lineHeight,
    parsePx(computed.fontSize, 12) * 1.2
  ) * scale;
  const font = formatCanvasFont(computed, fontSize).replace(
    /(\d+(?:\.\d+)?)px/,
    `${fontSize}px`
  );
  return {
    fontSize,
    lineHeight,
    paddingLeft: parsePx(computed.paddingLeft, 0) * scale,
    paddingTop: parsePx(computed.paddingTop, 0) * scale,
    paddingRight: parsePx(computed.paddingRight, 0) * scale,
    paddingBottom: parsePx(computed.paddingBottom, 0) * scale,
    background: getEffectiveBackground(element),
    color: computed.color || "#ffffff",
    font,
  };
}

/**
 * Draw text owned by node-external extension DOM.
 *
 * collectTextElementsFromDom() structurally rejects every `.dom-widget` and
 * `[data-node-id]` descendant. Widget text can therefore reach the export only
 * through widget_render_plan.mjs, even when widget.element is unavailable.
 */
export function drawExternalTextOverlays({
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
  const elements = Array.from(new Set(collectTextElementsFromDom(uiCanvas, { debugLog })));
  const picks = new Map();
  let skippedNoRect = 0;
  let skippedEmpty = 0;

  for (const element of elements) {
    if (element instanceof HTMLInputElement && element.type !== "hidden") continue;
    if (!isEffectivelyVisibleElement(element)) continue;

    const text = getElementText(element);
    if (!text.trim()) {
      skippedEmpty += 1;
      continue;
    }

    const rect = getDomElementGraphRect(element, uiCanvas, {
      debugLog,
      stage: "transform",
      kind: "external-text",
    });
    if (!rect) {
      skippedNoRect += 1;
      continue;
    }

    // Position matching is permitted only to preserve selection filtering for
    // node-external extension DOM. It is never used for widget deduplication.
    const resolvedId = resolveNodeIdForGraphRect(nodeRects, rect, null);
    if (!shouldRenderResolvedNode(resolvedId, selectedIdSet, renderFilter)) continue;
    const nodeRect = Number.isFinite(resolvedId)
      ? nodeRects?.find((candidate) => candidate?.id === resolvedId) || null
      : null;
    const clippedRect = intersectWithNodeRect(rect, nodeRect);
    if (!clippedRect) continue;
    if (clippedRect.w > bounds.width * 1.05 || clippedRect.h > bounds.height * 1.05) {
      skippedNoRect += 1;
      continue;
    }

    const key = buildPickKey(clippedRect, resolvedId);
    if (!picks.has(key)) {
      picks.set(key, { element, rect: clippedRect, text });
    }
  }

  let drawn = 0;
  for (const { element, rect, text } of picks.values()) {
    const exportRect = {
      x: (rect.x - bounds.left) * scale,
      y: (rect.y - bounds.top) * scale,
      w: rect.w * scale,
      h: rect.h * scale,
    };
    if (drawTextBlockToRect(
      exportCtx,
      text,
      exportRect,
      getScaledTextStyle(element, scale)
    )) {
      drawn += 1;
      debugLog?.("diag.draw.external-text", diagnoseDomElement(element, uiCanvas, {
        stage: "draw",
        reason: "drawn",
        exportRect,
        textPreview: text.slice(0, 120),
        kind: "external-text",
      }));
    }
  }

  debugLog?.("dom.external-text.summary", {
    candidates: elements.length,
    drawn,
    skippedNoRect,
    skippedEmpty,
  });
}
