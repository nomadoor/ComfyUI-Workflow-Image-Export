import { capturePlaceholderPng } from "../core/capture.js";
import { triggerDownload } from "../core/download.js";

let activeDialog = null;

const STYLES = `
.cwie-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.cwie-dialog {
  width: 360px;
  max-width: calc(100vw - 32px);
  background: var(--comfy-menu-bg, #1f1f1f);
  color: var(--fg-color, #e5e5e5);
  border: 1px solid var(--border-color, #3a3a3a);
  border-radius: 8px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
  padding: 16px;
  font-family: var(--font-family, system-ui, sans-serif);
}

.cwie-dialog h3 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
}

.cwie-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}

.cwie-row label {
  font-size: 12px;
  color: var(--fg-color, #e5e5e5);
}

.cwie-select {
  width: 100%;
  background: var(--input-bg, #2b2b2b);
  color: inherit;
  border: 1px solid var(--border-color, #3a3a3a);
  border-radius: 4px;
  padding: 4px 6px;
}

.cwie-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.cwie-button {
  border-radius: 4px;
  border: 1px solid var(--border-color, #3a3a3a);
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  background: var(--input-bg, #2b2b2b);
  color: inherit;
}

.cwie-button.primary {
  background: var(--comfy-menu-bg, #1f1f1f);
  box-shadow: inset 0 0 0 1px var(--highlight-color, #4a90e2);
}

.cwie-button:disabled {
  opacity: 0.6;
  cursor: default;
}
`;

function ensureStyles() {
  if (document.getElementById("cwie-styles")) {
    return;
  }
  const style = document.createElement("style");
  style.id = "cwie-styles";
  style.textContent = STYLES;
  document.head.appendChild(style);
}

function closeDialog() {
  if (activeDialog) {
    activeDialog.remove();
    activeDialog = null;
  }
}

export function openExportDialog({ onExportStarted, onExportFinished } = {}) {
  if (activeDialog) {
    return;
  }

  ensureStyles();

  const backdrop = document.createElement("div");
  backdrop.className = "cwie-backdrop";
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      closeDialog();
    }
  });

  const dialog = document.createElement("div");
  dialog.className = "cwie-dialog";

  const title = document.createElement("h3");
  title.textContent = "Export Workflow Image";

  const formatRow = document.createElement("div");
  formatRow.className = "cwie-row";

  const formatLabel = document.createElement("label");
  formatLabel.textContent = "Format";

  const formatSelect = document.createElement("select");
  formatSelect.className = "cwie-select";
  ["PNG", "WebP", "SVG"].forEach((format) => {
    const option = document.createElement("option");
    option.value = format.toLowerCase();
    option.textContent = format;
    formatSelect.appendChild(option);
  });

  formatRow.appendChild(formatLabel);
  formatRow.appendChild(formatSelect);

  const footer = document.createElement("div");
  footer.className = "cwie-footer";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "cwie-button";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", () => closeDialog());

  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.className = "cwie-button primary";
  exportButton.textContent = "Export";

  exportButton.addEventListener("click", async () => {
    exportButton.disabled = true;
    cancelButton.disabled = true;
    onExportStarted?.();
    try {
      const dataUrl = await capturePlaceholderPng();
      await triggerDownload({
        dataUrl,
        filename: "workflow.png",
      });
    } finally {
      onExportFinished?.();
      closeDialog();
    }
  });

  footer.appendChild(cancelButton);
  footer.appendChild(exportButton);

  dialog.appendChild(title);
  dialog.appendChild(formatRow);
  dialog.appendChild(footer);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  activeDialog = backdrop;
}
