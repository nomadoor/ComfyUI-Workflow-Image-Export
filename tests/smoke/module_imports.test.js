import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const IMPORT_SPECIFIER_RE =
  /(?:import|export)\s+(?:[^"'()]*?\sfrom\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function toPosix(value) {
  return value.replaceAll(path.sep, "/");
}

function ensureRelativeSpecifier(fromFile, toFile) {
  const relative = toPosix(path.relative(path.dirname(fromFile), toFile));
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function extractBracedBlockAfter(source, anchor) {
  const anchorIndex = source.indexOf(anchor);
  assert.notEqual(anchorIndex, -1, `missing source anchor: ${anchor}`);
  const blockStart = source.indexOf("{", anchorIndex + anchor.length);
  assert.notEqual(blockStart, -1, `missing block after source anchor: ${anchor}`);
  let depth = 0;
  for (let index = blockStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(blockStart, index + 1);
  }
  assert.fail(`unterminated block after source anchor: ${anchor}`);
}

async function writeAppStub(tempRoot) {
  const stubPath = path.join(tempRoot, "scripts", "app.js");
  await fs.mkdir(path.dirname(stubPath), { recursive: true });
  await fs.writeFile(
    stubPath,
    [
      "export const app = {",
      "  registerExtension() {},",
      "  extensionManager: { setting: { get() { return undefined; }, set() {} } },",
      "  ui: {",
      "    settings: {",
      "      getSettingValue(_id, fallback) { return fallback; },",
      "      setSettingValue() {},",
      "    },",
      "  },",
      "};",
      "",
    ].join("\n"),
    "utf8"
  );
  return stubPath;
}

async function mirrorModule(sourcePath, tempRoot, appStubPath, seen = new Set()) {
  const normalizedSourcePath = path.resolve(sourcePath);
  if (seen.has(normalizedSourcePath)) {
    return;
  }
  seen.add(normalizedSourcePath);

  const repoRelative = path.relative(REPO_ROOT, normalizedSourcePath);
  const tempPath = path.join(tempRoot, repoRelative);
  await fs.mkdir(path.dirname(tempPath), { recursive: true });

  const source = await fs.readFile(normalizedSourcePath, "utf8");
  const specifiers = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER_RE)) {
    const specifier = match[1] || match[2];
    if (specifier) {
      specifiers.push(specifier);
    }
  }

  for (const specifier of specifiers) {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const dependencyPath = path.resolve(
        path.dirname(normalizedSourcePath),
        specifier.split(/[?#]/, 1)[0]
      );
      await mirrorModule(dependencyPath, tempRoot, appStubPath, seen);
    }
  }

  const rewritten = source.replaceAll(
    '"/scripts/app.js"',
    `"${ensureRelativeSpecifier(tempPath, appStubPath)}"`
  );
  await fs.writeFile(tempPath, rewritten, "utf8");
}

async function importMirroredModule(entryRelativePath) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cwie-import-smoke-"));
  const appStubPath = await writeAppStub(tempRoot);
  const entrySourcePath = path.join(REPO_ROOT, entryRelativePath);
  await mirrorModule(entrySourcePath, tempRoot, appStubPath);
  const entryTempPath = path.join(tempRoot, entryRelativePath);
  return {
    tempRoot,
    module: await import(pathToFileURL(entryTempPath).href),
  };
}

test.beforeEach(() => {
  globalThis.localStorage = {
    getItem() {
      return null;
    },
    setItem() {},
    removeItem() {},
  };
  globalThis.window = {};
});

test.afterEach(async () => {
  delete globalThis.localStorage;
  delete globalThis.window;
});

test("main.js import graph resolves successfully", async (t) => {
  const { tempRoot, module } = await importMirroredModule("web/js/main.js");
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  assert.equal(typeof module, "object");
});

test("dialog.mjs import graph resolves successfully", async (t) => {
  const { tempRoot, module } = await importMirroredModule("web/js/ui/dialog.mjs");
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  assert.equal(typeof module.openExportDialog, "function");
});

test("offscreen setup preserves the current LiteGraph link render mode", async (t) => {
  const { tempRoot, module: graphSetup } = await importMirroredModule(
    "web/js/export/offscreen_graph_setup.mjs"
  );
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });
  const exportCanvas = {};

  graphSetup.copyRenderSettings({ links_render_mode: 2 }, exportCanvas);

  assert.equal(exportCanvas.links_render_mode, 2);
});

test("scaled tile geometry reaches the real offscreen transform in graph units", async (t) => {
  const { tempRoot, module: graphSetup } = await importMirroredModule(
    "web/js/export/offscreen_graph_setup.mjs"
  );
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });
  const tiledRender = await import(pathToFileURL(
    path.join(REPO_ROOT, "web/js/export/tiled_render.mjs")
  ).href);
  const geometry = tiledRender.resolveScaledTileGeometry({
    x: 2048,
    y: 2048,
    width: 2048,
    height: 1024,
    outputWidth: 10000,
    outputHeight: 6000,
    renderScaleFactor: 2,
    bleed: 64,
  });
  const bbox = {
    minX: 100,
    minY: 50,
    paddedMinX: 90,
    paddedMinY: 40,
  };
  const offscreen = {
    ds: { offset: [0, 0] },
    _cwieScaleFactor: 2,
    _cwieTileOffsetX: geometry.tileRect.x,
    _cwieTileOffsetY: geometry.tileRect.y,
  };

  graphSetup.configureTransform(offscreen, bbox, 10);

  const tileGraphOrigin = [
    bbox.paddedMinX + geometry.tileRect.x,
    bbox.paddedMinY + geometry.tileRect.y,
  ];
  assert.deepEqual(
    tileGraphOrigin.map((value, axis) =>
      (value + offscreen.ds.offset[axis]) * offscreen.ds.scale
    ),
    [0, 0]
  );
});

test("main.js is the only ComfyUI auto-loaded JS entry under web/js", async () => {
  const webJsRoot = path.join(REPO_ROOT, "web", "js");
  const jsFiles = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        jsFiles.push(toPosix(path.relative(REPO_ROOT, fullPath)));
      }
    }
  }

  await walk(webJsRoot);
  assert.deepEqual(jsFiles.sort(), ["web/js/main.js"]);
});

test("main.js cache-busts the mjs dialog entry", async () => {
  const mainSource = await fs.readFile(path.join(REPO_ROOT, "web/js/main.js"), "utf8");
  assert.match(mainSource, /import\("\.\/ui\/dialog\.mjs\?v=[^"?]+"\)/);
});

test("local browser modules use one complete identity per target", async () => {
  const webJsRoot = path.join(REPO_ROOT, "web", "js");
  const sourceFiles = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && /\.(?:m?js)$/.test(entry.name)) {
        sourceFiles.push(fullPath);
      }
    }
  }

  await walk(webJsRoot);
  const formsByTarget = new Map();
  for (const sourcePath of sourceFiles) {
    const source = await fs.readFile(sourcePath, "utf8");
    for (const match of source.matchAll(IMPORT_SPECIFIER_RE)) {
      const specifier = match[1] || match[2];
      if (!specifier?.startsWith(".")) continue;
      const bareSpecifier = specifier.split(/[?#]/, 1)[0];
      const targetPath = path.resolve(path.dirname(sourcePath), bareSpecifier);
      const identities = formsByTarget.get(targetPath) || new Set();
      identities.add(specifier.match(/[?#].*$/)?.[0] || "plain");
      formsByTarget.set(targetPath, identities);
    }
  }

  const mixedTargets = [...formsByTarget.entries()]
    .filter(([, forms]) => forms.size > 1)
    .map(([targetPath]) => toPosix(path.relative(REPO_ROOT, targetPath)))
    .sort();
  assert.deepEqual(mixedTargets, []);
});

test("fallback media overlays never draw unverified media into the export canvas", async () => {
  const source = await fs.readFile(
    path.join(REPO_ROOT, "web/js/export/fallback_media_overlays.mjs"),
    "utf8"
  );

  assert.equal(source.includes("exportCtx.drawImage"), false);
  assert.equal(source.includes("drawMediaSafely"), true);
});

test("huge tiled exports share safe media snapshots and retain failure ownership", async () => {
  const indexSource = await fs.readFile(
    path.join(REPO_ROOT, "web/js/export/index.mjs"),
    "utf8"
  );
  const renderSource = await fs.readFile(
    path.join(REPO_ROOT, "web/js/export/render_graph_offscreen.mjs"),
    "utf8"
  );
  const hugeScopeBlock = extractBracedBlockAfter(
    indexSource,
    "if (huge && scopeSelected)"
  );

  assert.match(indexSource, /mediaMode:\s*"force"/);
  assert.match(indexSource, /mediaSnapshotCache:\s*new Map\(\)/);
  assert.match(hugeScopeBlock, /renderFilter:\s*"all"/);
  assert.match(hugeScopeBlock, /linkFilter:\s*renderOptions\.linkFilter \|\| "all"/);
  assert.match(renderSource, /mediaSnapshotCache:\s*options\.mediaSnapshotCache/);
  assert.match(renderSource, /drawPlaceholderOnMiss:\s*false/);
  assert.match(renderSource, /drawBlockedPlaceholder:\s*false/);
  assert.match(renderSource, /mediaFallbackCoverage/);
});

test("removed extension Settings registration does not return to the import graph", async () => {
  await assert.rejects(
    fs.access(path.join(REPO_ROOT, "web/js/core/settings.mjs"))
  );
  const mainSource = await fs.readFile(path.join(REPO_ROOT, "web/js/main.js"), "utf8");
  const dialogSource = await fs.readFile(path.join(REPO_ROOT, "web/js/ui/dialog.mjs"), "utf8");
  assert.equal(mainSource.includes("registerLegacySettings"), false);
  assert.equal(dialogSource.includes("getDefaultsFromSettings"), false);
  assert.equal(dialogSource.includes("setDefaultsInSettings"), false);
});
