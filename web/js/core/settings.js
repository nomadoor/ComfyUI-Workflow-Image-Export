import { app } from "/scripts/app.js";
import { getSettingsAccess } from "./detect.js";

export const SETTING_IDS = {
  format: "WorkflowImageExport.DefaultFormat",
  embedWorkflow: "WorkflowImageExport.EmbedWorkflow",
  background: "WorkflowImageExport.Background",
  solidColor: "WorkflowImageExport.SolidColor",
  nodeOpacity: "WorkflowImageExport.NodeOpacity",
  padding: "WorkflowImageExport.Padding",
  outputResolution: "WorkflowImageExport.OutputResolution",
  maxLongEdge: "WorkflowImageExport.MaxLongEdge",
  exceedMode: "WorkflowImageExport.ExceedMode",
  pngCompression: "WorkflowImageExport.PngCompression",
};

export const DEFAULTS = {
  format: "png",
  embedWorkflow: true,
  background: "ui",
  solidColor: "#1f1f1f",
  nodeOpacity: 100,
  padding: 100,
  outputResolution: "auto",
  maxLongEdge: 4096,
  exceedMode: "tile",
  pngCompression: 7,
};

const CAT = "Workflow Image Export";
const BASIC = "0. Basic";
const ADV = "1. Advanced";
const cat = (section, label) => [CAT, section, label];

const SETTINGS_DEFINITIONS = [
  // Advanced (define in reverse to match UI order)
  {
    id: SETTING_IDS.exceedMode,
    name: "If exceeded",
    category: cat(ADV, "If exceeded"),
    type: "combo",
    options: [
      { text: "Downscale", value: "downscale" },
      { text: "Tile", value: "tile" },
    ],
    defaultValue: "downscale",
    tooltip: "Behavior when max long edge is exceeded.",
  },
  {
    id: SETTING_IDS.maxLongEdge,
    name: "Max long edge (px)",
    category: cat(ADV, "Max long edge (px)"),
    type: "number",
    defaultValue: DEFAULTS.maxLongEdge,
    attrs: {
      min: 0,
      step: 1,
    },
    tooltip: "Maximum long edge before downscale/tile is applied.",
  },
  {
    id: SETTING_IDS.outputResolution,
    name: "Output resolution",
    category: cat(ADV, "Output resolution"),
    type: "combo",
    options: [
      { text: "Auto", value: "auto" },
      { text: "100%", value: "100%" },
      { text: "200%", value: "200%" },
    ],
    defaultValue: "auto",
    tooltip: "Scale the export resolution.",
  },
  {
    id: SETTING_IDS.pngCompression,
    name: "PNG compression",
    category: cat(ADV, "PNG compression"),
    type: "number",
    defaultValue: DEFAULTS.pngCompression,
    attrs: {
      min: 0,
      max: 9,
      step: 1,
    },
    tooltip: "PNG compression level (0 = fastest, 9 = smallest).",
  },
  // Basic (define in reverse to match UI order)
  {
    id: SETTING_IDS.nodeOpacity,
    name: "Node opacity (%)",
    category: cat(BASIC, "Node opacity (%)"),
    type: "number",
    defaultValue: DEFAULTS.nodeOpacity,
    attrs: {
      min: 0,
      max: 100,
      step: 1,
    },
    tooltip: "Background opacity for nodes in the exported image (100 = fully opaque).",
  },
  {
    id: SETTING_IDS.padding,
    name: "Padding (px)",
    category: cat(BASIC, "Padding (px)"),
    type: "number",
    defaultValue: DEFAULTS.padding,
    attrs: {
      min: 0,
      step: 1,
    },
    tooltip: "Extra padding around the captured bounds.",
  },
  {
    id: SETTING_IDS.solidColor,
    name: "Solid color",
    category: cat(BASIC, "Solid color"),
    type: "text",
    defaultValue: DEFAULTS.solidColor,
    attrs: {
      type: "color",
    },
    tooltip: "Used when background is set to Solid.",
  },
  {
    id: SETTING_IDS.background,
    name: "Background",
    category: cat(BASIC, "Background"),
    type: "combo",
    options: [
      { text: "UI", value: "ui" },
      { text: "Transparent", value: "transparent" },
      { text: "Solid", value: "solid" },
    ],
    defaultValue: "ui",
    tooltip: "Background style for export.",
  },
  {
    id: SETTING_IDS.embedWorkflow,
    name: "Embed workflow",
    category: cat(BASIC, "Embed workflow"),
    type: "boolean",
    defaultValue: true,
    tooltip: "Embed workflow JSON into the exported file when supported.",
  },
  {
    id: SETTING_IDS.format,
    name: "Default format",
    category: cat(BASIC, "Default format"),
    type: "combo",
    options: [
      { text: "PNG", value: "png" },
      { text: "WebP", value: "webp" },
    ],
    defaultValue: "png",
    tooltip: "Output format used when opening the export dialog.",
  },
];

let legacyRegistered = false;

export function getSettingsDefinitions() {
  return SETTINGS_DEFINITIONS;
}

export function registerLegacySettings(log) {
  const access = getSettingsAccess(app);
  if (!access || access.type !== "legacy" || legacyRegistered) {
    return;
  }
  if (typeof access.addSetting !== "function") {
    return;
  }
  for (const definition of SETTINGS_DEFINITIONS) {
    try {
      access.addSetting(definition);
    } catch (error) {
      log?.("legacy settings add failed", definition.id, error);
    }
  }
  legacyRegistered = true;
  log?.("legacy settings registered");
}

function normalizeFormat(value) {
  const v = String(value ?? "").toLowerCase();
  if (["png", "webp", "svg"].includes(v)) {
    return v;
  }
  if (v === "png" || v === "webp" || v === "svg") {
    return v;
  }
  return DEFAULTS.format;
}

function normalizeBackground(value) {
  const v = String(value ?? "").toLowerCase();
  if (["ui", "transparent", "solid"].includes(v)) {
    return v;
  }
  return DEFAULTS.background;
}

function normalizeResolution(value) {
  const v = String(value ?? "").toLowerCase();
  if (v === "auto" || v === "100%" || v === "200%") {
    return v;
  }
  return DEFAULTS.outputResolution;
}

function normalizeExceedMode(value) {
  const v = String(value ?? "").toLowerCase();
  if (v === "downscale" || v === "tile") {
    return v;
  }
  return DEFAULTS.exceedMode;
}

function normalizeNumber(value, fallback) {
  const num = Number.parseInt(value, 10);
  if (Number.isFinite(num) && num >= 0) {
    return num;
  }
  return fallback;
}

function normalizePngCompression(value) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return DEFAULTS.pngCompression;
  return Math.min(9, Math.max(0, num));
}

export function normalizeState(raw) {
  return {
    format: normalizeFormat(raw?.format),
    embedWorkflow: Boolean(raw?.embedWorkflow),
    background: normalizeBackground(raw?.background),
    solidColor: typeof raw?.solidColor === "string" ? raw.solidColor : DEFAULTS.solidColor,
    nodeOpacity: normalizeNumber(raw?.nodeOpacity, DEFAULTS.nodeOpacity),
    padding: normalizeNumber(raw?.padding, DEFAULTS.padding),
    outputResolution: normalizeResolution(raw?.outputResolution),
    maxLongEdge: normalizeNumber(raw?.maxLongEdge, DEFAULTS.maxLongEdge),
    exceedMode: normalizeExceedMode(raw?.exceedMode),
    pngCompression: normalizePngCompression(raw?.pngCompression),
  };
}

export function getDefaultsFromSettings() {
  const access = getSettingsAccess(app);
  if (!access) {
    return { ...DEFAULTS };
  }

  const get = access.get;
  if (typeof get !== "function") {
    return { ...DEFAULTS };
  }

  const raw = {
    format: get(SETTING_IDS.format, DEFAULTS.format),
    embedWorkflow: get(SETTING_IDS.embedWorkflow, DEFAULTS.embedWorkflow),
    background: get(SETTING_IDS.background, DEFAULTS.background),
    solidColor: get(SETTING_IDS.solidColor, DEFAULTS.solidColor),
    nodeOpacity: get(SETTING_IDS.nodeOpacity, DEFAULTS.nodeOpacity),
    padding: get(SETTING_IDS.padding, DEFAULTS.padding),
    outputResolution: get(SETTING_IDS.outputResolution, DEFAULTS.outputResolution),
    maxLongEdge: get(SETTING_IDS.maxLongEdge, DEFAULTS.maxLongEdge),
    exceedMode: get(SETTING_IDS.exceedMode, DEFAULTS.exceedMode),
    pngCompression: get(SETTING_IDS.pngCompression, DEFAULTS.pngCompression),
  };

  return normalizeState(raw);
}

function toSettingFormat(state) {
  // Store the option "value" (not the display label) so the combo keeps showing a selection.
  return {
    format: state.format,
    embedWorkflow: Boolean(state.embedWorkflow),
    background: state.background,
    solidColor: state.solidColor,
    nodeOpacity: state.nodeOpacity,
    padding: state.padding,
    outputResolution: state.outputResolution,
    maxLongEdge: state.maxLongEdge,
    exceedMode: state.exceedMode,
    pngCompression: state.pngCompression,
  };
}

export function setDefaultsInSettings(state) {
  const access = getSettingsAccess(app);
  if (!access || typeof access.set !== "function") {
    return false;
  }
  const values = toSettingFormat(normalizeState(state));
  access.set(SETTING_IDS.format, values.format);
  access.set(SETTING_IDS.embedWorkflow, values.embedWorkflow);
  access.set(SETTING_IDS.background, values.background);
  access.set(SETTING_IDS.solidColor, values.solidColor);
  access.set(SETTING_IDS.nodeOpacity, values.nodeOpacity);
  access.set(SETTING_IDS.padding, values.padding);
  access.set(SETTING_IDS.outputResolution, values.outputResolution);
  access.set(SETTING_IDS.maxLongEdge, values.maxLongEdge);
  access.set(SETTING_IDS.exceedMode, values.exceedMode);
  access.set(SETTING_IDS.pngCompression, values.pngCompression);
  return true;
}

// Reset button removed per UX decision.
