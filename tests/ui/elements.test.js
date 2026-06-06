import test from "node:test";
import assert from "node:assert/strict";

import { createRow } from "../../web/js/ui/elements.mjs";

class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = "";
    this.textContent = "";
    this.id = "";
    this.htmlFor = "";
    this.attributes = {};
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  matches(selector) {
    return selector
      .split(",")
      .map((item) => item.trim().toUpperCase())
      .includes(this.tagName);
  }

  querySelector(selector) {
    const queue = [...this.children];
    while (queue.length) {
      const child = queue.shift();
      if (child.matches?.(selector)) return child;
      queue.push(...(child.children || []));
    }
    return null;
  }
}

function findFirst(element, tagName) {
  const target = tagName.toUpperCase();
  const queue = [element];
  while (queue.length) {
    const current = queue.shift();
    if (current.tagName === target) return current;
    queue.push(...(current.children || []));
  }
  return null;
}

test.beforeEach(() => {
  globalThis.document = {
    createElement(tagName) {
      return new MockElement(tagName);
    },
  };
});

test.afterEach(() => {
  delete globalThis.document;
});

test("createRow associates a generated id with direct controls", () => {
  const input = document.createElement("input");
  const row = createRow("Padding", input);
  const label = findFirst(row, "label");

  assert.ok(input.id.startsWith("cwie-control-"));
  assert.equal(label.htmlFor, input.id);
});

test("createRow preserves existing control ids", () => {
  const input = document.createElement("input");
  input.id = "existing-id";
  const row = createRow("Padding", input);
  const label = findFirst(row, "label");

  assert.equal(input.id, "existing-id");
  assert.equal(label.htmlFor, "existing-id");
});

test("createRow associates labels with nested wrapper controls and keeps help text", () => {
  const wrapper = document.createElement("div");
  const input = document.createElement("input");
  wrapper.appendChild(input);

  const row = createRow("Node opacity", wrapper, {
    helpText: "Controls node background opacity in exports.",
  });
  const label = findFirst(row, "label");
  const help = findFirst(row, "button");

  assert.equal(label.htmlFor, input.id);
  assert.equal(help.attributes["data-help"], "Controls node background opacity in exports.");
  assert.equal(help.attributes["aria-label"], "Controls node background opacity in exports.");
});
