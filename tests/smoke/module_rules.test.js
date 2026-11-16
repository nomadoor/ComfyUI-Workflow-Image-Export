// The rules for browser modules under web/ (see AGENTS.md): ComfyUI serves only .js with
// Cache-Control: no-store and imports every listed .js once at startup.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const web = join(root, "web");

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}
const files = walk(web);
const modules = files.filter((f) => extname(f) === ".js");
const rel = (f) => relative(root, f).replaceAll("\\", "/");

// static and dynamic import specifiers, and re-exports
const SPEC = /\b(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s*["']([^"']+)["']/g;
function specifiers(file) {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(SPEC)].map((m) => m[1] ?? m[2] ?? m[3]);
}

test("no module under web/ other than .js", () => {
  const other = files.filter((f) => [".mjs", ".cjs", ".ts", ".mts"].includes(extname(f))).map(rel);
  assert.deepEqual(other, []);
});

test("import specifiers carry no query string", () => {
  const withQuery = modules.flatMap((f) => specifiers(f).filter((s) => s.includes("?")).map((s) => `${rel(f)}: ${s}`));
  assert.deepEqual(withQuery, []);
});

test("relative imports point at existing files", () => {
  const missing = modules.flatMap((f) =>
    specifiers(f).filter((s) => s.startsWith(".") && !s.includes("/scripts/")).filter((s) => !existsSync(resolve(dirname(f), s))).map((s) => `${rel(f)}: ${s}`));
  assert.deepEqual(missing, []);
});

test("only web/js/main.js registers an extension", () => {
  const registering = modules.filter((f) => /registerExtension\s*\(/.test(readFileSync(f, "utf8"))).map(rel);
  assert.deepEqual(registering, ["web/js/main.js"]);
});

test("no import cycles", () => {
  const edges = new Map(modules.map((f) => [f, specifiers(f).filter((s) => s.startsWith(".")).map((s) => resolve(dirname(f), s)).filter((t) => edges0(t))]));
  function edges0(t) { return modules.includes(t); }
  const state = new Map();
  const cycles = [];
  const visit = (f, path) => {
    if (state.get(f) === "done") return;
    if (state.get(f) === "open") { cycles.push([...path.slice(path.indexOf(f)), f].map(rel).join(" -> ")); return; }
    state.set(f, "open");
    for (const t of edges.get(f) ?? []) visit(t, [...path, f]);
    state.set(f, "done");
  };
  for (const f of modules) visit(f, []);
  assert.deepEqual(cycles, []);
});
