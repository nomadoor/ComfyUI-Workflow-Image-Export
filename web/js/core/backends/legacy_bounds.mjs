export function collectNodeRects(graph, debugLog) {
  const rects = [];
  const nodes = graph?._nodes || graph?.nodes || [];

  nodes.forEach((node, index) => {
    if (!node) return;
    const bounding =
      (typeof node.getBounding === "function" && node.getBounding()) ||
      node.bounding ||
      node._bounding;
    if (Array.isArray(bounding) && bounding.length >= 4) {
      rects.push({
        left: bounding[0],
        top: bounding[1],
        right: bounding[0] + bounding[2],
        bottom: bounding[1] + bounding[3],
        id: node.id,
        title: node.title,
        type: node.type,
      });
      debugLog?.("node.bounding", {
        index,
        id: node.id,
        title: node.title,
        bounding: [...bounding],
      });
      return;
    }
    const pos = node.pos || node._pos || [0, 0];
    const size = node.size || node._size || [140, 30];
    if (!pos || pos.length < 2 || !size || size.length < 2) return;
    rects.push({
      left: pos[0],
      top: pos[1],
      right: pos[0] + size[0],
      bottom: pos[1] + size[1],
      id: node.id,
      title: node.title,
      type: node.type,
    });
    debugLog?.("node.pos", {
      index,
      id: node.id,
      title: node.title,
      pos: [...pos],
      size: [...size],
    });
  });

  return rects;
}

export function collectGraphBounds(graph, debugLog) {
  const rects = collectNodeRects(graph, debugLog);
  const groups = graph?._groups || graph?.groups || [];

  groups.forEach((group, index) => {
    if (!group) return;
    const pos = group.pos || group._pos || [0, 0];
    const size = group.size || group._size || [140, 80];
    if (!pos || pos.length < 2 || !size || size.length < 2) return;
    rects.push({
      left: pos[0],
      top: pos[1],
      right: pos[0] + size[0],
      bottom: pos[1] + size[1],
    });
    debugLog?.("group.pos", {
      index,
      title: group.title,
      pos: [...pos],
      size: [...size],
    });
  });

  if (!rects.length) {
    return { bounds: null, nodeRects: [] };
  }

  let left = rects[0].left;
  let top = rects[0].top;
  let right = rects[0].right;
  let bottom = rects[0].bottom;
  for (let i = 1; i < rects.length; i += 1) {
    const rect = rects[i];
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  const bounds = { left, top, right, bottom, width: right - left, height: bottom - top };
  debugLog?.("bounds.raw", bounds);
  return { bounds, nodeRects: rects };
}

export function applyPadding(bounds, padding, debugLog) {
  if (!bounds) return null;
  const pad = Number.isFinite(padding) ? padding : 0;
  const padded = {
    left: bounds.left - pad,
    top: bounds.top - pad,
    right: bounds.right + pad,
    bottom: bounds.bottom + pad,
    width: bounds.width + pad * 2,
    height: bounds.height + pad * 2,
  };
  debugLog?.("bounds.padded", padded);
  return padded;
}

export function filterNodeRectsBySelected(nodeRects, selectedNodeIds) {
  const ids = Array.isArray(selectedNodeIds)
    ? new Set(selectedNodeIds.map((id) => Number(id)).filter(Number.isFinite))
    : null;
  if (!ids?.size) return [];
  return (nodeRects || []).filter((rect) => rect && Number.isFinite(rect.id) && ids.has(rect.id));
}

export function boundsFromNodeRects(nodeRects, debugLog) {
  if (!nodeRects?.length) return null;
  let left = nodeRects[0].left;
  let top = nodeRects[0].top;
  let right = nodeRects[0].right;
  let bottom = nodeRects[0].bottom;
  for (let i = 1; i < nodeRects.length; i += 1) {
    const rect = nodeRects[i];
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  const bounds = { left, top, right, bottom, width: right - left, height: bottom - top };
  debugLog?.("bounds.selected.raw", bounds);
  return bounds;
}
