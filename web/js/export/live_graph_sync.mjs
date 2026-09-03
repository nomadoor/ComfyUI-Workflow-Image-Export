import { toNodeIdKey } from "../core/node_ids.mjs";

function buildNodeIdMap(graph) {
  const nodes = graph?._nodes || graph?.nodes || [];
  const byId = new Map();
  for (const node of nodes) {
    const id = toNodeIdKey(node?.id);
    if (id !== null) byId.set(id, node);
  }
  return byId;
}

function toFinitePair(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !Number.isFinite(Number(value[0])) ||
    !Number.isFinite(Number(value[1]))
  ) {
    return null;
  }
  return [Number(value[0]), Number(value[1])];
}

function writeGeometryPair(node, publicKey, privateKey, pair) {
  const target = node?.[privateKey];
  if (target && typeof target.set === "function") {
    target.set(pair);
    return;
  }
  if (target && typeof target === "object") {
    target[0] = pair[0];
    target[1] = pair[1];
    return;
  }
  node[publicKey] = [...pair];
}

function cloneExportState(value) {
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }
  try {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }
  } catch (_) {}
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return undefined;
  }
}

function syncLiveNodeText(exportGraph, liveGraph) {
  const exportNodes = exportGraph?._nodes || exportGraph?.nodes || [];
  const liveById = buildNodeIdMap(liveGraph);
  if (!liveById.size || !exportNodes.length) return;
  const multilineWidgetTypes = new Set(["textarea", "markdown", "customtext", "textpreview"]);
  const shouldSyncWidgetValue = (exportWidget, liveWidget) => {
    const type = String(exportWidget?.type || liveWidget?.type || "").toLowerCase();
    if (exportWidget?.options?.multiline === true || liveWidget?.options?.multiline === true) {
      return true;
    }
    return multilineWidgetTypes.has(type);
  };

  for (const node of exportNodes) {
    const id = toNodeIdKey(node?.id);
    if (id === null) continue;
    const liveNode = liveById.get(id);
    if (!liveNode) continue;

    if (liveNode.widgets_values !== undefined) {
      const snapshot = cloneExportState(liveNode.widgets_values);
      if (snapshot !== undefined) node.widgets_values = snapshot;
    }
    if (liveNode.properties !== undefined) {
      const snapshot = cloneExportState(liveNode.properties);
      if (snapshot !== undefined) node.properties = snapshot;
    }
    if (Number.isFinite(liveNode.widgets_start_y)) {
      node.widgets_start_y = liveNode.widgets_start_y;
    }
    if (Array.isArray(node.widgets) && Array.isArray(liveNode.widgets)) {
      const count = Math.min(node.widgets.length, liveNode.widgets.length);
      const widgetsValues = node.widgets_values;
      const widgetsValuesKeys =
        widgetsValues && typeof widgetsValues === "object" && !Array.isArray(widgetsValues)
          ? Object.keys(widgetsValues)
          : null;
      for (let i = 0; i < count; i += 1) {
        const exportWidget = node.widgets[i];
        const liveWidget = liveNode.widgets[i];
        if (!exportWidget || !liveWidget) continue;
        const widgetsValueKey =
          widgetsValuesKeys && widgetsValuesKeys[i] !== undefined
            ? widgetsValuesKeys[i]
            : null;
        const originalName = exportWidget.name;
        const originalLabel = exportWidget.label;
        const originalOptionsName = exportWidget.options?.name;
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
          widgetsValueKey !== null &&
          widgetsValues[widgetsValueKey] !== undefined
        ) {
          value = widgetsValues[widgetsValueKey];
        }
        if (value === undefined && node.properties && typeof node.properties === "object") {
          if (widgetName && node.properties[widgetName] !== undefined) {
            value = node.properties[widgetName];
          }
        }

        if (value !== undefined && shouldSyncWidgetValue(exportWidget, liveWidget)) {
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
        const labelName =
          originalName ||
          originalLabel ||
          originalOptionsName ||
          widgetsValueKey ||
          widgetName;
        if (labelName && typeof labelName === "string") {
          try {
            exportWidget.name = labelName;
          } catch (_) {}
          if (exportWidget.options && typeof exportWidget.options === "object") {
            try {
              exportWidget.options.name = originalOptionsName || labelName;
            } catch (_) {}
          }
        }
        if (originalLabel !== undefined) {
          try {
            exportWidget.label = originalLabel;
          } catch (_) {}
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
  }
}

function syncLiveNodeGeometry(exportGraph, liveGraph) {
  const exportNodes = exportGraph?._nodes || exportGraph?.nodes || [];
  const liveById = buildNodeIdMap(liveGraph);
  if (!liveById.size || !exportNodes.length) return;

  for (const node of exportNodes) {
    const id = toNodeIdKey(node?.id);
    if (id === null) continue;
    const liveNode = liveById.get(id);
    if (!liveNode) continue;

    const livePos = toFinitePair(liveNode.pos || liveNode._pos);
    if (livePos) {
      writeGeometryPair(node, "pos", "_pos", livePos);
    }

    const liveSize = toFinitePair(liveNode.size || liveNode._size);
    if (liveSize) {
      writeGeometryPair(node, "size", "_size", liveSize);
    }

    // LiteGraph caches the measured title width while a node is collapsed.
    // measure() has no drawing context in the bbox pass, so preserve the live
    // cache to avoid cropping long collapsed titles to the default width.
    if (Number.isFinite(Number(liveNode._collapsed_width))) {
      node._collapsed_width = Number(liveNode._collapsed_width);
    }
  }
}

function syncLiveGroups(exportGraph, liveGraph) {
  const exportGroups = exportGraph?._groups || exportGraph?.groups || [];
  const liveGroups = liveGraph?._groups || liveGraph?.groups || [];
  if (!exportGroups.length || !liveGroups.length) return;

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
        const exportPos = toFinitePair(exportGroup.pos || exportGroup._pos);
        let best = null;
        let bestDist = Number.POSITIVE_INFINITY;
        for (const candidate of sameTitle) {
          const candPos = toFinitePair(candidate.pos || candidate._pos);
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

    const livePos = toFinitePair(liveGroup.pos || liveGroup._pos);
    const liveSize = toFinitePair(liveGroup.size || liveGroup._size);
    if (livePos) {
      writeGeometryPair(exportGroup, "pos", "_pos", livePos);
    }
    if (liveSize) {
      writeGeometryPair(exportGroup, "size", "_size", liveSize);
    }
  }
}

export function syncLiveGraphState(exportGraph, liveGraph, uiCanvas) {
  void uiCanvas;
  syncLiveNodeText(exportGraph, liveGraph);
  // The live graph is the visual source of truth; clone sizing hooks must not
  // replace the position or size the user is viewing.
  syncLiveNodeGeometry(exportGraph, liveGraph);
  syncLiveGroups(exportGraph, liveGraph);
}
