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

test("fallback media overlays never draw unverified media into the export canvas", async () => {
  const source = await fs.readFile(
    path.join(REPO_ROOT, "web/js/export/fallback_media_overlays.mjs"),
    "utf8"
  );

  assert.equal(source.includes("exportCtx.drawImage"), false);
  assert.equal(source.includes("drawMediaSafely"), true);
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
