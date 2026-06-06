import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveBlobExtension,
  resolveWorkflowName,
  sanitizeFilename,
} from "../../web/js/ui/export_filename.mjs";

test("sanitizeFilename removes unsafe filesystem characters", () => {
  assert.equal(sanitizeFilename("  bad<>:\"/\\|?*\x00 name  "), "bad name");
  assert.equal(sanitizeFilename(""), "");
});

test("resolveWorkflowName prefers graph metadata in stable order", () => {
  assert.equal(
    resolveWorkflowName({
      graph: {
        name: "",
        title: "Graph Title",
        extra: { workflow_name: "Extra Name" },
      },
      documentTitle: "Document - ComfyUI",
    }),
    "Graph Title"
  );
  assert.equal(
    resolveWorkflowName({
      graph: {
        extra: { workflow_name: "Extra Name" },
      },
      documentTitle: "Document - ComfyUI",
    }),
    "Extra Name"
  );
});

test("resolveWorkflowName falls back to document title and default", () => {
  assert.equal(resolveWorkflowName({ documentTitle: "My Flow - ComfyUI" }), "My Flow");
  assert.equal(resolveWorkflowName({ documentTitle: "" }), "workflow");
});

test("resolveBlobExtension prefers explicit cwieFormat then MIME type", () => {
  assert.equal(resolveBlobExtension({ cwieFormat: "WEBP", type: "image/png" }), "webp");
  assert.equal(resolveBlobExtension({ type: "image/png" }, "webp"), "png");
  assert.equal(resolveBlobExtension({ type: "image/webp" }, "png"), "webp");
  assert.equal(resolveBlobExtension({ type: "image/svg+xml" }, "png"), "svg");
  assert.equal(resolveBlobExtension({ type: "application/octet-stream" }, "webp"), "webp");
});
