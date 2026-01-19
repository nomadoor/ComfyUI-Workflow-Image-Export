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
