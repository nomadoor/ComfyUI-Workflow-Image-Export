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

export function computeGraphBBox(graph, options = {}) {
  const nodes = graph?._nodes || graph?.nodes || [];
  const groups = graph?._groups || graph?.groups || [];
  const pad = Number(options.padding) || 0;
  const fallbackSize = normalizeSize(options.defaultSize, DEFAULT_NODE_SIZE);
  const debug = options.debug === true;

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

  nodes.forEach((node, index) => {
    if (!node) return;
    const bounding =
      (typeof node.getBounding === "function" && node.getBounding()) ||
      node.bounding ||
      node._bounding;
    if (Array.isArray(bounding) && bounding.length >= 4) {
      const bw = Number(bounding[2]);
      const bh = Number(bounding[3]);
      if (Number.isFinite(bw) && Number.isFinite(bh) && (bw > 0 || bh > 0)) {
        minX = Math.min(minX, bounding[0]);
        minY = Math.min(minY, bounding[1]);
        maxX = Math.max(maxX, bounding[0] + bw);
        maxY = Math.max(maxY, bounding[1] + bh);
        if (debug && index < 5) {
          console.log("[CWIE][Offscreen] node.bounding", {
            index,
            id: node.id,
            title: node.title,
            bounding: [...bounding],
          });
        }
        return;
      }
    }

    const pos = normalizePos(node.pos || node._pos);
    const size = normalizeSize(node.size || node._size, fallbackSize);
    const x = pos[0];
    const y = pos[1];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + size[0]);
    maxY = Math.max(maxY, y + size[1]);
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
