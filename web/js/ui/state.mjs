import { normalizeState } from "../core/settings_state.mjs";

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

export function buildInitialState({ defaults = {}, lastUsed = null, debugEnabled = false } = {}) {
  const mergedDefaults = {
    ...defaults,
    scopeSelected: false,
    scopeOpacity: 40,
  };
  return normalizeDialogState(
    lastUsed ? { ...mergedDefaults, ...lastUsed } : mergedDefaults,
    { debugEnabled }
  );
}

export function toLastUsedState(state) {
  return {
    ...normalizeState(state),
    scopeSelected: Boolean(state?.scopeSelected),
    scopeOpacity: normalizeScopeOpacity(state?.scopeOpacity),
  };
}
