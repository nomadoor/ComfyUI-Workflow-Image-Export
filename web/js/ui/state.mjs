import { DEFAULTS, normalizeState } from "../core/settings_state.mjs?v=20260825-2";

export function normalizeScopeOpacity(value) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return 40;
  return Math.min(100, Math.max(0, num));
}

export function normalizeDialogState(raw = {}, options = {}) {
  return {
    ...normalizeState(raw),
    debug: Boolean(options.debugEnabled),
    scopeSelected: Boolean(raw?.scopeSelected),
    scopeOpacity: normalizeScopeOpacity(raw?.scopeOpacity),
  };
}

export function buildInitialState({ lastUsed = null, debugEnabled = false } = {}) {
  const mergedDefaults = {
    ...DEFAULTS,
    scopeSelected: false,
    scopeOpacity: 40,
  };
  return normalizeDialogState(
    lastUsed ? { ...mergedDefaults, ...lastUsed } : mergedDefaults,
    { debugEnabled }
  );
}

export function toLastUsedState(state, options = {}) {
  const lastUsed = {
    ...normalizeState(state),
    scopeSelected: Boolean(state?.scopeSelected),
    scopeOpacity: normalizeScopeOpacity(state?.scopeOpacity),
  };
  if (options.preserveExceedMode !== undefined) {
    lastUsed.exceedMode = normalizeState({
      ...lastUsed,
      exceedMode: options.preserveExceedMode,
    }).exceedMode;
  }
  return lastUsed;
}
