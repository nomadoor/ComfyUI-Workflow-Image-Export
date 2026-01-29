import { app } from "/scripts/app.js";
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
let activeDialogCleanup = null;

const PREVIEW_MAX_PIXELS = 1024 * 1024;

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
  try {
    activeDialogCleanup?.();
  } catch (_) {
    // ignore cleanup failures
  } finally {
    activeDialogCleanup = null;
  }
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
  return {
    ...getDefaultsFromSettings(),
    debug: isDebugEnabled(),
    scopeSelected: false,
    scopeOpacity: 40,
  };
}

function getSelectedNodeIds() {
  const selected =
    app?.canvas?.selected_nodes ||
    app?.canvas?.selectedNodes ||
    app?.graph?.selected_nodes ||
    null;
  if (!selected) return [];
  if (selected instanceof Map) {
    return Array.from(selected.keys()).map((id) => Number(id)).filter(Number.isFinite);
  }
  if (Array.isArray(selected)) {
    return selected
      .map((node) => node?.id)
      .filter((id) => Number.isFinite(id));
  }
  if (typeof selected === "object") {
    return Object.keys(selected)
      .map((id) => Number(id))
      .filter(Number.isFinite);
  }
  return [];
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

  const content = document.createElement("div");
  content.className = "cwie-dialog-grid";

  const previewPane = document.createElement("div");
  previewPane.className = "cwie-preview-pane";

  const previewFrame = document.createElement("div");
  previewFrame.className = "cwie-preview-frame is-fit is-loading";

  const previewImg = document.createElement("img");
  previewImg.className = "cwie-preview-image";
  previewImg.alt = "Export preview";

  const previewLoading = document.createElement("div");
  previewLoading.className = "cwie-preview-loading";
  previewLoading.innerHTML = `
    <div class="cwie-preview-loading-icon" aria-hidden="true"></div>
    <div class="cwie-preview-loading-text">Loading preview…</div>
  `;

  previewFrame.appendChild(previewImg);
  previewFrame.appendChild(previewLoading);
  previewPane.appendChild(previewFrame);

  const controlsPane = document.createElement("div");
  controlsPane.className = "cwie-controls-pane";

  const controlsScroll = document.createElement("div");
  controlsScroll.className = "cwie-controls-scroll";

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
  paddingInput.type = "range";
  paddingInput.min = "0";
  paddingInput.max = "400";
  paddingInput.step = "1";
  paddingInput.className = "cwie-range";

  const paddingValue = document.createElement("span");
  paddingValue.className = "cwie-range-value";
  paddingValue.textContent = "0";

  const paddingWrapper = document.createElement("div");
  paddingWrapper.className = "cwie-range-wrapper";
  paddingWrapper.appendChild(paddingInput);
  paddingWrapper.appendChild(paddingValue);

  const scopeToggle = createToggle();
  const scopeOpacityInput = document.createElement("input");
  scopeOpacityInput.type = "range";
  scopeOpacityInput.min = "0";
  scopeOpacityInput.max = "100";
  scopeOpacityInput.step = "1";
  scopeOpacityInput.className = "cwie-range";

  const scopeOpacityValue = document.createElement("span");
  scopeOpacityValue.className = "cwie-range-value";
  scopeOpacityValue.textContent = "40";

  const scopeOpacityWrapper = document.createElement("div");
  scopeOpacityWrapper.className = "cwie-range-wrapper";
  scopeOpacityWrapper.appendChild(scopeOpacityInput);
  scopeOpacityWrapper.appendChild(scopeOpacityValue);

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

  const pngCompressionInput = document.createElement("input");
  pngCompressionInput.type = "range";
  pngCompressionInput.min = "0";
  pngCompressionInput.max = "9";
  pngCompressionInput.step = "1";
  pngCompressionInput.className = "cwie-range";

  const pngCompressionValue = document.createElement("span");
  pngCompressionValue.className = "cwie-range-value";
  pngCompressionValue.textContent = "6";

  const pngCompressionWrapper = document.createElement("div");
  pngCompressionWrapper.className = "cwie-range-wrapper";
  pngCompressionWrapper.appendChild(pngCompressionInput);
  pngCompressionWrapper.appendChild(pngCompressionValue);

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
      pngCompressionInput.disabled = false;
      return;
    }

    embedToggle.input.checked = false;
    embedToggle.input.disabled = true;
    formatSelect.setDisabled(false);
    pngCompressionInput.disabled = true;

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
    paddingValue.textContent = String(nextState.padding);
    outputResolutionSelect.setValue(nextState.outputResolution);
    pngCompressionInput.value = String(nextState.pngCompression);
    pngCompressionValue.textContent = String(nextState.pngCompression);
    maxLongEdgeInput.value = String(nextState.maxLongEdge);
    exceedSelect.setValue(nextState.exceedMode);
    if (solidColorRow) {
      solidColorRow.classList.toggle("is-hidden", nextState.background !== "solid");
    }
    scopeToggle.input.checked = Boolean(nextState.scopeSelected);
    const opacityValue = Number.isFinite(Number(nextState.scopeOpacity)) ? nextState.scopeOpacity : 40;
    scopeOpacityInput.value = String(opacityValue);
    scopeOpacityValue.textContent = String(opacityValue);
    previewFrame.classList.toggle("is-transparent", nextState.background === "transparent");
    if (debugToggle?.input) {
      debugToggle.input.checked = Boolean(nextState.debug);
    }
  }

  function updateStateFromControls() {
    const prevDebug = Boolean(state.debug);
    const normalized = normalizeSettingsState({
      format: formatSelect.getValue(),
      embedWorkflow: embedToggle.input.checked,
      background: [...backgroundGroup.inputs.values()].find((input) => input.checked)?.value,
      solidColor: solidColorInput.value,
      padding: paddingInput.value,
      outputResolution: outputResolutionSelect.getValue(),
      pngCompression: pngCompressionInput.value,
      maxLongEdge: maxLongEdgeInput.value,
      exceedMode: exceedSelect.getValue(),
    });
    state = {
      ...normalized,
      debug: prevDebug,
      scopeSelected: Boolean(scopeToggle.input.checked),
      scopeOpacity: Number.parseInt(scopeOpacityInput.value, 10) || 0,
    };
  }

  let scopeInitialized = false;

  function updateScopeAvailability(forceDefault = false) {
    const selectedIds = getSelectedNodeIds();
    const hasSelection = selectedIds.length > 0;
    scopeToggle.input.disabled = !hasSelection;
    scopeOpacityInput.disabled = !hasSelection || !scopeToggle.input.checked;
    if (!hasSelection) {
      scopeToggle.input.checked = false;
      scopeOpacityInput.value = "40";
      scopeOpacityValue.textContent = "40";
    } else if ((forceDefault || !scopeInitialized) && state.scopeSelected === false) {
      scopeToggle.input.checked = true;
    }
    scopeInitialized = true;
  }

  let previewUrl = null;
  let previewTimer = null;
  let previewIdle = null;
  let previewBusy = false;
  let previewQueued = false;
  let dialogClosed = false;
  let previewToken = 0;
  let previewPaused = false;

  const cleanupDialog = () => {
    if (dialogClosed) return;
    dialogClosed = true;
    previewToken += 1;
    if (previewTimer) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
    if (previewIdle && "cancelIdleCallback" in window) {
      window.cancelIdleCallback(previewIdle);
      previewIdle = null;
    }
    previewQueued = false;
    previewBusy = false;
    if (previewUrl) {
      try {
        URL.revokeObjectURL(previewUrl);
      } catch (_) {
        // ignore revoke errors
      }
      previewUrl = null;
    }
    if (previewImg) {
      previewImg.src = "";
    }
  };

  activeDialogCleanup = cleanupDialog;

  async function renderPreview() {
    if (dialogClosed) return;
    if (previewPaused) {
      previewQueued = true;
      return;
    }
    if (previewBusy) {
      previewQueued = true;
      return;
    }
    const token = previewToken;
    updateStateFromControls();
    updateScopeAvailability();
    const selectedIds = getSelectedNodeIds();
    const previewState = {
      ...state,
      format: "png",
      embedWorkflow: false,
      outputResolution: "100%",
      maxLongEdge: 0,
      selectedNodeIds: selectedIds,
      previewFast: true,
      previewMaxPixels: PREVIEW_MAX_PIXELS,
    };
    try {
      previewBusy = true;
      previewFrame.classList.add("is-loading");
      const blob = await capture(previewState);
      if (dialogClosed || token !== previewToken) {
        previewFrame.classList.remove("is-loading");
        return;
      }
      if (!blob) {
        previewFrame.classList.remove("is-loading");
        previewBusy = false;
        return;
      }
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      previewUrl = URL.createObjectURL(blob);
      previewImg.src = previewUrl;
    } catch (error) {
      log?.("preview:error", { message: error?.message || String(error) });
      previewFrame.classList.remove("is-loading");
    } finally {
      previewBusy = false;
      if (!dialogClosed && previewQueued) {
        previewQueued = false;
        renderPreview();
      }
    }
  }

  function schedulePreview(delay = 450) {
    if (dialogClosed) return;
    if (previewPaused) {
      previewQueued = true;
      return;
    }
    if (previewTimer) {
      clearTimeout(previewTimer);
    }
    if (previewIdle && "cancelIdleCallback" in window) {
      window.cancelIdleCallback(previewIdle);
      previewIdle = null;
    }
    const run = () => {
      if (!dialogClosed) {
        renderPreview();
      }
    };
    previewTimer = setTimeout(() => {
      previewTimer = null;
      if (dialogClosed) return;
      if ("requestIdleCallback" in window) {
        previewIdle = window.requestIdleCallback(() => {
          previewIdle = null;
          run();
        }, { timeout: 1500 });
        return;
      }
      run();
    }, delay);
  }

  function handleChange() {
    previewToken += 1;
    updateStateFromControls();
    previewFrame.classList.toggle("is-transparent", state.background === "transparent");
    schedulePreview();
  }

  const pausePreview = () => {
    previewPaused = true;
  };

  const resumePreview = (delay = 200) => {
    if (dialogClosed) return;
    if (!previewPaused) return;
    previewPaused = false;
    if (previewQueued) {
      previewQueued = false;
      schedulePreview(delay);
    }
  };

  formatSelect.onChange((value) => {
    syncEmbedAvailability(value);
    handleChange();
  });
  embedToggle.input.addEventListener("change", () => handleChange());
  solidColorInput.addEventListener("input", () => handleChange());
  solidColorInput.addEventListener("change", () => handleChange());
  paddingInput.addEventListener("input", () => {
    paddingValue.textContent = paddingInput.value;
    handleChange();
  });
  outputResolutionSelect.onChange(() => handleChange());
  pngCompressionInput.addEventListener("input", () => {
    pngCompressionValue.textContent = pngCompressionInput.value;
    handleChange();
  });
  maxLongEdgeInput.addEventListener("change", () => handleChange());
  exceedSelect.onChange(() => handleChange());
  scopeToggle.input.addEventListener("change", () => {
    updateScopeAvailability();
    handleChange();
  });
  scopeOpacityInput.addEventListener("input", () => {
    scopeOpacityValue.textContent = scopeOpacityInput.value;
    handleChange();
  });

  for (const input of backgroundGroup.inputs.values()) {
    input.addEventListener("change", () => {
      handleChange();
      solidColorRow.classList.toggle("is-hidden", state.background !== "solid");
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
    state = { ...normalizeSettingsState(DEFAULTS), scopeSelected: false, scopeOpacity: 40 };
    applyStateToControls(state);
    schedulePreview();
  });

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "cwie-button";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", () => closeDialog());

  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.className = "cwie-button primary";
  exportButton.textContent = "";

  const exportSpinner = document.createElement("span");
  exportSpinner.className = "cwie-spinner";
  exportSpinner.setAttribute("aria-hidden", "true");
  const exportLabel = document.createElement("span");
  exportLabel.className = "cwie-button-label";
  exportLabel.textContent = "Export";
  const exportProgressText = document.createElement("span");
  exportProgressText.className = "cwie-button-progress";
  exportProgressText.textContent = "0%";
  exportButton.append(exportSpinner, exportLabel, exportProgressText);

  exportButton.addEventListener("click", async () => {
    exportButton.disabled = true;
    cancelButton.disabled = true;
    exportButton.classList.add("is-busy");
    onExportStarted?.();
    const exportT0 = performance.now();
    const logExportPhase = (label) => {
      if (!state.debug) return;
      const dt = Math.round(performance.now() - exportT0);
      console.log(`[CWIE][Export][perf] ${label} +${dt}ms`);
    };

    const updateExportProgress = (payload) => {
      const value = payload?.value;
      if (!Number.isFinite(value)) {
        exportButton.classList.remove("is-progressing");
        exportProgressText.textContent = "0%";
        return;
      }
      const exportProgressValue = Math.max(0, Math.min(1, value));
      const percent = Number.isFinite(payload?.percent)
        ? payload.percent
        : Math.round(exportProgressValue * 100);
      exportButton.classList.add("is-progressing");
      exportProgressText.textContent = `${percent}%`;
    };

    updateStateFromControls();
    updateScopeAvailability();
    const expectsTiling = state.exceedMode === "tile";
    if (expectsTiling) {
      exportButton.classList.add("is-progressing");
      exportProgressText.textContent = "0%";
    }
    // Allow the busy spinner/progress to paint before heavy export work.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    logExportPhase("ui.ready");
    let messageDialogPayload = null;
    try {
      logExportPhase("capture.start");
      const blob = await capture({
        ...state,
        onProgress: updateExportProgress,
      });
      logExportPhase("capture.done");
      setDefaultsInSettings(state);
      logExportPhase("download.start");
      await triggerDownload({
        blob,
        filename: `workflow.${state.format || "png"}`,
      });
      logExportPhase("download.done");
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
      exportButton.classList.remove("is-progressing");
      exportProgressText.textContent = "0%";
      exportButton.classList.remove("is-busy");
      onExportFinished?.();
      closeDialog();
      logExportPhase("dialog.closed");
      setTimeout(() => logExportPhase("post.0ms"), 0);
      setTimeout(() => logExportPhase("post.250ms"), 250);
      setTimeout(() => logExportPhase("post.1000ms"), 1000);
      setTimeout(() => logExportPhase("post.2000ms"), 2000);
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

  controlsScroll.appendChild(basicTitle);
  controlsScroll.appendChild(createRow("Format", formatSelect.root));
  controlsScroll.appendChild(createRow("Embed workflow", embedToggle.wrapper));
  controlsScroll.appendChild(embedNote);
  controlsScroll.appendChild(createRow("Background", backgroundGroup.group));

  solidColorRow = createRow("Solid color", solidColorInput);
  controlsScroll.appendChild(solidColorRow);
  controlsScroll.appendChild(createRow("Padding", paddingWrapper));
  controlsScroll.appendChild(createRow("Scope", scopeToggle.wrapper));
  controlsScroll.appendChild(createRow("Opacity", scopeOpacityWrapper));

  advancedBody.appendChild(createRow("Output resolution", outputResolutionSelect.root));
  advancedBody.appendChild(createRow("PNG Compression", pngCompressionWrapper));
  advancedBody.appendChild(createRow("Max long edge", maxLongEdgeInput));
  advancedBody.appendChild(createRow("If exceeded", exceedSelect.root));

  // Debug Toggle
  const debugToggle = createToggle();
  debugToggle.input.checked = Boolean(state.debug);
  debugToggle.input.addEventListener("change", () => {
    state.debug = Boolean(debugToggle.input.checked);
    if (window.__cwie__) {
      window.__cwie__.setDebug(state.debug);
    }
  });
  advancedBody.appendChild(createRow("Enable Debug Log", debugToggle.wrapper));

  advancedHeader.appendChild(advancedTitle);
  advancedHeader.appendChild(advancedToggle);
  advancedSection.appendChild(advancedHeader);
  advancedSection.appendChild(advancedBody);

  controlsScroll.appendChild(advancedSection);
  controlsPane.appendChild(controlsScroll);
  controlsPane.appendChild(footer);

  content.appendChild(previewPane);
  content.appendChild(controlsPane);

  dialog.appendChild(title);
  dialog.appendChild(content);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  activeDialog = backdrop;

  applyStateToControls(state);
  updateScopeAvailability(true);
  previewFrame.classList.toggle("is-transparent", state.background === "transparent");
  solidColorRow.classList.toggle("is-hidden", state.background !== "solid");
  // Defer first preview so the dialog paints immediately.
  setTimeout(() => {
    if (!dialogClosed) {
      schedulePreview(0);
    }
  }, 0);

  previewImg.addEventListener("load", () => {
    if (!dialogClosed) {
      previewFrame.classList.remove("is-loading");
    }
  });

  controlsPane.addEventListener("pointerdown", pausePreview);
  controlsPane.addEventListener("pointerup", () => resumePreview(150));
  controlsPane.addEventListener("pointercancel", () => resumePreview(150));
}
