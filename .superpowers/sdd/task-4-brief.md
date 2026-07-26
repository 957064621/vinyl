### Task 4: Apply The Directional-Light Visual System

**Files:**
- Modify: `src/style.css`
- Create: `test/unit/archive-styles.test.js`

**Interfaces:**
- Consumes: `--cover-a`, `--cover-b`, `--cover-accent`, `data-motion-profile`, body overlay/audio state classes, and the existing turntable/control DOM.
- Produces: stable desktop/mobile layouts, directional projected-light fields, archive metadata styling, and compact/reduce performance overrides.

- [ ] **Step 1: Write static visual and performance guardrails**

Test exact archive tokens, zero nonzero `letter-spacing` declarations, the absence of `ambient-dust-drift` and `ambient-veil-shift`, no compact/reduce backdrop filter, no permanent `will-change` outside `[data-motion-active]`, and no loading progress rail selector.

- [ ] **Step 2: Run the style test and verify it fails**

Run: `node --test test/unit/archive-styles.test.js`

Expected: FAIL against the current blue/rose ambient background, infinite full-screen animations, and persistent compositor hints.

- [ ] **Step 3: Recalibrate tokens and the first viewport**

Use `#070808`, `#151819`, `#222526`, `#aeb6b9`, `#f1f2ee`, and `#a43b42` as the neutral/archive base. Keep cover colors as reflected light variables. Use system sans for controls/metadata and the existing Songti stack only for title and lyrics.

Desktop uses an asymmetric header/metadata axis around the unframed turntable. Mobile explicitly collapses to one centered column at `max-width: 767px`, bounds the turntable with viewport and height constraints, and keeps all control labels inside their containers.

- [ ] **Step 4: Replace ambient blobs with projected beams**

Create at most two fixed pseudo-element light fields using directional linear/conic gradients, a polygon mask, and finite opacity changes. The beam has a visible origin outside the top-left or top-right edge and a widening falloff across the turntable. It must not read as a circular orb or bokeh field.

Full mode may use one finite state-triggered beam pass. Compact uses a static low-opacity beam with no filter. Reduce removes travel and preserves the static hierarchy.

- [ ] **Step 5: Refine controls and overlays**

Keep the draw command as the primary pill, but reduce blur, glow, and competing sweeps. Use one perimeter light pass only. Treat the expanded player as a quiet instrument rail with stable dimensions. Lyrics use open projected type; playlist uses an opaque graphite index with one static red current-row rule. Hidden overlays have no animation.

- [ ] **Step 6: Verify visual guardrails and build**

Run:

```bash
node --test test/unit/archive-styles.test.js test/unit/draw-button-flow.test.js
npm run verify
git diff --check
```

Expected: PASS with no draw-button size, radius, padding, alignment, or interaction-state regressions. Update the prior typography assertion from `letter-spacing: 0.09em` to `letter-spacing: 0`; this current page-wide typography rule intentionally supersedes that one older local constraint.

- [ ] **Step 7: Commit the visual system**

```bash
git add src/style.css test/unit/archive-styles.test.js
git commit -m "feat: apply directional light archive styling"
```

