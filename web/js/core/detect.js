import { app } from "/scripts/app.js";

export function findGraphCanvas() {
  const selectors = [
    "canvas.graphcanvas",
    "canvas#graph-canvas",
    "#graph-canvas canvas",
    "canvas.litegraph",
  ];

  for (const selector of selectors) {
    const candidate = document.querySelector(selector);
    if (candidate instanceof HTMLCanvasElement) {
      return candidate;
    }
  }

  const anyCanvas = document.querySelector("canvas");
  if (anyCanvas instanceof HTMLCanvasElement) {
    return anyCanvas;
  }

  return null;
}

export function findWorkflowRoot() {
  const rootSelectors = [
    "#graph-canvas",
    ".graph-canvas",
    ".graph-canvas-container",
    ".comfy-graph",
    ".comfyui-graph",
  ];

  for (const selector of rootSelectors) {
    const candidate = document.querySelector(selector);
    if (candidate instanceof HTMLElement) {
      return candidate;
    }
  }

  const canvas = findGraphCanvas();
  if (canvas) {
    return canvas.parentElement || canvas;
  }

  return document.body;
}

export function findNode2Root() {
  const selectors = [
    "#graph-canvas-container",
    ".graph-canvas-container",
    ".comfy-graph",
    ".comfyui-graph",
  ];
  for (const selector of selectors) {
    const candidate = document.querySelector(selector);
    if (candidate instanceof HTMLElement) {
      return candidate;
    }
  }
  return null;
}

export function debugDomCandidates() {
  const info = {
    graphCanvas: findGraphCanvas(),
    workflowRoot: findWorkflowRoot(),
    node2Root: findNode2Root(),
  };
  console.log("[workflow-image-export] debug dom candidates", info);
  return info;
}

export function getWorkflowElementSelectors() {
  return {
    nodes: [
      ".node",
      ".graph-node",
      ".litegraph-node",
      ".comfy-node",
      ".node-container",
      "[data-node-id]",
      "[data-nodeid]",
    ],
    groups: [
      ".group",
      ".graph-group",
      ".litegraph-group",
      "[data-group-id]",
    ],
    notes: [
      ".note",
      ".comment",
      ".graph-comment",
      ".litegraph-comment",
      "[data-note-id]",
    ],
  };
}

export function getLiteGraphAccess() {
  const LGraphCanvas = window?.LGraphCanvas || window?.LiteGraph?.LGraphCanvas;
  const canvas = app?.canvas || window?.app?.canvas || LGraphCanvas?.active_canvas;

  const candidates = [
    { graph: app?.graph, source: "app.graph" },
    { graph: app?.canvas?.graph, source: "app.canvas.graph" },
    { graph: app?.graph?.graph, source: "app.graph.graph" },
    { graph: app?.canvas?.graph?.graph, source: "app.canvas.graph.graph" },
    { graph: window?.app?.graph, source: "window.app.graph" },
    { graph: window?.app?.canvas?.graph, source: "window.app.canvas.graph" },
    { graph: LGraphCanvas?.active_canvas?.graph, source: "LGraphCanvas.active_canvas.graph" },
    { graph: window?.graph, source: "window.graph" },
    { graph: window?.LiteGraph?.graph, source: "LiteGraph.graph" },
  ];

  const pick = candidates.find((entry) => entry.graph);
  if (!pick?.graph || !LGraphCanvas) {
    return null;
  }
  return { graph: pick.graph, canvas, LGraphCanvas, source: pick.source };
}

export function getLegacyCanvasMenuHook() {
  const LGraphCanvas = window?.LGraphCanvas || window?.LiteGraph?.LGraphCanvas;
  if (!LGraphCanvas?.prototype?.getCanvasMenuOptions) {
    return null;
  }
  return {
    LGraphCanvas,
    getCanvasMenuOptions: LGraphCanvas.prototype.getCanvasMenuOptions,
  };
}

export function detectBackend() {
  try {
    const canvas = findGraphCanvas();
    if (canvas) {
      return "legacy";
    }
  } catch (e) {
    // fall through
  }
  return "legacy";
}

export function getSettingsAccess(app) {
  const extSetting = app?.extensionManager?.setting;
  if (extSetting && typeof extSetting.get === "function") {
    return {
      type: "extensionManager",
      get: (id, fallback) => {
        const value = extSetting.get(id);
        return value === undefined ? fallback : value;
      },
      set: (id, value) => extSetting.set?.(id, value),
    };
  }

  const uiSettings = app?.ui?.settings;
  if (uiSettings && typeof uiSettings.getSettingValue === "function") {
    return {
      type: "legacy",
      get: (id, fallback) => uiSettings.getSettingValue(id, fallback),
      set: (id, value) => uiSettings.setSettingValue?.(id, value),
      addSetting: uiSettings.addSetting?.bind(uiSettings),
    };
  }

  return null;
}
