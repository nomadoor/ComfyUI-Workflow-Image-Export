import test from "node:test";
import assert from "node:assert/strict";

import {
  createRadioGroup,
  createRow,
  createSelect,
} from "../../web/js/ui/elements.mjs";

class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = "";
    this.textContent = "";
    this.id = "";
    this.htmlFor = "";
    this.attributes = {};
    this.dataset = {};
    this.listeners = new Map();
    this.disabled = false;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  dispatchEvent(event) {
    for (const handler of this.listeners.get(event.type) || []) {
      handler(event);
    }
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

  querySelectorAll(selector) {
    const matches = [];
    const queue = [...this.children];
    while (queue.length) {
      const child = queue.shift();
      if (child.matches?.(selector)) matches.push(child);
      queue.push(...(child.children || []));
    }
    return matches;
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
    createElementNS(_namespace, tagName) {
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

test("disabled custom selects cannot open or receive option input", () => {
  const select = createSelect("exceed", [
    { value: "downscale", label: "Downscale" },
    { value: "tile", label: "Tile" },
  ]);
  const summary = findFirst(select.root, "summary");

  select.setValue("tile");
  select.setDisabled(true);
  select.root.setAttribute("open", "");
  select.root.dispatchEvent({ type: "toggle" });

  assert.equal(select.root.attributes["data-disabled"], "true");
  assert.equal("open" in select.root.attributes, false);
  assert.equal(summary.attributes["aria-disabled"], "true");
  assert.equal(summary.attributes.tabindex, "-1");
  assert.ok(select.root.querySelectorAll("input").every((input) => input.disabled));
});

test("radio groups render all choices inline without dropdown elements", () => {
  const group = createRadioGroup("exceed", [
    { value: "downscale", label: "Downscale" },
    { value: "tile", label: "Tile" },
  ]);

  assert.equal(group.group.className, "cwie-radio-group");
  assert.equal(group.inputs.size, 2);
  assert.equal(group.inputs.get("downscale").type, "radio");
  assert.equal(group.inputs.get("tile").type, "radio");
  assert.equal(group.group.querySelector("details"), null);
  assert.equal(group.group.querySelector("summary"), null);
});
