import {
  capture,
  detectBackendType,
  isNode2UnsupportedError,
} from "../core/capture/index.js";
import { triggerDownload } from "../core/download.js";
import {
  DEFAULTS,
  getDefaultsFromSettings,
  normalizeState as normalizeSettingsState,
  setDefaultsInSettings,
} from "../core/settings.js";

let activeDialog = null;
let activeMessageDialog = null;

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
  width: 420px;
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

.cwie-message {
  margin: 0 0 12px 0;
  font-size: 12px;
  line-height: 1.5;
}

.cwie-section-title {
  margin: 12px 0 8px 0;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.7;
}

.cwie-row {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}

.cwie-row label {
  font-size: 12px;
  color: var(--fg-color, #e5e5e5);
}

.cwie-select,
.cwie-input {
  width: 100%;
  background: var(--input-bg, #2b2b2b);
  color: inherit;
  border: 1px solid var(--border-color, #3a3a3a);
  border-radius: 4px;
  padding: 4px 6px;
}

.cwie-input[type="color"] {
  padding: 2px;
  height: 28px;
}

.cwie-toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 38px;
  height: 20px;
}

.cwie-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.cwie-toggle-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: var(--input-bg, #2b2b2b);
  border: 1px solid var(--border-color, #3a3a3a);
  border-radius: 12px;
  transition: 0.2s ease;
}

.cwie-toggle-slider::before {
  content: "";
  position: absolute;
  height: 14px;
  width: 14px;
  left: 2px;
  top: 2px;
  background: var(--fg-color, #e5e5e5);
  border-radius: 50%;
  transition: 0.2s ease;
}

.cwie-toggle input:checked + .cwie-toggle-slider {
  background: var(--highlight-color, #4a90e2);
  border-color: var(--highlight-color, #4a90e2);
}

.cwie-toggle input:checked + .cwie-toggle-slider::before {
  transform: translateX(18px);
}

.cwie-toggle input:disabled + .cwie-toggle-slider {
  opacity: 0.5;
  cursor: not-allowed;
}

.cwie-toggle input:disabled + .cwie-toggle-slider::before {
  background: #b0b0b0;
}

.cwie-radio-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.cwie-radio {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #3a3a3a);
  background: var(--input-bg, #2b2b2b);
  font-size: 12px;
  cursor: pointer;
}

.cwie-radio input {
  margin: 0;
}

.cwie-note {
  font-size: 12px;
  opacity: 0.8;
  line-height: 1.4;
}

.cwie-advanced {
  margin-top: 6px;
}

.cwie-advanced-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 6px 0;
  font-size: 12px;
}

.cwie-advanced-body {
  display: none;
  margin-top: 8px;
}

.cwie-advanced.is-open .cwie-advanced-body {
  display: block;
}

.cwie-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

.cwie-footer-right {
  display: flex;
  gap: 8px;
}

.cwie-footer-left {
  display: flex;
  align-items: center;
}

.cwie-button {
  border-radius: 4px;
  border: 1px solid var(--border-color, #3a3a3a);
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  background: var(--input-bg, #2b2b2b);
  color: inherit;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.cwie-button.primary {
  background: var(--comfy-menu-bg, #1f1f1f);
  box-shadow: inset 0 0 0 1px var(--highlight-color, #4a90e2);
}

.cwie-button.reset {
  font-size: 11px;
  padding: 4px 8px;
  opacity: 0.7;
}

.cwie-button:disabled {
  opacity: 0.6;
  cursor: default;
}

.cwie-link {
  border: none;
  background: none;
  color: var(--highlight-color, #4a90e2);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}

.cwie-spinner {
  display: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: rgba(255, 255, 255, 0.9);
  animation: cwie-spin 0.8s linear infinite;
}

.cwie-button.is-busy .cwie-spinner {
  display: inline-block;
}

@keyframes cwie-spin {
  to {
    transform: rotate(360deg);
  }
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

function closeMessageDialog() {
  if (activeMessageDialog) {
    activeMessageDialog.remove();
    activeMessageDialog = null;
  }
}

function openMessageDialog({ title, message }) {
  ensureStyles();
  closeMessageDialog();

  const backdrop = document.createElement("div");
  backdrop.className = "cwie-backdrop";
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      closeMessageDialog();
    }
  });

  const dialog = document.createElement("div");
  dialog.className = "cwie-dialog";

  const heading = document.createElement("h3");
  heading.textContent = title;

  const body = document.createElement("p");
  body.className = "cwie-message";
  body.textContent = message;

  const footer = document.createElement("div");
  footer.className = "cwie-footer";

  const footerRight = document.createElement("div");
  footerRight.className = "cwie-footer-right";

  const okButton = document.createElement("button");
  okButton.type = "button";
  okButton.className = "cwie-button primary";
  okButton.textContent = "OK";
  okButton.addEventListener("click", () => closeMessageDialog());

  footerRight.appendChild(okButton);
  footer.appendChild(footerRight);

  dialog.appendChild(heading);
  dialog.appendChild(body);
  dialog.appendChild(footer);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  activeMessageDialog = backdrop;
}

function createRow(labelText, inputElement) {
  const row = document.createElement("div");
  row.className = "cwie-row";

  const label = document.createElement("label");
  label.textContent = labelText;

  row.appendChild(label);
  row.appendChild(inputElement);

  return row;
}

function createToggle() {
  const wrapper = document.createElement("label");
  wrapper.className = "cwie-toggle";

  const input = document.createElement("input");
  input.type = "checkbox";

  const slider = document.createElement("span");
  slider.className = "cwie-toggle-slider";

  wrapper.appendChild(input);
  wrapper.appendChild(slider);

  return { wrapper, input };
}

function createRadioGroup(name, options) {
  const group = document.createElement("div");
  group.className = "cwie-radio-group";

  const inputs = new Map();

  for (const option of options) {
    const label = document.createElement("label");
    label.className = "cwie-radio";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = option.value;

    const text = document.createElement("span");
    text.textContent = option.label;

    label.appendChild(input);
    label.appendChild(text);
    group.appendChild(label);

    inputs.set(option.value, input);
  }

  return { group, inputs };
}

function isDebugEnabled() {
  return (
    localStorage.getItem("cwie.debug") === "1" ||
    window.__cwie__?.debug === true
  );
}

function buildInitialState() {
  return { ...getDefaultsFromSettings(), debug: isDebugEnabled() };
}

export function openExportDialog({ onExportStarted, onExportFinished, log } = {}) {
  if (activeDialog) {
    return;
  }

  ensureStyles();

  if (detectBackendType() === "node2") {
    openMessageDialog({
      title: "Node2.0 未対応",
      message: "Node2.0にはまだ対応していません。",
    });
    return;
  }

  let state = buildInitialState();

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

  const basicTitle = document.createElement("div");
  basicTitle.className = "cwie-section-title";
  basicTitle.textContent = "Basic";

  const formatSelect = document.createElement("select");
  formatSelect.className = "cwie-select";
  ["png", "webp"].forEach((format) => {
    const option = document.createElement("option");
    option.value = format;
    option.textContent = format.toUpperCase();
    formatSelect.appendChild(option);
  });

  const embedToggle = createToggle();
  const embedNote = document.createElement("div");
  embedNote.className = "cwie-note";

  const backgroundGroup = createRadioGroup("cwie-bg", [
    { value: "ui", label: "UI" },
    { value: "transparent", label: "Transparent" },
    { value: "solid", label: "Solid" },
  ]);

  const solidColorInput = document.createElement("input");
  solidColorInput.type = "color";
  solidColorInput.className = "cwie-input";

  const paddingInput = document.createElement("input");
  paddingInput.type = "number";
  paddingInput.min = "0";
  paddingInput.step = "1";
  paddingInput.className = "cwie-input";

  const advancedSection = document.createElement("div");
  advancedSection.className = "cwie-advanced";

  let solidColorRow = null;

  const advancedToggle = document.createElement("button");
  advancedToggle.type = "button";
  advancedToggle.className = "cwie-advanced-toggle";
  advancedToggle.setAttribute("aria-expanded", "false");
  advancedToggle.textContent = "Advanced";

  const advancedCaret = document.createElement("span");
  advancedCaret.textContent = ">";
  advancedToggle.appendChild(advancedCaret);

  const advancedBody = document.createElement("div");
  advancedBody.className = "cwie-advanced-body";

  const outputResolutionSelect = document.createElement("select");
  outputResolutionSelect.className = "cwie-select";
  [
    { value: "auto", label: "Auto" },
    { value: "100%", label: "100%" },
    { value: "200%", label: "200%" },
  ].forEach((optionData) => {
    const option = document.createElement("option");
    option.value = optionData.value;
    option.textContent = optionData.label;
    outputResolutionSelect.appendChild(option);
  });

  const maxLongEdgeInput = document.createElement("input");
  maxLongEdgeInput.type = "number";
  maxLongEdgeInput.min = "0";
  maxLongEdgeInput.step = "1";
  maxLongEdgeInput.className = "cwie-input";

  const exceedSelect = document.createElement("select");
  exceedSelect.className = "cwie-select";
  [
    { value: "downscale", label: "Downscale" },
    { value: "tile", label: "Tile" },
  ].forEach((optionData) => {
    const option = document.createElement("option");
    option.value = optionData.value;
    option.textContent = optionData.label;
    exceedSelect.appendChild(option);
  });

  function syncEmbedAvailability(formatValue) {
    const v = String(formatValue || "png").toLowerCase();
    if (v === "png") {
      embedToggle.input.disabled = false;
      embedNote.textContent = "";
      return;
    }

    embedToggle.input.checked = false;
    embedToggle.input.disabled = true;

    if (v === "webp") {
      embedNote.textContent =
        "WebPではワークフロー埋め込みはOFF固定です。";
      return;
    }
  }

  function applyStateToControls(nextState) {
    formatSelect.value = nextState.format;
    embedToggle.input.checked = nextState.embedWorkflow;
    syncEmbedAvailability(nextState.format);
    const bgInput = backgroundGroup.inputs.get(nextState.background);
    if (bgInput) {
      bgInput.checked = true;
    }
    solidColorInput.value = nextState.solidColor;
    paddingInput.value = String(nextState.padding);
    outputResolutionSelect.value = nextState.outputResolution;
    maxLongEdgeInput.value = String(nextState.maxLongEdge);
    exceedSelect.value = nextState.exceedMode;
    if (solidColorRow) {
      solidColorRow.style.display = nextState.background === "solid" ? "grid" : "none";
    }
  }

  function updateStateFromControls() {
    const normalized = normalizeSettingsState({
      format: formatSelect.value,
      embedWorkflow: embedToggle.input.checked,
      background: [...backgroundGroup.inputs.values()].find((input) => input.checked)?.value,
      solidColor: solidColorInput.value,
      padding: paddingInput.value,
      outputResolution: outputResolutionSelect.value,
      maxLongEdge: maxLongEdgeInput.value,
      exceedMode: exceedSelect.value,
    });
    state = { ...normalized, debug: isDebugEnabled() };
  }

  function handleChange() {
    updateStateFromControls();
  }

  formatSelect.addEventListener("change", () => {
    syncEmbedAvailability(formatSelect.value);
    handleChange();
  });
  embedToggle.input.addEventListener("change", () => handleChange());
  solidColorInput.addEventListener("change", () => handleChange());
  paddingInput.addEventListener("change", () => handleChange());
  outputResolutionSelect.addEventListener("change", () => handleChange());
  maxLongEdgeInput.addEventListener("change", () => handleChange());
  exceedSelect.addEventListener("change", () => handleChange());

  for (const input of backgroundGroup.inputs.values()) {
    input.addEventListener("change", () => {
      handleChange();
      solidColorRow.style.display = state.background === "solid" ? "grid" : "none";
    });
  }

  let advancedOpen = false;
  advancedToggle.addEventListener("click", () => {
    advancedOpen = !advancedOpen;
    advancedSection.classList.toggle("is-open", advancedOpen);
    advancedToggle.setAttribute("aria-expanded", String(advancedOpen));
    advancedCaret.textContent = advancedOpen ? "v" : ">";
  });

  const footer = document.createElement("div");
  footer.className = "cwie-footer";

  const footerLeft = document.createElement("div");
  footerLeft.className = "cwie-footer-left";

  const footerRight = document.createElement("div");
  footerRight.className = "cwie-footer-right";

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "cwie-button reset";
  resetButton.textContent = "Reset to defaults";
  resetButton.addEventListener("click", () => {
    state = normalizeSettingsState(DEFAULTS);
    applyStateToControls(state);
  });

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "cwie-button";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", () => closeDialog());

  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.className = "cwie-button primary";
  exportButton.textContent = "Export";

  const exportSpinner = document.createElement("span");
  exportSpinner.className = "cwie-spinner";
  exportSpinner.setAttribute("aria-hidden", "true");
  exportButton.prepend(exportSpinner);

  exportButton.addEventListener("click", async () => {
    exportButton.disabled = true;
    cancelButton.disabled = true;
    exportButton.classList.add("is-busy");
    onExportStarted?.();
    updateStateFromControls();
    let messageDialogPayload = null;
    try {
      const blob = await capture(state);
      setDefaultsInSettings(state);
      await triggerDownload({
        blob,
        filename: `workflow.${state.format || "png"}`,
      });
    } catch (error) {
      if (isNode2UnsupportedError(error)) {
        messageDialogPayload = {
          title: "Node2.0 未対応",
          message: "Node2.0にはまだ対応していません。",
        };
      } else {
        log?.("export:error", { message: error?.message || String(error) });
        console.error("[workflow-image-export] export failed", error);
      }
    } finally {
      exportButton.classList.remove("is-busy");
      onExportFinished?.();
      closeDialog();
      if (messageDialogPayload) {
        openMessageDialog(messageDialogPayload);
      }
    }
  });

  footerRight.appendChild(cancelButton);
  footerRight.appendChild(exportButton);

  footerLeft.appendChild(resetButton);
  footer.appendChild(footerLeft);
  footer.appendChild(footerRight);

  dialog.appendChild(title);
  dialog.appendChild(basicTitle);
  dialog.appendChild(createRow("Format", formatSelect));
  dialog.appendChild(createRow("Embed workflow", embedToggle.wrapper));
  dialog.appendChild(embedNote);
  dialog.appendChild(createRow("Background", backgroundGroup.group));

  solidColorRow = createRow("Solid color", solidColorInput);
  dialog.appendChild(solidColorRow);
  dialog.appendChild(createRow("Padding", paddingInput));

  advancedBody.appendChild(createRow("Output resolution", outputResolutionSelect));
  advancedBody.appendChild(createRow("Max long edge", maxLongEdgeInput));
  advancedBody.appendChild(createRow("If exceeded", exceedSelect));

  advancedSection.appendChild(advancedToggle);
  advancedSection.appendChild(advancedBody);

  dialog.appendChild(advancedSection);
  dialog.appendChild(footer);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  activeDialog = backdrop;

  applyStateToControls(state);
}
