import {
  nodeIdSetHas,
  normalizeNodeIdSet,
  toNodeIdKey,
} from "../node_ids.mjs";

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
  return normalizeNodeIdSet(selectedNodeIds);
}

export function shouldRenderResolvedNode(nodeId, selectedNodeIds, mode) {
  if (!mode || mode === "all") return true;
  if (mode === "none") return false;
  const ids = normalizeSelectedNodeIds(selectedNodeIds);
  if (!ids?.size || toNodeIdKey(nodeId) === null) return false;
  const isSelected = nodeIdSetHas(ids, nodeId);
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
