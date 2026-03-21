## 0007: DOM Widget Overlay Policy

### Status

Accepted

### Context

The export pipeline now blends selected DOM-rendered widget content back into
workflow images.

Recent validation established three different classes of behavior:

- VHS video previews can be captured from live DOM video elements when they are
  collected by source URL and drawn on a dedicated path.
- `comfy-multiline-input` can be rendered reliably without DOM capture by
  drawing widget text and resolving an opaque background from parent DOM.
- `comfy-markdown` does not have a stable browser-only, dependency-free
  WYSIWYG capture path. `foreignObject` capture is best-effort and may fail at
  SVG image load time. The stable fallback is rendered text content with an
  opaque background.

### Decision

We keep the current split policy:

1. VHS uses a dedicated live-video overlay path.
2. Multiline text uses text overlay drawing with effective background
   resolution.
3. Markdown is content-first, not WYSIWYG-first.
   - Prefer rendered DOM capture when it works.
   - Fall back to rendered text (`innerText`) with an opaque background.
   - Do not chase browser-only WYSIWYG further under the current
     dependency-free constraint.

### Rationale

- VHS and multiline now have stable, user-visible wins.
- Markdown WYSIWYG remained blocked by browser `foreignObject` limitations and
  XML validity concerns, while the content-first fallback already removes the
  worst failures:
  - raw markdown in exports
  - double-drawing
  - transparent fallback backgrounds
- Continuing to optimize markdown WYSIWYG in the current architecture would add
  risk without a proportional reliability gain.

### Consequences

- Export output now aims for correctness first:
  - VHS preview visible when present in live DOM
  - multiline widget content visible with correct background
  - markdown content readable, but not guaranteed to match frontend WYSIWYG
- Future true markdown WYSIWYG work should be treated as a separate product
  decision and will likely require one of:
  - an additional dependency such as `html2canvas`
  - a server-side render/capture path

### Supersedes / Clarifies

- Clarifies the current state beyond [0002](./0002-offscreen-export-status.md)
- Supersedes the practical outcome of [0004](./0004-vhs-thumbnail-strategy.md)
  for current frontend-based VHS export behavior
