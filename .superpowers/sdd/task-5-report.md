# Task 5: Draw Button Perimeter-Light Loop

## Scope

Adapted the existing draw button without changing its DOM. The perimeter mask now lives on `.btn-sheen`; its oversized square `::before` rotor makes one quiet full-profile pass. `.play-btn::after` is a synchronized low-energy outer-edge halo. Compact is static and reduced motion is dark.

Changed tracked files:

- `src/main.js`
- `src/style.css`
- `test/unit/draw-button-flow.test.js`
- `test/e2e/draw-button-flow.spec.js`

This report and Playwright output remain untracked and were not staged.

## RED Evidence

Command:

```sh
node --test test/unit/draw-button-flow.test.js
```

Result: exit 1, 0 passed / 3 failed. The old implementation used registered `--btn-flow-angle` and separate full/compact orbit and fade loops; it had neither `btn-perimeter-pass` nor `btn-halo-pulse`, did not provide the static compact contract, and lacked the document-hidden hook.

## Implementation

- Removed the custom-angle property animation and competing compact loops.
- Added exactly one `btn-perimeter-pass` and one `btn-halo-pulse`, both on the existing `7200ms` cycle. The active phase ends at `16.667%`; the perimeter transform travels continuously from `0turn` to `1turn` and the remaining cycle is visibly at rest.
- Kept the 1px exclusion mask and padding on the fixed `.btn-sheen` container. Its child is an absolutely centered `300%` square, using transform and opacity only.
- Used successive fixed-RGBA fallback and color-mix enhanced background declarations for both perimeter and halo.
- Full animation is gated by profile and stopped/hidden for busy, disabled, document-hidden, loading, lyric/playlist overlay, and island opening/collapsing state. Restarting after a gate begins close to phase zero.
- Feature-gated compact perimeter has no animation and `0.19` opacity; compact halo is static at `0.06`. Reduced motion hides both layers.
- Initialized and maintained `data-document-hidden` on the root in the existing `visibilitychange` path; no new listener or DOM was added.

## GREEN Evidence

```sh
node --test test/unit/draw-button-flow.test.js test/unit/archive-styles.test.js
```

Result: exit 0, 11 passed / 0 failed.

```sh
npm run verify
```

Result: exit 0. Unit suite: 173 passed / 0 failed. Audit check, Vite production build, and build test completed successfully.

```sh
npx playwright test test/e2e/draw-button-flow.spec.js
```

Result: exit 0, 10 passed / 5 profile-inapplicable skips in 47.5s.

Browser evidence covered:

- Desktop: one `btn-perimeter-pass` and one `btn-halo-pulse`, same 7200ms cubic-bezier cycle, synchronized time, peak pulse, and rest at 1500ms, 3600ms, and 6900ms.
- Gates: busy, disabled, document-hidden, both overlays, opening/collapsing, and loading remove both decorative animations and hide both layers; release restarts from phase zero.
- Compact: no running decorative animations with static perimeter and halo. Reduced: neither layer is visible or animated.
- Geometry and interaction: desktop/mobile button size, label viewport containment/overflow/nowrap, focus outline, and profile-specific press variables remain locked.
- Pixel concentration: central interior remains below `4/255`; perimeter energy exceeds interior energy by at least 3x.
- Pixel 5 compact check observed no decorative animations and no long task over 50ms.

```sh
git diff --check
```

Result: exit 0, no whitespace errors.

## Self-Review

- No DOM, labels, primary button geometry, or unrelated interaction flow was changed.
- The halo is an outer-edge radial band, not a center fill; fixed blur is not animated.
- The opacity-only compact presentation is inside the mask/conic support gate, preserving transparent fallback behavior on unsupported browsers.
- E2E filters the button's CSSAnimation objects by exact names rather than depending on experimental pseudo-element APIs.
- Retained the required browser coverage rather than snapshotting derived styles alone.

## Concerns

No unresolved implementation concern. The compact halo can be sampled while its fixed transition settles, so its E2E assertion intentionally accepts the documented low-opacity range (`0.04` to `0.07`) while requiring no animation.

## Review Follow-up

The Task 5 review identified four coverage gaps. The production visual, cycle, labels, press behavior, and button geometry remain unchanged.

### Fixes

- Moved compact halo presentation into the same mask/conic `@supports` gate as compact perimeter. The full halo animation is also gated with its perimeter pass, so an unsupported browser retains the base transparent fallback instead of displaying an isolated halo.
- Added a brace-scanned unit assertion that reads the capability-gate body and requires both compact selectors inside it, then rejects a compact halo selector after that gate.
- Strengthened runtime geometry checks for computed border radius, padding, flex display, centering, label viewport overflow/nowrap, button containment, and label-to-viewport containment on both axes. Desktop remains `--button-y: 1px`; coarse mobile remains `.5px`, with their corresponding scale variables.
- Made every busy, disabled, document-hidden, lyric, playlist, opening, collapsing, and loading gate independently release and prove both named CSS animations restart near phase zero.
- Replaced the mobile all-page empty-window claim with a self-validating probe: it requires Long Tasks API support, records a deliberate 70ms positive control, clears it, flushes with `takeRecords()`, and samples separate gated-hidden and compact-visible 48-frame windows. It records no compact animations or over-50ms long tasks in either window and compares the visible rAF maximum against the hidden baseline. This is bounded observational evidence, not a claim that a whole-page idle interval establishes causal effect attribution.

### Follow-up Verification

```sh
node --test test/unit/draw-button-flow.test.js test/unit/archive-styles.test.js
```

Result: exit 0, 11 passed / 0 failed.

```sh
npx playwright test test/e2e/draw-button-flow.spec.js
```

Result: exit 0, 10 passed / 5 profile-inapplicable skips in 45.9s.

The saved mobile metrics recorded a 70ms long-task positive control. The gated-hidden baseline had 48 frame gaps, 10.4ms maximum, and no long task; compact-visible had 48 frame gaps, 10.3ms maximum, no long task, and no decorative animation. The desktop pixel check recorded center energy 0, interior 0.000072, and perimeter 0.005345.

```sh
npm run verify
git diff --check
```

Result: both exit 0. `npm run verify` completed 173 unit tests with 0 failures, audit check, production build, and build test.
