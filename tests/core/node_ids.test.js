import assert from "node:assert/strict";
import test from "node:test";

import {
  nodeIdSetHas,
  nodeIdsEqual,
  normalizeNodeIdList,
  normalizeNodeIdSet,
  toNodeIdKey,
} from "../../web/js/core/node_ids.mjs";

test("node ids use the frontend local string representation", () => {
  assert.equal(toNodeIdKey(63), "63");
  assert.equal(toNodeIdKey("63"), "63");
  assert.equal(toNodeIdKey("node-alpha"), "node-alpha");
  assert.equal(toNodeIdKey(""), null);
  assert.equal(toNodeIdKey(Number.NaN), null);
  assert.equal(toNodeIdKey(1.5), null);
});

test("selection containers normalize without discarding arbitrary string ids", () => {
  assert.deepEqual(
    normalizeNodeIdList(new Map([[3, {}], ["node-four", {}]])),
    ["3", "node-four"]
  );
  assert.deepEqual(
    normalizeNodeIdList([{ id: 8 }, { id: "node-nine" }, { nope: true }]),
    ["8", "node-nine"]
  );
  assert.deepEqual(
    normalizeNodeIdList({ 5: true, "node-six": true }),
    ["5", "node-six"]
  );
});

test("node id comparison accepts serialized numbers and runtime strings", () => {
  const ids = normalizeNodeIdSet([63, "node-alpha"]);

  assert.equal(nodeIdSetHas(ids, "63"), true);
  assert.equal(nodeIdSetHas(ids, 63), true);
  assert.equal(nodeIdSetHas(ids, "node-alpha"), true);
  assert.equal(nodeIdsEqual(63, "63"), true);
  assert.equal(nodeIdsEqual("node-alpha", "node-alpha"), true);
  assert.equal(nodeIdsEqual("063", 63), false);
});

test("normalized node id sets are snapshots and preserve serialized distinctions", () => {
  const source = new Set(["63", "063", "3:5"]);
  const normalized = normalizeNodeIdSet(source);

  assert.notEqual(normalized, source);
  source.add("later");
  assert.deepEqual([...normalized], ["63", "063", "3:5"]);
  assert.equal(nodeIdSetHas(normalized, 63), true);
  assert.equal(nodeIdSetHas(normalized, "063"), true);
  assert.equal(nodeIdSetHas(normalized, "3:5"), true);
});
