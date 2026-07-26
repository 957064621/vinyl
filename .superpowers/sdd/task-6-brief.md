### Task 6: Browser Interaction, Visual, And Performance QA

**Files:**
- Modify only if a failing behavior requires it: `src/main.js`, `src/style.css`, focused tests
- Do not commit: `test-results/`, screenshots, videos, traces, or temporary scripts

**Interfaces:**
- Consumes: production build and Playwright projects `desktop-chromium`, `mobile-chromium`, and `mobile-reduce`.
- Produces: screenshot/video evidence in `/tmp`, console/interaction results, and a fidelity ledger.

- [ ] **Step 1: Define the target flow**

The flow under test is: loading poster resolves -> archive player becomes interactive -> draw selects a real track and opens lyrics -> close lyrics -> play/pause and seek respond -> open playlist -> change mode and select a track -> return to a stable active player.

- [ ] **Step 2: Run automated verification**

Run:

```bash
npm run verify
npm run test:e2e
git diff --check
```

Expected: PASS in all configured projects with no relevant console errors, framework overlay, stuck loading layer, stale overlay, or effect-attributable mobile long task over `50ms`.

- [ ] **Step 3: Capture five states at desktop and mobile**

Capture loading, idle, active player, lyrics, and playlist at `1440x900` and `390x844`. Capture reduced motion at `390x844`. Store temporary evidence under `/tmp/vinyl-light-archive-qa/`.

- [ ] **Step 4: Inspect images and repair mismatches**

Use `view_image` on the baseline screenshots, the accepted design evidence, and the latest implementation screenshots. Record at least these comparison points: visible copy, first-viewport balance, typography, neutral palette, beam direction, cover treatment, control geometry, overlay hierarchy, mobile containment, and reduced-motion clarity.

- [ ] **Step 5: Run interaction interruption probes**

Rapidly invoke draw -> playlist -> lyrics -> close and track switch -> pause. Verify the latest request wins, prior Promises settle, the turntable reads its rendered state, audio and UI agree, and no transient class remains after settlement.

- [ ] **Step 6: Final clean check**

Verify `git status --short` contains only intentional source/test changes and the preserved user-owned `.superpowers/` and `test-results/` artifacts. Remove only temporary artifacts created for this task outside the repository.
