# ADR-001: Robust Node Detection and TypedArray Compatibility

## Status
Accepted

## Context
The previous implementation of `ComfyUI-Workflow-Image-Export` failed to correctly detect workflow bounds in certain environments (Legacy / Nodes 2.0).

### Root Causes Identified
1.  **Strict DOM Dependency**: The logic relied heavily on DOM queries (`.node`, etc.) which fail in environments using Shadow DOM (Nodes 2.0) or custom themes.
2.  **Graph Discovery**: The fallback to LiteGraph internal data (`app.graph`) was fragile and sometimes missed the active instance.
3.  **TypedArray Incompatibility**: Even when the graph was found, `bounds.js` used `Array.isArray(node.pos)` to validate node positions. in some ComfyUI environments (likely newer LiteGraph versions), `node.pos` is a `Float64Array`. `Array.isArray` returns `false` for TypedArrays, causing all valid nodes to be rejected.

## Decision

### 1. Improved Graph Detection Strategy
We expanded the search strategy in `detect.js` to iterate through multiple potential locations for the graph instance:
- `app.graph`
- `app.canvas.graph`
- `window.LiteGraph.LGraphCanvas.active_canvas.graph`
- And others.

This ensures we can access the underlying data even if the UI DOM is obscure.

### 2. Relaxed Array Validation
In `bounds.js`, we replaced strict `Array.isArray()` checks with a duck-typing approach compatible with TypedArrays:

```javascript
// Old (Failed for Float64Array)
if (!Array.isArray(pos)) continue;

// New (Works for Array and TypedArray)
if (!pos || pos.length < 2) continue;
```

This ensures we correctly interpret position and size data regardless of whether it's a standard Array or a Float64Array.

### 3. Graceful Property Access
We added fallback interactions for node properties (`size` vs `_size`, `pos` vs `_pos`) and safe defaults to prevent crashes when encountering malformed or partial node data.

## Consequences
- **Positive**: The export function now reliably captures the full workflow bounds in a wider range of environments, including those using TypedArrays for performance.
- **Positive**: Reduced dependency on specific DOM class names.
- **Maintenance**: Future updates to LiteGraph's data structure will need to be monitored, but the current "duck typing" approach is more resilient than strict type checks.
