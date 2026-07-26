# Visual 8: Slower, Softer Poster Handoffs

## User-visible outcome

The current poster changes feel too fast and hard, and the final full-width white exposure looks cheap. Rework the existing single-poster loading choreography so it feels soft, elegant, continuous, and iOS-like. Keep the existing light-particle scatter plus sliced light-curtain vocabulary, but remove the final white flash entirely.

Evidence: `/tmp/vinyl-motion-before-contact-sheet.png` and `/tmp/vinyl-visual8-motion-audit.md`.

## Scope

Modify only when required:

- `src/ui/poster-transition.js`
- `src/ui/light-particle-field.js`
- `src/ui/loading-screen.js`
- `src/style.css`
- `test/unit/poster-transition.test.js`
- `test/unit/light-particle-field.test.js`
- `test/unit/loading-screen.test.js`
- `test/e2e/loading-poster-transition.spec.js`

Do not touch the paused Task 10 files: `src/main.js`, `src/motion/`, `src/app/transitions.js`, `test/unit/motion-controller.test.js`, or `test/unit/audio-controller.test.js`.

## Fixed invariants

- Reuse only the five decoded cover nodes, one existing Canvas, and the three existing slit spans.
- Add no image, production request, visible text, character, DOM node, dependency, external URL, blur, filter, shadow animation, backdrop filter, clip path, perspective, rotation, or permanent `will-change`. CSS linear gradients on the three existing slit spans are allowed and required to avoid solid rectangular light blocks.
- Preserve FIFO decoded-node ownership, retry/failure behavior, root-only transition-end filtering, accessibility isolation, stale-token cancellation, and full/compact profile switching without cancelling or reordering the in-flight poster.
- One accessible active poster; at most one visual outgoing poster; no blank handoff after the first stable poster.
- `reduce` remains an exact direct `120ms linear` image/root opacity fade, zero Canvas frames, hidden slit, and no translation or scale.
- Full/compact DOM animation uses only opacity and transform. Compact must retain no effect-attributable task over 50ms.

## Exact timing table

Keep immutable `normal` and `compressed` scenes per profile. Reveal, outgoing poster motion, particle scatter, and ordinary light-curtain settlement use the same `handoff` duration so the planes do not move and fade on mismatched clocks.

```js
full: {
  normal: { gather: 220, handoff: 820, hold: 420 },
  compressed: { gather: 160, handoff: 620, hold: 260 },
  finalHold: 840,
  finalResolve: 1100,
  exitLead: 620,
  rootFade: 680
}
compact: {
  normal: { gather: 180, handoff: 720, hold: 360 },
  compressed: { gather: 120, handoff: 560, hold: 240 },
  finalHold: 720,
  finalResolve: 920,
  exitLead: 520,
  rootFade: 560
}
reduce: { fade: 120 }
```

Scene wall times are therefore full `1460/1040ms` and compact `1260/920ms`. Compression still begins only when pending queue length exceeds two and remains until the queue drains. A final poster always receives its profile `finalHold` total, never the compressed hold.

## Ordinary handoff

Use a dedicated symmetric `cubic-bezier(0.42, 0, 0.58, 1)` for incoming/outgoing poster opacity and transform, so the visible crossfade is distributed across the full duration instead of front-loading the change. Use `cubic-bezier(0.4, 0, 0.2, 1)` for ordinary and final directional light-beam travel so the beam visibly glides across rather than jumping then idling. Particle position uses smootherstep in Canvas. Use `cubic-bezier(0.32, 0.72, 0, 1)` only for quiet root fade/tails.

Start slit ignition at 45% of gather, before changing poster dominance. The finite slit duration is the remaining 55% of gather plus the handoff duration. Gather completion still gates the semantic handoff.

Poster planes remain complete and horizontal-only:

- full incoming: `translateX(+/-0.9%) scale(0.997)` to identity;
- full outgoing: identity to mirrored `translateX(+/-0.75%) scale(0.996)`;
- compact incoming: `translateX(+/-6px) scale(0.998)` to identity;
- compact outgoing: identity to mirrored `translateX(+/-5px) scale(0.997)`.

Incoming and outgoing opacity and transform use the same handoff duration and the exact symmetric handoff easing. Their effective opacity sum must stay at least `0.94`, with no more than two visual layers and no more than one layer above `0.55`. For every non-first handoff, the incoming effective-opacity interval from `0.15` through `0.85` must span at least `210ms` and include at least eight requestAnimationFrame samples; both conditions are required.

Ordinary parent slit opacity at `0/18/42/60/82/100%` is exactly `0/0.025/0.18/0.28/0.09/0`. Parent LTR travel is `translate3d(-112%, -50%, 0)` to `translate3d(12%, -50%, 0)`; RTL mirrors it. Core/warm/cool peak opacity is at most `0.62/0.26/0.23`, and all three decrease monotonically after the parent peak. Replace every solid `rgba(...)` span background with a directional `linear-gradient(...)` whose outer stops are fully transparent. Narrow the effective bright region inside the existing spans: the core may occupy at most the central 36% of its box and each edge beam must fade to transparent before its outer 55%. No frame may expose a visible rectangular boundary or a near-uniform white region across more than 35% of the viewport width. The light remains visibly attributable: its luminance centroid must move monotonically in the item's direction across sampled frames, completing one pass without reversal or looping.

## Particle energy

Keep 64 particles/DPR 1.5 in full and 28/DPR 1.25 in compact. Replace position smoothstep with smootherstep `p^3 * (p * (6p - 15) + 10)` so velocity is zero at both ends.

Use Canvas `globalAlpha` and trail-length multipliers without filters:

- gather at progress `0 / 0.35 / 1`: alpha `0.04 / 0.20 / 0.36`, trail multiplier `0.35 / 0.72 / 1`;
- retained gathered terminal: alpha `0.36`, no RAF;
- scatter at progress `0 / 0.45 / 1`: alpha `0.36 / 0.24 / 0`, trail multiplier `1 / 0.68 / 0.12`.

The first scatter frame must reuse the gathered records and terminal coordinates. Store enough rendered energy state that a resize redraw preserves the exact retained appearance. Scatter settlement, retry, failure, exit, and destroy clear all pixels and leave no RAF.

## Final poster resolve

Delete the generic full-width `loading-final-exposure` animation and its `scaleX(1)` white slab. The last poster remains fully readable through `finalHold` and is not independently faded or transformed during closure.

After that hold, continue the last poster direction with `loading-final-ltr` or `loading-final-rtl` on the existing parent slit and separate finite final animations on the existing core/warm/cool children. Parent opacity at `0/18/38/52/70/86/100%` is exactly `0/0.03/0.14/0.22/0.11/0.03/0`. Final core/warm/cool peak opacity is at most `0.52/0.22/0.20`. The parent never reaches a full-width opaque state and never uses `scaleX(1)`.

The final resolve lasts `1100ms full / 920ms compact`. It uses the same transparent directional beam gradients and must never fall back to solid span backgrounds. `finish()` opens the exit gate only after the peak, at `620ms / 520ms`, while the low-energy directional light tail continues. `exit()` starts the profile root fade (`680ms / 560ms`) and removes the loading root only after both root opacity and final slit opacity are zero. The healthy path must not force `animation: none`; retain a bounded duration-plus-80ms fallback. Reset/freeze/destroy cancels both gate and final tail so stale completion cannot mutate a later run.

## Tests and evidence

Follow TDD. Update timing/CSS tests before production code. Preserve the real stale-completion test from commit `be4ad3e`.

Required focused commands:

```sh
node --test test/unit/poster-transition.test.js test/unit/light-particle-field.test.js test/unit/loading-screen.test.js
npx playwright test test/e2e/loading-poster-transition.spec.js
```

E2E must retain exact five cover requests, max concurrency 2, decoded node identity, one semantic active poster, uncropped geometry, no blank handoff, Canvas continuity/cleanup, no post-settlement frames, failure/retry behavior, and mobile long-task limit. Add timestamped checks proving compact compressed handoffs are at least 900ms and final exit does not contain the old full-width white slab. At ordinary and final peak, sample a horizontal screenshot luminance profile: both outer edges must remain close to the loading background, the center peak must stay bounded, and no contiguous near-uniform bright run may cover more than 35% of viewport width. This browser pixel check supplements, not replaces, manual review of the complete video.

Record a new 390x844 video from `http://127.0.0.1:5173/`, make a contact sheet in `/tmp`, inspect it beside the before sheet, and report the paths. Run `npm run verify`, `npm run test:e2e`, and `git diff --check`. Because paused Task 10 red tests are uncommitted in the shared tree, first run broad verification from a temporary clean worktree or temporarily exclude only those two unrelated files without altering/deleting them. Never stage `test-results/` or Task 10 files.

Commit only Visual 8 files with message `refine: soften poster archive motion`. Append full commands, outputs, measured scene durations, long-task count, request count, and visual evidence paths to `/tmp/vinyl-visual8-report.md`.
