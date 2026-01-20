import { app } from "/scripts/app.js";
import { openExportDialog } from "./ui/dialog.js";
import { installLegacyCanvasMenuItem } from "./core/menu.js";
import { findNode2Root, debugDomCandidates } from "./core/detect.js";

const DEBUG = localStorage.getItem("cwie.debug") === "1";
let usedOfficialMenu = false;
let node2MenuInstalled = false;
let node2MenuEl = null;

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

function ensureNode2MenuElement() {
  if (node2MenuEl) {
    return node2MenuEl;
  }
  const menu = document.createElement("div");
  menu.style.position = "fixed";
  menu.style.zIndex = "100000";
  menu.style.background = "var(--comfy-menu-bg, #1f1f1f)";
  menu.style.color = "var(--fg-color, #e5e5e5)";
  menu.style.border = "1px solid var(--border-color, #3a3a3a)";
  menu.style.borderRadius = "6px";
  menu.style.boxShadow = "0 6px 18px rgba(0,0,0,0.4)";
  menu.style.padding = "6px";
  menu.style.fontSize = "12px";
  menu.style.display = "none";

  const item = document.createElement("div");
  item.style.display = "flex";
  item.style.alignItems = "center";
  item.style.gap = "6px";
  item.style.cursor = "pointer";
  item.style.padding = "6px 8px";
  item.style.borderRadius = "4px";
  item.onmouseenter = () => {
    item.style.background = "rgba(255,255,255,0.08)";
  };
  item.onmouseleave = () => {
    item.style.background = "transparent";
  };
  item.innerHTML = buildMenuLabel();
  item.addEventListener("click", () => {
    hideNode2Menu();
    log("context menu click (node2)");
    openExportDialog({
      onExportStarted: () => log("export started"),
      onExportFinished: () => log("export finished"),
      log,
    });
  });

  menu.appendChild(item);
  document.body.appendChild(menu);
  node2MenuEl = menu;
  return menu;
}

function hideNode2Menu() {
  if (node2MenuEl) {
    node2MenuEl.style.display = "none";
  }
}

function shouldShowContextMenu(target) {
  if (!(target instanceof Element)) return false;
  const selectors = [
    "#graph-canvas-container",
    ".graph-canvas-container",
    ".comfy-graph",
    ".comfyui-graph",
    "#graph-canvas",
    "canvas.graphcanvas",
    "canvas.litegraph",
    "canvas.lgraphcanvas",
  ];
  return selectors.some((sel) => target.closest(sel));
}

function installNode2ContextMenuFallback() {
  if (node2MenuInstalled) return;
  node2MenuInstalled = true;

  document.addEventListener("click", () => hideNode2Menu());
  document.addEventListener("contextmenu", (event) => {
    if (usedOfficialMenu) return;
    if (!shouldShowContextMenu(event.target)) return;
    event.preventDefault();
    const menu = ensureNode2MenuElement();
    const x = Math.min(event.clientX, window.innerWidth - 220);
    const y = Math.min(event.clientY, window.innerHeight - 80);
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.display = "block";
  });
}

app.registerExtension({
  name: "comfyui.workflowImageExport",
  setup() {
    window.__cwie__ = {
      loadedAt: new Date().toISOString(),
      debug: DEBUG,
    };
    if (DEBUG) {
      window.__cwie__.debugTools = {
        findNode2Root,
        debugDomCandidates,
      };
    }
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
            log,
          });
        },
        log,
      });
    }, 0);
    installNode2ContextMenuFallback();
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
          log,
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
