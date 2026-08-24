import {
  normalizeSelectedNodeIds,
  shouldRenderResolvedNode,
} from "./legacy_overlay_utils.mjs";
import {
  formatCanvasFont,
  getEffectiveBackground,
  parsePx,
} from "./legacy_text_helpers.mjs";
import { toNodeIdKey } from "../node_ids.mjs";

const MARKDOWN_SELECTORS = ".comfy-markdown-content, .tiptap";
const TEXT_ELEMENT_SELECTORS = "textarea, [contenteditable='true'], .ProseMirror, .cm-content";
const MEDIA_SELECTORS = "canvas, img, video";
const MULTILINE_TYPES = new Set(["textarea", "customtext", "markdown"]);
const MEDIA_TYPES = new Set(["canvas", "image", "preview", "video"]);

function isInstance(value, ctorName) {
  const ctor = globalThis[ctorName];
  return typeof ctor === "function" && value instanceof ctor;
}

function isElementLike(value) {
  return Boolean(value && typeof value === "object" && typeof value.querySelector === "function");
}

function findElement(root, selectors) {
  if (!root) return null;
  if (typeof root.matches === "function" && root.matches(selectors)) return root;
  return root.querySelector?.(selectors) || null;
}

function getWidgetText(node, widget, widgetIndex) {
  if (typeof widget?.value === "string") return widget.value;
  const values = node?.widgets_values;
  const widgets = Array.isArray(node?.widgets) ? node.widgets : [];
  if (
    Array.isArray(values) &&
    values.length === widgets.length &&
    typeof values[widgetIndex] === "string"
  ) {
    return values[widgetIndex];
  }
  if (values && !Array.isArray(values) && typeof values === "object") {
    const name = widget?.name || widget?.options?.name;
    if (name && typeof values[name] === "string") return values[name];
  }
  return "";
}

function isFiniteCoordinatePair(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    Number.isFinite(Number(value[0])) &&
    Number.isFinite(Number(value[1]))
  );
}

function getWidgetGraphRect(node, widget) {
  const pos = node?.pos || node?._pos;
  const size = node?.size || node?._size;
  if (!isFiniteCoordinatePair(pos)) return null;

  const nodeWidth = Number(widget?.width ?? node?.width ?? size?.[0]);
  const margin = Number.isFinite(Number(widget?.margin)) ? Number(widget.margin) : 10;
  const widgetY = Number.isFinite(Number(widget?.y))
    ? Number(widget.y)
    : Number.isFinite(Number(node?.widgets_start_y))
      ? Number(node.widgets_start_y)
      : Number(globalThis.window?.LiteGraph?.NODE_TITLE_HEIGHT) || 30;
  const computedHeight = Number.isFinite(Number(widget?.computedHeight))
    ? Number(widget.computedHeight)
    : Number.isFinite(Number(widget?.height))
      ? Number(widget.height)
      : 50;
  const width = nodeWidth - margin * 2;
  const height = computedHeight - margin * 2;

  if (
    !Number.isFinite(Number(pos[0])) ||
    !Number.isFinite(Number(pos[1])) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return {
    x: Number(pos[0]) + margin,
    y: Number(pos[1]) + margin + widgetY,
    w: width,
    h: height,
  };
}

function getNodeGraphRect(node) {
  const pos = node?.pos || node?._pos;
  const size = node?.size || node?._size;
  if (!isFiniteCoordinatePair(pos) || !isFiniteCoordinatePair(size)) return null;
  const w = Number(size[0]);
  const h = Number(size[1]);
  if (!(w > 0) || !(h > 0)) return null;
  return {
    x: Number(pos[0]),
    y: Number(pos[1]),
    w,
    h,
  };
}

function getDefaultStyle() {
  const liteGraph = globalThis.window?.LiteGraph;
  const fontSize = 11;
  return {
    fontSize,
    lineHeight: fontSize * 1.35,
    paddingLeft: 6,
    paddingTop: 4,
    paddingRight: 6,
    paddingBottom: 4,
    background: liteGraph?.WIDGET_BGCOLOR || null,
    color: liteGraph?.NODE_TEXT_COLOR || "#ffffff",
    font: `${fontSize}px ${liteGraph?.NODE_FONT || "sans-serif"}`,
  };
}

function getDomStyle(element) {
  if (!element || typeof globalThis.window?.getComputedStyle !== "function") {
    return getDefaultStyle();
  }
  try {
    const computed = globalThis.window.getComputedStyle(element);
    const fontSize = parsePx(computed.fontSize, 12);
    return {
      fontSize,
      lineHeight: parsePx(computed.lineHeight, fontSize * 1.2),
      paddingLeft: parsePx(computed.paddingLeft, 0),
      paddingTop: parsePx(computed.paddingTop, 0),
      paddingRight: parsePx(computed.paddingRight, 0),
      paddingBottom: parsePx(computed.paddingBottom, 0),
      background:
        getEffectiveBackground(element) ||
        globalThis.window?.LiteGraph?.WIDGET_BGCOLOR ||
        null,
      color: computed.color || "#ffffff",
      font: formatCanvasFont(computed, fontSize),
    };
  } catch (_) {
    return getDefaultStyle();
  }
}

function classifyWidget(widget, ownedElement) {
  const type = String(widget?.type || "").toLowerCase();
  const markdownElement = findElement(ownedElement, MARKDOWN_SELECTORS);
  if (type === "markdown" || markdownElement) {
    return {
      kind: "markdown",
      renderElement: markdownElement || ownedElement,
    };
  }

  const textElement = findElement(ownedElement, TEXT_ELEMENT_SELECTORS);
  const isTextarea = isInstance(ownedElement, "HTMLTextAreaElement")
    || isInstance(textElement, "HTMLTextAreaElement");
  const isMultiline =
    widget?.options?.multiline === true ||
    MULTILINE_TYPES.has(type) ||
    isTextarea;
  if (isMultiline) {
    return {
      kind: "multiline",
      renderElement: textElement || ownedElement,
    };
  }

  const mediaElement = findElement(ownedElement, MEDIA_SELECTORS);
  if (
    MEDIA_TYPES.has(type) ||
    mediaElement ||
    isInstance(ownedElement, "HTMLCanvasElement") ||
    isInstance(ownedElement, "HTMLImageElement") ||
    isInstance(ownedElement, "HTMLVideoElement")
  ) {
    return {
      kind: "media",
      renderElement: mediaElement || ownedElement,
    };
  }
  return null;
}

export function buildWidgetRenderPlan({
  graph,
  uiCanvas = null,
  allowDom = true,
  options = {},
} = {}) {
  void uiCanvas;
  const nodes = graph?._nodes || graph?.nodes || [];
  const planByKey = new Map();
  const selectedNodeIds = normalizeSelectedNodeIds(options.selectedNodeIds);
  const renderFilter = options.renderFilter || "all";

  for (const node of nodes) {
    if (!node || node.id === undefined || node.id === null) continue;
    if (!shouldRenderResolvedNode(node.id, selectedNodeIds, renderFilter)) continue;
    const widgets = Array.isArray(node.widgets) ? node.widgets : [];
    for (let widgetIndex = 0; widgetIndex < widgets.length; widgetIndex += 1) {
      const widget = widgets[widgetIndex];
      if (!widget) continue;
      if (node.flags?.collapsed === true) continue;
      if (
        widget.hidden === true ||
        widget.type === "hidden" ||
        widget.computedDisabled === true
      ) {
        continue;
      }
      if (
        typeof node.isWidgetVisible === "function" &&
        node.isWidgetVisible(widget) === false
      ) {
        continue;
      }

      // widget.element is authoritative. Never recover ownership from DOM position.
      const ownedElement = allowDom && isElementLike(widget.element) ? widget.element : null;
      const classification = classifyWidget(widget, ownedElement);
      if (!classification) continue;
      const graphRect = getWidgetGraphRect(node, widget);
      const nodeGraphRect = getNodeGraphRect(node);
      if (!graphRect || !nodeGraphRect) continue;

      const key = `${node.id}:${widgetIndex}`;
      const text = getWidgetText(node, widget, widgetIndex);
      let source = classification.kind === "markdown"
        ? "capture"
        : classification.kind === "media"
          ? "media"
          : "text";
      let styleSource = classification.renderElement ? "dom" : "default";
      let renderElement = classification.renderElement;

      if (!allowDom && source !== "media") {
        source = "text";
        styleSource = "default";
        renderElement = null;
      } else if (!allowDom) {
        styleSource = "default";
        renderElement = null;
      } else if (source === "capture" && options.skipWidgetCapture === true) {
        source = "text";
        styleSource = "default";
        renderElement = null;
      }

      planByKey.set(key, {
        key,
        nodeId: node.id,
        widgetIndex,
        graphRect,
        nodeGraphRect,
        source,
        styleSource,
        ownedElement,
        element: renderElement,
        text,
        style: styleSource === "dom" ? getDomStyle(renderElement) : getDefaultStyle(),
      });
    }
  }

  return Array.from(planByKey.values());
}

export function joinWidgetRenderPlanToGraph(plan, graph, debugLog = null) {
  const nodes = graph?._nodes || graph?.nodes || [];
  const nodesById = new Map();
  for (const node of nodes) {
    const nodeId = toNodeIdKey(node?.id);
    if (nodeId === null) continue;
    nodesById.set(nodeId, node);
  }

  const input = Array.isArray(plan) ? plan : [];
  const joined = [];
  for (const entry of input) {
    const entryNodeId = toNodeIdKey(entry?.nodeId);
    const node = entryNodeId === null ? null : nodesById.get(entryNodeId);
    const widgets = Array.isArray(node?.widgets) ? node.widgets : [];
    const widget = Number.isInteger(entry?.widgetIndex)
      ? widgets[entry.widgetIndex]
      : null;
    const graphRect = widget ? getWidgetGraphRect(node, widget) : null;
    const nodeGraphRect = getNodeGraphRect(node);
    if (!widget || !graphRect || !nodeGraphRect) continue;
    joined.push({
      ...entry,
      graphRect,
      nodeGraphRect,
    });
  }
  debugLog?.("widget.plan.join", {
    input: input.length,
    joined: joined.length,
    dropped: input.length - joined.length,
  });
  return joined;
}

export function collectPlannedWidgetIndexes(plan) {
  const byNodeId = new Map();
  const claimedKeys = new Set();
  for (const entry of Array.isArray(plan) ? plan : []) {
    if (
      !entry?.key ||
      claimedKeys.has(entry.key) ||
      !Number.isInteger(entry.widgetIndex)
    ) {
      continue;
    }
    if (
      entry.source !== "capture" &&
      entry.source !== "media" &&
      !String(entry.text || "").trim()
    ) continue;

    const nodeId = toNodeIdKey(entry.nodeId);
    if (nodeId === null) continue;
    if (!byNodeId.has(nodeId)) byNodeId.set(nodeId, new Set());
    byNodeId.get(nodeId).add(entry.widgetIndex);
    claimedKeys.add(entry.key);
  }
  return byNodeId;
}

/**
 * Scope ownership to one offscreen canvas. Planned widgets are removed only
 * during the synchronous drawNodeWidgets call, so live widget objects are never
 * mutated across an animation frame or another await.
 */
export function installPlannedWidgetDrawSuppression(canvas, plan) {
  const byNodeId = collectPlannedWidgetIndexes(plan);
  const baseDrawNodeWidgets = canvas?.drawNodeWidgets;
  if (!canvas || !byNodeId.size || typeof baseDrawNodeWidgets !== "function") {
    return { suppressed: 0, restore() {} };
  }

  const previousDescriptor = Object.getOwnPropertyDescriptor(canvas, "drawNodeWidgets");
  const wrappedDrawNodeWidgets = function (node, ...args) {
    const nodeId = toNodeIdKey(node?.id);
    const indexes = nodeId === null ? null : byNodeId.get(nodeId);
    const widgets = node?.widgets;
    if (!indexes?.size || !Array.isArray(widgets)) {
      return baseDrawNodeWidgets.call(this, node, ...args);
    }

    const filteredWidgets = widgets.filter((_, index) => !indexes.has(index));
    try {
      node.widgets = filteredWidgets;
    } catch (_) {
      return baseDrawNodeWidgets.call(this, node, ...args);
    }
    try {
      return baseDrawNodeWidgets.call(this, node, ...args);
    } finally {
      node.widgets = widgets;
    }
  };

  try {
    Object.defineProperty(canvas, "drawNodeWidgets", {
      configurable: true,
      enumerable: previousDescriptor?.enumerable ?? false,
      writable: true,
      value: wrappedDrawNodeWidgets,
    });
  } catch (_) {
    return { suppressed: 0, restore() {} };
  }

  let suppressed = 0;
  for (const indexes of byNodeId.values()) suppressed += indexes.size;
  let restored = false;
  return {
    suppressed,
    restore() {
      if (restored) return;
      restored = true;
      try {
        if (previousDescriptor) {
          Object.defineProperty(canvas, "drawNodeWidgets", previousDescriptor);
        } else {
          delete canvas.drawNodeWidgets;
        }
      } catch (_) {}
    },
  };
}
