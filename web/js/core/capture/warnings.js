function normalizeWarnings(warnings) {
  return Array.from(new Set(
    (Array.isArray(warnings) ? warnings : [])
      .map((warning) => String(warning || "").trim())
      .filter(Boolean)
  ));
}

const DIAGNOSTIC_NOTICES = new Set([
  "render:tiled",
  "render:tiled-png",
]);

export function partitionCaptureNotices(notices) {
  const diagnostics = [];
  const warnings = [];
  for (const notice of normalizeWarnings(notices)) {
    if (DIAGNOSTIC_NOTICES.has(notice)) {
      diagnostics.push(notice);
    } else {
      warnings.push(notice);
    }
  }
  return { diagnostics, warnings };
}

export function attachCaptureWarnings(blob, warnings) {
  if (!blob) return blob;
  const normalized = normalizeWarnings(warnings);
  if (!normalized.length) {
    try {
      delete blob.cwieWarnings;
    } catch (_) {}
    return blob;
  }
  try {
    Object.defineProperty(blob, "cwieWarnings", {
      configurable: true,
      enumerable: false,
      value: normalized,
      writable: true,
    });
  } catch (_) {
    try {
      blob.cwieWarnings = normalized;
    } catch (_) {}
  }
  return blob;
}

export function getNode2WarningMessage(warnings) {
  const normalized = normalizeWarnings(warnings);
  if (normalized.includes("node2:transparent_recovery_failed")) {
    return "Transparent background recovery failed for part or all of the capture. Affected regions retained their captured black or white matte background.";
  }
  if (normalized.includes("node2:transparent_background_unsupported")) {
    return "Transparent background recovery was not available for this Node 2.0 capture. The image was exported with its captured background.";
  }
  return "";
}

export function getExportWarningMessage(warnings) {
  const normalized = normalizeWarnings(warnings);
  if (normalized.includes("scope:opacity_disabled_for_huge")) {
    return "Selection cropping was preserved, but Scope opacity was disabled because this export required the huge tiled PNG path.";
  }
  return getNode2WarningMessage(normalized);
}
