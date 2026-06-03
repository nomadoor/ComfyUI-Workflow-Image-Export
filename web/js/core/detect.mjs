import { app } from "/scripts/app.js";

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
