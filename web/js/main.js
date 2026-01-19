import { app } from "../../../scripts/app.js";
import { openExportDialog } from "./ui/dialog.js";
import { installLegacyCanvasMenuItem } from "./core/menu.js";

const DEBUG = localStorage.getItem("cwie.debug") === "1";
let usedOfficialMenu = false;

function log(...args) {
  if (DEBUG) {
    console.log("[workflow-image-export]", ...args);
  }
}

function buildMenuLabel() {
  const icon = `
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" style="margin-right:6px; vertical-align:-2px;">
      <path d="M3 6h10v6H3z" fill="none" stroke="currentColor" stroke-width="1.2" />
      <path d="M8 2v7" stroke="currentColor" stroke-width="1.2" />
      <path d="M6 4l2-2 2 2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;

  return `${icon}<span>Export Workflow Image&hellip;</span>`;
}

app.registerExtension({
  name: "comfyui.workflowImageExport",
  setup() {
    window.__cwie__ = {
      loadedAt: new Date().toISOString(),
      debug: DEBUG,
    };
    log("extension loaded", window.__cwie__);
    setTimeout(() => {
      if (usedOfficialMenu) {
        return;
      }
      installLegacyCanvasMenuItem({
        contentHtml: buildMenuLabel(),
        labelPlain: "Export Workflow Image...",
        onClick: () => {
          log("context menu click (legacy)");
          openExportDialog({
            onExportStarted: () => log("export started"),
            onExportFinished: () => log("export finished"),
          });
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
        openExportDialog({
          onExportStarted: () => log("export started"),
          onExportFinished: () => log("export finished"),
        });
      },
    };

    // Place near the top: prepend to existing items if possible.
    if (Array.isArray(existingItems)) {
      log("getCanvasMenuItems hook invoked");
      return [item, null, ...existingItems];
    }

    return [item];
  },
});
