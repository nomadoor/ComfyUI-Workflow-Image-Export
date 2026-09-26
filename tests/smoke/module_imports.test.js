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
  const module = await import(pathToFileURL(entryTempPath).href);
  const { app } = await import(pathToFileURL(appStubPath).href);
  return { tempRoot, module, app };
}

function createFakeCanvasElement() {
  const context = {
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    shadowColor: "transparent",
    shadowBlur: 0,
    clearRect() {},
    drawImage() {},
    fillRect() {},
    setTransform() {},
  };
  return {
    width: 0,
    height: 0,
    style: {},
    getContext(type) {
      assert.equal(type, "2d");
      return context;
    },
  };
}

function installOffscreenSessionFixture(
  app,
  { nodeCount = 4, failConstruct = false, failDraw = false } = {}
) {
  const events = [];
  const state = {
    configureCount: 0,
    graphClearCount: 0,
    drawNodeIds: [],
    canvases: [],
    events,
  };

  class FakeGraph {
    constructor() {
      this._nodes = [];
      this._groups = [];
      this.links = {};
      this.list_of_graphcanvas = [];
      this.primaryCanvas = null;
    }

    configure(data) {
      state.configureCount += 1;
      this._nodes = (data?.nodes || []).map((item) => ({
        id: item.id,
        pos: [...(item.pos || [0, 0])],
        size: [...(item.size || [100, 80])],
        widgets: [],
        graph: this,
      }));
    }

    remove(node) {
      const index = this._nodes.indexOf(node);
      if (index >= 0) this._nodes.splice(index, 1);
    }

    detachCanvas(canvas) {
      events.push({ type: "detach", canvas });
      const index = this.list_of_graphcanvas.indexOf(canvas);
      if (index >= 0) this.list_of_graphcanvas.splice(index, 1);
      // Current LiteGraph keeps primaryCanvas pointing at the detached canvas
      // until the next canvas is attached.
    }

    clear() {
      state.graphClearCount += 1;
      events.push({
        type: "graph.clear",
        canvas: this.primaryCanvas,
        hasCanvas: Boolean(this.primaryCanvas?.canvas),
      });
      this._nodes.length = 0;
    }

    stop() {}
  }

  class FakeLGraphCanvas {
    constructor(canvas, graph) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.graph = graph;
      this.ds = { scale: 1, offset: [0, 0] };
      this.visible_area = new Float32Array(4);
      this.last_drawn_area = new Float32Array(4);
      this.min_font_size_for_lod = 8;
      graph.list_of_graphcanvas.push(this);
      graph.primaryCanvas = this;
      state.canvases.push(this);
      events.push({ type: "attach", canvas: this });
      if (failConstruct) throw new Error("construct failed");
    }

    computeVisibleArea() {}
    setDirtyCanvas() {}
    stopRendering() {}
    unbind_events() {}
    clear() {}

    setCanvas(canvas) {
      events.push({ type: "setCanvas", owner: this, canvas });
      this.canvas = canvas;
    }

    draw() {
      state.drawNodeIds.push(this.graph._nodes.map((node) => node.id));
      if (failDraw) throw new Error("draw failed");
    }
  }

  const liveGraph = Object.assign(Object.create(FakeGraph.prototype), {
    _nodes: Array.from({ length: nodeCount }, (_, index) => ({
      id: index + 1,
      pos: [index * 120, 0],
      size: [100, 80],
      widgets: [],
    })),
    _groups: [],
    links: {},
    list_of_graphcanvas: [],
    primaryCanvas: null,
  });
  app.graph = liveGraph;
  app.canvas = {
    constructor: FakeLGraphCanvas,
    canvas: { closest() { return null; }, parentElement: null },
  };
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, "canvas");
      return createFakeCanvasElement();
    },
    documentElement: {},
    body: null,
  };

  return {
    state,
    workflowJson: {
      nodes: liveGraph._nodes.map((node) => ({
        id: node.id,
        pos: node.pos,
        size: node.size,
      })),
    },
    renderOptions: {
      bboxOverride: {
        paddedMinX: 0,
        paddedMinY: 0,
        width: 400,
        height: 100,
      },
      backgroundMode: "transparent",
      includeDomOverlays: false,
      includeGrid: false,
      mediaMode: "off",
      renderScaleFactor: 1,
      skipTextFallback: true,
      tileRect: { x: 0, y: 0, width: 200, height: 100 },
      uiPxRatio: 1,
    },
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

test("offscreen session applies destructive filters once before all tile renders", async (t) => {
  const { tempRoot, module, app } = await importMirroredModule(
    "web/js/export/render_graph_offscreen.mjs"
  );
  t.after(async () => {
    delete globalThis.document;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });
  const fixture = installOffscreenSessionFixture(app);
  const session = await module.createOffscreenRenderSession(
    fixture.workflowJson,
    { ...fixture.renderOptions, renderFilter: "none", linkFilter: "none" }
  );

  await session.render(fixture.renderOptions);
  await session.render({
    ...fixture.renderOptions,
    tileRect: { x: 200, y: 0, width: 200, height: 100 },
  });
  session.cleanup();

  assert.deepEqual(fixture.state.drawNodeIds, [[], []]);
});

test("offscreen session resolves an implicit selection bbox before graph filtering", async (t) => {
  const { tempRoot, module, app } = await importMirroredModule(
    "web/js/export/render_graph_offscreen.mjs"
  );
  t.after(async () => {
    delete globalThis.document;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });
  const fixture = installOffscreenSessionFixture(app);
  const baseOptions = {
    ...fixture.renderOptions,
    bboxOverride: null,
    cropToSelection: true,
    previewFast: true,
    selectedNodeIds: [1],
    tileRect: null,
  };

  const allSession = await module.createOffscreenRenderSession(
    fixture.workflowJson,
    { ...baseOptions, renderFilter: "all" }
  );
  const allResult = await allSession.render(baseOptions);
  allSession.cleanup();

  const noneSession = await module.createOffscreenRenderSession(
    fixture.workflowJson,
    { ...baseOptions, renderFilter: "none" }
  );
  const noneResult = await noneSession.render(baseOptions);
  noneSession.cleanup();

  assert.deepEqual(noneResult.bbox, allResult.bbox);
  assert.deepEqual(
    {
      width: noneResult.bbox.width,
      height: noneResult.bbox.height,
      paddedMinX: noneResult.bbox.paddedMinX,
      paddedMinY: noneResult.bbox.paddedMinY,
    },
    { width: 100, height: 80, paddedMinX: 0, paddedMinY: 0 }
  );
});

test("offscreen session owns one graph and releases canvases in lifecycle order", async (t) => {
  const { tempRoot, module, app } = await importMirroredModule(
    "web/js/export/render_graph_offscreen.mjs"
  );
  t.after(async () => {
    delete globalThis.document;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });
  const fixture = installOffscreenSessionFixture(app);
  const session = await module.createOffscreenRenderSession(
    fixture.workflowJson,
    fixture.renderOptions
  );

  const firstResult = await session.render(fixture.renderOptions);
  const firstCanvas = fixture.state.canvases[0];
  assert.equal(firstResult.cleanup, undefined);
  assert.ok(firstCanvas.canvas, "first canvas remains attached after its render");

  await session.render({
    ...fixture.renderOptions,
    tileRect: { x: 200, y: 0, width: 200, height: 100 },
  });
  const secondCanvas = fixture.state.canvases[1];
  assert.equal(firstCanvas.canvas, null, "next render releases the previous canvas");
  assert.ok(secondCanvas.canvas, "final canvas remains attached until session cleanup");

  session.cleanup();
  session.cleanup();

  assert.equal(fixture.state.configureCount, 1);
  assert.equal(fixture.state.graphClearCount, 1);
  assert.equal(secondCanvas.canvas, null);
  assert.equal(
    fixture.state.events.filter((event) => event.type === "detach").length,
    2
  );
  const clearIndex = fixture.state.events.findIndex((event) => event.type === "graph.clear");
  const finalCanvasReleaseIndex = fixture.state.events.findIndex(
    (event) => event.type === "setCanvas" && event.owner === secondCanvas && event.canvas === null
  );
  assert.equal(fixture.state.events[clearIndex].hasCanvas, true);
  assert.ok(clearIndex < finalCanvasReleaseIndex);
  await assert.rejects(session.render(fixture.renderOptions), /session is closed/i);
});

test("offscreen session retains and detaches a canvas whose draw fails", async (t) => {
  const { tempRoot, module, app } = await importMirroredModule(
    "web/js/export/render_graph_offscreen.mjs"
  );
  t.after(async () => {
    delete globalThis.document;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });
  const fixture = installOffscreenSessionFixture(app, { failDraw: true });
  const session = await module.createOffscreenRenderSession(
    fixture.workflowJson,
    fixture.renderOptions
  );

  await assert.rejects(session.render(fixture.renderOptions), /draw failed/);
  const failedCanvas = fixture.state.canvases[0];
  session.cleanup();
  session.cleanup();

  assert.equal(fixture.state.configureCount, 1);
  assert.equal(fixture.state.graphClearCount, 1);
  assert.equal(failedCanvas.canvas, null);
  assert.equal(
    fixture.state.events.filter(
      (event) => event.type === "detach" && event.canvas === failedCanvas
    ).length,
    1
  );
  const clearIndex = fixture.state.events.findIndex((event) => event.type === "graph.clear");
  const failedCanvasReleaseIndex = fixture.state.events.findIndex(
    (event) => event.type === "setCanvas" && event.owner === failedCanvas && event.canvas === null
  );
  assert.equal(fixture.state.events[clearIndex].hasCanvas, true);
  assert.ok(clearIndex < failedCanvasReleaseIndex);
});

test("offscreen session detaches a canvas attached by a throwing constructor", async (t) => {
  const { tempRoot, module, app } = await importMirroredModule(
    "web/js/export/render_graph_offscreen.mjs"
  );
  t.after(async () => {
    delete globalThis.document;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });
  const fixture = installOffscreenSessionFixture(app, { failConstruct: true });
  const session = await module.createOffscreenRenderSession(
    fixture.workflowJson,
    fixture.renderOptions
  );

  await assert.rejects(session.render(fixture.renderOptions), /construct failed/);
  const failedCanvas = fixture.state.canvases[0];
  session.cleanup();

  assert.equal(fixture.state.graphClearCount, 1);
  assert.equal(failedCanvas.canvas, null);
  assert.equal(
    fixture.state.events.filter(
      (event) => event.type === "detach" && event.canvas === failedCanvas
    ).length,
    1
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
