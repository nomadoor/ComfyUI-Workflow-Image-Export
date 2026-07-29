# ADR 0013: Node ID Normalization

## Status

Accepted

## Context

ComfyUI frontend v1.47.6 changed local LiteGraph node IDs to strings. In
frontend v1.47.10, `toNodeId()` returns `String(value)`, while serialized
workflow IDs remain `number | string`. Numeric-looking canonical strings are
serialized as integers, but other strings are preserved.

Export code joins live graph state, serialized workflow graphs, DOM node
attributes, selection state, and render plans. Comparing their raw ID values
made Scope cropping depend on whether the frontend represented the same ID as
`63` or `"63"`.

## Decision

All node identity comparisons and lookup keys pass through
`toNodeIdKey()`:

- integer `63` and string `"63"` both normalize to `"63"`;
- `"063"` remains distinct from `63`, matching frontend
  `serializeNodeId()`;
- scoped or named IDs such as `"3:5"` remain unchanged;
- empty strings, non-integer numbers, and unsupported values are invalid.

The helper intentionally does not trim strings or coerce numeric-looking
strings beyond converting integer values to strings.

Link IDs are a separate LiteGraph identity domain and remain numeric.

## Consequences

Scope bounds, render filtering, overlay ownership, DOM media lookup, and live
to-export graph synchronization share one identity contract. Serialized
numeric IDs can join to current frontend runtime IDs without discarding
non-numeric or subgraph-scoped IDs.

Any future frontend compatibility change should be made in
`web/js/core/node_ids.mjs` and covered by its pure tests rather than adding
local ID coercion.
