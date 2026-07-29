import test from "node:test";
import assert from "node:assert/strict";

import {
  isWidgetOwnedDomElement,
} from "../../web/js/core/overlays/dom_utils.mjs";
import {
  buildPickKey,
  getExternalTextElementText,
  isExternalTextOverlayEnabled,
  shouldSkipExternalTextElement,
} from "../../web/js/core/backends/legacy_dom_text_overlays.mjs";

class MiniElement {
  constructor({ className = "", attributes = {} } = {}) {
    this.className = className;
    this.attributes = { ...attributes };
    this.parentElement = null;
    this.children = [];
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  matches(selector) {
    if (selector.startsWith(".")) {
      return this.className.split(/\s+/).includes(selector.slice(1));
    }
    const attributeMatch = selector.match(/^\[([^\]]+)\]$/);
    return Boolean(
      attributeMatch &&
      Object.prototype.hasOwnProperty.call(this.attributes, attributeMatch[1])
    );
  }

  closest(selectorList) {
    const selectors = selectorList.split(",").map((selector) => selector.trim());
    let current = this;
    while (current) {
      if (selectors.some((selector) => current.matches(selector))) return current;
      current = current.parentElement;
    }
    return null;
  }
}

test("DOM widget descendants are structurally owned without resolving a widget", () => {
  const widgetRoot = new MiniElement({ className: "dom-widget extension-shell" });
  const wrapper = widgetRoot.appendChild(new MiniElement({ className: "wrapper" }));
  const textarea = wrapper.appendChild(new MiniElement());

  assert.equal(isWidgetOwnedDomElement(textarea), true);
});

test("Nodes 2.0 node-card descendants are structurally owned without widget.element", () => {
  const modernCard = new MiniElement({ attributes: { "data-node-id": "72" } });
  const legacyCard = new MiniElement({ attributes: { "data-nodeid": "73" } });
  const modernTextarea = modernCard.appendChild(new MiniElement());
  const legacyTextarea = legacyCard.appendChild(new MiniElement());

  assert.equal(isWidgetOwnedDomElement(modernTextarea), true);
  assert.equal(isWidgetOwnedDomElement(legacyTextarea), true);
});

test("node-external extension DOM remains available to the external scanner", () => {
  const extensionRoot = new MiniElement({ className: "third-party-overlay" });
  const textarea = extensionRoot.appendChild(new MiniElement());

  assert.equal(isWidgetOwnedDomElement(textarea), false);
});

test("external text overlay scanning requires explicit opt-in", () => {
  assert.equal(isExternalTextOverlayEnabled(), false);
  assert.equal(isExternalTextOverlayEnabled({ allowExternalDomText: false }), false);
  assert.equal(isExternalTextOverlayEnabled({ allowExternalDomText: true }), true);
});

test("external text pick keys distinguish a valid 'none' ID from an invalid ID", () => {
  const rect = { x: 10, y: 20, w: 30, h: 40 };

  assert.notEqual(buildPickKey(rect, "none"), buildPickKey(rect, null));
});

test("external text inputs use their value and only hidden inputs are skipped", () => {
  const previousInput = globalThis.HTMLInputElement;
  const previousTextarea = globalThis.HTMLTextAreaElement;
  class MockInput {
    constructor(type, value) {
      this.type = type;
      this.value = value;
    }
  }
  class MockTextarea {}
  globalThis.HTMLInputElement = MockInput;
  globalThis.HTMLTextAreaElement = MockTextarea;
  try {
    const textInput = new MockInput("text", "external value");
    const hiddenInput = new MockInput("hidden", "secret");

    assert.equal(getExternalTextElementText(textInput), "external value");
    assert.equal(shouldSkipExternalTextElement(textInput), false);
    assert.equal(shouldSkipExternalTextElement(hiddenInput), true);
  } finally {
    if (previousInput === undefined) delete globalThis.HTMLInputElement;
    else globalThis.HTMLInputElement = previousInput;
    if (previousTextarea === undefined) delete globalThis.HTMLTextAreaElement;
    else globalThis.HTMLTextAreaElement = previousTextarea;
  }
});
