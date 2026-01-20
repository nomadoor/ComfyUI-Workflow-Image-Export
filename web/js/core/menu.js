import { getLegacyCanvasMenuHook } from "./detect.js";

const MENU_ID = "cwie-export-menu";
let legacyInstalled = false;

function patchLegacyCanvasMenu({ contentHtml, labelPlain, onClick, log }) {
  const hook = getLegacyCanvasMenuHook();
  if (!hook) {
    return false;
  }
  if (legacyInstalled) {
    return true;
  }

  const original = hook.getCanvasMenuOptions;
  hook.LGraphCanvas.prototype.getCanvasMenuOptions = function () {
    const options = original?.apply(this, arguments) || [];
    const exists = options.some((item) =>
      item && (item.id === MENU_ID || item.content === labelPlain || item.content === contentHtml)
    );
    if (!exists) {
      const entry = { id: MENU_ID, content: contentHtml, callback: onClick };
      options.push(null);
      options.push(entry);
    }
    return options;
  };

  legacyInstalled = true;
  log?.("legacy menu hook installed");
  return true;
}

export function installLegacyCanvasMenuItem({
  contentHtml,
  labelPlain,
  onClick,
  log,
  pollMs = 500,
  timeoutMs = 8000,
} = {}) {
  if (patchLegacyCanvasMenu({ contentHtml, labelPlain, onClick, log })) {
    return true;
  }

  const start = Date.now();
  const timer = setInterval(() => {
    if (patchLegacyCanvasMenu({ contentHtml, labelPlain, onClick, log })) {
      clearInterval(timer);
      return;
    }
    if (Date.now() - start > timeoutMs) {
      clearInterval(timer);
      log?.("legacy menu hook timed out");
    }
  }, pollMs);

  return false;
}
