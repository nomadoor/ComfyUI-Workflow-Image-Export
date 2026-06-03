# AGENTS.md

This file defines working rules for coding agents in this repository.

## Project Shape

- This is a ComfyUI frontend extension for exporting workflow images.
- Python is only the custom-node entry point: `__init__.py` exposes `WEB_DIRECTORY`.
- The product code is JavaScript under `web/js/`, with styles under `web/css/`.
- Current repair focus is ComfyUI Classic / LiteGraph legacy export.
- Node 2.0 support is not part of the legacy repair path. Treat it as a future backend with a different architecture.

## Current Priorities

1. Stabilize and simplify the legacy export path.
2. Keep the context menu and dialog usable in current ComfyUI Classic.
3. Preserve PNG/WebP export, PNG workflow embedding, background options, padding, and selection cropping.
4. Add tests around fragile pure logic before or while refactoring it.
5. Avoid expanding scope into Node 2.0, SVG export, or a new UI framework during the legacy cleanup.

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

## Testing

- Run `npm test` after meaningful JavaScript changes.
- The current test suite uses Node's built-in test runner.
- Add focused tests for pure functions when refactoring:
  - `web/js/export/bbox.js`
  - `web/js/export/png_embed_workflow.js`
  - `web/js/core/utils.js`
  - settings/state/storage modules
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
