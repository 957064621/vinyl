# Draw Button Flowing Light

## Reference and intent

Reference: `/Users/yuko/.codex/attachments/c989f15d-2fbe-47a7-bf3f-6938acc9f750/pasted-text.txt` (`Glowing Shadow`). Borrow only the idea of a restrained light trace moving around a surface. Do not copy its card dimensions, rainbow hue cycling, blur, scale changes, mix-blend modes, or heavy shadow pulse.

The existing draw button must keep exactly the same size, glass material, typography, geometry, layout, hover/active response, and text-transition behavior. Add a subtle archive-light perimeter pass that belongs to the existing cold light palette.

## Files and ownership

- Modify `src/style.css`.
- Add or modify only focused button visual tests under `test/unit/` and `test/e2e/`.
- Do not change `index.html`, `src/main.js`, button text, DOM, dependencies, assets, requests, or any Task 10 file.

## Geometry/material lock

Before and after computed styles must match for:

- desktop `.play-btn`: width `136px`, height `48px`, border radius `999px`;
- mobile `.play-btn`: width `106px`, height `46px`, same pill radius;
- padding, margin, font family, font size, weight, letter spacing, base background layers, backdrop filter, border, base box shadow, transform, and dynamic-island slot geometry;
- `::before`, `::after`, and current `.btn-sheen::after` surface/sheen behavior unless a conflict is proven by a visual test.

Do not change perceived fill opacity or glass texture. At the brightest flow frame, the central 70% interior average pixel delta versus idle must remain below 4/255 per RGB channel; the visible change belongs to the outer 2px perimeter and the existing external glow only.

## Motion implementation

Use the existing `.btn-sheen` node. Add `.btn-sheen::before` as a 1px masked perimeter layer with:

- a conic gradient containing one narrow cool-white head, a faint `var(--cover-a)` lead, and a faint `var(--cover-b)` tail;
- transparent remainder, no rainbow hue rotation;
- `-webkit-mask`/`mask` content-box exclusion so only the perimeter is painted;
- no blur, filter, mix-blend-mode, new box shadow, or layout property animation;
- a registered angle custom property only if required for a clean border orbit; provide a static transparent fallback when registration/animation is unsupported.

One pass is finite and quiet: a visible orbit lasts `1200ms` with `cubic-bezier(0.4, 0, 0.2, 1)`, followed by an idle interval. Full profile repeats every `7200ms`; compact repeats every `9600ms` with peak opacity at most `0.58`; full peak opacity at most `0.72`. The light head occupies at most 32 degrees of the perimeter gradient. It must not loop continuously at constant brightness.

The effect pauses when the button has `data-busy`, when an overlay hides the primary control, or when the document is hidden if the current visibility controller exposes a class/state usable from CSS. It resumes from a clean cycle rather than jumping. Do not add a document listener solely for this decorative effect.

`prefers-reduced-motion: reduce` and the app `reduce` profile disable `.btn-sheen::before` animation and set its opacity to zero. Keep the existing `.btn-sheen::after` reduce handling.

## Performance and visual gates

- No button or island dimension/layout shift across idle, flow peak, hover, active, busy, split, and collapse states.
- No persistent `will-change` for the new perimeter effect.
- Pixel 5 compact: zero effect-attributable long task over 50ms during two cycles; no animation while loading overlay is present.
- Desktop and 390x844 video evidence must show the light following the pill edge, not crossing the label or changing the glass fill.
- Reduced motion screenshot must show the unchanged original button with no perimeter frame.
- Browser sampling must prove pixel change is concentrated at the perimeter and that the label bounding box and computed button geometry remain byte-for-byte/numerically unchanged.

Use TDD, run focused unit/E2E, `npm run verify`, `npm run test:e2e`, and `git diff --check`. Append evidence to `/tmp/vinyl-draw-button-flow-report.md`. Commit only this task's files with `refine: add restrained draw-button light flow`; never stage `.superpowers/`, `test-results/`, or paused Task 10 files.
