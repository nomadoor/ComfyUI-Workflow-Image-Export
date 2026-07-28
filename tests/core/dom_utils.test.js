import test from "node:test";
import assert from "node:assert/strict";

import {
  isWidgetOwnedDomElement,
} from "../../web/js/core/overlays/dom_utils.mjs";

function elementInside(selectors = []) {
  const ancestors = new Set(selectors);
  return {
    closest(selectorList) {
      return selectorList
        .split(",")
        .map((selector) => selector.trim())
        .some((selector) => ancestors.has(selector))
        ? {}
        : null;
    },
  };
}

test("DOM widget descendants are structurally owned without resolving a widget", () => {
  assert.equal(isWidgetOwnedDomElement(elementInside([".dom-widget"])), true);
});

test("Nodes 2.0 node-card descendants are structurally owned without widget.element", () => {
  assert.equal(isWidgetOwnedDomElement(elementInside(["[data-node-id]"])), true);
  assert.equal(isWidgetOwnedDomElement(elementInside(["[data-nodeid]"])), true);
});

test("node-external extension DOM remains available to the external scanner", () => {
  assert.equal(isWidgetOwnedDomElement(elementInside([])), false);
});

