export function findNodeForPoint(nodeRects, x, y) {
  if (!nodeRects?.length) return null;
  for (let i = 0; i < nodeRects.length; i += 1) {
    const rect = nodeRects[i];
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return rect;
    }
  }
  return null;
}

export function normalizeSelectedNodeIds(selectedNodeIds) {
  if (selectedNodeIds instanceof Set) return selectedNodeIds;
  if (!Array.isArray(selectedNodeIds)) return null;
  const ids = new Set(selectedNodeIds.map((id) => Number(id)).filter(Number.isFinite));
  return ids.size ? ids : null;
}

export function shouldRenderResolvedNode(nodeId, selectedNodeIds, mode) {
  if (!mode || mode === "all") return true;
  if (mode === "none") return false;
  const ids = normalizeSelectedNodeIds(selectedNodeIds);
  if (!ids?.size || !Number.isFinite(nodeId)) return false;
  const isSelected = ids.has(Number(nodeId));
  if (mode === "selected") return isSelected;
  if (mode === "unselected") return !isSelected;
  return true;
}

export function isVideoNodeTitle(title, type) {
  const text = `${title || ""} ${type || ""}`.toLowerCase();
  return text.includes("video");
}

export function isVhsVideoElement(video) {
  if (!video) return false;
  if (video.classList?.contains("VHS_loopedvideo")) return true;
  const src = `${video.currentSrc || ""} ${video.src || ""}`.toLowerCase();
  return src.includes("/api/vhs/viewvideo") || src.includes("viewvideo");
}
