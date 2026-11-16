# AGENTS.md

This file defines working rules for coding agents in this repository.

## Agent skills

- Follow the engineering workflow in `docs/agents/workflow.md`.
- Read `docs/agents/issue-tracker.md`, `docs/agents/labels.md`, and
  `docs/agents/domain.md` before publishing work or changing domain guidance.

## Project Shape

- This is a ComfyUI frontend extension for exporting workflow images.
- Python is only the custom-node entry point: `__init__.py` exposes `WEB_DIRECTORY`.
- The product code is JavaScript under `web/js/`, with styles under `web/css/`.
- Browser modules under `web/` are plain `.js`. ComfyUI serves `.js` with `Cache-Control: no-store`; any other extension (`.mjs` included) gets no cache header, so the browser keeps its own copy and goes on running the old file after an update, through a ComfyUI restart and a hard reload. Do not add `.mjs` files under `web/`.
- ComfyUI imports every `.js` under `web/` once at startup (the `/extensions` list). `web/js/main.js` is the only file that calls `app.registerExtension`. Every other module only defines and exports: no code that runs on import, no import cycles. The startup import and `main.js`'s own imports load the same URL, so each module still runs once.
- Import specifiers are plain relative paths with no query string; a query makes a second copy of the module.
- Code that must load only on demand goes in the dot-directory `web/js/.lazy/`: ComfyUI serves it with `no-store` but does not list it. The vendored pako bundle lives there, because it sets `window.pako` when it runs.
- Classic uses a LiteGraph renderer; Node 2.0 uses an established browser-compositor backend. Keep their rendering architectures separate.
- Shared UI and export policy may cover both backends, but backend-specific repairs should remain isolated.

## Current Priorities

1. Stabilize and simplify the Classic export path without reviving unsafe preview-save or direct-media paths.
2. Keep the context menu and dialog usable in current ComfyUI Classic and Node 2.0.
3. Preserve PNG/WebP export, PNG workflow embedding, background options, padding, and selection cropping.
4. Add tests around fragile pure logic before or while refactoring it.
5. Avoid expanding scope into SVG export or a new UI framework during export cleanup.

## Non-Negotiables

- Do not break existing exported workflow metadata compatibility without documenting the migration.
- Do not add network behavior to the extension.
- Do not add runtime code execution such as `eval` or generated function bodies.
- Avoid new dependencies. If one is truly needed, explain why and keep it small.
- Do not bundle large assets, model files, screenshots, or generated media.
- Keep changes scoped. Do not rewrite unrelated files while repairing legacy export.
- Do not treat `ops/` as disposable. It contains design notes and ADRs; update it only when the task explicitly calls for documentation or architectural notes.

## Architecture Guidelines

- Prefer small pure modules for bbox math, color parsing, PNG chunk handling, size decisions, and state normalization.
- Keep ComfyUI/LiteGraph feature detection isolated in detection/backend modules.
- Keep rendering backends separate from UI dialog code.
- Keep DOM widget/media overlay handling best-effort and isolated from the core raster export path.
- Do not duplicate constants such as tile thresholds, max canvas edge, or default settings across modules unless there is a clear reason.
- Do not introduce Vue or a build step just for the current legacy repair. The existing extension is loaded directly as browser ES modules.
- Treat LiteGraph coordinate pairs by indexed numeric capability, not
  `Array.isArray()`. Current frontend node positions and sizes use typed-array
  views and proxies.

## Testing

- Run `npm test` after meaningful JavaScript changes.
- The current test suite uses Node's built-in test runner.
- Add focused tests for pure functions when refactoring:
  - `web/js/export/bbox.js`
  - `web/js/export/png_embed_workflow.js`
  - `web/js/core/utils.js`
  - settings/state/storage modules
- `npm test` runs every `tests/**/*.test.js`. `tests/smoke/module_rules.test.js` checks the module rules above.
- Prefer structural assertions over golden image tests.
- Browser/ComfyUI integration behavior should be manually checked when possible and recorded in `AGENTS-STATE.md`.

## Stop And Ask

Ask before:

- Changing the public user workflow or removing an existing option.
- Dropping support for PNG workflow embedding.
- Adding a dependency or build tool.
- Reworking Node 2.0 support.
- Making broad UI redesigns beyond keeping the existing dialog functional.
- Changing repository packaging metadata in `pyproject.toml`.

## Agent State

Before starting work, read `AGENTS-STATE.md` if it exists.

When finishing a meaningful step, update `AGENTS-STATE.md` with:

- current goal
- files changed
- checks run
- next action
- blockers or assumptions

`AGENTS-STATE.md` is local working memory for agents. Do not treat chat history as the source of truth.
