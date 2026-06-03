import { collectNodeRects } from "../core/backends/legacy_bounds.mjs";
import {
  collectDomWidgetContainers,
  collectVideoElementsFromDom,
  getDomElementGraphRect,
  getNodeIdFromElement,
  resolveNodeIdForGraphRect,
} from "../core/overlays/dom_utils.mjs";

function buildNodeIdMap(graph) {
  const nodes = graph?._nodes || graph?.nodes || [];
  const byId = new Map();
  for (const node of nodes) {
    if (node && Number.isFinite(node.id)) {
      byId.set(node.id, node);
    }
  }
  return byId;
}

function copyNodeMedia(fromNode, toNode) {
  if (!fromNode || !toNode) return false;
  const mediaKeys = [
    "imgs",
    "img",
    "image",
    "preview",
    "preview_image",
    "previewImage",
    "previewMediaType",
    "canvas",
    "previewCanvas",
    "images",
    "animatedImages",
    "frames",
    "frame",
    "video_path",
    "filepath",
    "file",
    "url",
    "media",
    "media_el",
    "mediaEl",
    "texture",
    "tex",
    "_texture",
    "output_image",
  ];
  let copied = false;
  for (const key of mediaKeys) {
    if (fromNode[key] === undefined || fromNode[key] === null) continue;
    if (
      key === "video" ||
      key === "videos" ||
      key === "videoEl" ||
      key === "videoElement" ||
      key === "media_el" ||
      key === "mediaEl"
    ) {
      continue;
    }
    toNode[key] = fromNode[key];
    copied = true;
  }
  return copied;
}

function syncLiveNodeMedia(exportGraph, liveGraph, debugLog) {
  const exportNodes = exportGraph?._nodes || exportGraph?.nodes || [];
  const liveById = buildNodeIdMap(liveGraph);
  if (!liveById.size || !exportNodes.length) return;

  let copiedCount = 0;
  for (const node of exportNodes) {
    if (!node || !Number.isFinite(node.id)) continue;
    const liveNode = liveById.get(node.id);
    if (!liveNode) continue;
    if (copyNodeMedia(liveNode, node)) {
      copiedCount += 1;
    }
  }
  debugLog?.("media.sync", { copiedCount });
}

function syncLiveNodeText(exportGraph, liveGraph) {
  const exportNodes = exportGraph?._nodes || exportGraph?.nodes || [];
  const liveById = buildNodeIdMap(liveGraph);
  if (!liveById.size || !exportNodes.length) return;

  for (const node of exportNodes) {
    if (!node || !Number.isFinite(node.id)) continue;
    const liveNode = liveById.get(node.id);
    if (!liveNode) continue;

    if (liveNode.widgets_values !== undefined) {
      node.widgets_values = liveNode.widgets_values;
    }
    if (liveNode.properties !== undefined) {
      node.properties = liveNode.properties;
    }
    if (Number.isFinite(liveNode.widgets_start_y)) {
      node.widgets_start_y = liveNode.widgets_start_y;
    }
    if (Array.isArray(node.widgets) && Array.isArray(liveNode.widgets)) {
      const count = Math.min(node.widgets.length, liveNode.widgets.length);
      const widgetsValues = liveNode.widgets_values;
      const widgetsValuesKeys =
        widgetsValues && typeof widgetsValues === "object" && !Array.isArray(widgetsValues)
          ? Object.keys(widgetsValues)
          : null;
      for (let i = 0; i < count; i += 1) {
        const exportWidget = node.widgets[i];
        const liveWidget = liveNode.widgets[i];
        if (!exportWidget || !liveWidget) continue;
        const widgetName =
          exportWidget.name ||
          liveWidget.name ||
          exportWidget?.options?.name ||
          liveWidget?.options?.name;
        let value = liveWidget.value;
        if (value === undefined) {
          if (widgetsValues && typeof widgetsValues === "object" && !Array.isArray(widgetsValues)) {
            if (widgetName && widgetsValues[widgetName] !== undefined) {
              value = widgetsValues[widgetName];
            }
          } else if (Array.isArray(widgetsValues) && widgetsValues[i] !== undefined) {
            value = widgetsValues[i];
          }
        }
        if (
          value === undefined &&
          widgetsValuesKeys &&
          widgetsValuesKeys[i] !== undefined &&
          widgetsValues[widgetsValuesKeys[i]] !== undefined
        ) {
          value = widgetsValues[widgetsValuesKeys[i]];
        }
        if (value === undefined && liveNode.properties && typeof liveNode.properties === "object") {
          if (widgetName && liveNode.properties[widgetName] !== undefined) {
            value = liveNode.properties[widgetName];
          }
        }

        if (value !== undefined) {
          if (typeof exportWidget.setValue === "function") {
            try {
              exportWidget.setValue(value);
            } catch (_) {}
          } else {
            try {
              exportWidget.value = value;
            } catch (_) {}
            try {
              exportWidget._value = value;
            } catch (_) {}
            if (exportWidget.options && typeof exportWidget.options === "object") {
              try {
                exportWidget.options.value = value;
              } catch (_) {}
            }
          }
        }
        if (Number.isFinite(liveWidget.y)) {
          try {
            exportWidget.y = liveWidget.y;
          } catch (_) {}
        }
        if (Number.isFinite(liveWidget.height)) {
          try {
            exportWidget.height = liveWidget.height;
          } catch (_) {}
        }
        if (Number.isFinite(liveWidget.aspectRatio)) {
          try {
            exportWidget.aspectRatio = liveWidget.aspectRatio;
          } catch (_) {}
        }
        if (Number.isFinite(liveWidget.computedHeight)) {
          try {
            exportWidget.computedHeight = liveWidget.computedHeight;
          } catch (_) {}
        }
        if (liveWidget.parentEl && exportWidget.parentEl) {
          try {
            exportWidget.parentEl.hidden = Boolean(liveWidget.parentEl.hidden);
          } catch (_) {}
        }
      }
    }
    if (typeof node.computeSize === "function") {
      try {
        const nextSize = node.computeSize([node.size?.[0], node.size?.[1]]);
        if (Array.isArray(nextSize) && nextSize.length >= 2) {
          if (typeof node.setSize === "function") {
            node.setSize([Number(nextSize[0]), Number(nextSize[1])]);
          } else {
            node.size = [Number(nextSize[0]), Number(nextSize[1])];
          }
        }
      } catch (_) {}
    }
  }
}

function syncLiveNodeGeometry(exportGraph, liveGraph) {
  const exportNodes = exportGraph?._nodes || exportGraph?.nodes || [];
  const liveById = buildNodeIdMap(liveGraph);
  if (!liveById.size || !exportNodes.length) return;

  const isValidPair = (pair) => Array.isArray(pair) && pair.length >= 2
    && Number.isFinite(Number(pair[0]))
    && Number.isFinite(Number(pair[1]));

  for (const node of exportNodes) {
    if (!node || !Number.isFinite(node.id)) continue;
    const liveNode = liveById.get(node.id);
    if (!liveNode) continue;

    const livePos = liveNode.pos || liveNode._pos;
    if (isValidPair(livePos)) {
      node.pos = [Number(livePos[0]), Number(livePos[1])];
    }

    const liveSize = liveNode.size || liveNode._size;
    if (isValidPair(liveSize)) {
      node.size = [Number(liveSize[0]), Number(liveSize[1])];
    }
  }
}

function resizeNodeForDomRect(exportNode, rect) {
  const nodePos = exportNode.pos || exportNode._pos;
  const nodeSize = exportNode.size || exportNode._size;
  if (!Array.isArray(nodePos) || !Array.isArray(nodeSize) || nodePos.length < 2 || nodeSize.length < 2) {
    return;
  }

  const requiredHeight = Math.ceil(rect.y + rect.h - Number(nodePos[1]));
  if (Number.isFinite(requiredHeight) && requiredHeight > Number(nodeSize[1])) {
    exportNode.size = [Number(nodeSize[0]), requiredHeight];
  }
}

function syncLiveDomWidgetHeights(exportGraph, uiCanvas) {
  const exportById = buildNodeIdMap(exportGraph);
  if (!exportById.size || !uiCanvas) return;

  const nodeRects = collectNodeRects(exportGraph, null);
  const widgets = collectDomWidgetContainers(uiCanvas);
  for (const widget of widgets) {
    if (!(widget instanceof HTMLElement)) continue;
    if (!widget.querySelector?.("video, img, canvas")) continue;

    const rect = getDomElementGraphRect(widget, uiCanvas);
    if (!rect || rect.h <= 0) continue;

    const nodeId = resolveNodeIdForGraphRect(
      nodeRects,
      rect,
      getNodeIdFromElement(widget)
    );
    if (!Number.isFinite(nodeId)) continue;

    const exportNode = exportById.get(nodeId);
    if (exportNode) resizeNodeForDomRect(exportNode, rect);
  }

  const videos = collectVideoElementsFromDom(uiCanvas);
  for (const video of videos) {
    if (!(video instanceof HTMLVideoElement)) continue;
    const rect = getDomElementGraphRect(video, uiCanvas);
    if (!rect || rect.h <= 0) continue;

    const nodeId = resolveNodeIdForGraphRect(
      nodeRects,
      rect,
      getNodeIdFromElement(video)
    );
    if (!Number.isFinite(nodeId)) continue;

    const exportNode = exportById.get(nodeId);
    if (exportNode) resizeNodeForDomRect(exportNode, rect);
  }
}

function syncLiveGroups(exportGraph, liveGraph) {
  const exportGroups = exportGraph?._groups || exportGraph?.groups || [];
  const liveGroups = liveGraph?._groups || liveGraph?.groups || [];
  if (!exportGroups.length || !liveGroups.length) return;

  const normalizePos = (pos) => {
    if (Array.isArray(pos) && pos.length >= 2) return [pos[0], pos[1]];
    return null;
  };
  const normalizeSize = (size) => {
    if (Array.isArray(size) && size.length >= 2) return [size[0], size[1]];
    return null;
  };
  const distanceSq = (a, b) => {
    if (!a || !b) return Number.POSITIVE_INFINITY;
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    return dx * dx + dy * dy;
  };

  const liveById = new Map();
  for (const group of liveGroups) {
    if (!group) continue;
    if (group.id !== undefined && group.id !== null) {
      liveById.set(group.id, group);
    }
  }

  for (const exportGroup of exportGroups) {
    if (!exportGroup) continue;
    let liveGroup = null;

    if (exportGroup.id !== undefined && exportGroup.id !== null) {
      liveGroup = liveById.get(exportGroup.id) || null;
    }

    if (!liveGroup && exportGroup.title) {
      const sameTitle = liveGroups.filter((group) => group?.title === exportGroup.title);
      if (sameTitle.length === 1) {
        liveGroup = sameTitle[0];
      } else if (sameTitle.length > 1) {
        const exportPos = normalizePos(exportGroup.pos || exportGroup._pos);
        let best = null;
        let bestDist = Number.POSITIVE_INFINITY;
        for (const candidate of sameTitle) {
          const candPos = normalizePos(candidate.pos || candidate._pos);
          const dist = distanceSq(exportPos, candPos);
          if (dist < bestDist) {
            bestDist = dist;
            best = candidate;
          }
        }
        liveGroup = best;
      }
    }

    if (!liveGroup) {
      const idx = exportGroups.indexOf(exportGroup);
      liveGroup = liveGroups[idx] || null;
    }

    if (!liveGroup) continue;

    const livePos = normalizePos(liveGroup.pos || liveGroup._pos);
    const liveSize = normalizeSize(liveGroup.size || liveGroup._size);
    if (livePos) {
      exportGroup.pos = [...livePos];
    }
    if (liveSize) {
      exportGroup.size = [...liveSize];
    }
  }
}

export function syncLiveGraphState(exportGraph, liveGraph, uiCanvas, debugLog) {
  syncLiveNodeGeometry(exportGraph, liveGraph);
  syncLiveNodeMedia(exportGraph, liveGraph, debugLog);
  syncLiveNodeText(exportGraph, liveGraph);
  syncLiveDomWidgetHeights(exportGraph, uiCanvas);
  syncLiveGroups(exportGraph, liveGraph);
}
