# Vinyl Lamp Portal, Particle Stream, and Player Handoff Design

**Date:** 2026-07-27

**Status:** Approved visual direction

## Goal

Refine the loading sequence so each poster travels through a spatial portal inspired by the portfolio homepage lamp, then hand the final poster to the turntable without a visible hitch. The portal must grow from a short ignition mark into a full-height opening with layered light, use a restrained scanner-like particle stream, and look materially consistent on desktop and mobile.

This design supersedes the current thin scanner-line experiment, the final animated `clip-path` handoff, the older full-profile cap of 64 particles, and the blanket compact-profile prohibition on blur. Compact may use the bounded fixed-radius portal and final-ambient blur layers defined here; it still cannot animate blur radius or run an unbounded blur surface. The existing decoded-image gate, loading order, retry behavior, motion profiles, and turntable application remain unchanged.

## Locked Visual Intent

- The portal reads as a spacetime tunnel opening, not as a black-core lamp or a standalone scanner line.
- Its entrance borrows the portfolio homepage lamp rhythm: a short ignition, an elegant length expansion, then delayed bloom from wider light layers.
- The poster begins crossing only after the opening is visibly established.
- The supplied Scanner Card Stream is a particle-motion reference, not an implementation template. The desired quality is a dense-looking stream born along the portal edge with small additive points, short trails, and finite lifetimes.
- Desktop and mobile use the same portal proportions, normalized timing curve, light hierarchy, and phase order.
- Blur remains part of the art direction. Blur radii stay fixed during an active phase; opacity and transform create the motion.
- The final poster-to-turntable transition prioritizes uninterrupted spatial continuity and stable frame pacing.

## Current Failure Modes

The current loading CSS contains multiple generations of portal styling. Base slit, stage rail, later tunnel, scanner-line, compact, and final-ambient rules overlap. The mobile breakpoint changes portal height and width independently, so the same state does not produce the same composition across profiles.

The final handoff currently combines an animated rectangular-to-round `clip-path`, a two-axis mask, poster translation and scaling, large blurred ambient layers, loading-root opacity, and the revealed player underneath. Those effects overlap in one short interval and can force repeated rasterization at the exact moment visual attention is highest.

The particle controller also supports a repeating hold command. A decorative loop during stable poster display adds work without advancing the transition and must not overlap the final handoff.

## Portal Composition

The existing `#loadingLightSlit` element remains the portal coordinate system. No React, Three.js, WebGL renderer, image request, or permanent DOM layer is added.

The portal uses the existing child spans plus bounded pseudo-elements:

- The parent owns the measured position, target height, lifecycle opacity, and length expansion.
- The core span draws two narrow luminous rims separated by a transparent aperture. The middle is not painted black; the loading background naturally supplies the tunnel depth.
- The warm and cool spans provide near-field refraction and a wider outer haze.
- Parent pseudo-elements form the directional conic light sheets derived from the portfolio lamp beams, rotated into a vertical portal.
- Every blurred layer has an explicit bounded box, `contain: paint`, and a fixed blur radius. Near refraction uses 10 px and the outer haze uses 22 px in both full and compact profiles. Their cached results move only through `transform` and `opacity`.

Portal height comes from the rendered artwork box, not viewport-only breakpoints. The target is the artwork height plus an 8% breathing margin, clamped inside the loading stage. The left and right portal positions come from the measured artwork edges. Desktop and mobile use the same calculation.

## Portal Choreography

Full and compact profiles share one normalized 760 ms portal envelope. Compact changes rendering budget, not the visible choreography.

1. **Ignition, 0-120 ms:** the portal fades from zero and grows from roughly 14% to 28% of target length around its center.
2. **Expansion, 120-420 ms:** the luminous rims extend toward full height on a fast, controlled `cubic-bezier(0.16, 1, 0.3, 1)` curve.
3. **Bloom, 200-520 ms:** near refraction and outer conic light layers follow 80-120 ms behind the rim. Their fixed blur fields expand with transform and opacity.
4. **Traversal, 260-650 ms:** the poster crosses the portal boundary after the opening is established. Portal particles peak around the leading poster edge.
5. **Extinguish, 650-760 ms:** particle energy reaches zero first; the light field then fades with a slight 1.02 length settle rather than disappearing or snapping shorter.

The left portal emits the incoming poster. The right portal receives the outgoing poster. Only the active side is lit, and the portal is fully dark during a stable poster hold.

## Particle Stream

`src/ui/light-particle-field.js` remains a finite Canvas 2D controller. The Scanner Card Stream informs the emitter geometry and additive point treatment, but its always-running Three.js field, 800-to-2500 Canvas particles, per-frame random alpha mutation, DOM scanning, and React state updates are intentionally excluded.

The revised controller uses:

- a cached offscreen radial sprite for warm-white and cool-white points;
- `globalCompositeOperation = "lighter"` during particle drawing;
- preallocated numeric storage, with no object creation or random generation inside the frame loop;
- particles born along the measured portal height with a 1-3 px cross-axis jitter;
- short directional drift and short trails aligned with poster travel;
- a finite energy envelope tied to portal ignition, traversal, and extinguish;
- the existing upper bounds of 84 particles for `full`, 28 for `compact`, and zero for `reduce`.

Incoming particles drift from the left aperture into the stage. Outgoing particles converge toward the right aperture before disappearing. Perceived density comes from the cached glow sprite, additive overlap, staggered lifetime, and trail length rather than a large particle count.

There is no particle hold loop. The Canvas stops scheduling frames and clears after each portal phase, on failure, on profile replacement, when the document is hidden, and before final handoff.

## Final Poster-to-Turntable Handoff

The final handoff is a separate phase and never runs portal particles.

1. Settle and clear the particle controller.
2. Measure the final poster and target vinyl cover once.
3. Prepare the existing target cover with the same decoded artwork and place it at opacity zero.
4. On the next animation frame, animate the poster toward the target using only `transform` and `opacity`.
5. Begin the target-cover crossfade after the source has completed most of its travel. The two layers overlap so combined artwork visibility never falls below 0.85.
6. Start the loading-root fade only after the target cover is visibly established.
7. Remove transient promotion hints and handoff styles after settlement.

The source keeps its existing static soft-edge mask during travel. The mask does not animate. The rectangular-to-round animated `clip-path` is removed; the circular target cover owns the final shape during the crossfade.

The two blurred final-ambient layers remain at fixed 22 px and 19 px radii. Their boxes are bounded, and only opacity and transform animate. No handoff keyframe changes `filter`, `backdrop-filter`, mask geometry, width, height, or shadow geometry.

## Motion Profiles

### Full

- Portal envelope: 760 ms.
- Up to 84 Canvas particles at DPR capped at 1.5.
- Full bounded near-field and outer-haze layers.
- Final handoff uses composited transform and opacity with bounded fixed-blur ambience.

### Compact

- The same 760 ms portal envelope, geometry ratios, and light hierarchy.
- Up to 28 Canvas particles at DPR capped at 1.25.
- Smaller backing-store cost and fewer particle trails, without changing the portal silhouette.
- Final handoff follows the same phase offsets and easing as full mode.

### Reduce

- No portal expansion, particle frame, translation, scale, animated blur, or spatial handoff.
- The existing direct 120 ms opacity fade remains.

## Component Ownership and Data Flow

- `src/ui/poster-transition.js` owns portal phase timing, measured portal geometry, poster state, and final settlement order.
- `src/ui/light-particle-field.js` owns only finite Canvas particle rendering and cleanup.
- `src/ui/loading-screen.js` measures and prepares the existing poster and turntable target for final handoff.
- `src/style.css` owns portal layers, fixed blur values, shared responsive proportions, and composited motion keyframes.
- `test/unit/` verifies lifecycle, timing, cleanup, and CSS contracts.
- `test/e2e/loading-poster-transition.spec.js` verifies rendered geometry, continuity, desktop/mobile parity, and performance.

One portal phase passes measured artwork bounds and side to the particle controller. The particle promise settles before the poster state becomes stable. The final sequence clears particles before preparing the player target. Loading-screen removal remains gated by both handoff settlement and root fade completion.

## Cancellation and Error Handling

Reset, retry, freeze, switch to `reduce`, visibility loss, and destroy must cancel the active animation frame, resolve or reject pending work exactly once, clear the Canvas, remove portal datasets, and restore one stable poster state.

A stale portal or handoff completion cannot mutate a later loading run. If final target measurement is invalid, the sequence falls back to a transform-free source/target crossfade instead of retaining the loading screen or attempting animated geometry with invalid values.

## Verification

Unit coverage must prove:

- full and compact share portal geometry ratios, phase offsets, and easing;
- compact does not substitute a different portal shape;
- portal blur values are fixed and no keyframe animates `filter` or `backdrop-filter`;
- final handoff does not animate `clip-path`, mask geometry, filter, dimensions, or shadows;
- particle storage stays within 84/28/0 profile limits;
- no frame is scheduled after portal settlement, final handoff start, clear, reduce, or destroy;
- cancellation and stale completion preserve one stable active poster.

Browser verification covers desktop Chromium, Pixel-class mobile Chromium, and reduced motion. It must capture ignition, expansion, traversal, and final handoff frames and assert:

- desktop and mobile portals use matching normalized height, aperture, and bloom ratios;
- the portal grows from short to full length before poster traversal;
- particle pixels appear around the active portal and disappear before stable hold;
- combined final source/target artwork visibility never drops below 0.85;
- no effect-attributable long task exceeds 50 ms;
- no incoherent overlap or blank frame appears;
- Canvas frame count remains unchanged after portal settlement and loading removal;
- the loading layer is removed and the player remains interactive.

Run `npm run test:unit`, `npm run build`, the focused loading-poster Playwright suite, and desktop/mobile screenshot inspection before completion.

## Non-Goals

- No direct dependency on Three.js, React, or the referenced component package.
- No 800-to-2500 particle field, continuous ambient particle loop, ASCII scramble, card stream, or scanner controls.
- No new visible copy, loading asset, duplicate poster image request, or player redesign.
- No unrelated refactor of the broader archive interface.
