import { app } from "/scripts/app.js";
import { installLegacyCanvasMenuItem } from "./core/menu.mjs";
import { registerLegacySettings } from "./core/settings.mjs";

const DEBUG_STORAGE_KEY = "cwie.debug";
const DEBUG_SESSION_KEY = "cwie.debug.session";

function getInitialDebugEnabled() {
  try {
    localStorage.removeItem(DEBUG_STORAGE_KEY);
  } catch (_) {
    // Ignore storage failures. Debug should stay opt-in and non-persistent.
  }
  try {
    return sessionStorage.getItem(DEBUG_SESSION_KEY) === "1";
  } catch (_) {
    return false;
  }
}

let debugEnabled = getInitialDebugEnabled();
let usedOfficialMenu = false;

function log(...args) {
  if (debugEnabled) {
    console.log("[workflow-image-export]", ...args);
  }
}

function setDebug(enabled) {
  debugEnabled = !!enabled;
  try {
    localStorage.removeItem(DEBUG_STORAGE_KEY);
    sessionStorage.setItem(DEBUG_SESSION_KEY, debugEnabled ? "1" : "0");
  } catch (_) {
    // Storage can be unavailable in restricted contexts; keep runtime state only.
  }
  if (window.__cwie__) {
    window.__cwie__.debug = debugEnabled;
  }
  console.log(`[workflow-image-export] Debug logging ${debugEnabled ? "enabled" : "disabled"}.`);
}

function buildMenuLabel() {
  const icon = `
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" style="margin-right:8px; vertical-align:-2px;">
      <path d="M3 6h10v6H3z" fill="none" stroke="currentColor" stroke-width="1.2" />
      <path d="M8 2v7" stroke="currentColor" stroke-width="1.2" />
      <path d="M6 4l2-2 2 2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;

  return `
    <span style="display:inline-flex; align-items:center;">
      ${icon}
      <span>Export Workflow Image&hellip;</span>
    </span>
  `;
}

async function openDialog(log) {
  try {
    const mod = await import("./ui/dialog.mjs");
    const openExportDialog = mod?.openExportDialog;
    if (typeof openExportDialog !== "function") {
      throw new Error("workflow-image-export: openExportDialog not available");
    }
    openExportDialog({
      onExportStarted: () => log("export started"),
      onExportFinished: () => log("export finished"),
      log,
    });
  } catch (error) {
    console.error("[workflow-image-export] failed to open dialog", error);
  }
}

function installNode2DebugApi() {
  const root = window.__cwie__ || {};
  const api = {
    async inspect() {
      const mod = await import("./core/backends/node2_compositor_capture.mjs");
      return mod.inspectNode2Targets();
    },
    async captureFrame(options = {}) {
      const mod = await import("./core/backends/node2_compositor_capture.mjs");
      return mod.captureNode2SingleFrame(options);
    },
    async tileProbe(options = {}) {
      const mod = await import("./core/backends/node2_compositor_capture.mjs");
      return mod.runNode2TileProbe(options);
    },
    async cameraMoveProbe(options = {}) {
      const mod = await import("./core/backends/node2_compositor_capture.mjs");
      return mod.runNode2CameraMoveProbe(options);
    },
  };
  root.node2Capture = api;
  root.node2Spike = api;
  window.__cwie__ = root;
}

app.registerExtension({
  name: "comfyui.workflowImageExport",
  setup() {
    window.__cwie__ = {
      loadedAt: new Date().toISOString(),
      debug: debugEnabled,
      setDebug,
    };
    installNode2DebugApi();
    log("extension loaded", window.__cwie__);
    registerLegacySettings(log);
    setTimeout(() => {
      if (usedOfficialMenu) {
        return;
      }
      installLegacyCanvasMenuItem({
        contentHtml: buildMenuLabel(),
        labelPlain: "Export Workflow Image...",
        onClick: () => {
          log("context menu click (legacy)");
          openDialog(log);
        },
        log,
      });
    }, 0);
  },
  getCanvasMenuItems(existingItems) {
    usedOfficialMenu = true;
    const item = {
      content: buildMenuLabel(),
      callback: () => {
        log("context menu click");
        openDialog(log);
      },
    };

    if (Array.isArray(existingItems)) {
      log("getCanvasMenuItems hook invoked");
      return [...existingItems, null, item];
    }

    return [null, item];
  },
});
