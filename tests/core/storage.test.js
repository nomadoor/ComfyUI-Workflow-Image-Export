import test from "node:test";
import assert from "node:assert/strict";

import { clearLastUsed, loadLastUsed, saveLastUsed } from "../../web/js/core/storage.js";

function createLocalStorageMock() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

test.beforeEach(() => {
  globalThis.localStorage = createLocalStorageMock();
});

test.afterEach(() => {
  delete globalThis.localStorage;
});

test("saveLastUsed and loadLastUsed roundtrip values", () => {
  const value = { format: "webp", scopeSelected: true };
  saveLastUsed(value);
  assert.deepEqual(loadLastUsed(), value);
});

test("loadLastUsed returns null for invalid json payloads", () => {
  globalThis.localStorage.setItem("cwie.lastUsed.v1", "{broken");
  assert.equal(loadLastUsed(), null);
});

test("clearLastUsed removes the persisted value", () => {
  saveLastUsed({ format: "png" });
  clearLastUsed();
  assert.equal(loadLastUsed(), null);
});
