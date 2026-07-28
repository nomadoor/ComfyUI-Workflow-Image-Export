import test from "node:test";
import assert from "node:assert/strict";

import {
  isWidgetOwnedDomElement,
} from "../../web/js/core/overlays/dom_utils.mjs";
import {
  isExternalTextOverlayEnabled,
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
