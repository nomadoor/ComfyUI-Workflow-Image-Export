export function applyNodeOpacity(canvas, value, debugLog = null) {
  if (!canvas) return;
  const alpha = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
  debugLog?.("node.opacity.apply", {
    alpha,
    hasCtx: Boolean(canvas.ctx || canvas.context || canvas.canvas?.getContext),
  });
  const keys = ["node_opacity", "nodeOpacity"];
  for (const key of keys) {
    const existed = key in canvas;
    if (existed) {
      canvas[key] = alpha;
    }
    debugLog?.("node.opacity.prop", { key, value: alpha, existed });
  }
  for (const key of ["node_alpha", "nodeAlpha"]) {
    if (key in canvas) {
      debugLog?.("node.opacity.prop.skip", { key, reason: "avoid-full-node-opacity" });
    }
  }
  canvas._cwieNodeOpacity = alpha;

  if (!Number.isFinite(alpha) || alpha >= 0.999) return;

  const ctx = canvas.ctx || canvas.context || canvas.canvas?.getContext?.("2d");
  if (!ctx) return;

  if (debugLog) {
    const methodKeys = new Set();
    let proto = canvas;
    let depth = 0;
    while (proto && depth < 5) {
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key.toLowerCase().includes("drawnode")) methodKeys.add(key);
      }
      proto = Object.getPrototypeOf(proto);
      depth += 1;
    }
    debugLog("node.opacity.methods", { methods: Array.from(methodKeys).sort() });
  }

  const resolveMethod = (name) => {
    if (typeof canvas[name] === "function") return canvas[name];
    let proto = canvas;
    let depth = 0;
    while (proto && depth < 5) {
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      if (desc && typeof desc.value === "function") return desc.value;
      proto = Object.getPrototypeOf(proto);
      depth += 1;
    }
    return null;
  };

  const wrapMethod = (name) => {
    const original = resolveMethod(name);
    if (typeof original !== "function" || original._cwieNodeOpacityWrapped) return false;
    canvas[name] = function (...args) {
      ctx._cwieNodeOpacityAlpha = alpha;
      debugLog?.("node.opacity.draw", { method: name, alpha });
      try {
        return original.apply(this, args);
      } finally {
        // no-op
      }
    };
    canvas[name]._cwieNodeOpacityWrapped = true;
    debugLog?.("node.opacity.wrap", { method: name, alpha });
    return true;
  };

  let wrapped = false;
  if (wrapMethod("drawNodeBackground")) wrapped = true;
  if (wrapMethod("drawNodeBox")) wrapped = true;

  const originalDrawShape = resolveMethod("drawNodeShape");
  if (typeof originalDrawShape === "function" && !originalDrawShape._cwieNodeOpacityShapeWrapped) {
    canvas.drawNodeShape = function (...args) {
      const node = args[0];
      const prevAlpha = ctx.globalAlpha;
      ctx._cwieNodeOpacityAlpha = alpha;
      ctx.globalAlpha = Number.isFinite(prevAlpha) ? prevAlpha * alpha : alpha;
      debugLog?.("node.opacity.draw", { method: "drawNodeShape", alpha, node: node?.title });
      try {
        return originalDrawShape.apply(this, args);
      } finally {
        ctx.globalAlpha = prevAlpha;
      }
    };
    canvas.drawNodeShape._cwieNodeOpacityShapeWrapped = true;
    debugLog?.("node.opacity.wrap", { method: "drawNodeShape", alpha });
    wrapped = true;
  }

  const originalDrawWidgets = resolveMethod("drawNodeWidgets");
  if (typeof originalDrawWidgets === "function" && !originalDrawWidgets._cwieNodeOpacityWidgetWrapped) {
    canvas.drawNodeWidgets = function (...args) {
      const node = args[0];
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = 1;
      debugLog?.("node.opacity.draw", { method: "drawNodeWidgets", alpha: 1, node: node?.title });
      try {
        return originalDrawWidgets.apply(this, args);
      } finally {
        ctx.globalAlpha = prevAlpha;
      }
    };
    canvas.drawNodeWidgets._cwieNodeOpacityWidgetWrapped = true;
    debugLog?.("node.opacity.wrap", { method: "drawNodeWidgets", alpha: 1 });
    wrapped = true;
  }

  if (!wrapped) {
    debugLog?.("node.opacity.wrap", { method: "none", alpha });
  }
}
