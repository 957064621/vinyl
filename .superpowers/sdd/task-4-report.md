# Task 4 Report: Directional-Light Visual System

## Implementation Summary

- Replaced the blue/rose ambient backdrop with the neutral archive palette and two fixed, masked directional projector beams.
- Added an asymmetric desktop grid and an explicit `max-width: 767px` single-column mobile layout around the existing turntable, metadata rail, and controls.
- Removed global backdrop filters, permanent compositor hints, nonzero letter spacing, obsolete ambient keyframes, and the competing draw-button sweep.
- Kept the existing perimeter-flow implementation and interaction geometry for Task 5; added the Task 4 typography assertion that the base draw button uses `letter-spacing: 0`.
- Restyled the metadata rail, controls, quiet player rail, lyrics, and opaque playlist index without changing markup, controller code, audio behavior, loading/retry behavior, assets, or visible copy.

## RED Evidence

Command: `node --test test/unit/archive-styles.test.js`

Result: exit 1, 1 passing and 4 failing tests. Failures identified missing archive tokens, the old radial ambient field, missing compact/reduce projector rules, and missing `max-width: 767px` layout rules.

## GREEN Evidence

Commands:

    node --test test/unit/archive-styles.test.js
    node --test test/unit/archive-styles.test.js test/unit/draw-button-flow.test.js
    npm run verify
    git diff --check

Results:

- Archive-style test: exit 0, 5/5 passing.
- Focused archive/draw-flow test run: exit 0, 8/8 passing.
- `npm run verify`: exit 0; 170/170 unit tests passed, audit check passed, Vite production build passed, and build-test discovery completed successfully.
- `git diff --check`: exit 0 with no output.

## Files

- Commit: `4e28340 feat: apply directional light archive styling`
- Modified: `src/style.css`
- Added: `test/unit/archive-styles.test.js`
- Modified: `test/unit/draw-button-flow.test.js`
- Updated, uncommitted workflow report: `.superpowers/sdd/task-4-report.md`

## Self-Review

- The final cascade contains no `will-change`, `backdrop-filter`, `ambient-dust-drift`, `ambient-veil-shift`, `btn-sheen-sweep`, or nonzero `letter-spacing` declarations.
- Full profile uses only a finite transform/opacity beam pass during track transitions; compact and reduce are static and unfiltered.
- The unframed turntable, draw-button size/radius/padding, loading gate, metadata/audio interfaces, and DOM structure remain intact.
- The added mobile rules bound the turntable by viewport and height and constrain control labels without adding any new content.

## Concern

The optional Python Playwright visual smoke could not launch because its Chromium executable is not installed locally. No browser was installed or configuration changed; Task 6 should use the repository Node Playwright workflow as planned.

## Review Follow-up

- Replaced every `100lvh` declaration with a `100vh` fallback followed by `100dvh`, including the loading slit and both overlays.
- Added the 768-1023px two-column shell so the desktop three-axis minimums cannot overflow at tablet widths.
- Made terminal archive control, overlay, error, and track-switch rules authoritative: interaction/error colors now use archive projector, silver, and red; non-pill tiles are at 6px or below; and default archive transitions are limited to transform/opacity.
- Appended terminal `prefers-reduced-motion` and `data-motion-profile="reduce"` overrides for the turntable, vinyl, controls, overlays, and text so state changes are immediate and static.
- Reworked `archive-styles.test.js` to extract the terminal archive section and named media blocks without global `lastIndexOf` lookup. The test now guards viewport units, shell axes, tablet/mobile bounds, palette/error states, radii, transition properties, and reduce-profile overrides.

### Follow-up Verification

- `node --test test/unit/archive-styles.test.js test/unit/draw-button-flow.test.js`: exit 0, 10/10 passing.
- `npm run verify`: exit 0, 172/172 unit tests passed; audit check, Vite production build, and build-test discovery passed.
- `git diff --check`: exit 0 with no output.
- `rg -n "100lvh" src/style.css`: exit 1 with no output, confirming no source declarations remain.

## Active-State Transition Re-Review

### RED Evidence

- Added the terminal active-selector assertions and stylesheet-wide active transition guard to `test/unit/archive-styles.test.js` before changing CSS.
- `node --test test/unit/archive-styles.test.js`: exit 1, 7/8 passing. The new assertion failed because terminal `.play-btn:active` did not explicitly declare a transform/opacity-only transition.

### Implementation

- Replaced the inherited legacy `.play-btn:active` and visible lyric/playlist-toggle active transitions so they animate only `transform` and `opacity`.
- Added explicit transform/opacity-only transitions to terminal `.play-btn:active`, `.player-ctrl-btn:active`, and the visible-toggle, overlay-close, playback-mode, and audio-retry active group.
- Retained all existing custom properties, press transforms, and immediate background, border-color, and box-shadow state changes. Task 5 perimeter-flow rules and `test/unit/draw-button-flow.test.js` were unchanged.
- The new guard examines every `:active` rule in the stylesheet and rejects shorthand or `transition-property` declarations other than `transform`, `opacity`, or `none`.

### GREEN Evidence

- `node --test test/unit/archive-styles.test.js test/unit/draw-button-flow.test.js`: exit 0, 11/11 passing.
- `npm run verify`: exit 0, 173/173 unit tests passed; audit check, Vite production build, and build-test discovery passed.
- `git diff --check`: exit 0 with no output.

### Self-Review

- Reviewed every active selector with a transition: legacy active rules contain only transform/opacity transitions, and terminal archive rules explicitly replace the inherited timing with transform/opacity-only transitions.
- The committed diff is restricted to `src/style.css` and `test/unit/archive-styles.test.js`; `.superpowers/` and `test-results/` remain unstaged.

## Active Transition Guard Fix

### Implementation

- Replaced the active-transition shorthand parser with a top-level tokenizer that preserves commas and whitespace inside timing functions. It now finds an explicit transition property regardless of declaration order and fails closed when a shorthand is opaque or otherwise cannot be parsed to exactly `transform`, `opacity`, or `none`.
- The stylesheet-wide active-rule guard now rejects every transition longhand other than `transition-property`, as well as forbidden `transition-property` values.
- The strengthened guard uncovered two legacy overlay-close active longhands. Replaced them with explicit transform/opacity shorthand declarations that retain the prior 100ms timing and zero-delay behavior.

### Regression Coverage

- Added assertions that reject `transition: background ease 180ms`, `transition: var(--active-transition)`, and `transition-duration` in an active rule.
- Added a valid multi-transition assertion with `cubic-bezier()` and `linear()` functions containing commas, confirming those commas do not split transition entries.

### Verification

- `node --test test/unit/archive-styles.test.js test/unit/draw-button-flow.test.js`: exit 0, 11/11 passing.
- `git diff --check`: exit 0 with no output.

### Self-Review

- The final stylesheet-wide scan accepts the existing transform/opacity/none active transitions and rejects reordered, opaque, and longhand transition bypasses.
- No Task 5 test, DOM, controller, audio, accessibility, copy, assets, or motion behavior was changed. The CSS correction is limited to two legacy active overlay transition declarations required for the stylesheet-wide invariant.

## Active Transition Case-Insensitive Follow-Up

### Implementation

- Normalized active-transition declaration identifiers before comparison and made the active selector, `transition`, `transition-property`, and transition-longhand matchers case-insensitive. CSS property-name casing therefore cannot bypass the active-state guard.
- Restored the base `.overlay-close-btn:active` press curve to `var(--continuity-ease)` with the existing 100ms duration and explicit zero delay for both transform and opacity.

### Regression Coverage

- Added rejection coverage for `.uppercase:ACTIVE { TRANSITION: background 180ms; }` and `.property:ACTIVE { TRANSITION-PROPERTY: background; }`.
- Added a direct assertion for the base overlay-close 100ms `var(--continuity-ease)` transform/opacity transition and zero delay.

### Verification

- `node --test test/unit/archive-styles.test.js test/unit/draw-button-flow.test.js`: exit 0, 11/11 passing.
- `git diff --check`: exit 0 with no output.

### Self-Review

- Active selector and declaration matching now follows CSS ASCII case-insensitivity for the guarded identifiers, including `TRANSITION-PROPERTY` and `:ACTIVE`.
- The CSS behavior change is limited to restoring the prior overlay-close press timing curve; Task 5 source, tests, plans, and specs were not changed.

## Active Transition Cascade and Compact Parser Follow-Up

### Implementation

- Split the terminal visible overlay-close active selectors from the lyric, playlist, playback-mode, and audio-retry group. The terminal overlay rule now explicitly restores `transform` and `opacity` to `0.1s var(--continuity-ease) 0s`, so it wins the cascade over the visible overlay selector's prior press rule.
- Made active-rule discovery brace-boundary-aware without requiring a newline before a selector. The boundary is zero-width, allowing adjacent compact rules to be discovered independently without selector text crossing braces.

### Regression Coverage

- Added a terminal-rule assertion for the visible overlay-close selectors and their exact restored 100ms continuity timing.
- Added a compact mixed-case forbidden rule (`a {} .compact:AcTiVe { ... }`) that the stylesheet-wide active transition guard must reject.

### Verification

- `node --test test/unit/archive-styles.test.js test/unit/draw-button-flow.test.js`: exit 0, 11/11 passing.
- `git diff --check`: exit 0 with no output.

### Self-Review

- The visible overlay-close pair retains its archive active colors and immediate press-state visual changes while using its independent 100ms transition; the lyric/playlist/mode/audio group remains at its existing 180ms timing.
- Only `src/style.css` and `test/unit/archive-styles.test.js` will be staged. Task 5 plan/spec files, `.superpowers/`, and `test-results/` remain unstaged.
