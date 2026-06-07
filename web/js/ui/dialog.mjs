import { app } from "/scripts/app.js";
import {
  capture,
  detectBackendType,
  isNode2UnsupportedError,
  isWebpHugeUnsupportedError,
} from "../core/capture/index.mjs";
import { captureLegacy } from "../core/backends/legacy_capture.mjs";
import { triggerDownload } from "../core/download.mjs";
import { computeGraphBBox } from "../export/bbox.mjs";
import { embedWorkflowInPngBlob } from "../export/png_embed_workflow.mjs";
import { loadLastUsed, saveLastUsed } from "../core/storage.mjs";
import {
  getSelectedNodeIdsFromApp,
  getWorkflowJsonTextFromApp,
} from "../core/workflow_state.mjs";
import { toBlobAsync } from "../core/utils.mjs";
import {
  DEFAULTS,
  getDefaultsFromSettings,
  normalizeState as normalizeSettingsState,
  setDefaultsInSettings,
} from "../core/settings.mjs";
import { buildInitialState, toLastUsedState } from "./state.mjs";
import {
  buildPreviewState as buildPreviewStateForDialog,
  getPreviewMime,
  getPreviewStateKey,
} from "./preview_state.mjs";
import {
  resolveBlobExtension,
  resolveWorkflowName,
} from "./export_filename.mjs";
import {
  evaluateWebpAvailability,
  getOutputResolutionScale,
} from "./webp_availability.mjs";
import {
  createCaretIcon,
  createRadioGroup,
  createRow,
  createSelect,
  createToggle,
} from "./elements.mjs";

let activeDialog = null;
let activeMessageDialog = null;
let activeDialogCleanup = null;

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

function isDebugEnabled() {
  return !!window.__cwie__?.debug;
}

function getSelectedNodeIds() {
  return getSelectedNodeIdsFromApp(app);
}

export function openExportDialog({ onExportStarted, onExportFinished, log } = {}) {
  if (activeDialog) {
    return;
  }

  ensureStyles();

  const backendType = detectBackendType();
  const isNode2Backend = backendType === "node2";

  let state = buildInitialState({
    defaults: getDefaultsFromSettings(),
    lastUsed: loadLastUsed(),
    debugEnabled: isDebugEnabled(),
  });
  if (isNode2Backend && state.background === "transparent") {
    state = { ...state, background: "ui" };
  }

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

  const previewCanvas = document.createElement("canvas");
  previewCanvas.className = "cwie-preview-canvas";
  previewCanvas.setAttribute("aria-label", "Export preview");
  previewCanvas.width = 0;
  previewCanvas.height = 0;

  const previewLoading = document.createElement("div");
  previewLoading.className = "cwie-preview-loading";
  previewLoading.innerHTML = `
    <div class="cwie-preview-loading-icon" aria-hidden="true"></div>
    <div class="cwie-preview-loading-text">Loading preview…</div>
  `;

  previewFrame.appendChild(previewImg);
  previewFrame.appendChild(previewCanvas);
  previewFrame.appendChild(previewLoading);
  previewPane.appendChild(previewFrame);

  const controlsPane = document.createElement("div");
  controlsPane.className = "cwie-controls-pane";

  const controlsScroll = document.createElement("div");
  controlsScroll.className = "cwie-controls-scroll";

  const basicTitle = document.createElement("div");
  basicTitle.className = "cwie-section-title";
  basicTitle.textContent = "Basic";

  const backendNote = document.createElement("div");
  backendNote.className = "cwie-note";
  backendNote.textContent = isNode2Backend
    ? "Node 2.0 export captures the visible graph view when you press Export."
    : "";

  const formatSelect = createSelect("format", [
    { value: "png", label: "PNG" },
    { value: "webp", label: "WebP" },
  ]);

  const embedToggle = createToggle();
  const embedNote = document.createElement("div");
  embedNote.className = "cwie-note";
  const webpNote = document.createElement("div");
  webpNote.className = "cwie-note";

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

  const nodeOpacityInput = document.createElement("input");
  nodeOpacityInput.type = "range";
  nodeOpacityInput.min = "0";
  nodeOpacityInput.max = "100";
  nodeOpacityInput.step = "1";
  nodeOpacityInput.className = "cwie-range";

  const nodeOpacityValue = document.createElement("span");
  nodeOpacityValue.className = "cwie-range-value";
  nodeOpacityValue.textContent = "100";

  const nodeOpacityWrapper = document.createElement("div");
  nodeOpacityWrapper.className = "cwie-range-wrapper";
  nodeOpacityWrapper.appendChild(nodeOpacityInput);
  nodeOpacityWrapper.appendChild(nodeOpacityValue);

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
      webpNote.textContent = "";
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

  let webpBlocked = false;
  let webpCheckToken = 0;
  let webpCheckTimer = null;
  let webpCheckIdle = null;

  async function checkWebpAvailability() {
    const token = ++webpCheckToken;
    const formatValue = String(state.format || "png").toLowerCase();
    if (formatValue !== "webp") {
      webpBlocked = false;
      webpNote.textContent = "";
      if (exportButton) exportButton.disabled = false;
      return;
    }

    if (exportButton) exportButton.disabled = true;
    webpNote.textContent = "Checking WebP size…";

    const graph = app?.graph;
    if (!graph) {
      webpBlocked = false;
      webpNote.textContent = "";
      if (exportButton) exportButton.disabled = false;
      return;
    }

    try {
      const bbox = computeGraphBBox(graph, {
        padding: state.padding,
        selectedNodeIds: getSelectedNodeIds(),
        useSelectionOnly: Boolean(state.scopeSelected),
      });
      if (token !== webpCheckToken) return;
      const result = evaluateWebpAvailability({
        format: formatValue,
        bbox,
        scale: getOutputResolutionScale(state.outputResolution),
      });
      webpBlocked = result.blocked;
      webpNote.textContent = result.message;
      if (exportButton) exportButton.disabled = webpBlocked;
    } catch (error) {
      if (token !== webpCheckToken) return;
      webpBlocked = false;
      webpNote.textContent = "";
      if (exportButton) exportButton.disabled = false;
      log?.("webp:check.error", { message: error?.message || String(error) });
    }
  }

  function scheduleWebpCheck(delay = 350) {
    if (dialogClosed) return;
    if (webpCheckTimer) {
      clearTimeout(webpCheckTimer);
    }
    if (webpCheckIdle && "cancelIdleCallback" in window) {
      window.cancelIdleCallback(webpCheckIdle);
      webpCheckIdle = null;
    }
    const run = () => {
      if (!dialogClosed) {
        checkWebpAvailability();
      }
    };
    webpCheckTimer = setTimeout(() => {
      webpCheckTimer = null;
      if (dialogClosed) return;
      if ("requestIdleCallback" in window) {
        webpCheckIdle = window.requestIdleCallback(() => {
          webpCheckIdle = null;
          run();
        }, { timeout: 1500 });
        return;
      }
      run();
    }, delay);
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
    const nodeOpacity = Number.isFinite(Number(nextState.nodeOpacity)) ? nextState.nodeOpacity : 100;
    nodeOpacityInput.value = String(nodeOpacity);
    nodeOpacityValue.textContent = String(nodeOpacity);
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
    if (isNode2Backend) {
      paddingInput.disabled = true;
      nodeOpacityInput.disabled = true;
      scopeToggle.input.disabled = true;
      scopeOpacityInput.disabled = true;
      exceedSelect.setDisabled(true);
      const transparentInput = backgroundGroup.inputs.get("transparent");
      if (transparentInput) transparentInput.disabled = true;
      if (nextState.background === "transparent") {
        const uiInput = backgroundGroup.inputs.get("ui");
        if (uiInput) uiInput.checked = true;
      }
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
      nodeOpacity: nodeOpacityInput.value,
      pngCompression: pngCompressionInput.value,
      maxLongEdge: maxLongEdgeInput.value,
      exceedMode: exceedSelect.getValue(),
    });
    state = {
      ...normalized,
      background: isNode2Backend && normalized.background === "transparent"
        ? "ui"
        : normalized.background,
      debug: prevDebug,
      scopeSelected: Boolean(scopeToggle.input.checked),
      scopeOpacity: Number.parseInt(scopeOpacityInput.value, 10) || 0,
    };
  }

  let scopeInitialized = false;

  function updateScopeAvailability(forceDefault = false) {
    if (isNode2Backend) {
      scopeToggle.input.checked = false;
      scopeToggle.input.disabled = true;
      scopeOpacityInput.disabled = true;
      scopeOpacityInput.value = "40";
      scopeOpacityValue.textContent = "40";
      scopeInitialized = true;
      return;
    }
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
  let previewSnapshot = null;
  let previewTimer = null;
  let previewIdle = null;
  let previewBusy = false;
  let previewQueued = false;
  let dialogClosed = false;
  let previewToken = 0;
  let previewPaused = false;

  function buildPreviewState() {
    return buildPreviewStateForDialog({
      state,
      selectedNodeIds: getSelectedNodeIds(),
      workflowJsonText: getWorkflowJsonText(),
    });
  }

  function getWorkflowJsonText() {
    return getWorkflowJsonTextFromApp(app);
  }

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
    previewSnapshot = null;
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
    if (previewCanvas) {
      previewCanvas.width = 0;
      previewCanvas.height = 0;
    }
  };

  activeDialogCleanup = cleanupDialog;

  function drawPreviewCanvas(sourceCanvas) {
    if (!sourceCanvas?.width || !sourceCanvas?.height) return false;
    previewCanvas.width = sourceCanvas.width;
    previewCanvas.height = sourceCanvas.height;
    const ctx = previewCanvas.getContext("2d", { alpha: true });
    if (!ctx) return false;
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    ctx.drawImage(sourceCanvas, 0, 0);
    if (previewImg.src) {
      previewImg.src = "";
    }
    previewFrame.classList.remove("is-loading");
    return true;
  }

  async function encodePreviewSnapshot(snapshot, fallbackState = null) {
    if (!snapshot) return null;
    if (snapshot.blob) return snapshot.blob;
    if (!snapshot.canvas) return null;
    const mime = snapshot.mime || (fallbackState?.format === "webp" ? "image/webp" : "image/png");
    const encoded = await toBlobAsync(snapshot.canvas, mime);
    snapshot.blob = encoded;
    return encoded;
  }

  async function renderPreview(previewStateOverride = null, options = {}) {
    if (dialogClosed) return;
    if (isNode2Backend) {
      previewFrame.classList.remove("is-loading");
      return null;
    }
    if (previewPaused && !options.force) {
      previewQueued = true;
      return;
    }
    if (previewBusy && !options.force) {
      previewQueued = true;
      return;
    }
    const token = previewToken;
    if (!previewStateOverride) {
      updateScopeAvailability();
      updateStateFromControls();
    }
    const previewState = previewStateOverride || buildPreviewState();
    const previewKey = getPreviewStateKey(previewState);
    try {
      previewBusy = true;
      previewFrame.classList.add("is-loading");
      const previewResult = await captureLegacy({
        ...previewState,
        skipWidgetCapture: true,
        deferBlob: true,
      });
      const blob = previewResult?.blob || null;
      const canvas = previewResult?.canvas || null;
      if (dialogClosed || token !== previewToken) {
        previewFrame.classList.remove("is-loading");
        return;
      }
      if (!blob && !canvas) {
        previewFrame.classList.remove("is-loading");
        previewBusy = false;
        return;
      }
      previewSnapshot = {
        blob,
        canvas,
        key: previewKey,
        mime: previewResult?.mime || getPreviewMime(previewState),
        state: previewState,
      };
      if (canvas && drawPreviewCanvas(canvas)) {
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
          previewUrl = null;
        }
        return previewSnapshot;
      }
      const displayBlob = blob || await encodePreviewSnapshot(previewSnapshot, previewState);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      previewUrl = URL.createObjectURL(displayBlob);
      previewImg.src = previewUrl;
      return previewSnapshot;
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
    if (isNode2Backend) return;
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
    scheduleWebpCheck();
  });
  embedToggle.input.addEventListener("change", () => handleChange());
  solidColorInput.addEventListener("input", () => handleChange());
  solidColorInput.addEventListener("change", () => handleChange());
  paddingInput.addEventListener("input", () => {
    paddingValue.textContent = paddingInput.value;
    handleChange();
  });
  nodeOpacityInput.addEventListener("input", () => {
    nodeOpacityValue.textContent = nodeOpacityInput.value;
    handleChange();
  });
  paddingInput.addEventListener("change", () => scheduleWebpCheck());
  pngCompressionInput.addEventListener("input", () => {
    pngCompressionValue.textContent = pngCompressionInput.value;
    handleChange();
  });
  maxLongEdgeInput.addEventListener("change", () => {
    handleChange();
    scheduleWebpCheck();
  });
  exceedSelect.onChange(() => {
    handleChange();
    scheduleWebpCheck();
  });
  scopeToggle.input.addEventListener("change", () => {
    updateScopeAvailability();
    handleChange();
    scheduleWebpCheck();
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
    if (webpBlocked) {
      openMessageDialog({
        title: "WebP not supported for huge exports",
        message: "WebP export is disabled for huge/tiled renders. Please use PNG or reduce the export size.",
      });
      return;
    }
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

    updateScopeAvailability();
    updateStateFromControls();
    const isRasterExport = state.format === "png" || state.format === "webp";
    const expectsTiling = !isRasterExport && state.exceedMode === "tile";
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
      let blob;
      if (isNode2Backend) {
        logExportPhase("capture.node2.start");
        blob = await capture({
          ...state,
          background: state.background === "transparent" ? "ui" : state.background,
          padding: 0,
          nodeOpacity: 100,
          scopeSelected: false,
          exceedMode: "downscale",
          onProgress: updateExportProgress,
        });
        logExportPhase("capture.node2.done");
      } else if (state.format === "png" || state.format === "webp") {
        const previewState = buildPreviewState();
        const previewKey = getPreviewStateKey(previewState);
        logExportPhase("preview.capture.start");
        const snapshot =
          previewSnapshot?.key === previewKey
            ? previewSnapshot
            : await renderPreview(previewState, { force: true });
        blob = await encodePreviewSnapshot(snapshot, previewState);
        logExportPhase("preview.capture.done");
        if (!blob) {
          throw new Error("Export failed: preview blob unavailable.");
        }
        if (state.format === "png" && state.embedWorkflow) {
          const workflowJson =
            previewSnapshot?.key === previewKey
              ? previewSnapshot.state?.workflowJsonText
              : previewState.workflowJsonText || getWorkflowJsonText();
          if (workflowJson) {
            logExportPhase("embed.workflow.start");
            blob = await embedWorkflowInPngBlob(blob, workflowJson);
            logExportPhase("embed.workflow.done");
          }
        }
      } else {
        logExportPhase("capture.start");
        blob = await capture({
          ...state,
          onProgress: updateExportProgress,
        });
        logExportPhase("capture.done");
      }
      setDefaultsInSettings(state);
      try {
        saveLastUsed(toLastUsedState(state));
      } catch (error) {
        log?.("export:saveLastUsed.error", {
          message: error?.message || String(error),
        });
      }
      logExportPhase("download.start");
      const ext = resolveBlobExtension(blob, state.format || "png");
      const baseName = resolveWorkflowName({
        graph: app?.graph,
        documentTitle: document?.title || "",
      });
      await triggerDownload({
        blob,
        filename: `${baseName}.${ext}`,
      });
      logExportPhase("download.done");
    } catch (error) {
      if (isNode2UnsupportedError(error)) {
        messageDialogPayload = {
          title: "Node2.0 Unsupported",
          message: "Node2.0 is not supported yet.",
        };
      } else if (isWebpHugeUnsupportedError(error)) {
        messageDialogPayload = {
          title: "WebP not supported for huge exports",
          message:
            "WebP export is disabled for huge/tiled renders. Please use PNG or reduce the export size.",
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
  footer.appendChild(webpNote);

  controlsScroll.appendChild(basicTitle);
  if (backendNote.textContent) {
    controlsScroll.appendChild(backendNote);
  }
  controlsScroll.appendChild(createRow("Format", formatSelect.root));
  controlsScroll.appendChild(createRow("Embed workflow", embedToggle.wrapper));
  controlsScroll.appendChild(embedNote);
  controlsScroll.appendChild(createRow("Background", backgroundGroup.group));

  solidColorRow = createRow("Solid color", solidColorInput);
  controlsScroll.appendChild(solidColorRow);
  controlsScroll.appendChild(
    createRow("Node opacity", nodeOpacityWrapper, {
      helpText: "Controls node background opacity in exports.",
    })
  );
  controlsScroll.appendChild(createRow("Padding", paddingWrapper));
  controlsScroll.appendChild(createRow("Scope", scopeToggle.wrapper));
  controlsScroll.appendChild(
    createRow("Scope opacity", scopeOpacityWrapper, {
      helpText: "Opacity for non-selected nodes when Scope is enabled.",
    })
  );

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
  if (isNode2Backend) {
    previewFrame.classList.remove("is-loading");
    previewFrame.classList.add("is-message");
    previewLoading.querySelector(".cwie-preview-loading-text").textContent =
      "Node 2.0 capture runs on export.";
  }
  // Defer first preview so the dialog paints immediately.
  setTimeout(() => {
    if (!dialogClosed && !isNode2Backend) {
      schedulePreview(0);
    }
  }, 0);
  setTimeout(() => {
    if (!dialogClosed) {
      scheduleWebpCheck(0);
    }
  }, 0);

  previewImg.addEventListener("load", () => {
    if (!dialogClosed) {
      previewFrame.classList.remove("is-loading");
    }
  });

  const previewCaptureIds = new Set();
  const shouldCapturePointer = (event) => {
    const target = event?.target;
    if (!(target instanceof Element)) return true;
    return !target.closest(
      "button, input, select, textarea, label, summary, details, .cwie-button, .cwie-select, .cwie-select-option"
    );
  };
  controlsPane.addEventListener("pointerdown", (event) => {
    if (shouldCapturePointer(event) && controlsPane.setPointerCapture) {
      try {
        controlsPane.setPointerCapture(event.pointerId);
        previewCaptureIds.add(event.pointerId);
      } catch (_) {
        // ignore capture failures
      }
    }
    pausePreview();
  });
  controlsPane.addEventListener("pointerup", (event) => {
    if (previewCaptureIds.has(event.pointerId) && controlsPane.releasePointerCapture) {
      try {
        controlsPane.releasePointerCapture(event.pointerId);
      } catch (_) {
        // ignore release failures
      }
      previewCaptureIds.delete(event.pointerId);
    }
    resumePreview(150);
  });
  controlsPane.addEventListener("pointercancel", (event) => {
    if (previewCaptureIds.has(event.pointerId) && controlsPane.releasePointerCapture) {
      try {
        controlsPane.releasePointerCapture(event.pointerId);
      } catch (_) {
        // ignore release failures
      }
      previewCaptureIds.delete(event.pointerId);
    }
    resumePreview(150);
  });
}
