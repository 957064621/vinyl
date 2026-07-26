### Task 5: Adapt The Draw Button Perimeter-Light Loop

**Files:**
- Modify: `src/main.js`
- Modify: `src/style.css`
- Modify: `test/unit/draw-button-flow.test.js`
- Modify: `test/e2e/draw-button-flow.spec.js`

**Interfaces:**
- Consumes: the existing `.play-btn`, `.btn-sheen`, `data-busy`, `data-motion-profile`, visibility listener, hover/focus/active states, and the supplied Glowing Shadow reference.
- Produces: one restrained idle perimeter-light pass with a synchronized soft halo pulse in `full`, a static compact highlight and halo, and no decorative light in `reduce`.

- [ ] **Step 1: Add failing loop and gating assertions**

Assert that production CSS defines exactly one perimeter-pass keyframe and one synchronized halo-pulse keyframe. Both use the same cycle and active window, animate only transform and opacity, run only in the full idle/interactable state, and stop for `[data-busy]`, disabled, document-hidden, loading, and overlay-transition states. Assert that compact is static and reduced-motion is absent. Keep all existing size, radius, padding, centering, and press-state assertions.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test test/unit/draw-button-flow.test.js`

Expected: FAIL because the current button uses competing sheen/glow loops and does not expose the new profile and busy-state contract.

- [ ] **Step 3: Adapt the supplied reference into one quiet perimeter pass**

Reuse the existing button DOM. Implement one masked conic or linear perimeter highlight using projector white, cold silver, archive red, and `--cover-accent`. Reuse `.play-btn::after` for a low-energy blurred halo that pulses once in sync with the perimeter pass. Do not copy the rainbow hue cycle, viewport-relative glow dimensions, chaotic multi-peak shadow pulse, or independent high-frequency loops from the reference.

In `full`, both layers share one cycle. The active travel and pulse phase uses `cubic-bezier(0.32, 0.72, 0, 1)` and is followed by a visible rest interval before the next cycle. Stop and hide both layers while the command is busy, disabled, document-hidden, loading, or participating in an overlay transition, then restart from phase zero. `compact` is static and low-opacity. `reduce` has no decorative light. Animate only transform and opacity; any blur or filter value is fixed.

Update the existing visibility listener with one root document-hidden attribute rather than adding a second listener. Rewrite the stale draw-button E2E contract so desktop expects the synchronized pass and pulse, compact expects no running decorative animation, and reduced motion expects neither layer.

- [ ] **Step 4: Verify interaction geometry and performance**

Run:

```bash
node --test test/unit/draw-button-flow.test.js test/unit/archive-styles.test.js
npm run verify
npx playwright test test/e2e/draw-button-flow.spec.js
git diff --check
```

Expected: PASS with unchanged button geometry and labels, no permanent compositor hint, no relevant console error, and no effect-attributable mobile long task over `50ms`.

- [ ] **Step 5: Commit the button loop**

```bash
git add src/main.js src/style.css test/unit/draw-button-flow.test.js test/e2e/draw-button-flow.spec.js
git commit -m "refine: adapt draw button perimeter light"
```
