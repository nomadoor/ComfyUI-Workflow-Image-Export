const LAST_USED_KEY = "cwie.lastUsed.v1";

export function loadLastUsed() {
  try {
    const raw = localStorage.getItem(LAST_USED_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch (error) {
    return null;
  }
}

export function saveLastUsed(values) {
  try {
    localStorage.setItem(LAST_USED_KEY, JSON.stringify(values));
  } catch (error) {
    // Ignore storage failures.
  }
}

export function clearLastUsed() {
  try {
    localStorage.removeItem(LAST_USED_KEY);
  } catch (error) {
    // Ignore storage failures.
  }
}
