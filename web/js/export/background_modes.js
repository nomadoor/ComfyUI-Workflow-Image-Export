const UI_BG_VARS = [
  "--comfy-background",
  "--comfy-workspace-bg",
  "--background-color",
  "--bg-color",
];

export const DEFAULT_SOLID_COLOR = "#1e1e1e";
export const EXTRACT_BG_1 = "#ff00ff";
export const EXTRACT_BG_2 = "#00ff00";

function readCssVar(target, name) {
  if (!target) return "";
  const value = window.getComputedStyle(target).getPropertyValue(name);
  return value ? value.trim() : "";
}

export function resolveUiBackgroundColor(fallback = DEFAULT_SOLID_COLOR) {
  const root = document.documentElement;
  const body = document.body;
  for (const name of UI_BG_VARS) {
    const value = readCssVar(root, name) || readCssVar(body, name);
    if (value) return value;
  }
  const bodyStyle = body ? window.getComputedStyle(body) : null;
  return bodyStyle?.backgroundColor || fallback;
}

export function resolveSolidBackgroundColor(options = {}) {
  return options.backgroundColor || DEFAULT_SOLID_COLOR;
}

function setIfPresent(target, key, value) {
  if (!target) return;
  try {
    if (key in target) {
      target[key] = value;
    }
  } catch (_) {
    // ignore read-only props
  }
}

export function applyBackgroundMode(offscreen, options = {}) {
  const mode = options.backgroundMode || "ui";
  const includeGrid = options.includeGrid !== false;

  if (includeGrid === false) {
    setIfPresent(offscreen, "show_grid", false);
  } else {
    setIfPresent(offscreen, "show_grid", true);
  }
  setIfPresent(offscreen, "render_background", true);

  setIfPresent(offscreen, "clear_background", true);
  // Preserve background_image in UI mode so any UI grid/pattern remains visible.
  if (!(mode === "ui" && includeGrid)) {
    setIfPresent(offscreen, "background_image", null);
  }

  if (mode === "transparent") {
    setIfPresent(offscreen, "clear_background_color", "rgba(0, 0, 0, 0)");
    setIfPresent(offscreen, "bgcolor", "rgba(0, 0, 0, 0)");
    setIfPresent(offscreen, "background_color", "rgba(0, 0, 0, 0)");
  } else if (mode === "solid") {
    const solid = resolveSolidBackgroundColor(options);
    setIfPresent(offscreen, "clear_background_color", solid);
    setIfPresent(offscreen, "bgcolor", solid);
    setIfPresent(offscreen, "background_color", solid);
  } else if (mode === "ui") {
    const uiColor = resolveUiBackgroundColor();
    setIfPresent(offscreen, "clear_background_color", uiColor);
    setIfPresent(offscreen, "bgcolor", uiColor);
    setIfPresent(offscreen, "background_color", uiColor);
  }

  if (offscreen && "_pattern" in offscreen) {
    offscreen._pattern = null;
  }

  return mode;
}

export function getExportBackgroundFillColor(options = {}) {
  const mode = options.backgroundMode || "ui";
  if (mode === "transparent") {
    return null;
  }
  if (mode === "solid") {
    return resolveSolidBackgroundColor(options);
  }
  // ui mode
  return resolveUiBackgroundColor();
}
