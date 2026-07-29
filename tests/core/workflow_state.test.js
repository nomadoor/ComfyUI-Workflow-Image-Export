import test from "node:test";
import assert from "node:assert/strict";

import {
  createWorkflowSignature,
  getSelectedNodeIdsFromApp,
  getWorkflowJsonFromApp,
  getWorkflowJsonTextFromApp,
  hashString,
  normalizeSelectedNodeIds,
  toWorkflowJsonString,
} from "../../web/js/core/workflow_state.mjs";

test("normalizeSelectedNodeIds accepts map, array of nodes, array of ids, and object maps", () => {
  assert.deepEqual(
    normalizeSelectedNodeIds(new Map([[3, {}], ["4", {}], ["node-five", {}]])),
    ["3", "4", "node-five"]
  );
  assert.deepEqual(
    normalizeSelectedNodeIds([{ id: 8 }, { id: "9" }, { id: "node-ten" }]),
    ["8", "9", "node-ten"]
  );
  assert.deepEqual(normalizeSelectedNodeIds([1, "2", "node-three"]), ["1", "2", "node-three"]);
  assert.deepEqual(
    normalizeSelectedNodeIds({ 5: true, 6: false, "node-seven": true }),
    ["5", "6", "node-seven"]
  );
  assert.deepEqual(normalizeSelectedNodeIds(null), []);
});

test("getSelectedNodeIdsFromApp follows ComfyUI selection locations", () => {
  assert.deepEqual(getSelectedNodeIdsFromApp({ canvas: { selected_nodes: { 1: true } } }), ["1"]);
  assert.deepEqual(
    getSelectedNodeIdsFromApp({ canvas: { selectedNodes: [{ id: "node-two" }] } }),
    ["node-two"]
  );
  assert.deepEqual(
    getSelectedNodeIdsFromApp({ graph: { selected_nodes: new Map([[3, true]]) } }),
    ["3"]
  );
});

test("getSelectedNodeIdsFromApp falls back to selectedItems and excludes non-node items", () => {
  const selectedNode = { id: "3:5" };
  const group = { id: "group-one" };
  const app = {
    canvas: {
      selected_nodes: {},
      selectedItems: new Set([selectedNode, group]),
    },
    graph: {
      _nodes: [selectedNode],
    },
  };

  assert.deepEqual(getSelectedNodeIdsFromApp(app), ["3:5"]);
});

test("workflow json helpers serialize graph state safely", () => {
  const workflow = { nodes: [{ id: 1 }], links: [] };
  const app = { graph: { serialize: () => workflow } };
  assert.equal(getWorkflowJsonFromApp(app), workflow);
  assert.equal(getWorkflowJsonTextFromApp(app), JSON.stringify(workflow));
  assert.equal(toWorkflowJsonString("{\"ok\":true}"), "{\"ok\":true}");
  assert.equal(toWorkflowJsonString(null), null);
  assert.equal(getWorkflowJsonFromApp({ graph: { serialize: () => { throw new Error("boom"); } } }), null);
});

test("workflow signatures change when workflow text changes", () => {
  const a = JSON.stringify({ nodes: [{ id: 1 }] });
  const b = JSON.stringify({ nodes: [{ id: 2 }] });
  assert.match(hashString(a), /^[0-9a-f]{8}$/);
  assert.equal(createWorkflowSignature(""), "unavailable");
  assert.notEqual(createWorkflowSignature(a), createWorkflowSignature(b));
  assert.match(createWorkflowSignature(a), /^\d+:[0-9a-f]{8}$/);
});
