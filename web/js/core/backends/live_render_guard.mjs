function copyPair(value) {
  return value && typeof value.length === "number" && value.length >= 2
    ? [Number(value[0]), Number(value[1])]
    : null;
}

function capturePair(owner, key) {
  return {
    hadOwn: Object.prototype.hasOwnProperty.call(owner, key),
    value: copyPair(owner?.[key]),
  };
}

function restorePair(owner, key, state) {
  if (!owner || !state) return;
  if (!state.hadOwn && !state.value) {
    try { delete owner[key]; } catch (_) {}
    return;
  }
  if (!state.value) return;
  try {
    const current = owner[key];
    if (current && typeof current.set === "function") {
      current.set(state.value);
    } else {
      owner[key] = [...state.value];
    }
  } catch (_) {}
}

function captureWidgetNumber(widget, key) {
  return {
    hadOwn: Object.prototype.hasOwnProperty.call(widget, key),
    value: widget[key],
  };
}

function restoreWidgetNumber(widget, key, state) {
  try {
    if (state.hadOwn) {
      widget[key] = state.value;
    } else {
      delete widget[key];
    }
  } catch (_) {}
}

export function createLiveRenderGuard(graph, uiCanvas) {
  const graphHadCanvasList = Object.prototype.hasOwnProperty.call(
    graph || {},
    "list_of_graphcanvas"
  );
  const initialGraphCanvases = new Set(
    Array.isArray(graph?.list_of_graphcanvas) ? graph.list_of_graphcanvas : []
  );
  const primaryCanvasState = {
    hadOwn: Object.prototype.hasOwnProperty.call(graph || {}, "primaryCanvas"),
    value: graph?.primaryCanvas,
  };
  let trackedGraphCanvas = null;
  const nodeStates = [];
  for (const node of graph?._nodes || graph?.nodes || []) {
    if (!node) continue;
    nodeStates.push({
      node,
      pos: capturePair(node, "pos"),
      privatePos: capturePair(node, "_pos"),
      size: capturePair(node, "size"),
      privateSize: capturePair(node, "_size"),
      widgets: (Array.isArray(node.widgets) ? node.widgets : [])
        .filter(Boolean)
        .map((widget) => ({
          widget,
          y: captureWidgetNumber(widget, "y"),
          height: captureWidgetNumber(widget, "height"),
          computedHeight: captureWidgetNumber(widget, "computedHeight"),
          lastY: captureWidgetNumber(widget, "last_y"),
          computedDisabled: captureWidgetNumber(widget, "computedDisabled"),
        })),
    });
  }

  const canvas = uiCanvas?.canvas;
  const root = canvas?.closest?.(".graph-canvas-panel") || canvas?.parentElement || null;
  const elementStates = [];
  for (const element of root?.querySelectorAll?.(".dom-widget, .dom-widget *") || []) {
    elementStates.push({
      element,
      cssText: element?.style?.cssText,
      hidden: element?.hidden,
    });
  }

  let restored = false;
  return {
    trackGraphCanvas(canvas) {
      trackedGraphCanvas = canvas || null;
    },
    restore() {
      if (restored) return;
      restored = true;
      for (const state of nodeStates) {
        restorePair(state.node, "pos", state.pos);
        restorePair(state.node, "_pos", state.privatePos);
        restorePair(state.node, "size", state.size);
        restorePair(state.node, "_size", state.privateSize);
        for (const widgetState of state.widgets) {
          restoreWidgetNumber(widgetState.widget, "y", widgetState.y);
          restoreWidgetNumber(widgetState.widget, "height", widgetState.height);
          restoreWidgetNumber(widgetState.widget, "computedHeight", widgetState.computedHeight);
          restoreWidgetNumber(widgetState.widget, "last_y", widgetState.lastY);
          restoreWidgetNumber(
            widgetState.widget,
            "computedDisabled",
            widgetState.computedDisabled
          );
        }
      }
      for (const state of elementStates) {
        try {
          if (state.element?.style && typeof state.cssText === "string") {
            state.element.style.cssText = state.cssText;
          }
          state.element.hidden = state.hidden;
        } catch (_) {}
      }
      const currentCanvases = Array.isArray(graph?.list_of_graphcanvas)
        ? [...graph.list_of_graphcanvas]
        : [];
      const cleanupTargets = trackedGraphCanvas
        ? [trackedGraphCanvas]
        : currentCanvases.filter((canvas) => !initialGraphCanvases.has(canvas));
      for (const canvas of cleanupTargets) {
        if (!canvas || initialGraphCanvases.has(canvas)) continue;
        try { graph?.detachCanvas?.(canvas); } catch (_) {}
        const list = graph?.list_of_graphcanvas;
        if (Array.isArray(list)) {
          const index = list.indexOf(canvas);
          if (index >= 0) list.splice(index, 1);
        }
      }
      try {
        if (primaryCanvasState.hadOwn) {
          graph.primaryCanvas = primaryCanvasState.value;
        } else {
          delete graph.primaryCanvas;
        }
      } catch (_) {}
      try {
        if (
          !graphHadCanvasList &&
          Array.isArray(graph?.list_of_graphcanvas) &&
          graph.list_of_graphcanvas.length === 0
        ) {
          delete graph.list_of_graphcanvas;
        }
      } catch (_) {}
    },
  };
}
