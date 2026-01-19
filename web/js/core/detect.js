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

export function getLegacyCanvasMenuHook() {
  const LGraphCanvas = window?.LGraphCanvas;
  if (!LGraphCanvas?.prototype?.getCanvasMenuOptions) {
    return null;
  }
  return {
    LGraphCanvas,
    getCanvasMenuOptions: LGraphCanvas.prototype.getCanvasMenuOptions,
  };
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
