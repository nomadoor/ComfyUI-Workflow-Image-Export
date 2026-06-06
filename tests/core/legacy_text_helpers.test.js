import test from "node:test";
import assert from "node:assert/strict";

import { isEffectivelyVisibleElement } from "../../web/js/core/backends/legacy_text_helpers.mjs";

class MockHTMLElement {
  constructor(style = {}) {
    this.style = style;
    this.nodeType = 1;
    this.parentElement = null;
    this.parentNode = null;
    this.isConnected = true;
  }
}

function append(parent, child) {
  child.parentElement = parent;
  child.parentNode = parent;
  return child;
}

test.beforeEach(() => {
  globalThis.HTMLElement = MockHTMLElement;
  globalThis.document = {
    documentElement: new MockHTMLElement(),
  };
  globalThis.window = {
    getComputedStyle(el) {
      return {
        display: el.style.display ?? "block",
        visibility: el.style.visibility ?? "visible",
        opacity: el.style.opacity ?? "1",
      };
    },
  };
});

test.afterEach(() => {
  delete globalThis.HTMLElement;
  delete globalThis.document;
  delete globalThis.window;
});

test("isEffectivelyVisibleElement rejects non-elements", () => {
  assert.equal(isEffectivelyVisibleElement(null), false);
  assert.equal(isEffectivelyVisibleElement({}), false);
});

test("isEffectivelyVisibleElement walks hidden ancestors", () => {
  const root = globalThis.document.documentElement;
  const hiddenParent = append(root, new MockHTMLElement({ display: "none" }));
  const child = append(hiddenParent, new MockHTMLElement());

  assert.equal(isEffectivelyVisibleElement(child), false);
});

test("isEffectivelyVisibleElement walks transparent ancestors", () => {
  const root = globalThis.document.documentElement;
  const transparentParent = append(root, new MockHTMLElement({ opacity: "0" }));
  const child = append(transparentParent, new MockHTMLElement());

  assert.equal(isEffectivelyVisibleElement(child), false);
});

test("isEffectivelyVisibleElement accepts visible connected elements", () => {
  const root = globalThis.document.documentElement;
  const parent = append(root, new MockHTMLElement());
  const child = append(parent, new MockHTMLElement());

  assert.equal(isEffectivelyVisibleElement(child), true);
});

test("isEffectivelyVisibleElement rejects disconnected elements", () => {
  const el = new MockHTMLElement();
  el.isConnected = false;

  assert.equal(isEffectivelyVisibleElement(el), false);
});
