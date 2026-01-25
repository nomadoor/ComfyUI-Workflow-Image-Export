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

function ensureStyles() {
  if (document.getElementById("cwie-styles")) {
    return;
  }
  const link = document.createElement("link");
  link.id = "cwie-styles";
  link.rel = "stylesheet";
  link.href = new URL("../../css/dialog.css", import.meta.url).toString();
  document.head.appendChild(link);
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

function createCaretIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M3 4l3 3 3-3");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.5");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

function createSelect(name, options) {
  const wrapper = document.createElement("details");
  wrapper.className = "cwie-select";
  wrapper.dataset.select = name;

  const summary = document.createElement("summary");
  summary.className = "cwie-select-summary";

  const labelGroup = document.createElement("span");
  labelGroup.className = "cwie-select-labels";

  options.forEach((option) => {
    const label = document.createElement("span");
    label.className = "cwie-select-label";
    label.dataset.value = option.value;
    label.textContent = option.label;
    labelGroup.appendChild(label);
  });

  const caret = document.createElement("span");
  caret.className = "cwie-caret";
  caret.appendChild(createCaretIcon());

  summary.appendChild(labelGroup);
  summary.appendChild(caret);

  const menu = document.createElement("div");
  menu.className = "cwie-select-options";

  const items = new Map();
  let currentValue = options[0]?.value ?? "";
  const changeHandlers = new Set();

  options.forEach((option) => {
    const optionLabel = document.createElement("label");
    optionLabel.className = "cwie-select-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = `cwie-select-${name}`;
    input.value = option.value;
    const text = document.createElement("span");
    text.textContent = option.label;
    optionLabel.appendChild(input);
    optionLabel.appendChild(text);
    items.set(option.value, input);
    menu.appendChild(optionLabel);
  });

  wrapper.appendChild(summary);
  wrapper.appendChild(menu);

  function setValue(value) {
    currentValue = value;
    const input = items.get(value);
    if (input) {
      input.checked = true;
    }
  }

  function getValue() {
    const checked = wrapper.querySelector("input[type=radio]:checked");
    return checked?.value ?? currentValue;
  }

  function onChange(handler) {
    changeHandlers.add(handler);
  }

  function setDisabled(disabled) {
    wrapper.toggleAttribute("data-disabled", disabled);
    wrapper.querySelectorAll("input").forEach((input) => {
      input.disabled = disabled;
    });
  }

  wrapper.addEventListener("change", (event) => {
    if (event.target && event.target.matches("input[type=radio]")) {
      currentValue = event.target.value;
      changeHandlers.forEach((handler) => handler(currentValue));
      wrapper.removeAttribute("open");
    }
  });

  setValue(currentValue);

  return {
    root: wrapper,
    setValue,
    getValue,
    onChange,
    setDisabled,
  };
}

function isDebugEnabled() {
  return !!window.__cwie__?.debug;
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
      title: "Node2.0 Unsupported",
      message: "Node2.0 is not supported yet.",
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

  const formatSelect = createSelect("format", [
    { value: "png", label: "PNG" },
    { value: "webp", label: "WebP" },
  ]);

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

  const advancedHeader = document.createElement("div");
  advancedHeader.className = "cwie-section-header";

  const advancedTitle = document.createElement("div");
  advancedTitle.className = "cwie-section-title";
  advancedTitle.textContent = "Advanced";

  const advancedToggle = document.createElement("button");
  advancedToggle.type = "button";
  advancedToggle.className = "cwie-advanced-toggle";
  advancedToggle.setAttribute("aria-expanded", "false");
  advancedToggle.textContent = "Show";

  const advancedCaret = document.createElement("span");
  advancedCaret.className = "cwie-caret";
  advancedCaret.appendChild(createCaretIcon());
  advancedToggle.appendChild(advancedCaret);

  const advancedBody = document.createElement("div");
  advancedBody.className = "cwie-advanced-body";

  const outputResolutionSelect = createSelect("resolution", [
    { value: "auto", label: "Auto" },
    { value: "100%", label: "100%" },
    { value: "200%", label: "200%" },
  ]);

  const maxLongEdgeInput = document.createElement("input");
  maxLongEdgeInput.type = "number";
  maxLongEdgeInput.min = "0";
  maxLongEdgeInput.step = "1";
  maxLongEdgeInput.className = "cwie-input";

  const exceedSelect = createSelect("exceed", [
    { value: "downscale", label: "Downscale" },
    { value: "tile", label: "Tile" },
  ]);

  function syncEmbedAvailability(formatValue) {
    const v = String(formatValue || "png").toLowerCase();
    if (v === "png") {
      embedToggle.input.disabled = false;
      formatSelect.setDisabled(false);
      embedNote.textContent = "";
      return;
    }

    embedToggle.input.checked = false;
    embedToggle.input.disabled = true;
    formatSelect.setDisabled(false);

    if (v === "webp") {
      embedNote.textContent =
        "Workflow embedding is disabled for WebP.";
      return;
    }
  }

  function applyStateToControls(nextState) {
    formatSelect.setValue(nextState.format);
    embedToggle.input.checked = nextState.embedWorkflow;
    syncEmbedAvailability(nextState.format);
    const bgInput = backgroundGroup.inputs.get(nextState.background);
    if (bgInput) {
      bgInput.checked = true;
    }
    solidColorInput.value = nextState.solidColor;
    paddingInput.value = String(nextState.padding);
    outputResolutionSelect.setValue(nextState.outputResolution);
    maxLongEdgeInput.value = String(nextState.maxLongEdge);
    exceedSelect.setValue(nextState.exceedMode);
    if (solidColorRow) {
      solidColorRow.style.display = nextState.background === "solid" ? "grid" : "none";
    }
  }

  function updateStateFromControls() {
    const normalized = normalizeSettingsState({
      format: formatSelect.getValue(),
      embedWorkflow: embedToggle.input.checked,
      background: [...backgroundGroup.inputs.values()].find((input) => input.checked)?.value,
      solidColor: solidColorInput.value,
      padding: paddingInput.value,
      outputResolution: outputResolutionSelect.getValue(),
      maxLongEdge: maxLongEdgeInput.value,
      exceedMode: exceedSelect.getValue(),
    });
    state = { ...normalized, debug: isDebugEnabled() };
  }

  function handleChange() {
    updateStateFromControls();
  }

  formatSelect.onChange((value) => {
    syncEmbedAvailability(value);
    handleChange();
  });
  embedToggle.input.addEventListener("change", () => handleChange());
  solidColorInput.addEventListener("change", () => handleChange());
  paddingInput.addEventListener("change", () => handleChange());
  outputResolutionSelect.onChange(() => handleChange());
  maxLongEdgeInput.addEventListener("change", () => handleChange());
  exceedSelect.onChange(() => handleChange());

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
    advancedCaret.classList.toggle("is-open", advancedOpen);
    advancedToggle.firstChild.textContent = advancedOpen ? "Hide" : "Show";
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
          title: "Node2.0 Unsupported",
          message: "Node2.0 is not supported yet.",
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
  dialog.appendChild(createRow("Format", formatSelect.root));
  dialog.appendChild(createRow("Embed workflow", embedToggle.wrapper));
  dialog.appendChild(embedNote);
  dialog.appendChild(createRow("Background", backgroundGroup.group));

  solidColorRow = createRow("Solid color", solidColorInput);
  dialog.appendChild(solidColorRow);
  dialog.appendChild(createRow("Padding", paddingInput));

  advancedBody.appendChild(createRow("Output resolution", outputResolutionSelect.root));
  advancedBody.appendChild(createRow("Max long edge", maxLongEdgeInput));
  advancedBody.appendChild(createRow("If exceeded", exceedSelect.root));

  // Debug Toggle
  const debugToggle = createToggle();
  debugToggle.input.checked = isDebugEnabled();
  debugToggle.input.addEventListener("change", () => {
    state.debug = debugToggle.input.checked;
    // Also update global debug state for persistence if desired, or just session
    if (window.__cwie__) {
      window.__cwie__.setDebug(debugToggle.input.checked);
    }
  });
  advancedBody.appendChild(createRow("Enable Debug Log", debugToggle.wrapper));

  advancedHeader.appendChild(advancedTitle);
  advancedHeader.appendChild(advancedToggle);
  advancedSection.appendChild(advancedHeader);
  advancedSection.appendChild(advancedBody);

  dialog.appendChild(advancedSection);
  dialog.appendChild(footer);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  activeDialog = backdrop;

  applyStateToControls(state);
}
