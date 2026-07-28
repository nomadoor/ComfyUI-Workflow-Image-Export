import {
  normalizeSelectedNodeIds,
  shouldRenderResolvedNode,
} from "./legacy_overlay_utils.mjs";
import {
  formatCanvasFont,
  getEffectiveBackground,
  parsePx,
} from "./legacy_text_helpers.mjs";

const MARKDOWN_SELECTORS = ".comfy-markdown-content, .tiptap";
const TEXT_ELEMENT_SELECTORS = "textarea, [contenteditable='true'], .ProseMirror, .cm-content";
const MEDIA_SELECTORS = "canvas, img, video";
const MULTILINE_TYPES = new Set(["textarea", "customtext", "markdown"]);

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
  if (Array.isArray(values) && typeof values[widgetIndex] === "string") {
    return values[widgetIndex];
  }
  if (values && typeof values === "object") {
    const name = widget?.name || widget?.options?.name;
    if (name && typeof values[name] === "string") return values[name];
    const keys = Object.keys(values);
    const indexedKey = keys[widgetIndex];
    if (indexedKey !== undefined && typeof values[indexedKey] === "string") {
      return values[indexedKey];
    }
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
  const margin = Number.isFinite(Number(widget?.margin)) ? Number(widget.margin) : 4;
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
    background: null,
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
      background: getEffectiveBackground(element),
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
    if (!shouldRenderResolvedNode(Number(node.id), selectedNodeIds, renderFilter)) continue;
    const widgets = Array.isArray(node.widgets) ? node.widgets : [];
    for (let widgetIndex = 0; widgetIndex < widgets.length; widgetIndex += 1) {
      const widget = widgets[widgetIndex];
      if (!widget) continue;

      // widget.element is authoritative. Never recover ownership from DOM position.
      const ownedElement = allowDom && isElementLike(widget.element) ? widget.element : null;
      const classification = classifyWidget(widget, ownedElement);
      if (!classification) continue;
      const graphRect = getWidgetGraphRect(node, widget);
      if (!graphRect) continue;

      const key = `${node.id}:${widgetIndex}`;
      const text = getWidgetText(node, widget, widgetIndex);
      let source = classification.kind === "markdown"
        ? "capture"
        : classification.kind === "media"
          ? "media"
          : "text";
      let styleSource = classification.renderElement ? "dom" : "default";
      let renderElement = classification.renderElement;

      if (!allowDom) {
        source = "text";
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

export function joinWidgetRenderPlanToGraph(plan, graph) {
  const nodes = graph?._nodes || graph?.nodes || [];
  const widgetsByNodeId = new Map();
  for (const node of nodes) {
    if (!node || node.id === undefined || node.id === null) continue;
    widgetsByNodeId.set(String(node.id), Array.isArray(node.widgets) ? node.widgets : []);
  }

  return (Array.isArray(plan) ? plan : []).filter((entry) => {
    const widgets = widgetsByNodeId.get(String(entry?.nodeId));
    return Boolean(widgets && Number.isInteger(entry?.widgetIndex) && widgets[entry.widgetIndex]);
  });
}
