# Vinyl Light Archive Player Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the light-and-shadow archive redesign across loading, the main turntable, player controls, lyrics, and playlist while making every player transition cancellable and continuous on desktop and mobile.

**Architecture:** Keep the existing browser-module application and mature media/loading controllers. Add one motion owner for draw, switch, overlay, and recovery timelines; keep visual changes scoped to existing DOM plus one factual track-metadata rail; preserve the five decoded loading images and current audio/data flow.

**Tech Stack:** Browser ES modules, DOM/CSS, Web Animations API with a compatibility adapter, requestAnimationFrame numeric tweens, Canvas 2D loading particles, Node test runner, JSDOM, Vite, Playwright Chromium.

## Global Constraints

- Preserve the current draw, play/pause, seek, lyric, playlist, playback-mode, retry, and close commands.
- Add no production image, dependency, remote origin, decorative copy, badge, section number, or duplicate loading image request.
- Loading keeps its single decoded-poster queue, bounded particles, retry behavior, and accessibility isolation.
- Remove the visible top-right loading progress and bottom progress rail; keep progress in a visually hidden polite live region.
- Use one dark carbon/graphite theme, projector white, cold silver, one archival red, and cover-derived reflected light.
- Keep the turntable unframed and keep panel radii at or below `8px`; command pills may remain pill-shaped.
- Use `cubic-bezier(0.32, 0.72, 0, 1)` for primary continuity and `cubic-bezier(0.42, 0, 0.58, 1)` only for true crossfades.
- Default animation properties are transform and opacity. Compact and reduce profiles use no full-screen live blur, background-position animation, or animated shadow.
- Preserve all current uncommitted changes in `test/unit/audio-controller.test.js`, `test/unit/motion-controller.test.js`, `.superpowers/`, and `test-results/`.
- Browser plugin is absent. Use the repository Playwright workflow and record the fallback.

---

### Task 1: Remove Visible Loading Chrome Without Removing Status

**Files:**
- Modify: `index.html`
- Modify: `src/style.css`
- Modify: `test/unit/loading-screen.test.js`
- Modify: `test/e2e/loading-poster-transition.spec.js`

**Interfaces:**
- Consumes: `createLoadingScreen().setProgress({ completed, total })` and `#loadingProgress` as the polite live region.
- Produces: an accessible `#loadingProgress.sr-only`, no `.loading-progress-rail`, and unchanged retry/error behavior.

- [ ] **Step 1: Add failing static assertions**

Add assertions that production markup has exactly one `#loadingProgress`, that it has class `sr-only`, and that `.loading-progress-rail` is absent. Keep the existing assertion that progress text updates to `01 / 05`.

```js
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const page = new JSDOM(html).window.document;
assert.equal(page.querySelectorAll('#loadingProgress.sr-only').length, 1);
assert.equal(page.querySelector('.loading-progress-rail'), null);
```

- [ ] **Step 2: Run the focused test and verify the intended failure**

Run: `node --test test/unit/loading-screen.test.js`

Expected: FAIL because the progress output is visible and the rail still exists.

- [ ] **Step 3: Make progress screen-reader-only and remove the rail**

Change production and test fixtures to:

```html
<output class="sr-only" id="loadingProgress" aria-label="加载进度" aria-live="polite" aria-atomic="true">00 / 05</output>
```

Delete:

```html
<div class="loading-progress-rail" aria-hidden="true"><span></span></div>
```

Add the reusable utility without hiding content from assistive technology:

```css
.sr-only {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  padding: 0 !important;
  margin: -1px !important;
  overflow: hidden !important;
  clip: rect(0, 0, 0, 0) !important;
  white-space: nowrap !important;
  border: 0 !important;
}
```

Delete `.loading-intake-head`, `.loading-progress-rail`, and related fill/animation rules that no longer have a production node.

- [ ] **Step 4: Run loading unit and browser coverage**

Run:

```bash
node --test test/unit/loading-screen.test.js test/unit/poster-transition.test.js
npx playwright test test/e2e/loading-poster-transition.spec.js
```

Expected: PASS; screenshots show only poster, directional light, short bottom status, and retry when forced.

- [ ] **Step 5: Commit the isolated loading change**

```bash
git add index.html src/style.css test/unit/loading-screen.test.js test/e2e/loading-poster-transition.spec.js
git commit -m "refine: remove loading poster chrome"
```

### Task 2: Implement Exclusive, Cancellable Motion Ownership

**Files:**
- Create: `src/motion/motion-controller.js`
- Create: `src/app/transitions.js`
- Modify: `src/main.js`
- Preserve/complete: `test/unit/motion-controller.test.js`
- Preserve/complete: `test/unit/audio-controller.test.js`

**Interfaces:**
- Produces: `detectMotionProfile(options) -> 'full' | 'compact' | 'reduce'`.
- Produces: `createMotionController({ profile, transitions, onActivityChange })` with `draw`, `switchTrack`, `openOverlay`, `closeOverlay`, `cancel`, `setDocumentVisible`, `isActive`, and `dispose`.
- Produces: `animateWithCleanup(element, keyframes, options, signal, animate?) -> Promise<{status}>` and `tweenWithCleanup(options) -> Promise<{status}>`.
- Produces: `createAppTransitions({ turntable, overlays, controls, audio, selectTrack })`.

- [ ] **Step 1: Record the current red state**

Run:

```bash
node --test test/unit/motion-controller.test.js test/unit/audio-controller.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/motion/motion-controller.js` and the current rejected-playback visual still using independent tween owners.

- [ ] **Step 2: Implement the motion core**

Use immutable tokens and exclusive ownership:

```js
export const MOTION_TOKENS = Object.freeze({
  full: Object.freeze({ enter: 520, move: 900, settle: 720, itemStagger: 16 }),
  compact: Object.freeze({ enter: 280, move: 460, settle: 360, itemStagger: 0 }),
  reduce: Object.freeze({ enter: 0, move: 0, settle: 0, itemStagger: 0 })
});
```

`runExclusive(name, task)` must increment a request id, abort the prior record, await its settled cleanup, skip superseded queued requests, publish activity changes, and return `{ status: 'completed' | 'cancelled', name }`. Unknown profiles throw `TypeError`.

`tweenWithCleanup` must settle on abort, settle immediately at `duration <= 0`, cancel its scheduled frame, remove its abort listener, and reject if `render` throws. `animateWithCleanup` must use the injected animation adapter when provided, fall back to applying the last keyframe when `.finished` is unavailable, and always remove `data-motion-active`.

- [ ] **Step 3: Implement completion-driven app transitions**

The transition order is:

```text
draw: close overlays -> stop old audio -> arm/rate prepare -> select/load -> arm/rate settle -> open lyrics -> play -> final label
switch: snapshot overlay -> pause -> select/load -> refresh -> play -> restore overlay
open/close: delegate one overlay operation with the same AbortSignal
```

Every boundary calls `assertActive(signal)`. Playback rejection calls `turntable.resetAfterPlaybackError({ signal, duration })` as the final recovery operation, then rethrows.

- [ ] **Step 4: Route current turntable cancellation through one owner**

In `src/main.js`, introduce:

```js
const cancelTurntableMotion = () => {
  tonearmTween.cancel();
  rateTween.cancel();
  cancelVolumeFade();
};
```

Use it before resetting playback visuals and before any new draw or switch timeline. Replace independent fixed-delay advancement in the draw/switch/overlay handlers with the controller commands. New commands must be allowed to supersede old commands rather than returning early behind `isDrawing`, `isOverlayClosing`, or `isTrackSwitching`.

- [ ] **Step 5: Verify cancellation and audio recovery**

Run:

```bash
node --test test/unit/motion-controller.test.js test/unit/audio-controller.test.js
npm run build
git diff --check
```

Expected: PASS; triple-request races start only the latest request, every aborted animation/tween settles, and rejected playback leaves a stable paused turntable.

- [ ] **Step 6: Commit the motion owner**

```bash
git add src/motion/motion-controller.js src/app/transitions.js src/main.js test/unit/motion-controller.test.js test/unit/audio-controller.test.js
git commit -m "refactor: coordinate cancellable player motion"
```

### Task 3: Add Archive Identity And Track State

**Files:**
- Modify: `index.html`
- Modify: `src/main.js`
- Create: `test/unit/archive-ui.test.js`

**Interfaces:**
- Consumes: the selected `lyricsPool[index]` object and audio controller state `{ status, track }`.
- Produces: `updateArchiveMetadata(index, audioStatus)` and DOM nodes `#archiveTrackNumber`, `#archiveRelease`, `#archiveSource`, `#archivePlaybackState`.

- [ ] **Step 1: Write the DOM contract test**

Assert the title is exactly `光影档案馆`, the subtitle is the only additional visible header line, the metadata rail has four `dt/dd` pairs, and no archive kicker or decorative accession sentence exists.

```js
assert.equal(document.querySelector('.header h1').textContent.trim(), '光影档案馆');
assert.equal(document.querySelectorAll('#archiveTrackMeta > div').length, 4);
assert.equal(document.querySelector('.archive-kicker'), null);
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/unit/archive-ui.test.js`

Expected: FAIL because the current heading is `歌词抽取机` and no metadata rail exists.

- [ ] **Step 3: Add factual archive markup**

Use:

```html
<header class="header">
  <h1>光影档案馆</h1>
  <p>按下按钮，为你抽取一段专属歌词</p>
</header>
```

Add below `.vinyl-wrapper`:

```html
<dl class="archive-track-meta" id="archiveTrackMeta" aria-live="polite">
  <div><dt>编号</dt><dd id="archiveTrackNumber">--</dd></div>
  <div><dt>发行</dt><dd id="archiveRelease">未抽取</dd></div>
  <div><dt>来源</dt><dd id="archiveSource">档案库</dd></div>
  <div><dt>状态</dt><dd id="archivePlaybackState">待机</dd></div>
</dl>
```

- [ ] **Step 4: Update metadata only on real state changes**

Map selected track index to a two-digit archive number, release/album name, a stable source label, and audio states `待机`, `读取`, `播放`, `暂停`, `故障`. Do not update these fields on animation frames.

- [ ] **Step 5: Verify and commit archive identity**

Run:

```bash
node --test test/unit/archive-ui.test.js test/unit/library.test.js
npm run build
```

Expected: PASS; all track data remains unchanged and the new rail reflects selection/playback state.

```bash
git add index.html src/main.js test/unit/archive-ui.test.js
git commit -m "feat: add archive player identity"
```

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

Expected: PASS with no layout regressions in the established draw-button geometry tests.

- [ ] **Step 7: Commit the visual system**

```bash
git add src/style.css test/unit/archive-styles.test.js
git commit -m "feat: apply directional light archive styling"
```

### Task 5: Browser Interaction, Visual, And Performance QA

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
