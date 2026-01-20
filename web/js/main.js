import { app } from "/scripts/app.js";
import { installLegacyCanvasMenuItem } from "./core/menu.js";
import { registerLegacySettings } from "./core/settings.js";

const DEBUG = localStorage.getItem("cwie.debug") === "1";
let usedOfficialMenu = false;

function log(...args) {
  if (DEBUG) {
    console.log("[workflow-image-export]", ...args);
  }
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
    const mod = await import("./ui/dialog.js");
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

app.registerExtension({
  name: "comfyui.workflowImageExport",
  setup() {
    window.__cwie__ = {
      loadedAt: new Date().toISOString(),
      debug: DEBUG,
    };
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
