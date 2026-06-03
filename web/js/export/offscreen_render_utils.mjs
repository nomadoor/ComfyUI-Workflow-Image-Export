export function applyRenderFilter(graph, selectedNodeIds, mode) {
  if (!graph || !mode || mode === "all") return;
  const ids = Array.isArray(selectedNodeIds)
    ? new Set(selectedNodeIds.map((id) => Number(id)).filter(Number.isFinite))
    : null;
  if (!ids || !ids.size) return;
  const nodes = graph?._nodes || graph?.nodes || [];
  const shouldKeep = (node) => {
    if (!node || !Number.isFinite(node.id)) return false;
    const isSelected = ids.has(node.id);
    if (mode === "none") return false;
    if (mode === "selected") return isSelected;
    if (mode === "unselected") return !isSelected;
    return true;
  };
  const remove = nodes.filter((node) => !shouldKeep(node));
  if (typeof graph.remove === "function") {
    remove.forEach((node) => {
      try {
        graph.remove(node);
      } catch (_) {}
    });
  } else if (Array.isArray(graph._nodes)) {
    graph._nodes = nodes.filter((node) => shouldKeep(node));
  }
}

export function applyLinkFilter(graph, selectedNodeIds, mode) {
  if (!graph || !mode || mode === "all") return;
  const ids = Array.isArray(selectedNodeIds)
    ? new Set(selectedNodeIds.map((id) => Number(id)).filter(Number.isFinite))
    : null;
  if (!ids || !ids.size) return;

  const getEndpoints = (link) => {
    if (!link || typeof link !== "object") return [null, null];
    const a = link.origin_id ?? link.from_id ?? link.originId ?? link.fromId;
    const b = link.target_id ?? link.to_id ?? link.targetId ?? link.toId;
    return [Number(a), Number(b)];
  };

  const keepLink = (link) => {
    if (mode === "none") return false;
    const [a, b] = getEndpoints(link);
    const aSel = Number.isFinite(a) && ids.has(a);
    const bSel = Number.isFinite(b) && ids.has(b);
    const bothSelected = aSel && bSel;
    if (mode === "selected") return bothSelected;
    if (mode === "unselected") return !bothSelected;
    return true;
  };

  if (graph.links instanceof Map) {
    const next = new Map();
    for (const [key, link] of graph.links.entries()) {
      if (keepLink(link)) {
        next.set(key, link);
      }
    }
    graph.links = next;
    return;
  }

  if (graph.links && typeof graph.links === "object") {
    const next = {};
    for (const [key, link] of Object.entries(graph.links)) {
      if (keepLink(link)) {
        next[key] = link;
      }
    }
    graph.links = next;
  }
}

export function computeScaleToFit(width, height, maxPixels) {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  const current = w * h;
  if (current <= maxPixels) return 1;
  return Math.sqrt(maxPixels / current);
}

export function computeTileBounds(bbox, tileRect, baseWidth, baseHeight) {
  if (!tileRect) {
    return {
      paddedMinX: bbox.paddedMinX,
      paddedMinY: bbox.paddedMinY,
      width: bbox.width,
      height: bbox.height,
    };
  }
  const x = Math.max(0, Math.min(baseWidth, Number(tileRect.x) || 0));
  const y = Math.max(0, Math.min(baseHeight, Number(tileRect.y) || 0));
  const w = Math.max(1, Math.min(baseWidth - x, Number(tileRect.width) || baseWidth));
  const h = Math.max(1, Math.min(baseHeight - y, Number(tileRect.height) || baseHeight));
  return {
    paddedMinX: bbox.paddedMinX + x,
    paddedMinY: bbox.paddedMinY + y,
    width: w,
    height: h,
  };
}
