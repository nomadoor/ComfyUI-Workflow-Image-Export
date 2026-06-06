import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const ENTRY = "web/js/export/fallback_media_helpers.mjs";
const IMPORT_SPECIFIER_RE =
  /(?:import|export)\s+(?:[^"'()]*?\sfrom\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function toPosix(value) {
  return value.replaceAll(path.sep, "/");
}

function ensureRelativeSpecifier(fromFile, toFile) {
  const relative = toPosix(path.relative(path.dirname(fromFile), toFile));
  return relative.startsWith(".") ? relative : `./${relative}`;
}

async function writeAppStub(tempRoot) {
  const stubPath = path.join(tempRoot, "scripts", "app.js");
  await fs.mkdir(path.dirname(stubPath), { recursive: true });
  await fs.writeFile(stubPath, "export const app = { graph: { nodes: [] } };\n", "utf8");
  return stubPath;
}

async function mirrorModule(sourcePath, tempRoot, appStubPath, seen = new Set()) {
  const normalizedSourcePath = path.resolve(sourcePath);
  if (seen.has(normalizedSourcePath)) return;
  seen.add(normalizedSourcePath);

  const repoRelative = path.relative(REPO_ROOT, normalizedSourcePath);
  const tempPath = path.join(tempRoot, repoRelative);
  await fs.mkdir(path.dirname(tempPath), { recursive: true });

  const source = await fs.readFile(normalizedSourcePath, "utf8");
  for (const match of source.matchAll(IMPORT_SPECIFIER_RE)) {
    const specifier = match[1] || match[2];
    if (specifier?.startsWith("./") || specifier?.startsWith("../")) {
      await mirrorModule(path.resolve(path.dirname(normalizedSourcePath), specifier), tempRoot, appStubPath, seen);
    }
  }

  const rewritten = source.replaceAll(
    '"/scripts/app.js"',
    `"${ensureRelativeSpecifier(tempPath, appStubPath)}"`
  );
  await fs.writeFile(tempPath, rewritten, "utf8");
}

async function importFallbackMediaHelpers(t) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cwie-fallback-media-"));
  const appStubPath = await writeAppStub(tempRoot);
  await mirrorModule(path.join(REPO_ROOT, ENTRY), tempRoot, appStubPath);
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });
  return import(pathToFileURL(path.join(tempRoot, ENTRY)).href);
}

test("normalizeSelectedNodeIds converts Set values to numeric ids", async (t) => {
  const { normalizeSelectedNodeIds } = await importFallbackMediaHelpers(t);

  assert.deepEqual([...normalizeSelectedNodeIds(new Set(["12", 13, "bad"]))], [12, 13]);
  assert.equal(normalizeSelectedNodeIds(new Set(["bad", Number.NaN])), null);
});

test("shouldRenderResolvedNode matches numeric node ids against string Set ids", async (t) => {
  const { shouldRenderResolvedNode } = await importFallbackMediaHelpers(t);

  assert.equal(shouldRenderResolvedNode(12, new Set(["12"]), "selected"), true);
  assert.equal(shouldRenderResolvedNode(12, new Set(["12"]), "unselected"), false);
});

test("computePreviewRect projects x from the live node position", async (t) => {
  const { computePreviewRect } = await importFallbackMediaHelpers(t);
  globalThis.window = {
    LiteGraph: {
      NODE_TITLE_HEIGHT: 30,
      NODE_WIDGET_HEIGHT: 20,
    },
  };

  const result = computePreviewRect({
    rect: { left: 100, top: 50, right: 300, bottom: 250 },
    node: {
      id: 42,
      pos: [125, 50],
      widgets_start_y: 30,
      widgets: [],
    },
    bounds: { left: 80, top: 40 },
    scale: 2,
  });

  assert.equal(result.x, 92);
  assert.equal(result.debug.deltaX, 25);
});
