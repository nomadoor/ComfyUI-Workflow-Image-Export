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
  assert.deepEqual(normalizeSelectedNodeIds(new Map([[3, {}], ["4", {}], ["bad", {}]])), [3, 4]);
  assert.deepEqual(normalizeSelectedNodeIds([{ id: 8 }, { id: "9" }, { id: "no" }]), [8, 9]);
  assert.deepEqual(normalizeSelectedNodeIds([1, "2", "x"]), [1, 2]);
  assert.deepEqual(normalizeSelectedNodeIds({ 5: true, 6: false, nope: true }), [5, 6]);
  assert.deepEqual(normalizeSelectedNodeIds(null), []);
});

test("getSelectedNodeIdsFromApp follows ComfyUI selection locations", () => {
  assert.deepEqual(getSelectedNodeIdsFromApp({ canvas: { selected_nodes: { 1: true } } }), [1]);
  assert.deepEqual(getSelectedNodeIdsFromApp({ canvas: { selectedNodes: [{ id: 2 }] } }), [2]);
  assert.deepEqual(getSelectedNodeIdsFromApp({ graph: { selected_nodes: new Map([[3, true]]) } }), [3]);
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
