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

function normalizeWidgetType(value) {
  const type = String(value || "").toLowerCase();
  const subtypeAt = type.indexOf(":");
  return subtypeAt < 0 ? type : type.slice(0, subtypeAt);
}

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

function getMediaIntrinsicArea(element) {
  const width = Number(
    element?.videoWidth || element?.naturalWidth || element?.width
  );
  const height = Number(
    element?.videoHeight || element?.naturalHeight || element?.height
  );
  return width > 0 && height > 0 ? width * height : 0;
}

function findActiveMediaElement(root) {
  if (!root) return null;
  const candidates = [];
  if (
    isInstance(root, "HTMLCanvasElement") ||
    isInstance(root, "HTMLImageElement") ||
    isInstance(root, "HTMLVideoElement")
  ) {
    candidates.push(root);
  }
  if (typeof root.querySelectorAll === "function") {
    candidates.push(...root.querySelectorAll(MEDIA_SELECTORS));
  } else {
    const first = findElement(root, MEDIA_SELECTORS);
    if (first) candidates.push(first);
  }
  const unique = [...new Set(candidates)];
  return unique.find((element) => element?.hidden !== true && getMediaIntrinsicArea(element) > 0)
    || unique.find((element) => element?.hidden !== true)
    || unique.find((element) => getMediaIntrinsicArea(element) > 0)
    || unique[0]
    || null;
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
  const typeFamily = normalizeWidgetType(type);
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

  const mediaElement = findActiveMediaElement(ownedElement);
  if (
    MEDIA_TYPES.has(typeFamily) ||
    mediaElement
  ) {
    return {
      kind: "media",
      renderElement: mediaElement || ownedElement,
      mediaDelegationEligible: Boolean(mediaElement),
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
        ...(source === "media" ? {
          widgetName: String(widget?.name || widget?.options?.name || ""),
          widgetType: String(widget?.type || ""),
        } : {}),
        graphRect,
        nodeGraphRect,
        source,
        styleSource,
        mediaDelegationEligible:
          source === "media" && classification.mediaDelegationEligible === true,
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
    let graphRect = widget ? getWidgetGraphRect(node, widget) : null;
    const nodeGraphRect = getNodeGraphRect(node);
    if (
      !graphRect &&
      nodeGraphRect &&
      entry?.geometrySource === "live-node-relative" &&
      entry?.relativeGraphRect
    ) {
      const relative = entry.relativeGraphRect;
      const values = [relative.x, relative.y, relative.w, relative.h].map(Number);
      if (values.every(Number.isFinite) && values[2] > 0 && values[3] > 0) {
        graphRect = {
          x: nodeGraphRect.x + values[0],
          y: nodeGraphRect.y + values[1],
          w: values[2],
          h: values[3],
        };
      }
    }
    if (!graphRect || !nodeGraphRect) continue;
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

export function buildOffscreenWidgetRenderPlan({
  liveGraph,
  exportGraph,
  includeDomOverlays = true,
  selectedNodeIds = null,
  renderFilter = "all",
  debugLog = null,
} = {}) {
  const rawLivePlan = buildWidgetRenderPlan({
    graph: liveGraph,
    allowDom: true,
    options: { selectedNodeIds, renderFilter },
  });
  const clonePlan = buildWidgetRenderPlan({
    graph: exportGraph,
    allowDom: false,
    options: { selectedNodeIds, renderFilter },
  });
  const liveNodes = liveGraph?._nodes || liveGraph?.nodes || [];
  const liveNodesById = new Map();
  for (const node of liveNodes) {
    const nodeId = toNodeIdKey(node?.id);
    if (nodeId !== null) liveNodesById.set(nodeId, node);
  }
  const exportNodes = exportGraph?._nodes || exportGraph?.nodes || [];
  const exportNodesById = new Map();
  for (const node of exportNodes) {
    const nodeId = toNodeIdKey(node?.id);
    if (nodeId !== null) exportNodesById.set(nodeId, node);
  }
  const mediaIdentity = (name, type) => {
    const normalizedName = String(name || "");
    const normalizedType = normalizeWidgetType(type);
    return normalizedName ? `name:${normalizedName}|type:${normalizedType}` : `type:${normalizedType}`;
  };
  const matchesCloneWidget = (entry, widget) => {
    if (!widget) return false;
    const liveName = String(entry.widgetName || "");
    const cloneName = String(widget?.name || widget?.options?.name || "");
    if (liveName || cloneName) {
      if (!(liveName && cloneName && liveName === cloneName)) return false;
      const liveType = normalizeWidgetType(entry.widgetType);
      const cloneType = normalizeWidgetType(widget?.type);
      return !liveType || !cloneType || liveType === cloneType;
    }
    const liveType = normalizeWidgetType(entry.widgetType);
    const cloneType = normalizeWidgetType(widget?.type);
    return Boolean(liveType && cloneType && liveType === cloneType);
  };
  const concreteLiveMediaByNode = new Map();
  for (const entry of rawLivePlan) {
    if (
      entry.source !== "media" ||
      entry.mediaDelegationEligible !== true ||
      !entry.element
    ) {
      continue;
    }
    const nodeId = toNodeIdKey(entry.nodeId);
    if (nodeId === null) continue;
    const entries = concreteLiveMediaByNode.get(nodeId) || [];
    entries.push(entry);
    concreteLiveMediaByNode.set(nodeId, entries);
  }
  const cloneMediaByNode = new Map();
  for (const entry of clonePlan) {
    if (entry.source !== "media") continue;
    const nodeId = toNodeIdKey(entry.nodeId);
    if (nodeId === null) continue;
    const entries = cloneMediaByNode.get(nodeId) || [];
    entries.push(entry);
    cloneMediaByNode.set(nodeId, entries);
  }
  const transientMediaNodeIds = new Set();
  for (const [nodeId, entries] of concreteLiveMediaByNode) {
    const liveNode = liveNodesById.get(nodeId);
    const exportNode = exportNodesById.get(nodeId);
    const liveWidgets = Array.isArray(liveNode?.widgets) ? liveNode.widgets : [];
    const exportWidgets = Array.isArray(exportNode?.widgets) ? exportNode.widgets : [];
    const liveIdentities = entries.map((entry) => mediaIdentity(entry.widgetName, entry.widgetType));
    const cloneEntries = cloneMediaByNode.get(nodeId) || [];
    const cloneIdentities = cloneEntries.map((entry) => mediaIdentity(entry.widgetName, entry.widgetType));
    const hasDuplicateIdentity = (identities) => new Set(identities).size !== identities.length;
    const indexMismatch = entries.some((entry) =>
      !Number.isInteger(entry.widgetIndex) ||
      !matchesCloneWidget(entry, exportWidgets[entry.widgetIndex])
    );
    if (
      liveWidgets.length !== exportWidgets.length ||
      indexMismatch ||
      hasDuplicateIdentity(liveIdentities) ||
      hasDuplicateIdentity(cloneIdentities)
    ) {
      transientMediaNodeIds.add(nodeId);
    }
  }
  const suppressedCloneMediaByNode = new Map();
  const cloneMediaMatchByLiveWidget = new Map();
  for (const nodeId of transientMediaNodeIds) {
    const liveEntries = concreteLiveMediaByNode.get(nodeId) || [];
    const unmatchedCloneEntries = [...(cloneMediaByNode.get(nodeId) || [])];
    const matches = new Map();
    const claimMatch = (liveEntry, predicate) => {
      const identity = mediaIdentity(liveEntry.widgetName, liveEntry.widgetType);
      const cloneIndex = unmatchedCloneEntries.findIndex((cloneEntry) =>
        mediaIdentity(cloneEntry.widgetName, cloneEntry.widgetType) === identity &&
        predicate(cloneEntry)
      );
      if (cloneIndex < 0) return false;
      const [cloneEntry] = unmatchedCloneEntries.splice(cloneIndex, 1);
      matches.set(liveEntry.widgetIndex, cloneEntry.widgetIndex);
      return true;
    };
    const unmatchedLiveEntries = liveEntries.filter((liveEntry) =>
      !claimMatch(liveEntry, (cloneEntry) => cloneEntry.widgetIndex === liveEntry.widgetIndex)
    );
    for (const liveEntry of unmatchedLiveEntries) {
      claimMatch(liveEntry, () => true);
    }
    cloneMediaMatchByLiveWidget.set(nodeId, matches);
    suppressedCloneMediaByNode.set(
      nodeId,
      new Set([...matches.values()].filter(Number.isInteger))
    );
  }
  const livePlan = rawLivePlan.map((entry) => {
    if (
      entry.source !== "media" ||
      !entry.element ||
      !entry.graphRect ||
      !entry.nodeGraphRect
    ) {
      return entry;
    }
    // Some extensions add transient DOM widgets only through the live app's
    // extension-level nodeCreated hook. LGraph.configure() does not recreate
    // those widgets in the export clone, so retain their node-relative media
    // geometry without relaxing identity for ordinary serialized widgets.
    const relativeEntry = {
      ...entry,
      geometrySource: "live-node-relative",
      relativeGraphRect: {
        x: entry.graphRect.x - entry.nodeGraphRect.x,
        y: entry.graphRect.y - entry.nodeGraphRect.y,
        w: entry.graphRect.w,
        h: entry.graphRect.h,
      },
    };
    const nodeId = toNodeIdKey(entry.nodeId);
    if (
      entry.mediaDelegationEligible === true &&
      nodeId !== null &&
      transientMediaNodeIds.has(nodeId)
    ) {
      return {
        ...relativeEntry,
        key: `${nodeId}:live-media:${entry.widgetIndex}`,
        liveWidgetIndex: entry.widgetIndex,
        widgetIndex: null,
        suppressedCloneWidgetIndexes: [
          cloneMediaMatchByLiveWidget.get(nodeId)?.get(entry.widgetIndex),
        ].filter(Number.isInteger),
      };
    }
    const exportNode = nodeId === null ? null : exportNodesById.get(nodeId);
    const exportWidgets = Array.isArray(exportNode?.widgets) ? exportNode.widgets : [];
    const cloneWidget = Number.isInteger(entry.widgetIndex)
      ? exportWidgets[entry.widgetIndex]
      : null;
    if (matchesCloneWidget(entry, cloneWidget)) return relativeEntry;

    // A live-only widget must not reuse its shifted index in the clone. Give it
    // a separate ownership key and remove clone-widget suppression authority.
    return {
      ...relativeEntry,
      key: `${nodeId}:live-media:${entry.widgetIndex}`,
      liveWidgetIndex: entry.widgetIndex,
      widgetIndex: null,
    };
  });
  if (includeDomOverlays !== false) {
    return joinWidgetRenderPlanToGraph(livePlan, exportGraph, debugLog);
  }

  // Keep deterministic clone-side text fallback, then replace/add only media
  // entries whose live widget owns a concrete canvas/img/video. This retains
  // static and runtime-generated media widgets without enabling foreignObject
  // DOM capture or making live DOM availability a prerequisite for text export.
  const byKey = new Map(
    clonePlan
      .filter((entry) => {
        const nodeId = toNodeIdKey(entry.nodeId);
        return entry.source !== "media" ||
          nodeId === null ||
          !suppressedCloneMediaByNode.get(nodeId)?.has(entry.widgetIndex);
      })
      .map((entry) => [entry.key, entry])
  );
  for (const entry of livePlan) {
    if (
      entry.source === "media" &&
      entry.mediaDelegationEligible === true &&
      entry.element
    ) {
      byKey.set(entry.key, entry);
    }
  }
  return joinWidgetRenderPlanToGraph(Array.from(byKey.values()), exportGraph, debugLog);
}

export function collectPlannedWidgetIndexes(plan) {
  const byNodeId = new Map();
  const claimedKeys = new Set();
  for (const entry of Array.isArray(plan) ? plan : []) {
    if (!entry?.key || claimedKeys.has(entry.key)) continue;
    const nodeId = toNodeIdKey(entry.nodeId);
    if (nodeId === null) continue;
    const indexes = new Set(
      (Array.isArray(entry.suppressedCloneWidgetIndexes)
        ? entry.suppressedCloneWidgetIndexes
        : []
      ).filter(Number.isInteger)
    );
    const ownsCloneWidget = Number.isInteger(entry.widgetIndex) && (
      entry.source === "capture" ||
      entry.source === "media" ||
      Boolean(String(entry.text || "").trim())
    );
    if (ownsCloneWidget) indexes.add(entry.widgetIndex);
    if (indexes.size) {
      if (!byNodeId.has(nodeId)) byNodeId.set(nodeId, new Set());
      for (const index of indexes) byNodeId.get(nodeId).add(index);
    }
    claimedKeys.add(entry.key);
  }
  return byNodeId;
}

export function collectPlannedMediaElements(plan) {
  const elements = new Set();
  for (const entry of Array.isArray(plan) ? plan : []) {
    if (entry?.source !== "media") continue;
    if (entry.element) elements.add(entry.element);
    const ownedElement = entry.ownedElement;
    if (!ownedElement || typeof ownedElement.querySelectorAll !== "function") continue;
    for (const element of ownedElement.querySelectorAll(MEDIA_SELECTORS)) {
      elements.add(element);
    }
  }
  return elements;
}

export function collectPlannedMediaNodeIds(plan) {
  const nodeIds = new Set();
  for (const entry of Array.isArray(plan) ? plan : []) {
    if (entry?.source !== "media") continue;
    const nodeId = toNodeIdKey(entry.nodeId);
    if (nodeId !== null) nodeIds.add(nodeId);
  }
  return nodeIds;
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
