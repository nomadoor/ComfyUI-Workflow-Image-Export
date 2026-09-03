const RENDER_SETTING_KEYS = [
  "render_background",
  "clear_background",
  "clear_background_color",
  "background_image",
  "show_grid",
  "bgcolor",
  "background_color",
  "grid_size",
  "link_color",
  "link_shadow_color",
  "link_brightness",
  "default_link_color",
  "link_type",
  "links_render_mode",
  "render_connections_border",
  "render_connections_shadows",
  "render_curved_connections",
  "always_render_background",
  "use_slot_types_default_colors",
  "use_slot_types_color",
  "NODE_WIDGET_COLOR",
  "NODE_TEXT_COLOR",
  "NODE_DEFAULT_COLOR",
  "NODE_SELECTED_COLOR",
  "NODE_BOX_OUTLINE_COLOR",
  "NODE_TITLE_COLOR",
  "NODE_TEXT_SIZE",
  "NODE_SLOT_RGB",
];

export function copyRenderSettings(fromCanvas, toCanvas) {
  if (!fromCanvas || !toCanvas) return;
  const renderKeys = [...RENDER_SETTING_KEYS];

  for (const key in fromCanvas) {
    if (
      key.startsWith("NODE_") ||
      key.startsWith("link_") ||
      key.startsWith("render_") ||
      key.startsWith("use_slot_") ||
      key.startsWith("default_")
    ) {
      if (!renderKeys.includes(key)) {
        renderKeys.push(key);
      }
    }
  }

  renderKeys.forEach((key) => {
    if (fromCanvas[key] !== undefined) {
      toCanvas[key] = fromCanvas[key];
    } else if (fromCanvas.constructor && fromCanvas.constructor[key] !== undefined) {
      toCanvas[key] = fromCanvas.constructor[key];
    }
  });
}
