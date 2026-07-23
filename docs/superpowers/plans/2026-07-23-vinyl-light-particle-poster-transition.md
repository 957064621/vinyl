# Vinyl Light Particle Poster Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five-column loading contact sheet with a deterministic, single-poster light-particle and slit sequence while preserving decoded-image gating, retry recovery, accessibility isolation, and mobile performance limits.

**Architecture:** A bounded Canvas controller owns particle rendering and frame lifecycle, while a separate queue controller owns poster order, timing, active-slot state, slit direction, and settlement. `loading-screen.js` remains the integration boundary for exact decoded image nodes and retry state; `bootstrap.js` continues to release `#appRoot` only after the visual queue and final loading exit settle.

**Tech Stack:** Browser ES modules, Canvas 2D, DOM/CSS transitions, Node test runner, JSDOM, Playwright Chromium.

## Global Constraints

- Reuse only the five existing covers in `CRITICAL_IMAGE_MANIFEST`; add no searched, stock, generated, or third-party production imagery.
- Enqueue a poster only after the loader reports `status === 'ready'` with its already loaded and decoded `result.image`; never fetch, clone, decode, or assign a second `src` in UI code.
- Preserve loader retries `2`, concurrency `2`, progress callback independence, recoverable failed-slot display, and retry focus.
- Keep `#appRoot` `inert` and `aria-hidden="true"` through loading, visual playback, errors, and final exposure; release it only after `playReadySequence()` resolves and immediately before loading-layer exit.
- Render exactly one active, unframed poster with `object-fit: contain`; inactive images stay out of the accessibility tree.
- Cap `full` at 64 particles and DPR 1.5, `compact` at 28 particles and DPR 1.25, and `reduce` at zero particles with no animation-frame request.
- `compact` uses no live blur, animated shadow, animated filter, or perspective; `reduce` uses only a short direct opacity change and skips particles, slit travel, parallax, and scatter.
- A gather or scatter command has a finite lifetime, pauses while the document is hidden, cancels its frame on settlement, and releases the Canvas backing store on destroy.
- Queue callbacks are synchronous and non-blocking. The queue targets 800 ms normal scenes and 440 ms compressed scenes when more than two posters remain; the final poster always keeps its readable hold.
- Animation failures remain distinct from `CriticalAssetError`, preserve the retry surface, and cannot reopen `#appRoot`.
- Keep all loading CSS in `src/style.css`; the broader Task 12 typography, player, overlay, and stylesheet split remain out of scope.
- Insert this increment after Task 8 local preparation and before Task 9. Task 8's remote OSS apply remains a credential-gated release gate, but neither implementation nor verification here depends on OSS credentials or the Task 8 runtime cover migration.
- Preserve the existing Task 6 contracts: exact decoded-node mounting, progress copy/counts, one-shot retry, root-only transition-end handling, and application-root gating.
- Do not modify `scripts/media/**` or `test/unit/media-tools.test.js`; another worker may be changing those paths.

## Target File Map

- Create `src/ui/light-particle-field.js`: Canvas particle geometry, profile caps, visibility pause, resize, finite frame scheduling, clearing, and backing-store disposal.
- Create `test/unit/light-particle-field.test.js`: deterministic scheduler/random/context coverage for particle caps and lifecycle.
- Create `src/ui/poster-transition.js`: poster FIFO, compression policy, slit alternation, active-slot and accessibility state, cancellation tokens, freeze/reset/destroy, and idle/final settlement.
- Create `test/unit/poster-transition.test.js`: deterministic queue, timing, final hold, stale-token, and source-boundary coverage.
- Modify `src/ui/loading-screen.js`: mount decoded nodes, synchronously enqueue them, translate visual failures, reset all visual state, and await final exposure.
- Modify `src/app/bootstrap.js`: pass the selected motion profile into the loading view while preserving the existing critical gate.
- Modify `index.html`: provide one poster stage, five layered slots, one Canvas, one DOM slit, progress/status UI, and retry.
- Modify `src/style.css`: replace contact-sheet loading rules with scoped single-stage poster/slit/particle rules only.
- Modify `test/unit/loading-screen.test.js`: preserve the existing Task 6 assertions and add focused integration/source/CSS assertions.
- Create `test/e2e/loading-poster-transition.spec.js`: deterministic desktop, Pixel-class mobile, reduced-motion, pixel, network, overlap, lifecycle, screenshot, and long-task checks.
- Verify `playwright.config.js` without changing it: its existing `desktop-chromium`, Pixel 5 `mobile-chromium`, and Pixel 5 `mobile-reduce` projects already cover the required profiles.

---

### Task 1: Build the finite light-particle field

**Files:**
- Create: `src/ui/light-particle-field.js`
- Test: `test/unit/light-particle-field.test.js`

**Interfaces:**
- Consumes: a real or fake `<canvas>`, `documentRef`, `windowRef`, `profile`, deterministic `random()`, and injected `requestFrame(callback)` / `cancelFrame(id)` functions.
- Produces: `createLightParticleField(options)` returning `{ gather(bounds), scatter(bounds), resize(), setProfile(profile), clear(), finish(), destroy(), getState() }`. `gather` and `scatter` return finite settlement promises; `getState()` returns `{ profile, particleCount, dpr, animating, destroyed }`.

- [ ] **Step 1: Write deterministic particle lifecycle tests**

Create `test/unit/light-particle-field.test.js` with this complete content:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  PARTICLE_PROFILES,
  createLightParticleField
} from '../../src/ui/light-particle-field.js';

const makeScheduler = () => {
  let nextId = 1;
  const callbacks = new Map();
  return {
    requestFrame(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      callbacks.delete(id);
    },
    step(time) {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(time);
    },
    get pending() {
      return callbacks.size;
    }
  };
};

const makeContext = () => {
  const calls = [];
  return {
    calls,
    setTransform: (...args) => calls.push(['setTransform', ...args]),
    clearRect: (...args) => calls.push(['clearRect', ...args]),
    beginPath: () => calls.push(['beginPath']),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    stroke: () => calls.push(['stroke']),
    arc: (...args) => calls.push(['arc', ...args]),
    fill: () => calls.push(['fill']),
    set lineWidth(value) { calls.push(['lineWidth', value]); },
    set strokeStyle(value) { calls.push(['strokeStyle', value]); },
    set fillStyle(value) { calls.push(['fillStyle', value]); },
    set globalAlpha(value) { calls.push(['globalAlpha', value]); }
  };
};

const makeFixture = ({ profile = 'full', dpr = 3 } = {}) => {
  const dom = new JSDOM('<canvas id="particles"></canvas>');
  const documentRef = dom.window.document;
  const canvas = documentRef.getElementById('particles');
  const context = makeContext();
  const scheduler = makeScheduler();
  canvas.getContext = () => context;
  canvas.getBoundingClientRect = () => ({ width: 320, height: 480 });
  Object.defineProperty(dom.window, 'devicePixelRatio', { value: dpr });
  let hidden = false;
  Object.defineProperty(documentRef, 'hidden', {
    configurable: true,
    get: () => hidden
  });
  const field = createLightParticleField({
    canvas,
    documentRef,
    windowRef: dom.window,
    profile,
    random: () => 0.25,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame
  });
  return {
    canvas,
    context,
    documentRef,
    field,
    scheduler,
    setHidden(value) { hidden = value; }
  };
};

const posterBounds = { left: 40, top: 60, width: 180, height: 240 };

test('profile caps and DPR caps are exact', () => {
  assert.deepEqual(PARTICLE_PROFILES, {
    full: { count: 64, dpr: 1.5, gatherMs: 160, scatterMs: 140 },
    compact: { count: 28, dpr: 1.25, gatherMs: 100, scatterMs: 90 },
    reduce: { count: 0, dpr: 1, gatherMs: 0, scatterMs: 0 }
  });
  const { canvas, field } = makeFixture();
  assert.equal(canvas.width, 480);
  assert.equal(canvas.height, 720);
  canvas.getBoundingClientRect = () => ({ width: 200, height: 300 });
  field.resize();
  assert.equal(canvas.width, 300);
  assert.equal(canvas.height, 450);
  field.setProfile('compact');
  assert.equal(canvas.width, 250);
  assert.equal(canvas.height, 375);
  assert.equal(field.getState().dpr, 1.25);
});

test('gather and scatter render bounded counts and leave no idle frame', async () => {
  const { field, scheduler, context, canvas } = makeFixture();
  const gathering = field.gather(posterBounds);
  assert.equal(field.getState().particleCount, 64);
  assert.equal(scheduler.pending, 1);
  scheduler.step(0);
  scheduler.step(200);
  await gathering;
  assert.equal(field.getState().animating, false);
  assert.equal(scheduler.pending, 0);
  assert.equal(canvas.dataset.phase, 'idle');
  assert.ok(context.calls.some(([name]) => name === 'arc'));

  field.setProfile('compact');
  const scattering = field.scatter(posterBounds);
  assert.equal(field.getState().particleCount, 28);
  scheduler.step(300);
  scheduler.step(500);
  await scattering;
  assert.equal(scheduler.pending, 0);
});

test('visibility pauses elapsed time and resumes one frame only', async () => {
  const { documentRef, field, scheduler, setHidden } = makeFixture();
  const gathering = field.gather(posterBounds);
  scheduler.step(0);
  setHidden(true);
  documentRef.dispatchEvent(new documentRef.defaultView.Event('visibilitychange'));
  assert.equal(scheduler.pending, 0);
  setHidden(false);
  documentRef.dispatchEvent(new documentRef.defaultView.Event('visibilitychange'));
  assert.equal(scheduler.pending, 1);
  scheduler.step(10_000);
  assert.equal(field.getState().animating, true, 'hidden wall time is not animation time');
  scheduler.step(10_200);
  await gathering;
  assert.equal(scheduler.pending, 0);
});

test('reduce schedules no frames, clear erases pixels, and destroy releases backing store', async () => {
  const { canvas, context, field, scheduler } = makeFixture({ profile: 'reduce' });
  await field.gather(posterBounds);
  await field.scatter(posterBounds);
  assert.equal(scheduler.pending, 0);
  assert.equal(field.getState().particleCount, 0);
  field.clear();
  assert.ok(context.calls.some(([name]) => name === 'clearRect'));
  field.destroy();
  assert.equal(canvas.width, 0);
  assert.equal(canvas.height, 0);
  assert.deepEqual(field.getState(), {
    profile: 'reduce',
    particleCount: 0,
    dpr: 1,
    animating: false,
    destroyed: true
  });
});
```

- [ ] **Step 2: Run the focused test to prove the red state**

Run: `node --test test/unit/light-particle-field.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/ui/light-particle-field.js`; no existing unit tests are run by this command.

- [ ] **Step 3: Implement bounded geometry and profile-aware backing-store sizing**

Create `src/ui/light-particle-field.js` with the following complete implementation:

```js
export const PARTICLE_PROFILES = Object.freeze({
  full: Object.freeze({ count: 64, dpr: 1.5, gatherMs: 160, scatterMs: 140 }),
  compact: Object.freeze({ count: 28, dpr: 1.25, gatherMs: 100, scatterMs: 90 }),
  reduce: Object.freeze({ count: 0, dpr: 1, gatherMs: 0, scatterMs: 0 })
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const easeOutCubic = (value) => 1 - ((1 - value) ** 3);

const normalizeBounds = (bounds, width, height) => ({
  left: clamp(Number(bounds?.left) || 0, 0, width),
  top: clamp(Number(bounds?.top) || 0, 0, height),
  width: clamp(Number(bounds?.width) || 0, 1, width),
  height: clamp(Number(bounds?.height) || 0, 1, height)
});

const perimeterPoint = (random, width, height) => {
  const edge = Math.floor(random() * 4) % 4;
  if (edge === 0) return { x: random() * width, y: 0 };
  if (edge === 1) return { x: width, y: random() * height };
  if (edge === 2) return { x: random() * width, y: height };
  return { x: 0, y: random() * height };
};

const pointInside = (random, bounds) => ({
  x: bounds.left + (random() * bounds.width),
  y: bounds.top + (random() * bounds.height)
});

export function createLightParticleField({
  canvas,
  documentRef = canvas?.ownerDocument ?? globalThis.document,
  windowRef = documentRef?.defaultView ?? globalThis.window,
  profile = 'compact',
  random = Math.random,
  requestFrame = windowRef.requestAnimationFrame.bind(windowRef),
  cancelFrame = windowRef.cancelAnimationFrame.bind(windowRef)
}) {
  if (!canvas) throw new TypeError('A particle canvas is required');
  const context = canvas.getContext('2d');
  if (!context) throw new TypeError('A 2D canvas context is required');
  if (!PARTICLE_PROFILES[profile]) throw new TypeError(`Unknown particle profile: ${profile}`);

  let currentProfile = profile;
  let dpr = 1;
  let width = 1;
  let height = 1;
  let particles = [];
  let active = null;
  let frameId = null;
  let destroyed = false;

  const clearPixels = () => {
    context.clearRect(0, 0, width, height);
  };

  const resize = () => {
    if (destroyed) return;
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width || windowRef.innerWidth || 1);
    height = Math.max(1, rect.height || windowRef.innerHeight || 1);
    dpr = Math.min(windowRef.devicePixelRatio || 1, PARTICLE_PROFILES[currentProfile].dpr);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    clearPixels();
  };

  const settle = () => {
    if (frameId !== null) cancelFrame(frameId);
    frameId = null;
    const resolve = active?.resolve;
    active = null;
    particles = [];
    canvas.dataset.phase = 'idle';
    clearPixels();
    resolve?.();
  };

  const draw = (progress) => {
    clearPixels();
    context.lineWidth = 1;
    for (const particle of particles) {
      const eased = easeOutCubic(progress);
      const x = particle.from.x + ((particle.to.x - particle.from.x) * eased);
      const y = particle.from.y + ((particle.to.y - particle.from.y) * eased);
      const alpha = Math.sin(Math.PI * clamp(progress, 0.08, 0.92));
      context.globalAlpha = 0.25 + (alpha * 0.7);
      context.strokeStyle = particle.color;
      context.fillStyle = particle.color;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + particle.tailX, y + particle.tailY);
      context.stroke();
      context.beginPath();
      context.arc(x, y, particle.radius, 0, Math.PI * 2);
      context.fill();
    }
  };

  const tick = (timestamp) => {
    frameId = null;
    if (!active || destroyed || documentRef.hidden) return;
    if (active.lastTimestamp !== null) {
      active.elapsed += Math.max(0, timestamp - active.lastTimestamp);
    }
    active.lastTimestamp = timestamp;
    const progress = clamp(active.elapsed / active.duration, 0, 1);
    canvas.dataset.frameCount = String(Number(canvas.dataset.frameCount || 0) + 1);
    draw(progress);
    if (progress >= 1) {
      settle();
      return;
    }
    frameId = requestFrame(tick);
  };

  const schedule = () => {
    if (!active || destroyed || documentRef.hidden || frameId !== null) return;
    frameId = requestFrame(tick);
  };

  const makeParticles = (mode, rawBounds) => {
    const bounds = normalizeBounds(rawBounds, width, height);
    return Array.from({ length: PARTICLE_PROFILES[currentProfile].count }, (_, index) => {
      const perimeter = perimeterPoint(random, width, height);
      const inside = pointInside(random, bounds);
      return {
        from: mode === 'gather' ? perimeter : inside,
        to: mode === 'gather' ? inside : perimeter,
        radius: 0.7 + (random() * 1.1),
        tailX: (random() - 0.5) * 8,
        tailY: (random() - 0.5) * 8,
        color: index % 2 === 0 ? '#fff5dc' : '#dcecff'
      };
    });
  };

  const run = (mode, bounds) => {
    settle();
    const config = PARTICLE_PROFILES[currentProfile];
    if (destroyed || config.count === 0) return Promise.resolve();
    resize();
    particles = makeParticles(mode, bounds);
    canvas.dataset.phase = mode;
    return new Promise((resolve) => {
      active = {
        duration: mode === 'gather' ? config.gatherMs : config.scatterMs,
        elapsed: 0,
        lastTimestamp: null,
        resolve
      };
      schedule();
    });
  };

  const handleVisibilityChange = () => {
    if (!active) return;
    if (documentRef.hidden) {
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
      active.lastTimestamp = null;
      return;
    }
    schedule();
  };

  resize();
  canvas.dataset.phase = 'idle';
  canvas.dataset.frameCount = '0';
  documentRef.addEventListener('visibilitychange', handleVisibilityChange);

  return {
    gather: (bounds) => run('gather', bounds),
    scatter: (bounds) => run('scatter', bounds),
    resize,
    setProfile(nextProfile) {
      if (!PARTICLE_PROFILES[nextProfile]) {
        throw new TypeError(`Unknown particle profile: ${nextProfile}`);
      }
      settle();
      currentProfile = nextProfile;
      resize();
    },
    clear: settle,
    finish: settle,
    destroy() {
      if (destroyed) return;
      settle();
      documentRef.removeEventListener('visibilitychange', handleVisibilityChange);
      destroyed = true;
      canvas.width = 0;
      canvas.height = 0;
    },
    getState: () => ({
      profile: currentProfile,
      particleCount: particles.length,
      dpr,
      animating: active !== null,
      destroyed
    })
  };
}
```

- [ ] **Step 4: Run particle tests to prove finite settlement and cleanup**

Run: `node --test test/unit/light-particle-field.test.js`

Expected: 4 tests PASS; `pending` is zero after gather/scatter settlement and reduce/destroy never leave a scheduled callback.

- [ ] **Step 5: Run the complete unit suite for regression coverage**

Run: `npm run test:unit`

Expected: all pre-existing unit tests plus the 4 new particle tests PASS, with process exit status 0.

- [ ] **Step 6: Commit only the particle controller slice**

```bash
git add src/ui/light-particle-field.js test/unit/light-particle-field.test.js
git diff --cached --check
git commit -m "feat: add bounded loading particle field"
```

Expected: the staged diff contains exactly those two files; `git diff --cached --check` prints nothing; the commit succeeds without staging concurrent media-tool changes.

---

### Task 2: Build the deterministic single-poster transition queue

**Files:**
- Create: `src/ui/poster-transition.js`
- Test: `test/unit/poster-transition.test.js`

**Interfaces:**
- Consumes: `{ root, slit, particleField, profile, scheduler, onError }`; `scheduler.sleep(ms, signal)` resolves `true` on timeout and `false` on abort.
- Produces: `createPosterTransition(options)` returning `{ enqueue(slot), waitForIdle(), finish(), freeze(), reset(), setProfile(profile), destroy(), getState() }`. `enqueue(slot)` returns a boolean synchronously; `finish()` seals the queue, waits for its final readable hold, and settles after final exposure.

- [ ] **Step 1: Write queue, compression, cancellation, and boundary tests**

Create `test/unit/poster-transition.test.js` with this complete content:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import {
  POSTER_TIMING,
  createPosterTransition
} from '../../src/ui/poster-transition.js';

const makeFixture = ({ scheduler } = {}) => {
  const dom = new JSDOM(`
    <div id="root">
      <div id="slit"></div>
      <figure data-loading-slot="archive-01"><img alt="one"></figure>
      <figure data-loading-slot="archive-02"><img alt="two"></figure>
      <figure data-loading-slot="archive-03"><img alt="three"></figure>
      <figure data-loading-slot="archive-04"><img alt="four"></figure>
      <figure data-loading-slot="archive-05"><img alt="five"></figure>
    </div>
  `);
  const document = dom.window.document;
  const particleCalls = [];
  const particleField = {
    gather: async (bounds) => { particleCalls.push(['gather', bounds]); },
    scatter: async (bounds) => { particleCalls.push(['scatter', bounds]); },
    finish: () => particleCalls.push(['finish']),
    setProfile: (profile) => particleCalls.push(['profile', profile])
  };
  const sleeps = [];
  const immediateScheduler = {
    async sleep(ms, signal) {
      sleeps.push(ms);
      return !signal.aborted;
    }
  };
  const root = document.getElementById('root');
  const slots = [...root.querySelectorAll('[data-loading-slot]')];
  for (const [index, slot] of slots.entries()) {
    slot.getBoundingClientRect = () => ({ left: 20 + index, top: 30, width: 180, height: 240 });
  }
  const errors = [];
  const controller = createPosterTransition({
    root,
    slit: document.getElementById('slit'),
    particleField,
    profile: 'full',
    scheduler: scheduler || immediateScheduler,
    onError: (error) => errors.push(error)
  });
  return { controller, errors, particleCalls, root, sleeps, slots };
};

const makeManualScheduler = () => {
  const pending = [];
  return {
    sleep(ms, signal) {
      return new Promise((resolve) => {
        const entry = { ms, resolve };
        const abort = () => {
          const index = pending.indexOf(entry);
          if (index >= 0) pending.splice(index, 1);
          resolve(false);
        };
        if (signal.aborted) return abort();
        signal.addEventListener('abort', abort, { once: true });
        pending.push(entry);
      });
    },
    releaseNext() {
      const entry = pending.shift();
      entry?.resolve(true);
    },
    get pending() { return pending.length; }
  };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('timing tables total 800ms normal and 440ms fast', () => {
  assert.equal(Object.values(POSTER_TIMING.normal).reduce((sum, value) => sum + value, 0), 800);
  assert.equal(Object.values(POSTER_TIMING.fast).reduce((sum, value) => sum + value, 0), 440);
  assert.equal(POSTER_TIMING.finalHold, 520);
  assert.equal(POSTER_TIMING.finalExposure, 360);
});

test('rapid enqueue is synchronous, FIFO, alternates direction, and leaves one active poster', async () => {
  const { controller, root, slots } = makeFixture();
  for (const slot of slots) assert.equal(controller.enqueue(slot), true);
  assert.equal(controller.enqueue(slots[0]), false, 'a decoded slot is accepted once per run');
  const finished = controller.finish();
  assert.ok(finished instanceof Promise);
  await finished;
  assert.deepEqual(slots.map((slot) => slot.dataset.transitionOrder), ['1', '2', '3', '4', '5']);
  assert.deepEqual(slots.map((slot) => slot.dataset.slitDirection), ['ltr', 'rtl', 'ltr', 'rtl', 'ltr']);
  assert.equal(root.querySelectorAll('.is-active').length, 1);
  assert.strictEqual(root.querySelector('.is-active'), slots[4]);
  assert.equal(slots[4].querySelector('img').hasAttribute('aria-hidden'), false);
  for (const slot of slots.slice(0, 4)) {
    assert.equal(slot.querySelector('img').getAttribute('aria-hidden'), 'true');
  }
});

test('a rapid backlog uses compressed phases but preserves the final hold', async () => {
  const { controller, sleeps, slots } = makeFixture();
  slots.forEach((slot) => controller.enqueue(slot));
  await controller.finish();
  assert.ok(sleeps.includes(POSTER_TIMING.fast.gather));
  assert.ok(sleeps.includes(POSTER_TIMING.fast.reveal));
  assert.ok(sleeps.includes(POSTER_TIMING.finalHold));
  assert.equal(sleeps.at(-1), POSTER_TIMING.finalExposure);
});

test('waitForIdle excludes final exposure while finish includes it', async () => {
  const scheduler = makeManualScheduler();
  const { controller, slots } = makeFixture({ scheduler });
  controller.enqueue(slots[0]);
  let idle = false;
  let finished = false;
  void controller.waitForIdle().then(() => { idle = true; });
  void controller.finish().then(() => { finished = true; });
  await flush();
  while (!idle) {
    assert.ok(scheduler.pending > 0);
    scheduler.releaseNext();
    await flush();
  }
  assert.equal(finished, false);
  scheduler.releaseNext();
  await flush();
  assert.equal(finished, true);
});

test('reset aborts stale work so an old completion cannot reactivate its poster', async () => {
  const scheduler = makeManualScheduler();
  const { controller, slots } = makeFixture({ scheduler });
  controller.enqueue(slots[0]);
  await flush();
  controller.reset();
  controller.enqueue(slots[1]);
  await flush();
  while (scheduler.pending) {
    scheduler.releaseNext();
    await flush();
  }
  await controller.waitForIdle();
  assert.equal(slots[0].classList.contains('is-active'), false);
  assert.equal(slots[1].classList.contains('is-active'), true);
});

test('freeze cancels backlog but keeps the current poster stable', async () => {
  const scheduler = makeManualScheduler();
  const { controller, slots } = makeFixture({ scheduler });
  controller.enqueue(slots[0]);
  controller.enqueue(slots[1]);
  await flush();
  scheduler.releaseNext();
  await flush();
  controller.freeze();
  assert.equal(controller.getState().queued, 0);
  assert.equal(slots[1].classList.contains('is-active'), false);
  assert.equal(slots[0].classList.contains('is-active'), true);
  assert.equal(slots[0].classList.contains('is-stable'), true);
  assert.equal(slots[0].classList.contains('is-scattering'), false);
});

test('queue source has no network, clone, src assignment, or decode ownership', () => {
  const source = readFileSync(new URL('../../src/ui/poster-transition.js', import.meta.url), 'utf8');
  for (const forbidden of ['fetch(', 'cloneNode(', '.decode(', '.src =', "setAttribute('src'"]) {
    assert.equal(source.includes(forbidden), false, `poster queue must not contain ${forbidden}`);
  }
});
```

- [ ] **Step 2: Run the queue test to prove the red state**

Run: `node --test test/unit/poster-transition.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/ui/poster-transition.js`.

- [ ] **Step 3: Implement the abortable timing primitive and queue state machine**

Create `src/ui/poster-transition.js` with this complete implementation:

```js
export const POSTER_TIMING = Object.freeze({
  normal: Object.freeze({ gather: 160, scatter: 160, reveal: 180, hold: 300 }),
  fast: Object.freeze({ gather: 80, scatter: 100, reveal: 100, hold: 160 }),
  finalHold: 520,
  finalExposure: 360,
  reduceFade: 120
});

const defaultScheduler = {
  sleep(ms, signal) {
    if (ms === 0) return Promise.resolve(!signal.aborted);
    return new Promise((resolve) => {
      const finish = (value) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        resolve(value);
      };
      const abort = () => finish(false);
      const timer = setTimeout(() => finish(true), ms);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }
};

const imageFor = (slot) => slot.querySelector('img');

export function createPosterTransition({
  root,
  slit,
  particleField,
  profile = 'compact',
  scheduler = defaultScheduler,
  onError = () => {}
}) {
  if (!root || !slit || !particleField) throw new TypeError('Poster transition elements are required');

  let currentProfile = profile;
  let queue = [];
  let accepted = new Set();
  let activeSlot = null;
  let generation = 0;
  let processingToken = null;
  let abortController = new AbortController();
  let sealed = false;
  let destroyed = false;
  let lastError = null;
  let finishPromise = null;
  const idleWaiters = new Set();

  const isCurrent = (token) => !destroyed && token === generation && !abortController.signal.aborted;
  const sleep = async (ms, token) => {
    if (!isCurrent(token)) return false;
    const completed = await scheduler.sleep(ms, abortController.signal);
    return completed && isCurrent(token);
  };

  const setActive = (slot, value) => {
    slot.classList.toggle('is-active', value);
    const image = imageFor(slot);
    if (image) {
      if (value) image.removeAttribute('aria-hidden');
      else image.setAttribute('aria-hidden', 'true');
    }
  };

  const stabilize = (slot) => {
    if (!slot) return;
    slot.classList.remove('is-revealing', 'is-scattering');
    slot.classList.add('is-stable');
  };

  const notifyIdle = () => {
    if (queue.length || processingToken !== null) return;
    for (const waiter of idleWaiters) waiter();
    idleWaiters.clear();
  };

  const timingFor = () => (queue.length > 2 ? POSTER_TIMING.fast : POSTER_TIMING.normal);

  const runItem = async (item, token) => {
    const timing = timingFor();
    const bounds = item.slot.getBoundingClientRect();
    item.slot.dataset.transitionOrder = String(item.order);
    item.slot.dataset.slitDirection = item.direction;
    item.slot.style.setProperty('--poster-reveal-ms', `${timing.reveal}ms`);
    slit.dataset.direction = item.direction;

    const gathered = await Promise.all([
      particleField.gather(bounds),
      sleep(currentProfile === 'reduce' ? 0 : timing.gather, token)
    ]);
    if (!isCurrent(token) || gathered[1] === false) return;

    if (activeSlot) {
      const outgoing = activeSlot;
      outgoing.classList.remove('is-stable');
      outgoing.classList.add('is-scattering');
      const scattered = await Promise.all([
        currentProfile === 'reduce' ? particleField.finish() : particleField.scatter(outgoing.getBoundingClientRect()),
        sleep(currentProfile === 'reduce' ? POSTER_TIMING.reduceFade : timing.scatter, token)
      ]);
      if (!isCurrent(token) || scattered[1] === false) return;
      setActive(outgoing, false);
      outgoing.classList.remove('is-scattering');
    }

    activeSlot = item.slot;
    slit.classList.toggle('is-lit', currentProfile !== 'reduce');
    setActive(activeSlot, true);
    activeSlot.classList.add('is-revealing');
    if (!await sleep(currentProfile === 'reduce' ? POSTER_TIMING.reduceFade : timing.reveal, token)) return;
    activeSlot.classList.remove('is-revealing');
    activeSlot.classList.add('is-stable');
    slit.classList.remove('is-lit');

    const isFinal = sealed && queue.length === 0;
    const hold = isFinal ? POSTER_TIMING.finalHold : timing.hold;
    await sleep(currentProfile === 'reduce' ? 0 : hold, token);
  };

  const fail = (error, token) => {
    if (token !== generation) return;
    lastError = error;
    queue = [];
    particleField.finish();
    slit.classList.remove('is-lit');
    stabilize(activeSlot);
    onError(error);
  };

  const ensurePump = () => {
    if (destroyed || processingToken !== null || queue.length === 0) return;
    const token = generation;
    processingToken = token;
    void (async () => {
      try {
        while (isCurrent(token) && queue.length) {
          const item = queue.shift();
          await runItem(item, token);
        }
      } catch (error) {
        fail(error, token);
      } finally {
        if (processingToken === token) processingToken = null;
        notifyIdle();
        if (queue.length) ensurePump();
      }
    })();
  };

  const cancelWork = ({ preserveActive }) => {
    generation += 1;
    abortController.abort();
    abortController = new AbortController();
    processingToken = null;
    queue = [];
    slit.classList.remove('is-lit');
    particleField.finish();
    if (preserveActive) {
      stabilize(activeSlot);
    } else {
      for (const slot of root.querySelectorAll('[data-loading-slot]')) {
        setActive(slot, false);
        slot.classList.remove('is-revealing', 'is-scattering', 'is-stable');
        delete slot.dataset.transitionOrder;
        delete slot.dataset.slitDirection;
        slot.style.removeProperty('--poster-reveal-ms');
      }
      activeSlot = null;
    }
    for (const waiter of idleWaiters) waiter();
    idleWaiters.clear();
  };

  root.dataset.motionProfile = currentProfile;
  particleField.setProfile(currentProfile);

  return {
    enqueue(slot) {
      if (destroyed || sealed || !slot || !imageFor(slot) || accepted.has(slot)) return false;
      const order = accepted.size + 1;
      accepted.add(slot);
      queue.push({
        slot,
        order,
        direction: order % 2 === 1 ? 'ltr' : 'rtl'
      });
      ensurePump();
      return true;
    },
    waitForIdle() {
      if (queue.length === 0 && processingToken === null) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.add(resolve));
    },
    finish() {
      if (finishPromise) return finishPromise;
      sealed = true;
      finishPromise = (async () => {
        await this.waitForIdle();
        if (lastError) throw lastError;
        const token = generation;
        root.classList.add('is-final-exposure');
        const duration = currentProfile === 'reduce' ? 0 : POSTER_TIMING.finalExposure;
        if (!await sleep(duration, token)) return;
        root.dataset.transitionSettled = 'true';
      })();
      return finishPromise;
    },
    freeze() {
      cancelWork({ preserveActive: true });
      sealed = true;
    },
    reset() {
      cancelWork({ preserveActive: false });
      accepted = new Set();
      sealed = false;
      lastError = null;
      finishPromise = null;
      root.classList.remove('is-final-exposure');
      delete root.dataset.transitionSettled;
    },
    setProfile(nextProfile) {
      currentProfile = nextProfile;
      root.dataset.motionProfile = nextProfile;
      particleField.setProfile(nextProfile);
    },
    destroy() {
      if (destroyed) return;
      cancelWork({ preserveActive: false });
      destroyed = true;
    },
    getState: () => ({
      profile: currentProfile,
      queued: queue.length,
      activeId: activeSlot?.dataset.loadingSlot ?? null,
      processing: processingToken !== null,
      sealed,
      destroyed
    })
  };
}
```

- [ ] **Step 4: Run the queue tests and correct only observed contract failures**

Run: `node --test test/unit/poster-transition.test.js`

Expected: 7 tests PASS. The output proves synchronous enqueue, FIFO order, one active slot, alternating `ltr`/`rtl`, a compressed timing path, final hold, abortable stale work, freeze semantics, and absence of loader/network ownership.

- [ ] **Step 5: Run both new controller suites together**

Run: `node --test test/unit/light-particle-field.test.js test/unit/poster-transition.test.js`

Expected: 11 tests PASS with exit status 0 and no process left alive by an idle timer or frame callback.

- [ ] **Step 6: Commit only the queue slice**

```bash
git add src/ui/poster-transition.js test/unit/poster-transition.test.js
git diff --cached --check
git commit -m "feat: add deterministic loading poster queue"
```

Expected: the staged diff contains exactly the transition controller and its test; no media-tool path is staged.

---

### Task 3: Integrate the decoded-node loading stage, CSS, retry, and app gate

**Files:**
- Modify: `src/ui/loading-screen.js`
- Modify: `src/app/bootstrap.js`
- Modify: `index.html`
- Modify: `src/style.css`
- Modify: `test/unit/loading-screen.test.js`

**Interfaces:**
- Consumes: Task 1 `createLightParticleField(...)`, Task 2 `createPosterTransition(...)`, and Task 6 progress events shaped as `{ id, status, completed, total, result }` where `result.image` is already loaded and decoded.
- Produces: `createLoadingScreen(documentRef, { motionProfile, particleFactory, transitionFactory })` with the existing `{ reset, setProgress, showError, playReadySequence, exit }` methods. `setProgress()` remains synchronous; `playReadySequence()` resolves after queue drain and full-width final exposure; `exit()` destroys both visual controllers before removing the loading root.

- [ ] **Step 1: Extend loading-screen tests with injected visual controllers**

In `test/unit/loading-screen.test.js`, add this import beside the existing loading-screen import:

```js
import { VisualTransitionError } from '../../src/ui/loading-screen.js';
```

Replace both fixture strings with the same loading subtree used by `index.html` in Step 4, followed by their existing `#appRoot` subtree where applicable. Add this helper after `nextTurn`:

```js
const createVisualHarness = (document) => {
  const calls = [];
  let finishError = null;
  const particles = {
    clear: () => calls.push('particles.clear'),
    destroy: () => calls.push('particles.destroy')
  };
  const transition = {
    enqueue(slot) {
      calls.push(['enqueue', slot.dataset.loadingSlot, slot.firstElementChild]);
      return true;
    },
    finish: async () => {
      calls.push('transition.finish');
      if (finishError) throw finishError;
    },
    freeze: () => calls.push('transition.freeze'),
    reset: () => calls.push('transition.reset'),
    setProfile: (profile) => calls.push(['transition.profile', profile]),
    destroy: () => calls.push('transition.destroy')
  };
  const view = createLoadingScreen(document, {
    motionProfile: 'compact',
    particleFactory: () => particles,
    transitionFactory: () => transition
  });
  return {
    calls,
    transition,
    view,
    failFinish(error = new Error('animation failed')) { finishError = error; }
  };
};
```

Change each direct `createLoadingScreen(dom.window.document)` call in the existing decoded-node, retry, and compact-exit tests to:

```js
const { view } = createVisualHarness(dom.window.document);
```

In the gate retry test, pass this additional option to `startCriticalAssetGate` so JSDOM does not need a native Canvas implementation:

```js
createView: (documentRef, options) => createLoadingScreen(documentRef, {
  ...options,
  particleFactory: () => ({ clear() {}, destroy() {} }),
  transitionFactory: () => ({
    enqueue() { return true; },
    async finish() {},
    freeze() {},
    reset() {},
    setProfile() {},
    destroy() {}
  })
}),
```

Append these focused tests:

```js
test('ready progress mounts before synchronous enqueue and never duplicates the decoded node', () => {
  const dom = createFixture();
  const { calls, view } = createVisualHarness(dom.window.document);
  const image = dom.window.document.createElement('img');
  view.setProgress({
    id: 'archive-01',
    status: 'ready',
    completed: 1,
    total: 5,
    result: { id: 'archive-01', alt: '加载封面图1', image }
  });
  const enqueue = calls.find((entry) => Array.isArray(entry) && entry[0] === 'enqueue');
  assert.strictEqual(enqueue[2], image);
  assert.equal(dom.window.document.querySelectorAll('img').length, 1);
  assert.equal(image.getAttribute('aria-hidden'), 'true');
});

test('playReadySequence waits for queue finish and records visual failures separately', async () => {
  const dom = createFixture();
  const { calls, failFinish, view } = createVisualHarness(dom.window.document);
  failFinish();
  await assert.rejects(view.playReadySequence('compact'), VisualTransitionError);
  assert.ok(calls.includes('transition.finish'));
  assert.ok(calls.includes('transition.freeze'));
  assert.equal(dom.window.document.getElementById('loadingScreen').dataset.errorKind, 'visual');
});

test('retry reset clears queue, canvas, and every mounted decoded image', () => {
  const dom = createFixture();
  const { calls, view } = createVisualHarness(dom.window.document);
  const image = dom.window.document.createElement('img');
  view.setProgress({
    id: 'archive-01',
    status: 'ready',
    completed: 1,
    total: 5,
    result: { id: 'archive-01', alt: '加载封面图1', image }
  });
  view.showError({ failures: [{ id: 'archive-02' }], message: 'failed' }, () => {});
  dom.window.document.getElementById('loadingRetry').click();
  assert.ok(calls.includes('transition.reset'));
  assert.ok(calls.includes('particles.clear'));
  assert.equal(dom.window.document.querySelectorAll('.loading-frame img').length, 0);
});

test('loading markup and CSS use one unframed contain stage without eager image sources', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8');
  const document = new JSDOM(html).window.document;
  const loading = document.getElementById('loadingScreen');
  assert.equal(loading.querySelectorAll('[data-loading-slot]').length, 5);
  assert.equal(loading.querySelectorAll('canvas#loadingParticles[aria-hidden="true"]').length, 1);
  assert.equal(loading.querySelectorAll('#loadingLightSlit[aria-hidden="true"]').length, 1);
  assert.equal(loading.querySelectorAll('img').length, 0);
  assert.equal(loading.querySelectorAll('a, button, input, select, textarea').length, 1);
  assert.match(css, /\.loading-image\s*\{[^}]*object-fit:\s*contain/s);
  assert.match(css, /\.loading-particles\s*\{[^}]*z-index:\s*3/s);
  assert.match(css, /\.loading-controls\s*\{[^}]*z-index:\s*5/s);
  assert.doesNotMatch(css, /\.loading-(?:image|frame)[^{]*\{[^}]*(?:filter|box-shadow)\s*:/s);
});
```

- [ ] **Step 2: Run the integration test to prove the red state**

Run: `node --test test/unit/loading-screen.test.js`

Expected: FAIL because `VisualTransitionError`, injected factories, queue calls, and the new stage markup do not exist yet. The original five Task 6 tests must remain present rather than being deleted to get red output.

- [ ] **Step 3: Replace loading-screen orchestration with decoded-node delegation**

Replace `src/ui/loading-screen.js` with this complete content:

```js
import { createLightParticleField } from './light-particle-field.js';
import { createPosterTransition } from './poster-transition.js';

const twoDigits = (value) => String(value).padStart(2, '0');

const waitForTransition = (element, {
  propertyName = 'opacity',
  timeoutMs = 900
} = {}) => new Promise((resolve) => {
  let settled = false;
  let timer;
  const cleanup = () => {
    clearTimeout(timer);
    element.removeEventListener('transitionend', handleTransitionEnd);
  };
  const finish = () => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve();
  };
  const handleTransitionEnd = (event) => {
    if (event.target !== element || event.propertyName !== propertyName) return;
    finish();
  };
  timer = setTimeout(finish, timeoutMs);
  element.addEventListener('transitionend', handleTransitionEnd);
});

export class VisualTransitionError extends Error {
  constructor(cause) {
    super('Loading poster transition failed', { cause });
    this.name = 'VisualTransitionError';
  }
}

export function createLoadingScreen(documentRef = document, {
  motionProfile = 'compact',
  particleFactory = createLightParticleField,
  transitionFactory = createPosterTransition
} = {}) {
  const root = documentRef.querySelector('#loadingScreen');
  const canvas = documentRef.querySelector('#loadingParticles');
  const slit = documentRef.querySelector('#loadingLightSlit');
  const progress = documentRef.querySelector('#loadingProgress');
  const copy = documentRef.querySelector('#loadingCopy');
  const retry = documentRef.querySelector('#loadingRetry');
  const slots = new Map(
    [...root.querySelectorAll('[data-loading-slot]')]
      .map((slot) => [slot.dataset.loadingSlot, slot])
  );
  const windowRef = documentRef.defaultView;
  const particleField = particleFactory({
    canvas,
    documentRef,
    windowRef,
    profile: motionProfile
  });
  const posterTransition = transitionFactory({
    root,
    slit,
    particleField,
    profile: motionProfile
  });

  const mountImage = (result) => {
    const slot = slots.get(result.id);
    if (!slot) return null;
    slot.querySelector('img')?.remove();
    result.image.alt = result.alt;
    result.image.className = 'loading-image';
    result.image.dataset.assetId = result.id;
    result.image.setAttribute('aria-hidden', 'true');
    slot.insertBefore(result.image, slot.firstChild);
    return slot;
  };

  const view = {
    reset() {
      posterTransition.reset();
      particleField.clear();
      root.dataset.state = 'loading';
      delete root.dataset.errorKind;
      root.classList.remove('is-exiting');
      retry.hidden = true;
      retry.onclick = null;
      copy.textContent = '影像读取中';
      progress.textContent = '00 / 05';
      for (const slot of slots.values()) {
        delete slot.dataset.status;
        slot.classList.remove('is-ready', 'is-failed');
        slot.querySelector('img')?.remove();
      }
    },
    setProgress({ id, status, completed, total, result }) {
      progress.textContent = `${twoDigits(completed)} / ${twoDigits(total)}`;
      const slot = slots.get(id);
      if (slot) {
        slot.dataset.status = status;
        slot.classList.toggle('is-ready', status === 'ready');
        slot.classList.toggle('is-failed', status === 'failed');
      }
      if (status === 'ready' && result) {
        const mountedSlot = mountImage(result);
        if (mountedSlot) posterTransition.enqueue(mountedSlot);
      }
      if (status === 'ready') copy.textContent = `已归档 ${completed} / ${total}`;
    },
    showError(error, onRetry) {
      posterTransition.freeze();
      particleField.clear();
      root.dataset.state = 'error';
      const visualFailure = error instanceof VisualTransitionError;
      root.dataset.errorKind = visualFailure ? 'visual' : 'asset';
      for (const failure of error.failures || []) {
        const slot = slots.get(failure.id);
        if (slot) {
          slot.dataset.status = 'failed';
          slot.classList.remove('is-ready');
          slot.classList.add('is-failed');
        }
      }
      const failureIds = error.failures?.map(({ id }) => id).join('、');
      copy.textContent = visualFailure
        ? '视觉过渡失败，请重新载入'
        : `影像读取失败：${failureIds || error.message}`;
      retry.hidden = false;
      retry.onclick = () => {
        view.reset();
        onRetry();
      };
      retry.focus();
    },
    async playReadySequence(profile) {
      root.dataset.state = 'ready';
      copy.textContent = '档案接入完成';
      posterTransition.setProfile(profile);
      try {
        await posterTransition.finish();
      } catch (error) {
        root.dataset.state = 'error';
        root.dataset.errorKind = 'visual';
        posterTransition.freeze();
        throw new VisualTransitionError(error);
      }
    },
    async exit(profile) {
      root.classList.add('is-exiting');
      if (profile !== 'reduce') {
        await waitForTransition(root, { timeoutMs: 900 });
      }
      posterTransition.destroy();
      particleField.destroy();
      root.remove();
    }
  };

  return view;
}
```

In `src/app/bootstrap.js`, make these two precise changes and leave load retries, concurrency, progress, inert release, and exit ordering unchanged:

```diff
 export function startCriticalAssetGate({
   documentRef = document,
   viewportWidth = window.innerWidth,
   motionProfile = 'compact',
-  load = loadCriticalImages
+  load = loadCriticalImages,
+  createView = createLoadingScreen
 } = {}) {
-  const view = createLoadingScreen(documentRef);
+  const view = createView(documentRef, { motionProfile });
```

- [ ] **Step 4: Replace the critical loading markup without adding image sources**

In the inline `<style>` in `index.html`, replace `.loading-intake`, `.loading-contact-sheet`, and `.loading-frame` with:

```css
.loading-intake {
    position: relative;
    width: min(92vw, 680px);
    height: min(88lvh, 820px);
}

.loading-stage {
    position: absolute;
    inset: 44px 0 58px;
}

.loading-poster-stack,
.loading-frame,
.loading-particles,
.loading-light-slit {
    position: absolute;
    inset: 0;
}

.loading-frame {
    margin: 0;
    visibility: hidden;
}

.loading-frame.is-active {
    visibility: visible;
}

.loading-image {
    width: 100%;
    height: 100%;
    object-fit: contain;
}
```

Replace only the existing `#loadingScreen` subtree in `<body>` with:

```html
<div class="loading-screen" id="loadingScreen" data-state="loading">
    <div class="loading-intake">
        <div class="loading-controls">
            <div class="loading-intake-head">
                <span>LIGHT ARCHIVE / INTAKE</span>
                <output id="loadingProgress" aria-live="polite" aria-atomic="true">00 / 05</output>
            </div>
            <p class="loading-copy" id="loadingCopy">影像读取中</p>
            <button class="loading-retry" id="loadingRetry" type="button" hidden>重新载入</button>
        </div>
        <div class="loading-stage" id="loadingStage">
            <div class="loading-poster-stack" id="loadingPosterStack">
                <figure class="loading-frame" data-loading-slot="archive-01"><figcaption>AR-01</figcaption></figure>
                <figure class="loading-frame" data-loading-slot="archive-02"><figcaption>AR-02</figcaption></figure>
                <figure class="loading-frame" data-loading-slot="archive-03"><figcaption>AR-03</figcaption></figure>
                <figure class="loading-frame" data-loading-slot="archive-04"><figcaption>AR-04</figcaption></figure>
                <figure class="loading-frame" data-loading-slot="archive-05"><figcaption>AR-05</figcaption></figure>
            </div>
            <canvas class="loading-particles" id="loadingParticles" aria-hidden="true"></canvas>
            <div class="loading-light-slit" id="loadingLightSlit" aria-hidden="true">
                <span class="loading-light-slit-core"></span>
                <span class="loading-light-slit-edge"></span>
            </div>
        </div>
        <div class="loading-progress-rail" aria-hidden="true"><span></span></div>
    </div>
</div>
```

Expected markup facts: five empty slots, zero eager `<img>` nodes, one Canvas, one slit container with DOM strips, one polite decoded-count output, one retry button, and no loading control other than retry.

- [ ] **Step 5: Replace only the loading CSS block with the single-stage visual system**

In `src/style.css`, replace the block beginning at `.loading-screen {` and ending at the closing brace of `.loading-retry[hidden]` with:

```css
.loading-screen {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100vw;
    height: 100lvh;
    padding: max(20px, env(safe-area-inset-top)) 20px max(20px, env(safe-area-inset-bottom));
    overflow: hidden;
    background: #070a12;
    opacity: 1;
    visibility: visible;
    transition: opacity 0.48s var(--hero-ease), visibility 0.48s var(--hero-ease);
}

.loading-screen.is-exiting {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
}

.loading-intake {
    position: relative;
    width: min(92vw, 680px);
    height: min(88lvh, 820px);
}

.loading-controls {
    position: absolute;
    inset: 0;
    z-index: 5;
    pointer-events: none;
}

.loading-intake-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    color: rgba(237, 245, 255, 0.82);
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 11px;
    line-height: 1.4;
    letter-spacing: 0;
}

.loading-stage {
    position: absolute;
    inset: 44px 0 58px;
    isolation: isolate;
    perspective: 900px;
}

.loading-poster-stack,
.loading-frame,
.loading-particles,
.loading-light-slit {
    position: absolute;
    inset: 0;
}

.loading-poster-stack {
    z-index: 2;
}

.loading-frame {
    display: grid;
    place-items: center;
    margin: 0;
    overflow: hidden;
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
}

.loading-frame.is-active {
    visibility: visible;
    opacity: 1;
}

.loading-frame figcaption {
    position: absolute;
    right: 0;
    bottom: 0;
    z-index: 2;
    color: rgba(247, 251, 255, 0.72);
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 9px;
    line-height: 1;
    letter-spacing: 0;
}

.loading-image {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    opacity: 0;
    transform: translate3d(0, 0, 0) scale(0.985);
    clip-path: inset(0 50% 0 50%);
    transition:
        opacity var(--poster-reveal-ms, 180ms) ease,
        transform var(--poster-reveal-ms, 180ms) var(--hero-ease),
        clip-path var(--poster-reveal-ms, 180ms) var(--hero-ease);
}

.loading-frame.is-revealing .loading-image,
.loading-frame.is-stable .loading-image {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
    clip-path: inset(0);
}

.loading-frame[data-slit-direction="ltr"].is-revealing .loading-image {
    transform-origin: 42% 50%;
}

.loading-frame[data-slit-direction="rtl"].is-revealing .loading-image {
    transform-origin: 58% 50%;
}

.loading-frame.is-scattering .loading-image {
    opacity: 0;
    transform: translate3d(0, -6px, 18px) rotateX(1deg) scale(1.012);
    clip-path: polygon(0 0, 100% 0, 98% 48%, 100% 52%, 100% 100%, 0 100%, 2% 52%, 0 48%);
}

.loading-particles {
    z-index: 3;
    width: 100%;
    height: 100%;
    pointer-events: none;
}

.loading-light-slit {
    z-index: 4;
    left: 50%;
    right: auto;
    width: 2px;
    opacity: 0;
    transform: translate3d(-50%, 0, 0) scaleY(0.12);
    transition: opacity 80ms linear, transform var(--poster-reveal-ms, 180ms) ease;
    pointer-events: none;
}

.loading-light-slit-core,
.loading-light-slit-edge {
    position: absolute;
    inset: 0;
    display: block;
    background: #fffdf4;
}

.loading-light-slit-edge {
    left: -3px;
    right: -3px;
    background: rgba(220, 236, 255, 0.38);
}

.loading-light-slit.is-lit {
    opacity: 1;
    transform: translate3d(-50%, 0, 0) scaleY(1);
}

.loading-light-slit[data-direction="ltr"].is-lit {
    transform: translate3d(18vw, 0, 0) scaleY(1);
}

.loading-light-slit[data-direction="rtl"].is-lit {
    transform: translate3d(-18vw, 0, 0) scaleY(1);
}

.loading-screen.is-final-exposure .loading-light-slit {
    left: 0;
    width: 100%;
    opacity: 1;
    transform: none;
    transition: width 0.36s var(--hero-ease), left 0.36s var(--hero-ease), opacity 0.36s ease;
}

.loading-copy {
    position: absolute;
    right: 0;
    bottom: 0;
    min-height: 1.5em;
    margin: 0;
    color: rgba(237, 245, 255, 0.9);
    font-weight: 600;
    font-size: 12px;
    line-height: 1.5;
    letter-spacing: 0;
}

.loading-screen[data-state="error"] .loading-copy {
    color: #ffb3c3;
}

.loading-screen[data-state="error"] .loading-frame.is-failed {
    visibility: visible;
    opacity: 1;
}

.loading-screen[data-state="error"] .loading-frame.is-failed figcaption {
    right: auto;
    bottom: calc(var(--failure-row, 0) * 18px);
    left: 0;
    padding: 3px 5px;
    color: #ffb3c3;
    background: #070a12;
}

.loading-frame:nth-child(1) { --failure-row: 0; }
.loading-frame:nth-child(2) { --failure-row: 1; }
.loading-frame:nth-child(3) { --failure-row: 2; }
.loading-frame:nth-child(4) { --failure-row: 3; }
.loading-frame:nth-child(5) { --failure-row: 4; }

.loading-retry {
    position: absolute;
    left: 0;
    bottom: 0;
    display: block;
    padding: 8px 12px;
    border: 1px solid rgba(237, 245, 255, 0.4);
    border-radius: 4px;
    color: #f7fbff;
    background: rgba(13, 20, 33, 0.92);
    font: inherit;
    cursor: pointer;
    pointer-events: auto;
}

.loading-retry[hidden] {
    display: none;
}

.loading-progress-rail {
    position: absolute;
    right: 0;
    bottom: 28px;
    left: 0;
    z-index: 5;
    height: 1px;
    overflow: hidden;
    background: rgba(237, 245, 255, 0.16);
}

.loading-progress-rail span {
    display: block;
    width: calc(var(--loading-progress, 0) * 20%);
    height: 100%;
    background: #fffdf4;
    transition: width 0.2s ease;
}

.loading-screen[data-motion-profile="compact"] .loading-stage {
    perspective: none;
}

.loading-screen[data-motion-profile="compact"] .loading-frame.is-scattering .loading-image {
    transform: translate3d(0, -4px, 0) scale(1.006);
}

.loading-screen[data-motion-profile="reduce"] .loading-particles,
.loading-screen[data-motion-profile="reduce"] .loading-light-slit {
    display: none;
}

.loading-screen[data-motion-profile="reduce"] .loading-image {
    clip-path: inset(0);
    transform: none;
    transition: opacity 0.12s linear;
}
```

Add this single line in `setProgress()` immediately after updating `progress.textContent` so the rail is decoded-count based rather than animation-phase based:

```js
root.style.setProperty('--loading-progress', String(completed));
```

Add `root.style.setProperty('--loading-progress', '0');` in `reset()` beside the progress text reset.

Inside the existing `@media (prefers-reduced-motion: reduce)` block, add:

```css
.loading-screen,
.loading-frame,
.loading-image,
.loading-light-slit,
.loading-progress-rail span {
    animation: none !important;
}
```

Do not move any non-loading selector; the Task 12 stylesheet split remains a later change.

- [ ] **Step 6: Run focused integration and static contract tests**

Run: `node --test test/unit/loading-screen.test.js test/unit/poster-transition.test.js test/unit/light-particle-field.test.js`

Expected: all tests in the three files PASS. Specifically, the original five Task 6 loading tests still pass, the exact decoded node is enqueued only after mount, retry clears queue/Canvas/images, and the CSS/source assertions find no eager image or loading-poster filter/shadow declaration.

- [ ] **Step 7: Run the complete local verification gate**

Run: `npm run verify`

Expected: unit tests, audit check, Vite build, and build tests all PASS with exit status 0. The Vite output contains no missing selector/module error and no new production image asset.

- [ ] **Step 8: Commit the loading integration without the broader Task 12 split**

```bash
git add index.html src/ui/loading-screen.js src/app/bootstrap.js src/style.css test/unit/loading-screen.test.js
git diff --cached --check
git commit -m "feat: add cinematic loading poster sequence"
```

Expected: exactly those five integration files are staged; the diff leaves non-loading stylesheet sections and all media scripts untouched.

---

### Task 4: Refine nonlinear continuity, light decay, and visual text density

**Files:**
- Modify: `src/ui/poster-transition.js`
- Modify: `test/unit/poster-transition.test.js`
- Modify: `src/style.css`
- Modify: `test/unit/loading-screen.test.js`

**Interfaces:**
- Preserves the existing queue API and exact decoded-node ownership.
- Adds the transient visual class `is-outgoing`; it never carries `is-active` or exposed image semantics.
- Publishes `--slit-duration` on the loading root so the DOM light envelope matches the current normal or compressed reveal duration.

- [ ] **Step 1: Write failing continuity and light-envelope tests**

Extend `test/unit/poster-transition.test.js` with a manual-scheduler test that advances the second poster through gather and then inspects state before scatter/reveal settlement:

```js
test('incoming reveal overlaps outgoing decay without a blank stage', async () => {
  const scheduler = makeManualScheduler();
  const { controller, particleCalls, root, slots } = makeFixture({ scheduler });
  controller.enqueue(slots[0]);
  controller.enqueue(slots[1]);
  await flush();

  while (!slots[0].classList.contains('is-stable')) {
    scheduler.releaseNext();
    await flush();
  }
  scheduler.releaseNext();
  await flush();

  assert.equal(slots[0].classList.contains('is-outgoing'), true);
  assert.equal(slots[0].classList.contains('is-active'), false);
  assert.equal(slots[0].querySelector('img').getAttribute('aria-hidden'), 'true');
  assert.equal(slots[1].classList.contains('is-active'), true);
  assert.equal(slots[1].classList.contains('is-revealing'), true);
  assert.equal(root.querySelectorAll('.is-active').length, 1);
  assert.equal(root.querySelectorAll('.is-active, .is-outgoing').length, 2);
  assert.ok(particleCalls.some(([name]) => name === 'scatter'));

  while (scheduler.pending) {
    scheduler.releaseNext();
    await flush();
  }
  await controller.waitForIdle();
  assert.equal(root.querySelectorAll('.is-outgoing').length, 0);
  assert.equal(root.querySelectorAll('.is-active').length, 1);
});
```

Extend the reset/freeze/destroy tests so every path removes `is-outgoing` and the root `--slit-duration` property. Extend `test/unit/loading-screen.test.js` static assertions with:

```js
assert.doesNotMatch(html, /LIGHT ARCHIVE|PROJECTION/);
assert.match(css, /\.loading-frame\.is-outgoing\s*\{[^}]*visibility:\s*visible/s);
assert.match(css, /--slit-duration/);
assert.match(css, /loading-final-exposure/);
assert.doesNotMatch(css, /\.loading-(?:image|light-slit)[^{]*\{[^}]*transition:[^}]*\blinear\b/s);
```

Keep the existing reduced-motion assertion allowing its direct `opacity 120ms linear` rule.

- [ ] **Step 2: Run the focused tests to prove the red state**

Run:

```bash
node --test test/unit/poster-transition.test.js test/unit/loading-screen.test.js
```

Expected: FAIL because `is-outgoing`, root `--slit-duration`, the overlapping state, and the final-exposure envelope are not implemented.

- [ ] **Step 3: Overlap outgoing decay with incoming reveal**

In `runAnimatedItem`, keep the existing gather phase. Replace the sequential outgoing scatter followed by incoming reveal with one cross-phase:

```js
const outgoing = activeItem;
if (outgoing) {
  setActive(outgoing, false);
  outgoing.slot.classList.remove('is-stable');
  outgoing.slot.classList.add('is-outgoing', 'is-scattering');
}

activeItem = item;
completedReadableHold = 0;
root.style.setProperty('--slit-duration', `${timing.reveal}ms`);
slit.classList.add('is-lit');
setActive(activeItem, true);
activeItem.slot.classList.add('is-revealing');

const [, scattered, revealed] = await Promise.all([
  outgoing
    ? Promise.resolve(particleField.scatter(outgoing.slot.getBoundingClientRect()))
    : Promise.resolve(),
  sleep(outgoing ? timing.scatter : 0, token),
  sleep(timing.reveal, token)
]);
if (!isCurrent(token) || scattered === false || revealed === false) return;

if (outgoing) {
  outgoing.slot.classList.remove('is-outgoing', 'is-scattering');
}
activeItem.slot.classList.remove('is-revealing');
activeItem.slot.classList.add('is-stable');
slit.classList.remove('is-lit');
```

Retain exactly one `.is-active` item and make the outgoing image `aria-hidden="true"` before overlap starts. Add `is-outgoing` to every cleanup/reset/freeze/destroy class list and remove `--slit-duration` during reset/destroy. Cancellation tokens remain authoritative; a stale overlap completion must not remove classes from a later run.

- [ ] **Step 4: Apply a finite nonlinear light envelope and outgoing visual layer**

In `src/style.css`, add `.loading-frame.is-outgoing` to the visible-frame rule while keeping it semantically inactive:

```css
.loading-frame.is-active,
.loading-frame.is-outgoing,
.loading-frame.is-failed {
    opacity: 1;
    visibility: visible;
}
```

Change the slit animations to use `var(--slit-duration, 180ms)` and the existing non-linear easing. Keep their opacity progression at `0 -> 0.12 -> 0.78 -> 0.18 -> 0`. Replace the static final exposure with a finite animation:

```css
.loading-screen.is-final-exposure .loading-light-slit {
    animation: loading-final-exposure 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes loading-final-exposure {
    0% { opacity: 0; transform: translate(-50%, -50%) scaleX(0.004); }
    38% { opacity: 0.72; transform: translate(-50%, -50%) scaleX(1); }
    72% { opacity: 0.36; transform: translate(-50%, -50%) scaleX(1); }
    100% { opacity: 0.08; transform: translate(-50%, -50%) scaleX(1); }
}
```

Use `cubic-bezier(0.22, 1, 0.36, 1)` for full/compact poster opacity, transform, clip-path, slit, progress rail, copy, and loading-screen exit transitions. Do not add blur, filter, shadow animation, negative letter spacing, new visible text, or new DOM elements. Preserve the reduced-motion direct opacity rule.

- [ ] **Step 5: Run focused and complete verification**

Run:

```bash
node --test test/unit/poster-transition.test.js test/unit/loading-screen.test.js
npm run verify
git diff --check
```

Expected: all focused and project tests PASS. During an animated handoff there is one `.is-active` and at most one `.is-outgoing`; after idle only one `.is-active` remains. Static assertions find no visible English archive heading, no normal caption opacity, and no full/compact linear loading transition.

- [ ] **Step 6: Commit the continuity refinement**

```bash
git add src/ui/poster-transition.js test/unit/poster-transition.test.js src/style.css test/unit/loading-screen.test.js
git diff --cached --check
git commit -m "refine: smooth loading poster choreography"
```

Expected: exactly the queue, queue tests, loading CSS, and loading static tests are staged; no media, audio, or broader Task 12 files are included.

---

### Task 5: Verify browser visuals, pixels, network concurrency, and frame/performance settlement

**Files:**
- Create: `test/e2e/loading-poster-transition.spec.js`
- Verify: `playwright.config.js` (no modification)

**Interfaces:**
- Consumes: the production loading gate, the five existing manifest requests, the Canvas `data-phase` / `data-frame-count` lifecycle seam from Task 1, and the three existing Playwright projects.
- Produces: browser assertions and screenshots for desktop Chromium, Pixel 5 Chromium, and Pixel 5 reduced motion. The test routes only the five requested image responses to deterministic 3:4 in-memory fixtures, so it exercises production request count/concurrency and decoded-node flow without OSS credentials or runtime-cover migration.

- [ ] **Step 1: Write the deterministic cross-profile browser test**

Create `test/e2e/loading-poster-transition.spec.js` with this complete content:

```js
import { test, expect } from '@playwright/test';

const coverSvg = (index) => Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
    <rect width="600" height="800" fill="#11151d"/>
    <rect x="28" y="28" width="544" height="744" fill="#f4f1e8"/>
    <rect x="56" y="56" width="488" height="688" fill="#26394a"/>
    <text x="300" y="410" text-anchor="middle" fill="#fffdf4" font-size="64">AR-${String(index).padStart(2, '0')}</text>
  </svg>
`);

const installDeterministicCovers = async (page) => {
  const stats = { active: 0, maxActive: 0, total: 0 };
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'image') {
      await route.continue();
      return;
    }
    stats.active += 1;
    stats.total += 1;
    stats.maxActive = Math.max(stats.maxActive, stats.active);
    const fixtureIndex = stats.total;
    await new Promise((resolve) => setTimeout(resolve, 80));
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: coverSvg(fixtureIndex)
    });
    stats.active -= 1;
  });
  return stats;
};

const installLongTaskObserver = async (page) => {
  await page.addInitScript(() => {
    window.__vinylLongTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__vinylLongTasks.push({ startTime: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: 'longtask', buffered: true });
  });
};

test('single-poster loading sequence is bounded and settles', async ({ page }, testInfo) => {
  const reduce = testInfo.project.name === 'mobile-reduce';
  const stats = await installDeterministicCovers(page);
  await installLongTaskObserver(page);
  await page.goto('./');

  const loading = page.locator('#loadingScreen');
  const canvas = page.locator('#loadingParticles');
  const canvasHandle = await canvas.elementHandle();
  expect(canvasHandle).not.toBeNull();

  await expect(page.locator('.loading-frame.is-active')).toHaveCount(1, { timeout: 5_000 });

  const posterGeometry = await page.locator('.loading-frame.is-active .loading-image').evaluate((image) => {
    const imageRect = image.getBoundingClientRect();
    const stageRect = image.closest('.loading-stage').getBoundingClientRect();
    return {
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      objectFit: getComputedStyle(image).objectFit,
      insideStage: imageRect.width <= stageRect.width + 0.5 && imageRect.height <= stageRect.height + 0.5
    };
  });
  expect(posterGeometry).toEqual({
    naturalWidth: 600,
    naturalHeight: 800,
    objectFit: 'contain',
    insideStage: true
  });

  if (!reduce) {
    await expect.poll(() => canvas.evaluate((element) => element.dataset.phase), { timeout: 5_000 })
      .not.toBe('idle');
    await expect.poll(() => canvas.evaluate((element) => {
      const context = element.getContext('2d');
      const pixels = context.getImageData(0, 0, element.width, element.height).data;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] !== 0) return true;
      }
      return false;
    })).toBe(true);
  } else {
    await expect(canvas).toHaveAttribute('data-frame-count', '0');
    await expect(page.locator('#loadingLightSlit')).toBeHidden();
  }

  if (reduce) {
    await page.screenshot({
      path: testInfo.outputPath(`loading-${testInfo.project.name}.png`),
      fullPage: true
    });
  }
  const effectStart = await page.evaluate(() => performance.now());

  const maxSimultaneousPosters = await page.evaluate(async () => {
    let max = 0;
    const samples = matchMedia('(prefers-reduced-motion: reduce)').matches ? 24 : 90;
    for (let sample = 0; sample < samples; sample += 1) {
      max = Math.max(max, document.querySelectorAll('.loading-frame.is-active').length);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return max;
  });
  expect(maxSimultaneousPosters).toBe(1);

  if (!reduce) {
    await expect(page.locator('[data-loading-slot="archive-05"]')).toHaveClass(/is-active/, { timeout: 8_000 });
    await page.screenshot({
      path: testInfo.outputPath(`loading-${testInfo.project.name}.png`),
      fullPage: true
    });
  }
  await expect(loading).toHaveCount(0, { timeout: 10_000 });
  const effectEnd = await page.evaluate(() => performance.now());

  const framesAtExit = Number(await canvasHandle.evaluate((element) => element.dataset.frameCount));
  await page.waitForTimeout(300);
  const framesAfterWait = Number(await canvasHandle.evaluate((element) => element.dataset.frameCount));
  expect(framesAfterWait).toBe(framesAtExit);

  await expect(page.locator('#appRoot')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#appRoot')).not.toHaveAttribute('aria-hidden', 'true');
  expect(stats.total).toBe(5);
  expect(stats.maxActive).toBeLessThanOrEqual(2);

  const effectLongTasks = await page.evaluate(({ start, end }) => (
    window.__vinylLongTasks.filter((entry) => entry.startTime >= start && entry.startTime <= end)
  ), { start: effectStart, end: effectEnd });
  expect(effectLongTasks.filter(({ duration }) => duration > 50)).toEqual([]);
});
```

- [ ] **Step 2: Install the required local Chromium revision**

Run:

```bash
npx playwright install chromium
```

Expected: the Chromium revision required by the installed `@playwright/test` package is present in Playwright's local browser cache. Re-running the command is idempotent and must not modify tracked repository files.

- [ ] **Step 3: Run the new browser test once to expose visual or lifecycle failures**

Run: `npx playwright test test/e2e/loading-poster-transition.spec.js --project=desktop-chromium`

Expected: 1 test PASS in `desktop-chromium`. Any assertion naming poster count, Canvas pixels, final slot, frame settlement, request count/concurrency, or a task over 50 ms is a red result: change only the responsible Task 1-3 code, rerun this command, and require `1 passed` without weakening thresholds or adding sleeps beyond the specified deterministic route delay.

- [ ] **Step 4: Verify desktop, Pixel-class mobile, and reduced motion**

Run: `npx playwright test test/e2e/loading-poster-transition.spec.js`

Expected: 3 tests PASS, one in each configured project. Passing runs produce `loading-desktop-chromium.png`, `loading-mobile-chromium.png`, and `loading-mobile-reduce.png` under their Playwright test output directories. Desktop and mobile images show one complete 3:4 poster, edge progress, no frame/card border, and no overlap; reduced motion shows the direct-fade poster with no slit or particle loop.

- [ ] **Step 5: Capture a retained mobile performance trace**

Run: `npx playwright test test/e2e/loading-poster-transition.spec.js --project=mobile-chromium --trace=on`

Expected: 1 test PASS and Playwright retains a trace archive under `test-results/`. The automated observation window contains no task longer than 50 ms, the routed image request count is exactly 5, maximum image concurrency is at most 2, and the detached Canvas frame count is unchanged after 300 ms.

- [ ] **Step 6: Run the complete project verification after browser coverage**

Run: `npm run verify && npm run test:e2e`

Expected: unit, audit, build, build-test, existing browser smoke, and all three new browser profiles PASS with exit status 0. No command requests OSS credentials and no assertion assumes Task 8 remote mutation has run.

- [ ] **Step 7: Inspect the final scoped diff and commit browser verification**

```bash
git status --short
git diff --check
git add test/e2e/loading-poster-transition.spec.js
git diff --cached --check
git commit -m "test: verify loading poster transition"
```

Expected: `git diff --check` and `git diff --cached --check` print nothing. The commit stages only the new browser test; generated `test-results/`, screenshots, traces, and concurrent `scripts/media/**` / `test/unit/media-tools.test.js` changes remain untracked or unstaged.

---

### Task 6: Refine Visual 6 timing, sliced light decay, and poster continuity

**Files:**
- Modify: `src/ui/poster-transition.js`
- Modify: `test/unit/poster-transition.test.js`
- Modify: `src/style.css`
- Modify: `test/unit/loading-screen.test.js`
- Modify: `test/e2e/loading-poster-transition.spec.js`

**Interfaces:**
- Preserves `createPosterTransition(...)`, its returned controller API, FIFO order, decoded-node ownership, `is-active` semantics, and Task 4's visual-only `is-outgoing` layer.
- Changes `POSTER_TIMING` to normal `{ gather: 180, scatter: 260, reveal: 320, hold: 300 }`, fast `{ gather: 80, scatter: 150, reveal: 180, hold: 180 }`, `finalHold: 560`, `finalExposure: 640`, and unchanged `reduceFade: 120`.
- Adds only the transient CSS custom property `--poster-scatter-ms` to an existing outgoing slot. It adds no DOM, image, request, visible copy, or production dependency.
- Reuses the existing `.loading-light-core`, `.loading-light-edge.is-warm`, and `.loading-light-edge.is-cool` spans as the three light-curtain slices.
- Preserves the current profile-change contract: switching an in-flight scene to `reduce` cancels and cleans transient work; `full <-> compact` keeps that scene running and applies the new profile to subsequent scene setup.

- [ ] **Step 1: Write failing timing, decay, continuity, and scope tests**

Replace the existing `timing tables are deeply frozen and preserve exact phase totals` test in `test/unit/poster-transition.test.js` with:

```js
test('timing tables are deeply frozen and preserve exact Visual 6 wall times', () => {
  assert.deepEqual(POSTER_TIMING, {
    normal: { gather: 180, scatter: 260, reveal: 320, hold: 300 },
    fast: { gather: 80, scatter: 150, reveal: 180, hold: 180 },
    finalHold: 560,
    finalExposure: 640,
    reduceFade: 120
  });
  const wallTime = ({ gather, scatter, reveal, hold }) => (
    gather + Math.max(scatter, reveal) + hold
  );
  assert.equal(wallTime(POSTER_TIMING.normal), 800);
  assert.equal(wallTime(POSTER_TIMING.fast), 440);
  assert.equal(Object.isFrozen(POSTER_TIMING), true);
  assert.equal(Object.isFrozen(POSTER_TIMING.normal), true);
  assert.equal(Object.isFrozen(POSTER_TIMING.fast), true);
});
```

In the existing `animated transitions overlap outgoing scatter with incoming reveal` test, destructure `slit`, then add these assertions immediately after its current `scheduler.durations` overlap assertion:

```js
assert.equal(
  outgoing.style.getPropertyValue('--poster-scatter-ms'),
  `${POSTER_TIMING.normal.scatter}ms`
);
assert.equal(slit.classList.contains('is-lit'), true);

scheduler.releaseNext();
await flush();
assert.equal(slit.classList.contains('is-lit'), true, 'light remains until the longer reveal decays');
assert.equal(outgoing.classList.contains('is-outgoing'), true);

scheduler.releaseNext();
await flush();
assert.equal(slit.classList.contains('is-lit'), false);
assert.equal(outgoing.classList.contains('is-outgoing'), false);
assert.equal(outgoing.style.getPropertyValue('--poster-scatter-ms'), '');
```

Replace that test's final `while (controller.getState().processing)` loop with one `scheduler.releaseNext()`, `await flush()`, and `await controller.waitForIdle()` to settle the pending hold.

Make every lifecycle cleanup assertion non-vacuous with these exact additions:

- In `reset aborts an old finish exposure without settling the new run`, set `slots[0].style.setProperty('--poster-scatter-ms', '260ms')` beside the existing seeded `is-outgoing` state, assert it equals `260ms` before `controller.reset()`, then assert it equals `''` after reset.
- In `freeze aborts queued work but keeps the current poster active and stable`, seed and pre-assert `--poster-scatter-ms: 260ms` on `slots[1]` before `controller.freeze()`, then assert it is empty afterward.
- In `animation errors stabilize the current poster, reject finish once, and reset recovers`, seed and pre-assert `--poster-scatter-ms: 260ms` on `slots[0]` before awaiting the rejected `finish()`, then assert the failure cleanup removed it.
- In `switching to reduce mid-gather cancels animation and resumes every item as a fade`, seed and pre-assert `--poster-scatter-ms: 260ms` on `slots[0]` before `controller.setProfile('reduce')`, then assert it is empty immediately after the switch cleanup.
- In `setProfile forwards valid changes and destroy is idempotent and terminal`, seed and pre-assert `--poster-scatter-ms: 260ms` on `slots[1]` beside its existing `is-outgoing` state, then assert it is empty after the first `destroy()`.

Add this manual-scheduler test to prove `full <-> compact` does not take the reduce cleanup path:

```js
test('full and compact changes preserve the in-flight scene', async () => {
  const scheduler = makeManualScheduler();
  const { controller, particleCalls, root, slots } = makeFixture({ scheduler });
  controller.enqueue(slots[0]);
  controller.enqueue(slots[1]);
  await flush();

  assert.deepEqual(scheduler.durations, [POSTER_TIMING.normal.gather]);
  assert.equal(controller.getState().processing, true);
  const pendingBeforeChange = scheduler.pending;

  controller.setProfile('compact');

  assert.equal(controller.getState().profile, 'compact');
  assert.equal(controller.getState().processing, true);
  assert.equal(scheduler.pending, pendingBeforeChange);
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.normal.gather]);
  assert.equal(root.dataset.motionProfile, 'compact');
  assert.deepEqual(particleCalls.at(-1), ['profile', 'compact']);

  let iterations = 0;
  while (controller.getState().processing) {
    assert.ok(iterations < 32, 'profile-change drain exceeded its bound');
    assert.ok(scheduler.pending > 0);
    scheduler.releaseNext();
    await flush();
    iterations += 1;
  }
  await controller.waitForIdle();

  assert.equal(controller.getState().activeId, 'archive-02');
  assert.equal(root.dataset.motionProfile, 'compact');
});
```

This test must not expect `switchRunningWorkToReduce()` behavior for `full <-> compact`.

In `test/unit/loading-screen.test.js`, add these bounded CSS helpers above `loading CSS defines the projection layers and motion-specific fallbacks`:

```js
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractCssBlock = (source, selector) => {
  const match = new RegExp(
    `(?:^|\\})\\s*${escapeRegExp(selector)}\\s*\\{`,
    'm'
  ).exec(source);
  assert.ok(match, `missing CSS block: ${selector}`);
  const openIndex = match.index + match[0].lastIndexOf('{');
  let depth = 1;
  for (let index = openIndex + 1; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(openIndex + 1, index);
  }
  assert.fail(`unterminated CSS block: ${selector}`);
};

const expectDeclarations = (body, declarations, label) => {
  for (const [property, value] of Object.entries(declarations)) {
    assert.match(
      body,
      new RegExp(`${escapeRegExp(property)}\\s*:\\s*${escapeRegExp(value)}\\s*;`),
      `${label} must contain ${property}: ${value}`
    );
  }
};

const expectKeyframeStops = (source, name, stops) => {
  const keyframeBody = extractCssBlock(source, `@keyframes ${name}`);
  for (const [percentage, declarations] of Object.entries(stops)) {
    expectDeclarations(
      extractCssBlock(keyframeBody, percentage),
      declarations,
      `${name} ${percentage}`
    );
  }
  return keyframeBody;
};
```

Replace the current `180ms` poster/slit assertions and every unbounded keyframe regex with this code inside that test:

```js
assert.equal(POSTER_TIMING.finalExposure, 640);
assert.match(loadingBlock, /--slit-duration:\s*320ms/);
assert.match(loadingBlock, /\.loading-image\s*\{[^}]*opacity var\(--poster-reveal-ms, 320ms\) cubic-bezier\(0\.22, 1, 0\.36, 1\)/s);
assert.match(loadingBlock, /\.loading-image\s*\{[^}]*transform var\(--poster-reveal-ms, 320ms\) cubic-bezier\(0\.22, 1, 0\.36, 1\)/s);
assert.match(loadingBlock, /\.loading-image\s*\{[^}]*clip-path var\(--poster-reveal-ms, 320ms\) cubic-bezier\(0\.22, 1, 0\.36, 1\)/s);

expectDeclarations(
  extractCssBlock(loadingBlock, '.loading-frame.is-scattering .loading-image'),
  { 'transition-duration': 'var(--poster-scatter-ms, 260ms)' },
  'outgoing scatter duration'
);

for (const [selector, animation] of [
  [
    '.loading-light-slit.is-lit[data-direction="ltr"]',
    'loading-slit-ltr var(--slit-duration, 320ms) cubic-bezier(0.22, 1, 0.36, 1) both'
  ],
  [
    '.loading-light-slit.is-lit[data-direction="rtl"]',
    'loading-slit-rtl var(--slit-duration, 320ms) cubic-bezier(0.22, 1, 0.36, 1) both'
  ],
  [
    '.loading-light-slit.is-lit .loading-light-core',
    'loading-curtain-core var(--slit-duration, 320ms) cubic-bezier(0.22, 1, 0.36, 1) both'
  ],
  [
    '.loading-light-slit.is-lit .loading-light-edge.is-warm',
    'loading-curtain-warm var(--slit-duration, 320ms) cubic-bezier(0.22, 1, 0.36, 1) both'
  ],
  [
    '.loading-light-slit.is-lit .loading-light-edge.is-cool',
    'loading-curtain-cool var(--slit-duration, 320ms) cubic-bezier(0.22, 1, 0.36, 1) both'
  ]
]) {
  expectDeclarations(extractCssBlock(loadingBlock, selector), { animation }, selector);
}

expectKeyframeStops(loadingBlock, 'loading-slit-ltr', {
  '0%': { opacity: '0', transform: 'translate(-150%, -50%) scaleX(0.004)' },
  '16%': { opacity: '0.10' },
  '42%': { opacity: '0.68' },
  '64%': { opacity: '0.34' },
  '82%': { opacity: '0.12' },
  '100%': { opacity: '0', transform: 'translate(50%, -50%) scaleX(0.004)' }
});

expectKeyframeStops(loadingBlock, 'loading-slit-rtl', {
  '0%': { opacity: '0', transform: 'translate(50%, -50%) scaleX(0.004)' },
  '16%': { opacity: '0.10' },
  '42%': { opacity: '0.68' },
  '64%': { opacity: '0.34' },
  '82%': { opacity: '0.12' },
  '100%': { opacity: '0', transform: 'translate(-150%, -50%) scaleX(0.004)' }
});

expectKeyframeStops(loadingBlock, 'loading-curtain-core', {
  '0%': { opacity: '0', transform: 'scaleX(0.08)' },
  '42%': { opacity: '1', transform: 'scaleX(1)' },
  '64%': { opacity: '0.46', transform: 'scaleX(0.72)' },
  '100%': { opacity: '0', transform: 'scaleX(0.18)' }
});

expectKeyframeStops(loadingBlock, 'loading-curtain-warm', {
  '0%': { opacity: '0', transform: 'translateX(8%) scaleX(0.04)' },
  '42%': { opacity: '0.82', transform: 'translateX(0) scaleX(1)' },
  '64%': { opacity: '0.34', transform: 'translateX(-10%) scaleX(0.80)' },
  '100%': { opacity: '0', transform: 'translateX(-18%) scaleX(0.56)' }
});

expectKeyframeStops(loadingBlock, 'loading-curtain-cool', {
  '0%': { opacity: '0', transform: 'translateX(-8%) scaleX(0.04)' },
  '42%': { opacity: '0.78', transform: 'translateX(0) scaleX(1)' },
  '64%': { opacity: '0.32', transform: 'translateX(10%) scaleX(0.80)' },
  '100%': { opacity: '0', transform: 'translateX(18%) scaleX(0.56)' }
});

expectDeclarations(
  extractCssBlock(loadingBlock, '.loading-screen.is-final-exposure .loading-light-slit'),
  {
    animation: `loading-final-exposure ${POSTER_TIMING.finalExposure}ms cubic-bezier(0.22, 1, 0.36, 1) both`
  },
  'final exposure duration sync'
);

expectKeyframeStops(loadingBlock, 'loading-final-exposure', {
  '0%': { opacity: '0', transform: 'translate(-50%, -50%) scaleX(0.004)' },
  '34%': { opacity: '0.68', transform: 'translate(-50%, -50%) scaleX(1)' },
  '62%': { opacity: '0.30', transform: 'translate(-50%, -50%) scaleX(1)' },
  '84%': { opacity: '0.10', transform: 'translate(-50%, -50%) scaleX(1)' },
  '100%': { opacity: '0', transform: 'translate(-50%, -50%) scaleX(1)' }
});

assert.doesNotMatch(loadingBlock, /(?:\.loading-frame|\.loading-image|\.loading-light-slit)[^{]*\{[^}]*(?:filter|box-shadow|backdrop-filter)\s*:/s);
```

Keep the existing checks for exactly five slots, zero eager images, one Canvas, one slit container, hidden normal captions, no visible English heading, no loading `url(...)`, and only the unit-level reduced-motion `opacity 120ms linear` exception. The LTR and RTL bodies are extracted separately, so a missing stop in one direction cannot pass by matching the next keyframe.

- [ ] **Step 2: Run the focused tests to prove the red state**

Run:

```bash
node --test test/unit/poster-transition.test.js test/unit/loading-screen.test.js
```

Expected: FAIL because the current timing table still reports `160/160/180/300`, the slit peaks at `0.78`, the final exposure ends at `0.08`, the curtain-slice keyframes do not exist, and `--poster-scatter-ms` is not published or cleaned. The pre-existing Task 4 overlap, stale-token, retry, reduce, and accessibility tests remain in the run.

- [ ] **Step 3: Implement the exact queue timing and cleanup contract**

In `src/ui/poster-transition.js`, replace only `POSTER_TIMING` with:

```js
export const POSTER_TIMING = Object.freeze({
  normal: Object.freeze({ gather: 180, scatter: 260, reveal: 320, hold: 300 }),
  fast: Object.freeze({ gather: 80, scatter: 150, reveal: 180, hold: 180 }),
  finalHold: 560,
  finalExposure: 640,
  reduceFade: 120
});
```

At the start of the existing animated overlap, publish both durations before adding transition classes:

```js
if (outgoing) {
  setActive(outgoing, false);
  outgoing.slot.style.setProperty('--poster-scatter-ms', `${timing.scatter}ms`);
  outgoing.slot.classList.remove('is-stable');
  outgoing.slot.classList.add('is-outgoing', 'is-scattering');
}

activeItem = item;
completedReadableHold = 0;
root.style.setProperty('--slit-duration', `${timing.reveal}ms`);
slit.classList.add('is-lit');
setActive(activeItem, true);
activeItem.slot.classList.add('is-revealing');
```

Keep scatter and reveal in the existing `Promise.all`. Because reveal is longer than scatter in both timing profiles, remove `is-lit`, `is-outgoing`, and `is-scattering` only after that `Promise.all` resolves. At the same settlement point remove `--poster-scatter-ms` from the outgoing slot. Add `slot.style.removeProperty('--poster-scatter-ms')` to `clearSlotState()`, the `preserveActive` loop in `cancelWork(...)`, `switchRunningWorkToReduce()`, and `fail(...)`; the non-preserving `cancelWork(...)` path already delegates to `clearSlotState()`. Preserve `setProfile(...)`'s existing `switchingToReduce && !alreadySettled` guard exactly: a running `full <-> compact` change must not invoke cleanup, increment the generation, abort controller sleeps, or requeue the current item. Do not change `setActive`, queue order, image mounting, the reduce branch, or cancellation-token checks.

- [ ] **Step 4: Implement the sliced light curtain and gentler poster planes**

In the loading block of `src/style.css`:

1. Change the root fallback to `--slit-duration: 320ms` and all poster reveal fallbacks to `320ms`.
2. Add `.loading-frame.is-scattering .loading-image { transition-duration: var(--poster-scatter-ms, 260ms); }`.
3. Change full outgoing transforms to at most `translate3d(2.4%, -0.6%, 0) rotateX(1.2deg) scale(0.992)` and its mirrored equivalent. Change compact outgoing transforms to `translate(14px, -2px) scale(0.992)` and its mirror.
4. Keep the existing three slit spans and add these animation assignments; do not edit `index.html`:

```css
.loading-light-slit.is-lit .loading-light-core {
    animation: loading-curtain-core var(--slit-duration, 320ms) cubic-bezier(0.22, 1, 0.36, 1) both;
}

.loading-light-slit.is-lit .loading-light-edge.is-warm {
    animation: loading-curtain-warm var(--slit-duration, 320ms) cubic-bezier(0.22, 1, 0.36, 1) both;
}

.loading-light-slit.is-lit .loading-light-edge.is-cool {
    animation: loading-curtain-cool var(--slit-duration, 320ms) cubic-bezier(0.22, 1, 0.36, 1) both;
}
```

Use this exact opacity envelope in both directional parent keyframes: `0: 0`, `16: 0.10`, `42: 0.68`, `64: 0.34`, `82: 0.12`, `100: 0`. Retain the existing directional start/end translations. Add:

```css
@keyframes loading-curtain-core {
    0% { opacity: 0; transform: scaleX(0.08); }
    42% { opacity: 1; transform: scaleX(1); }
    64% { opacity: 0.46; transform: scaleX(0.72); }
    100% { opacity: 0; transform: scaleX(0.18); }
}

@keyframes loading-curtain-warm {
    0% { opacity: 0; transform: translateX(8%) scaleX(0.04); }
    42% { opacity: 0.82; transform: translateX(0) scaleX(1); }
    64% { opacity: 0.34; transform: translateX(-10%) scaleX(0.80); }
    100% { opacity: 0; transform: translateX(-18%) scaleX(0.56); }
}

@keyframes loading-curtain-cool {
    0% { opacity: 0; transform: translateX(-8%) scaleX(0.04); }
    42% { opacity: 0.78; transform: translateX(0) scaleX(1); }
    64% { opacity: 0.32; transform: translateX(10%) scaleX(0.80); }
    100% { opacity: 0; transform: translateX(18%) scaleX(0.56); }
}
```

Set `loading-final-exposure` to `640ms` and use exactly `0: 0`, `34: 0.68`, `62: 0.30`, `84: 0.10`, `100: 0`, with `scaleX(1)` from 34% through 100%. Do not add blur, `filter`, shadow animation, `backdrop-filter`, `will-change`, a DOM node, image source, visible caption, heading, subtitle, hint, or identifier.

- [ ] **Step 5: Add browser sampling for single-poster visual continuity**

The current file has two tests and three Playwright projects, so this focused file produces six cases. Modify only the first test, `single-poster loading sequence is bounded and settles`, through its existing `installBrowserProbe(page)` helper. Leave the independent `captures the loading poster visual` test unchanged; it continues to own screenshot capture and exact-request verification without installing the continuity probe.

In `installBrowserProbe(page)`, extend `window.__vinylLoadingProbe` with:

```js
continuityArmed: false,
continuitySamples: 0,
maxVisualLayers: 0,
maxDominantPosters: 0,
minCompositeOpacity: 1
```

Inside the existing `DOMContentLoaded` callback, start this sampler after `inspectActivePosters()` and `inspectCanvas()`:

```js
const samplePosterContinuity = () => {
  const loading = document.querySelector('#loadingScreen');
  if (!loading) return;
  const visualFrames = [...loading.querySelectorAll('.loading-frame.is-active, .loading-frame.is-outgoing')];
  probe.continuityArmed ||= Boolean(loading.querySelector('.loading-frame.is-stable'));

  if (probe.continuityArmed && !loading.classList.contains('is-final-exposure')) {
    const opacities = visualFrames.map((frame) => (
      Number.parseFloat(getComputedStyle(frame.querySelector('.loading-image')).opacity) || 0
    ));
    probe.continuitySamples += 1;
    probe.maxVisualLayers = Math.max(probe.maxVisualLayers, visualFrames.length);
    probe.maxDominantPosters = Math.max(
      probe.maxDominantPosters,
      opacities.filter((opacity) => opacity > 0.55).length
    );
    probe.minCompositeOpacity = Math.min(
      probe.minCompositeOpacity,
      opacities.reduce((sum, opacity) => sum + opacity, 0)
    );
  }
  requestAnimationFrame(samplePosterContinuity);
};
requestAnimationFrame(samplePosterContinuity);
```

Add these fields to `finalProbe`. Inside the first test only, guard the full/compact assertions exactly as follows:

```js
if (!reduce) {
  expect(finalProbe.continuitySamples).toBeGreaterThan(3);
  expect(finalProbe.maxVisualLayers).toBeLessThanOrEqual(2);
  expect(finalProbe.maxDominantPosters).toBeLessThanOrEqual(1);
  expect(finalProbe.minCompositeOpacity).toBeGreaterThanOrEqual(0.70);
}
```

Do not apply the composite-opacity assertion to `mobile-reduce`; retain only its existing zero-frame and hidden-slit browser assertions. The exact `opacity 120ms linear` direct fade remains covered by `test/unit/loading-screen.test.js`, because the current E2E file does not measure its duration or curve. Keep the existing exact five-request, concurrency-at-most-two, stopped-frame-loop, uncropped-poster, and effect-attributable `50 ms` long-task assertions unchanged.

- [ ] **Step 6: Run focused unit and browser verification**

Run:

```bash
node --test test/unit/poster-transition.test.js test/unit/loading-screen.test.js
npx playwright test test/e2e/loading-poster-transition.spec.js
```

Expected: the focused unit command exits 0 with all tests PASS. Playwright reports `6 passed`: the performance/continuity test and the independent screenshot test each run in `desktop-chromium`, `mobile-chromium`, and `mobile-reduce`. The first test samples no blank full/compact stage and at most one dominant cover; reduced motion requests no frame and shows no slit. Both tests retain exact five-cover request verification, concurrency stays at most 2, and compact reports no effect-attributable long task over `50 ms`.

- [ ] **Step 7: Run the complete gate and inspect all three screenshots**

Run:

```bash
npm run verify && npm run test:e2e
find test-results -name 'loading-*.png' -print
git diff --check
```

Expected: both npm commands exit 0; Playwright reports all configured tests passing, including six cases from `loading-poster-transition.spec.js`; `git diff --check` prints nothing. Each case observes exactly the five allowlisted cover requests. The three screenshots produced only by `captures the loading poster visual` show one complete uncropped dominant poster, no card frame, and no added visible copy. The separate first test confirms full/compact continuity, zero reduced-motion Canvas frames, a hidden reduced-motion slit, and no Pixel-class effect-attributable task over `50 ms`.

- [ ] **Step 8: Commit only the Visual 6 implementation and tests**

```bash
git add src/ui/poster-transition.js test/unit/poster-transition.test.js src/style.css test/unit/loading-screen.test.js test/e2e/loading-poster-transition.spec.js
git diff --cached --check
git commit -m "refine: polish loading light curtain"
```

Expected: exactly those five files are staged. `index.html`, all five cover assets, `scripts/media/**`, generated screenshots/traces, and unrelated work remain unstaged; the commit succeeds with the stated message.

---

## Completion Gate

Implementation is complete only when all six task commits exist locally, `npm run verify && npm run test:e2e` exits 0, and the three browser screenshots have been visually inspected for a full uncropped poster, readable progress, loading-layer z-order above app overlays, one dominant poster, progressive post-peak light decay, and no incoherent overlap. Keep Task 8 remote OSS apply marked as a separate release gate before release, then continue with Task 9; leave the remaining Task 12 typography, player surface, overlays, and stylesheet split for its existing later work.
