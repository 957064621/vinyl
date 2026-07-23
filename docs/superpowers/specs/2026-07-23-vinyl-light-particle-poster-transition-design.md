# Vinyl Light Particle Poster Transition Design

**Date:** 2026-07-23

**Status:** Approved visual direction

## Goal

Replace the functional five-frame loading contact sheet with a cinematic, single-poster sequence that combines light-particle gathering and scattering with a sharp light-slit reveal. The sequence must feel visually forceful while preserving the existing decoded-image gate, retry behavior, keyboard isolation, and mobile performance limits.

## Fixed Constraints

- Reuse only the five existing covers in `CRITICAL_IMAGE_MANIFEST`; do not add searched, stock, generated, or third-party imagery.
- A poster may enter the sequence only after its existing image element has completed `load` and `decode`.
- Keep all non-loading application UI `inert` and `aria-hidden` until all five images are ready and the final loading transition settles.
- Loading and decoding continue with concurrency `2`; visual sequencing must not serialize or delay network work.
- A failed slot remains visible as a recoverable error and the retry button receives focus.
- Mobile `compact` mode must not use live blur, shadow animation, filter animation, or an unbounded particle count.
- `reduce` mode uses direct fades only and does not run particles, slit travel, parallax, or scattering.

## Visual Composition

The loading screen is a full-viewport dark projection field with one dominant poster visible at a time. The poster is unframed and shown with `object-fit: contain`, so the complete existing cover remains inspectable rather than being cropped into a background texture.

Five `data-loading-slot` elements remain in the DOM to preserve per-asset status and retry semantics, but CSS layers them into one stage instead of a contact-sheet grid. Only the active slot is visible. A restrained accession counter and progress output remain at the screen edges; they must not compete with the poster.

The stage includes:

- one full-poster plane for each decoded cover;
- one narrow solid light slit made from transformable DOM strips;
- one transparent Canvas particle field above the poster and below loading controls;
- one minimal progress rail and the existing retry control.

No additional image request may be introduced by HTML, CSS, Canvas, or a duplicate poster node. The exact decoded image node mounted by the loader is the visual source.

## Transition Sequence

Each decoded image is enqueued immediately without awaiting animation from the loader progress callback. A single visual queue owns poster transitions so network workers remain independent.

For each poster:

1. **Gather:** warm-white and cool-white light particles move from the viewport perimeter toward the future poster bounds.
2. **Ignition:** a narrow light slit appears through the poster center. Its travel direction alternates left-to-right and right-to-left between posters.
3. **Reveal:** the poster opens from the slit using `clip-path` and a small transform offset. The full cover reaches stable opacity without blur.
4. **Hold:** the cover remains readable while the archive counter advances.
5. **Scatter:** the outgoing cover separates into two shallow transform planes while particles move away from the slit. The next decoded poster enters from the opposite direction.

When all five images have decoded, `playReadySequence()` waits for the visual queue to drain. The final poster holds briefly, the slit expands into a full-width white exposure, and the loading layer exits to reveal the turntable. The ready promise resolves only after this exit completes.

When several images decode faster than the animation queue, timing compresses rather than making the user wait through five long scenes. Normal timing targets about `800 ms` per poster. With a backlog of more than two posters, intermediate scenes compress to about `440 ms`; the final poster retains a readable hold. After the fifth decode, the remaining sequence should settle within roughly `2.8 s` on a healthy device.

### Elegance Refinement

The visual tone is restrained, elegant, and continuous rather than flash-cut or explosive. Once a first poster is visible, no subsequent transition may create a blank stage between posters. The outgoing poster becomes an `is-outgoing` visual layer and is immediately hidden from the accessibility tree; the incoming poster becomes the sole `is-active` semantic layer while both visual opacity envelopes overlap briefly.

All full and compact poster movement uses the same non-linear `cubic-bezier(0.22, 1, 0.36, 1)` family. The light slit follows a finite intensity envelope: low ignition, controlled peak below solid white, then gradual decay to zero. Removing the slit class occurs only after its opacity has reached zero, so no light layer appears or disappears in one frame. The final full-width exposure also peaks below opaque white and fades down before the loading screen exits.

The normal loading state displays only decoded progress and a short Chinese status. English archive headings and normal-state accession captions are not visible. `AR-01` through `AR-05` identifiers appear only when the corresponding failed slots must be named. Decorative text remains `aria-hidden`; progress remains the single polite live region.

### Elegance Refinement Addendum (Visual 6)

This addendum supersedes only the earlier numeric timing and light-envelope details. It does not replace the decoded-image gate, queue ownership, Task 4 continuity classes, Task 5 browser/performance coverage, or any error and retry contract.

#### Exact Choreography

Full and compact motion keep the existing `gather -> overlapped slice/scatter -> hold` state order and use `cubic-bezier(0.22, 1, 0.36, 1)` for poster opacity, transform, `clip-path`, light-curtain travel, progress, copy, and loading-screen exit. No full or compact loading transition uses a linear curve.

| Queue mode | Gather | Slice and scatter | Hold | Scene wall time |
| --- | ---: | ---: | ---: | ---: |
| Normal | 180 ms | 320 ms reveal with 260 ms outgoing scatter | 300 ms | 800 ms |
| Compressed | 80 ms | 180 ms reveal with 150 ms outgoing scatter | 180 ms | 440 ms |

Scene wall time is `gather + max(reveal, scatter) + hold`; reveal and scatter start in the same turn. The final poster receives at least `560 ms` total readable hold. The final exposure lasts `640 ms` and reaches opacity `0` before loading-screen exit begins. `reduce` remains a `120 ms` direct opacity fade with no gather, slit, parallax, scatter, or Canvas frame.

During gather, the current poster remains stable and readable. At slice start, the prior slot becomes visual-only `is-outgoing` and its image is immediately `aria-hidden`; the incoming slot becomes the only semantic `is-active` poster. There may be at most one outgoing continuity layer, and there must never be a sampled full/compact frame with neither an active nor outgoing visible image. At slice settlement, the outgoing layer and slit are already at opacity `0` before their transient classes are removed. Cancellation, retry, freeze, profile change, and destroy clear every transient class and duration property so a stale completion cannot change a later run.

#### Light Curtain And Poster Planes

The existing warm edge, white core, and cool edge strips form one sliced light curtain; no element is added. Their parent opacity envelope is exactly `0` at 0%, `0.10` at 16%, `0.68` at the 42% peak, `0.34` at 64%, `0.12` at 82%, and `0` at 100%. After the peak, every listed opacity is strictly lower than the previous value. The three existing strips fan apart with transform and opacity only, then reach opacity `0` before `is-lit` is removed. The final exposure uses `0 -> 0.68 -> 0.30 -> 0.10 -> 0` at 0%, 34%, 62%, 84%, and 100%.

The outgoing cover moves no more than `2.4%` horizontally and `0.6%` vertically in full mode, with at most `1.2deg` rotation and a minimum scale of `0.992`. Compact mode uses at most `14px` horizontal movement, `2px` vertical movement, no perspective, and the same opacity envelope. The incoming cover remains complete and uncropped with `object-fit: contain`; the slit reveal may change only opacity, transform, and `clip-path`.

#### Density, Assets, And Verification

Normal loading exposes only the decoded count and the existing short Chinese status. It adds no heading, subtitle, phase label, keyboard hint, decorative character, or new visible identifier. `AR-01` through `AR-05` remain hidden unless a failed slot must be identified. The sequence continues to use only the five existing manifest covers and the exact mounted decoded image nodes; it adds no DOM node, duplicate image, CSS image, Canvas image, or request.

Task 5's browser assertions remain mandatory. Its one-active-poster and "no overlap" requirements mean no second semantic or dominant readable poster; they do not prohibit Task 4's one short, `aria-hidden` outgoing continuity residue. Visual 6 additionally samples full and compact handoffs after the first stable poster: at most two visual poster layers may coexist, at most one image may have computed opacity greater than `0.55`, and the sum of active plus outgoing image opacity may not fall below `0.70`. Pixel 5 `compact` runs must still report no effect-attributable long task over `50 ms`, no more than 28 particles, and no frame after settlement. Static tests must reject loading-poster blur, `filter`, animated shadow, `backdrop-filter`, new loading markup, new image references, or visible normal-state captions.

## Particle Field

Create a focused Canvas controller with no image sampling and no CORS dependency. It receives poster bounds and exposes gather, scatter, resize, profile-change, and destroy operations.

- `full`: at most `64` particles, device pixel ratio capped at `1.5`.
- `compact`: at most `28` particles, device pixel ratio capped at `1.25`.
- `reduce`: zero particles and no animation frame loop.

Particles are simple points and short line fragments in neutral warm and cool light tones. The controller animates only while a gather or scatter command is active, cancels its frame on settlement, pauses when the document is hidden, and releases its backing store on destroy. It must not create an idle infinite loop.

The effect must use bounded geometry and deterministic lifecycle state. Tests use an injected frame scheduler and deterministic random source; production may use `Math.random`.

## Motion Profiles

### Full

- Up to 64 Canvas particles.
- Alternating slit direction, shallow two-plane poster separation, and small perspective offset.
- Poster animation uses `transform`, `opacity`, and `clip-path` only.

### Compact

- Up to 28 Canvas particles.
- Shorter gather and scatter distance.
- One poster plane, no perspective, no animated filter, and no shadow animation.
- Transition duration is compressed and the layout remains stable on narrow mobile screens.

### Reduce

- No Canvas rendering or animation loop.
- No slit travel or split-plane movement.
- The newest decoded poster replaces the prior poster with a short opacity change; exit is immediate after the ready state is announced.

## Components And Ownership

- `src/ui/light-particle-field.js`: bounded Canvas renderer and lifecycle only.
- `src/ui/poster-transition.js`: deterministic poster queue, backlog compression, active-slot classes, slit direction, and settlement promise.
- `src/ui/loading-screen.js`: retains loading state, progress, retry, decoded-node mounting, and delegates visual transitions to the poster controller.
- `src/app/bootstrap.js`: continues to own the critical gate and awaits the loading view's final ready sequence before releasing `#appRoot`.
- `index.html`: supplies the single-stage loading structure, Canvas, slit strips, five status slots, progress, and retry control.
- Loading CSS remains scoped to the loading screen until the broader stylesheet split in Task 12.

The asset loader must not import UI or motion code. The poster queue must not fetch, clone, or decode images.

## Error Handling

If one or more assets fail, the current poster freezes in a stable state, active animation frames stop, failed slot identifiers remain available to the loading view, and the retry command is shown and focused. Retry resets poster classes, clears the queue, clears Canvas pixels, removes previously mounted images, and starts one new critical-load run.

An animation failure must not be reported as an image network/decode failure. The loading view records the visual error, settles the current animation, and preserves the retry surface. Actual `CriticalAssetError` remains the primary source for failed slot names.

## Accessibility

- The particle Canvas and light slit are `aria-hidden` and never focusable.
- The active poster keeps the manifest alt text; inactive poster images are hidden from the accessibility tree.
- Progress stays in the existing polite live region and reports decoded counts, not decorative animation phases.
- The application root stays inert during loading, visual playback, and error states.
- Retry is the only interactive loading control and receives focus on failure.

## Verification

Unit tests must prove:

- no poster becomes active before a decoded result is mounted;
- rapid ready events are queued without blocking the loader callback;
- only one poster is active at a time and order remains deterministic;
- backlog compression preserves the final poster hold;
- `playReadySequence()` waits for queue settlement;
- retry clears queued work, Canvas state, and mounted images;
- `compact` particle count never exceeds 28 and `reduce` creates no frame loop;
- stale transition completions cannot reactivate a prior poster.

Browser verification must cover desktop Chromium, Pixel-class mobile Chromium, and reduced motion. Screenshots must confirm a complete uncropped poster, readable progress, no overlap, and the loading layer above application overlays. Performance traces on the mobile profile must show no task longer than `50 ms` caused by the effect and no animation frame loop after exit.

## Integration With The Existing Plan

This visual increment replaces the loading-screen portion of Task 12 while preserving Tasks 5 and 6 contracts. The remaining Task 12 light-archive typography, player surface, overlay, and stylesheet split still proceed later. Task 8's OSS mutation remains a separate credential-gated release operation and does not block use of the existing five loading covers in this transition.
