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
- `web/js/main.js` is the only ComfyUI extension entry file. Supporting browser modules should use `.mjs` so ComfyUI does not auto-load them as standalone extensions.
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
- Do not add new supporting `.js` files under `web/`; use `.mjs` unless the file is intentionally a ComfyUI extension entry.
- Do not introduce Vue or a build step just for the current legacy repair. The existing extension is loaded directly as browser ES modules.
- Treat LiteGraph coordinate pairs by indexed numeric capability, not
  `Array.isArray()`. Current frontend node positions and sizes use typed-array
  views and proxies.

## Testing

- Run `npm test` after meaningful JavaScript changes.
- The current test suite uses Node's built-in test runner.
- Add focused tests for pure functions when refactoring:
  - `web/js/export/bbox.mjs`
  - `web/js/export/png_embed_workflow.mjs`
  - `web/js/core/utils.mjs`
  - settings/state/storage modules
- Prefer structural assertions over golden image tests.
- Browser/ComfyUI integration behavior should be manually checked when possible and recorded in `AGENTS-STATE.md`.

## Browser Module Cache Updates

- ComfyUI may cache supporting `.mjs` files across backend restarts. A restart alone is not proof that a changed browser module was loaded.
- When `web/js/ui/dialog.mjs` or any module in its static import graph changes, bump the dialog import query in `web/js/main.js`.
- The dialog query string does not automatically version its static dependencies. If a changed dependency was already cached, also revise that dependency's import specifier in its direct importer, then propagate a revision through importers up to `dialog.mjs`.
- After a cache revision, manually reload ComfyUI and verify the affected control or export path in the browser. Record the revision and result in `AGENTS-STATE.md`.

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
