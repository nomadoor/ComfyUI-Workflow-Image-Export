import { nodeIdSetHas, normalizeNodeIdSet } from "../core/node_ids.mjs";

const DEFAULT_NODE_SIZE = [240, 120];

function normalizeSize(size, fallback) {
  if (Array.isArray(size) && size.length >= 2) {
    const w = Number(size[0]);
    const h = Number(size[1]);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return [w, h];
    }
  }
  if (size && typeof size === "object") {
    const w = Number(size[0] ?? size.width ?? size.w);
    const h = Number(size[1] ?? size.height ?? size.h);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return [w, h];
    }
  }
  return fallback;
}

function normalizePos(pos) {
  if (Array.isArray(pos) && pos.length >= 2) {
    const x = Number(pos[0]);
    const y = Number(pos[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return [x, y];
    }
  }
  if (pos && typeof pos === "object") {
    const x = Number(pos[0] ?? pos.x);
    const y = Number(pos[1] ?? pos.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return [x, y];
    }
  }
  return [0, 0];
}

function normalizeRect(rect) {
  if (!rect || typeof rect !== "object") return null;
  const x = Number(rect[0] ?? rect.x);
  const y = Number(rect[1] ?? rect.y);
  const width = Number(rect[2] ?? rect.width ?? rect.w);
  const height = Number(rect[3] ?? rect.height ?? rect.h);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return [x, y, width, height];
}

function resolveNodeTitleHeight(node) {
  const candidates = [
    node?.titleHeight,
    node?.constructor?.title_height,
    globalThis.window?.LiteGraph?.NODE_TITLE_HEIGHT,
    globalThis.LiteGraph?.NODE_TITLE_HEIGHT,
    30,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return 30;
}

export function computeGraphBBox(graph, options = {}) {
  const nodes = graph?._nodes || graph?.nodes || [];
  const groups = graph?._groups || graph?.groups || [];
  const pad = Number(options.padding) || 0;
  const fallbackSize = normalizeSize(options.defaultSize, DEFAULT_NODE_SIZE);
  const debug = options.debug === true;
  const selectedIds = normalizeNodeIdSet(options.selectedNodeIds);
  const useSelectionOnly = Boolean(options.useSelectionOnly) && selectedIds && selectedIds.size > 0;

  if (!nodes.length && !groups.length) {
    const width = Math.max(1, fallbackSize[0]);
    const height = Math.max(1, fallbackSize[1]);
    return {
      minX: 0,
      minY: 0,
      maxX: width,
      maxY: height,
      width: width + pad * 2,
      height: height + pad * 2,
      paddedMinX: -pad,
      paddedMinY: -pad,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const useBounding = options.useBounding !== false;
  nodes.forEach((node, index) => {
    if (!node) return;
    if (useSelectionOnly && !nodeIdSetHas(selectedIds, node.id)) {
      return;
    }
    const hasBoundingApi = typeof node.getBounding === "function";
    let measuredBounding = null;
    if (useBounding) {
      const bounding =
        (typeof node.getBounding === "function" && node.getBounding()) ||
        node.bounding ||
        node._bounding;
      measuredBounding = normalizeRect(bounding);
    }
    const cachedCollapsedWidth = Number(node._collapsed_width);
    if (
      !measuredBounding &&
      node.flags?.collapsed === true &&
      Number.isFinite(cachedCollapsedWidth) &&
      cachedCollapsedWidth > 0
    ) {
      // Current LiteGraph measure(out) overwrites _collapsed_width with its
      // default when no drawing context is supplied. The live graph already
      // holds the width measured with the real canvas, so use that cache
      // directly rather than losing long-title geometry during export.
      const pos = normalizePos(node.pos || node._pos);
      const titleHeight = resolveNodeTitleHeight(node);
      measuredBounding = normalizeRect([
        pos[0],
        pos[1] - titleHeight,
        cachedCollapsedWidth,
        titleHeight,
      ]);
    }
    if (!measuredBounding && hasBoundingApi && typeof node.measure === "function") {
      const measured = [0, 0, 0, 0];
      const collapsedWidthDescriptor = Object.getOwnPropertyDescriptor(
        node,
        "_collapsed_width"
      );
      try {
        node.measure(measured);
        measuredBounding = normalizeRect(measured);
      } catch {
        // Some third-party nodes expose an incompatible measure hook. Fall
        // back to their live position and size without breaking export.
      } finally {
        if (collapsedWidthDescriptor) {
          Object.defineProperty(node, "_collapsed_width", collapsedWidthDescriptor);
        } else {
          delete node._collapsed_width;
        }
      }
    }
    if (measuredBounding) {
      const [bx, by, bw, bh] = measuredBounding;
      minX = Math.min(minX, bx);
      minY = Math.min(minY, by);
      maxX = Math.max(maxX, bx + bw);
      maxY = Math.max(maxY, by + bh);
      if (debug && index < 5) {
        console.log("[CWIE][Offscreen] node.bounding", {
          index,
          id: node.id,
          title: node.title,
          bounding: measuredBounding,
        });
      }
      return;
    }

    const pos = normalizePos(node.pos || node._pos);
    const size = normalizeSize(node.size || node._size, fallbackSize);
    const x = pos[0];
    // Configured offscreen nodes have not run updateArea() yet, so their
    // getBounding() result can be an empty rectangle. LiteGraph draws the title
    // above pos.y; include it in that specific fallback path.
    const titleHeight = hasBoundingApi ? resolveNodeTitleHeight(node) : 0;
    const y = pos[1] - titleHeight;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + size[0]);
    maxY = Math.max(maxY, pos[1] + size[1]);
    if (debug && index < 5) {
      console.log("[CWIE][Offscreen] node.pos", {
        index,
        id: node.id,
        title: node.title,
        pos: [pos[0], pos[1]],
        size: [size[0], size[1]],
      });
    }
  });

  groups.forEach((group, index) => {
    if (!group) return;
    if (useSelectionOnly) {
      return;
    }
    const pos = normalizePos(group.pos || group._pos);
    const size = normalizeSize(group.size || group._size, fallbackSize);
    const x = pos[0];
    const y = pos[1];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + size[0]);
    maxY = Math.max(maxY, y + size[1]);
    if (debug && index < 5) {
      console.log("[CWIE][Offscreen] group.pos", {
        index,
        title: group.title,
        pos: [pos[0], pos[1]],
        size: [size[0], size[1]],
      });
    }
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    minX = 0;
    minY = 0;
  }
  if (!Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    maxX = minX + fallbackSize[0];
    maxY = minY + fallbackSize[1];
  }

  const width = Math.max(1, maxX - minX + pad * 2);
  const height = Math.max(1, maxY - minY + pad * 2);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    paddedMinX: minX - pad,
    paddedMinY: minY - pad,
  };
}
