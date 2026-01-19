import {
  findGraphCanvas,
  findWorkflowRoot,
  getWorkflowElementSelectors,
  getLiteGraphAccess,
} from "./detect.js";

function isVisibleElement(element) {
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function addRect(rects, rect) {
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return;
  }
  rects.push(rect);
}

function unionRects(rects) {
  if (!rects.length) {
    return null;
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
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function expandBounds(bounds, padding) {
  if (!bounds) {
    return null;
  }
  const pad = Number.isFinite(padding) ? padding : 0;
  return {
    left: bounds.left - pad,
    top: bounds.top - pad,
    right: bounds.right + pad,
    bottom: bounds.bottom + pad,
    width: bounds.width + pad * 2,
    height: bounds.height + pad * 2,
  };
}

function collectBoundsFromSelectors(root, selectors) {
  const rects = [];
  let count = 0;
  for (const selector of selectors) {
    const elements = root.querySelectorAll(selector);
    for (const element of elements) {
      if (!(element instanceof Element) || !isVisibleElement(element)) {
        continue;
      }
      addRect(rects, element.getBoundingClientRect());
      count += 1;
    }
  }
  return { rects, count };
}

function collectGraphBounds(graph) {
  const rects = [];
  const nodes = graph._nodes || graph.nodes || [];
  const groups = graph._groups || graph.groups || [];

  nodes.forEach((node, index) => {
    if (!node) return;

    // LiteGraph nodes usually have pos: [x, y]
    // In some environments, this is a Float64Array, so Array.isArray() fails.
    const pos = node.pos || node._pos || [0, 0];
    if (!pos || pos.length < 2) {
      return;
    }

    const x = pos[0];
    const y = pos[1];

    // size might be [w, h] or properties
    let w = 140; // Default width
    let h = 30;  // Default height

    const size = node.size || node._size;
    if (size && size.length >= 2) {
      w = size[0];
      h = size[1];
    } else if (size && typeof size === "object") {
      w = size.width || size[0] || 140;
      h = size.height || size[1] || 30;
    } else if (node.computeSize) {
      const s = node.computeSize();
      if (s) { w = s[0]; h = s[1]; }
    }

    // Handle collapsed state
    if (node.flags && node.flags.collapsed) {
      // Collapsed nodes are smaller
      h = 30;
    }

    rects.push({
      left: x,
      top: y,
      right: x + w,
      bottom: y + h,
      width: w,
      height: h,
    });
  });

  for (const group of groups) {
    if (!group) continue;
    const pos = group.pos || group._pos || [0, 0];
    const size = group.size || group._size || [140, 80];

    if (!pos || pos.length < 2 || !size || size.length < 2) continue;

    rects.push({
      left: pos[0],
      top: pos[1],
      right: pos[0] + size[0],
      bottom: pos[1] + size[1],
      width: size[0],
      height: size[1],
    });
  }

  return rects;
}

export function getWorkflowBounds({ padding = 0, debug = false } = {}) {
  const root = findWorkflowRoot();
  const rects = [];
  let domCount = 0;
  let space = "dom";
  const diagnostics = {
    dom: { nodeMatches: 0, groupMatches: 0, noteMatches: 0 },
    graph: { nodeCount: 0, groupCount: 0, used: false },
    canvas: { used: false },
  };

  if (root) {
    const selectors = getWorkflowElementSelectors();
    const nodes = collectBoundsFromSelectors(root, selectors.nodes);
    const groups = collectBoundsFromSelectors(root, selectors.groups);
    const notes = collectBoundsFromSelectors(root, selectors.notes);
    rects.push(...nodes.rects, ...groups.rects, ...notes.rects);
    domCount = nodes.count + groups.count + notes.count;
    diagnostics.dom.nodeMatches = nodes.count;
    diagnostics.dom.groupMatches = groups.count;
    diagnostics.dom.noteMatches = notes.count;
  }

  if (!domCount) {
    const access = getLiteGraphAccess();
    if (access?.graph) {
      const graphRects = collectGraphBounds(access.graph);
      // If we found rects from graph, use them.
      if (graphRects.length) {
        rects.push(...graphRects);
        space = "graph";
        diagnostics.graph.used = true;
        diagnostics.graph.nodeCount = access.graph?._nodes?.length || access.graph?.nodes?.length || 0;
        diagnostics.graph.groupCount = access.graph?._groups?.length || access.graph?.groups?.length || 0;
        diagnostics.graph.source = access.source;
      }
    }
  }

  if (!rects.length) {
    const canvas = findGraphCanvas();
    if (canvas) {
      rects.push(canvas.getBoundingClientRect());
      space = "canvas";
      diagnostics.canvas.used = true;
    } else if (root) {
      rects.push(root.getBoundingClientRect());
      space = "root";
    }
  }

  const union = unionRects(rects);
  const expanded = expandBounds(union, padding);

  return {
    bounds: expanded,
    root,
    hasDomNodes: domCount > 0,
    space,
    diagnostics: debug ? diagnostics : undefined,
  };
}
