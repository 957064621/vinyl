import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { startCriticalAssetGate } from '../../src/app/bootstrap.js';
import { CriticalAssetError } from '../../src/media/asset-loader.js';
import {
  FINAL_HANDOFF_TIMING,
  LOADING_PRELUDE_TIMING,
  VisualTransitionError,
  createLoadingScreen
} from '../../src/ui/loading-screen.js';
import { POSTER_TIMING } from '../../src/ui/poster-transition.js';

const createFixture = () => new JSDOM(`
  <div class="loading-screen" id="loadingScreen" data-state="loading">
    <div class="loading-intake">
      <div class="loading-hole" id="loadingHole" aria-hidden="true">
        <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
      </div>
      <div class="loading-controls">
        <output class="sr-only" id="loadingProgress" aria-label="加载进度" aria-live="polite" aria-atomic="true">00 / 05</output>
        <p class="loading-copy" id="loadingCopy">讯号接入中</p>
        <button class="loading-retry" id="loadingRetry" type="button" hidden>重新载入</button>
        <button class="loading-skip" id="loadingSkip" type="button">跳过</button>
      </div>
      <div class="loading-stage">
        <div class="loading-poster-stack">
        <figure class="loading-frame" data-loading-slot="archive-01"><figcaption aria-hidden="true">AR-01</figcaption></figure>
        <figure class="loading-frame" data-loading-slot="archive-02"><figcaption aria-hidden="true">AR-02</figcaption></figure>
        <figure class="loading-frame" data-loading-slot="archive-03"><figcaption aria-hidden="true">AR-03</figcaption></figure>
        <figure class="loading-frame" data-loading-slot="archive-04"><figcaption aria-hidden="true">AR-04</figcaption></figure>
        <figure class="loading-frame" data-loading-slot="archive-05"><figcaption aria-hidden="true">AR-05</figcaption></figure>
        </div>
        <canvas class="loading-particles" id="loadingParticles"></canvas>
        <div class="loading-light-slit" id="loadingTopPortal" data-portal-side="top"></div>
        <div class="loading-light-slit" id="loadingLightSlit" data-portal-side="bottom"></div>
      </div>
    </div>
  </div>
  <main class="app-shell" id="appShell">
    <div class="vinyl-sticker">
      <div class="vinyl-cover" id="vinylCoverA"></div>
    </div>
  </main>
`);

const createControllerHarness = ({
  finish,
  particleDestroy,
  transitionDestroy
} = {}) => {
  const calls = [];
  const particleField = {
    clear: () => calls.push('particles.clear'),
    destroy() {
      calls.push('particles.destroy');
      particleDestroy?.();
    }
  };
  const transition = {
    enqueue(slot) {
      calls.push(['transition.enqueue', slot, slot.querySelector('img')]);
      return true;
    },
    skipTo(slot) {
      const image = slot?.querySelector('img') ?? null;
      calls.push(['transition.skipTo', slot, image]);
      return Boolean(image);
    },
    finish: finish || (() => {
      calls.push('transition.finish');
      return Promise.resolve();
    }),
    freeze: () => calls.push('transition.freeze'),
    reset(options) {
      calls.push('transition.reset');
      if (options) calls.push(['transition.reset.options', options]);
    },
    setProfile: (profile) => calls.push(['transition.setProfile', profile]),
    destroy() {
      calls.push('transition.destroy');
      transitionDestroy?.();
    }
  };
  const factories = {
    particleFactory(options) {
      calls.push(['particleFactory', options]);
      return particleField;
    },
    transitionFactory(options) {
      calls.push(['transitionFactory', options]);
      return transition;
    }
  };

  return { calls, factories, particleField, transition };
};

const createInjectedView = (documentRef, options = {}) => {
  const { viewOptions = {}, ...harnessOptions } = options;
  const harness = createControllerHarness(harnessOptions);
  return {
    harness,
    view: createLoadingScreen(documentRef, {
      motionProfile: 'reduce',
      loadingPrelude: false,
      ...viewOptions,
      ...harness.factories
    })
  };
};

const transitionEnd = (window, propertyName, { bubbles = false } = {}) => {
  const event = new window.Event('transitionend', { bubbles });
  Object.defineProperty(event, 'propertyName', { value: propertyName });
  return event;
};

const animationEnd = (window, animationName) => {
  const event = new window.Event('animationend');
  Object.defineProperty(event, 'animationName', { value: animationName });
  return event;
};

const createTimerHarness = () => {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const setTimer = (callback, delay = 0) => {
    const id = nextId++;
    timers.set(id, { at: now + delay, callback });
    return id;
  };
  const clearTimer = (id) => timers.delete(id);
  const advance = async (ms) => {
    const end = now + ms;
    while (true) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at;
      timers.delete(due[0]);
      due[1].callback();
      await Promise.resolve();
    }
    now = end;
    await Promise.resolve();
  };
  return { setTimer, clearTimer, advance, get pending() { return timers.size; } };
};

const createGateFixture = () => new JSDOM(`
  <div class="loading-screen" id="loadingScreen" data-state="loading">
    <output class="sr-only" id="loadingProgress" aria-label="加载进度" aria-live="polite" aria-atomic="true">00 / 05</output>
    <div data-loading-slot="archive-01"></div>
    <div data-loading-slot="archive-02"></div>
    <div data-loading-slot="archive-03"></div>
    <div data-loading-slot="archive-04"></div>
    <div data-loading-slot="archive-05"></div>
    <canvas id="loadingParticles"></canvas>
    <div id="loadingTopPortal" data-portal-side="top"></div>
    <div id="loadingLightSlit" data-portal-side="bottom"></div>
    <button id="loadingRetry" type="button" hidden>重新载入</button>
    <button id="loadingSkip" type="button">跳过</button>
    <p id="loadingCopy">讯号接入中</p>
  </div>
  <div class="app-root" id="appRoot" inert aria-hidden="true">
    <main id="appShell"></main>
  </div>
`);

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test('visual factories receive the loading stage dependencies and motion profile', () => {
  const dom = createFixture();
  const harness = createControllerHarness();
  createLoadingScreen(dom.window.document, {
    motionProfile: 'full',
    ...harness.factories
  });

  const root = dom.window.document.getElementById('loadingScreen');
  const canvas = dom.window.document.getElementById('loadingParticles');
  const topPortal = dom.window.document.getElementById('loadingTopPortal');
  const bottomPortal = dom.window.document.getElementById('loadingLightSlit');
  const particleCall = harness.calls.find(([name]) => name === 'particleFactory');
  const transitionCall = harness.calls.find(([name]) => name === 'transitionFactory');

  assert.strictEqual(particleCall[1].canvas, canvas);
  assert.strictEqual(particleCall[1].documentRef, dom.window.document);
  assert.strictEqual(particleCall[1].windowRef, dom.window);
  assert.equal(particleCall[1].profile, 'full');
  assert.strictEqual(transitionCall[1].root, root);
  assert.strictEqual(transitionCall[1].portals.top, topPortal);
  assert.strictEqual(transitionCall[1].portals.bottom, bottomPortal);
  assert.strictEqual(transitionCall[1].particleField, harness.particleField);
  assert.equal(transitionCall[1].profile, 'full');
  assert.equal(typeof transitionCall[1].onFinalScene, 'function');
  assert.equal(typeof transitionCall[1].onError, 'function');
});

test('reset cancels the final handoff barrier and clears every temporary marker', async () => {
  const dom = createFixture();
  const document = dom.window.document;
  const appShell = document.getElementById('appShell');
  const target = document.querySelector('.vinyl-sticker');
  const targetCover = document.getElementById('vinylCoverA');
  const timers = createTimerHarness();
  const { view, harness } = createInjectedView(document, {
    viewOptions: {
      motionProfile: 'full',
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    }
  });
  const root = document.getElementById('loadingScreen');
  const slot = root.querySelector('[data-loading-slot="archive-05"]');
  const image = document.createElement('img');
  image.className = 'loading-image';
  image.src = 'https://example.test/archive-05.jpg';
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: 600 },
    naturalHeight: { configurable: true, value: 800 }
  });
  slot.prepend(image);
  slot.getBoundingClientRect = () => ({
    left: 100,
    top: 50,
    right: 500,
    bottom: 550,
    width: 400,
    height: 500
  });
  appShell.getBoundingClientRect = () => ({
    left: 400,
    top: appShell.classList.contains('is-loading-reveal') ? 0 : 10,
    right: 720,
    bottom: appShell.classList.contains('is-loading-reveal') ? 760 : 770,
    width: 320,
    height: 760
  });
  target.getBoundingClientRect = () => ({
    left: 500,
    top: appShell.classList.contains('is-loading-reveal') ? 590 : 600,
    right: 620,
    bottom: appShell.classList.contains('is-loading-reveal') ? 710 : 720,
    width: 120,
    height: 120
  });
  const transitionCall = harness.calls.find(([name]) => name === 'transitionFactory');
  const imageCount = root.querySelectorAll('img').length;

  transitionCall[1].onFinalScene({ image, profile: 'full' });

  assert.strictEqual(slot.querySelector('.loading-image'), image);
  assert.equal(root.querySelectorAll('img').length, imageCount);
  assert.equal(root.querySelector('.loading-handoff-flight'), null);
  assert.equal(root.dataset.handoffReady, undefined);
  assert.equal(root.style.getPropertyValue('--poster-final-x'), '260px');
  assert.equal(root.style.getPropertyValue('--poster-final-y'), '350px');
  assert.equal(root.style.getPropertyValue('--poster-final-scale'), '0.32');
  assert.equal(root.style.getPropertyValue('--poster-final-radius'), '187.5px');
  assert.equal(root.style.getPropertyValue('--poster-source-inset-top'), '0.0000%');
  assert.equal(root.style.getPropertyValue('--poster-source-inset-right'), '3.1250%');
  assert.equal(root.style.getPropertyValue('--poster-source-inset-bottom'), '0.0000%');
  assert.equal(root.style.getPropertyValue('--poster-source-inset-left'), '3.1250%');
  assert.equal(root.style.getPropertyValue('--poster-final-inset-top'), '12.5000%');
  assert.equal(root.style.getPropertyValue('--poster-final-inset-right'), '3.1250%');
  assert.equal(root.style.getPropertyValue('--poster-final-inset-bottom'), '12.5000%');
  assert.equal(root.style.getPropertyValue('--poster-final-inset-left'), '3.1250%');
  assert.equal(image.dataset.loadingHandoff, 'true');
  assert.equal(targetCover.dataset.loadingHandoff, 'true');
  assert.equal(targetCover.dataset.loadingPrewarm, 'true');
  assert.equal(targetCover.classList.contains('is-active'), false);
  assert.equal(targetCover.style.backgroundImage, 'url("https://example.test/archive-05.jpg")');
  assert.equal(appShell.classList.contains('is-loading-reveal'), false);

  await timers.advance(16);
  assert.equal(root.dataset.handoffReady, 'true');
  assert.equal(root.dataset.handoffPhase, 'morphing');
  assert.equal(root.style.getPropertyValue('--final-resolve-ms'), '1280ms');
  assert.equal(root.style.getPropertyValue('--loading-player-reveal-delay-ms'), '486ms');
  assert.equal(root.style.getPropertyValue('--loading-player-reveal-ms'), '794ms');
  assert.equal(appShell.style.getPropertyValue('--loading-player-reveal-delay-ms'), '486ms');
  assert.equal(appShell.style.getPropertyValue('--loading-player-reveal-ms'), '794ms');
  assert.equal(appShell.classList.contains('is-loading-reveal'), true);
  assert.equal(appShell.dataset.loadingHandoff, 'true');
  assert.equal(targetCover.classList.contains('is-active'), false);

  const exiting = view.exit('full');
  assert.equal(appShell.classList.contains('is-loading-reveal'), true);

  view.reset();
  assert.equal(await exiting, false);
  assert.equal(root.isConnected, true);
  assert.equal(root.dataset.handoffReady, undefined);
  assert.equal(root.dataset.handoffPhase, undefined);
  assert.equal(root.style.getPropertyValue('--poster-final-x'), '');
  assert.equal(root.style.getPropertyValue('--loading-player-reveal-ms'), '');
  assert.equal(appShell.style.getPropertyValue('--loading-player-reveal-delay-ms'), '');
  assert.equal(appShell.style.getPropertyValue('--loading-player-reveal-ms'), '');
  assert.equal(image.isConnected, false);
  assert.equal(image.hasAttribute('data-loading-handoff'), false);
  assert.equal(appShell.classList.contains('is-loading-reveal'), false);
  assert.equal(appShell.hasAttribute('data-loading-handoff'), false);
  assert.equal(targetCover.hasAttribute('data-loading-handoff'), false);
  assert.equal(targetCover.classList.contains('is-active'), false);
  assert.equal(targetCover.style.backgroundImage, '');
  assert.equal(timers.pending, 0);

  view.destroy();
  assert.equal(appShell.classList.contains('is-loading-reveal'), false);
  assert.equal(targetCover.hasAttribute('data-loading-handoff'), false);
  assert.equal(targetCover.style.backgroundImage, '');
  assert.equal(timers.pending, 0);
});

test('final handoff starts one shared timeline and transfers artwork atomically', async () => {
  const dom = createFixture();
  const document = dom.window.document;
  const appShell = document.getElementById('appShell');
  const target = document.querySelector('.vinyl-sticker');
  const targetCover = document.getElementById('vinylCoverA');
  const timers = createTimerHarness();
  const { view, harness } = createInjectedView(document, {
    viewOptions: {
      motionProfile: 'full',
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    }
  });
  const root = document.getElementById('loadingScreen');
  const slot = root.querySelector('[data-loading-slot="archive-05"]');
  const image = document.createElement('img');
  image.className = 'loading-image';
  image.src = 'https://example.test/archive-05.jpg';
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: 600 },
    naturalHeight: { configurable: true, value: 800 }
  });
  slot.prepend(image);
  slot.getBoundingClientRect = () => ({
    left: 100, top: 50, right: 500, bottom: 550, width: 400, height: 500
  });
  appShell.getBoundingClientRect = () => ({
    left: 400, top: 0, right: 720, bottom: 760, width: 320, height: 760
  });
  target.getBoundingClientRect = () => ({
    left: 500, top: 590, right: 620, bottom: 710, width: 120, height: 120
  });
  const transitionCall = harness.calls.find(([name]) => name === 'transitionFactory');
  transitionCall[1].onFinalScene({ image, profile: 'full' });
  await timers.advance(16);
  assert.equal(root.dataset.handoffPhase, 'morphing');
  assert.equal(appShell.classList.contains('is-loading-reveal'), true);
  assert.equal(appShell.dataset.loadingHandoff, 'true');
  assert.equal(appShell.style.getPropertyValue('--loading-player-reveal-delay-ms'), '486ms');
  assert.equal(appShell.style.getPropertyValue('--loading-player-reveal-ms'), '794ms');

  const exiting = view.exit('full');
  await timers.advance(FINAL_HANDOFF_TIMING.full.morph - 1);
  assert.equal(appShell.classList.contains('is-loading-reveal'), true);
  assert.equal(targetCover.classList.contains('is-active'), false);
  assert.equal(root.isConnected, true);

  await timers.advance(1);
  assert.equal(root.dataset.handoffPhase, 'morphing');
  assert.equal(appShell.classList.contains('is-loading-reveal'), true);
  assert.equal(targetCover.classList.contains('is-active'), false);
  assert.equal(image.dataset.loadingHandoff, 'true');
  image.dispatchEvent(animationEnd(dom.window, 'loading-poster-to-player-motion'));
  await Promise.resolve();
  assert.equal(await exiting, true);
  assert.equal(root.isConnected, false);
  assert.equal(image.hasAttribute('data-loading-handoff'), false);
  assert.equal(targetCover.hasAttribute('data-loading-handoff'), false);
  assert.equal(targetCover.hasAttribute('data-loading-prewarm'), false);
  assert.equal(targetCover.classList.contains('is-active'), true);
  assert.equal(targetCover.style.backgroundImage, 'url("https://example.test/archive-05.jpg")');
  assert.equal(targetCover.style.opacity, '1');
  assert.equal(targetCover.style.transition, 'none');
  assert.equal(appShell.classList.contains('is-loading-reveal'), true);
  const resident = document.getElementById('loadingHandoffResident');
  assert.ok(resident);
  assert.strictEqual(resident.querySelector('.loading-handoff-resident-image'), image);
  assert.equal(image.isConnected, true);
  assert.equal(image.classList.contains('loading-image'), false);
  assert.equal(document.body.dataset.loadingHandoffResident, 'true');

  view.completeHandoff();
  assert.equal(appShell.classList.contains('is-loading-reveal'), false);
  assert.equal(appShell.hasAttribute('data-loading-handoff'), false);
  await timers.advance(16);
  assert.equal(targetCover.style.animation, '');
  assert.equal(targetCover.style.transition, '');
  assert.equal(targetCover.style.opacity, '');
  assert.strictEqual(
    document.querySelector('#loadingHandoffResident .loading-handoff-resident-image'),
    image
  );
});

test('loading screen forwards live profiles to its transition and uses the latest profile by default', async () => {
  const dom = createFixture();
  const { view, harness } = createInjectedView(dom.window.document, {
    viewOptions: { motionProfile: 'full' }
  });
  const root = dom.window.document.getElementById('loadingScreen');

  view.setProfile('reduce');
  await view.playReadySequence();

  assert.deepEqual(
    harness.calls.filter((call) => Array.isArray(call) && call[0] === 'transition.setProfile'),
    [
      ['transition.setProfile', 'reduce'],
      ['transition.setProfile', 'reduce']
    ]
  );

  const exiting = view.exit();
  root.dispatchEvent(transitionEnd(dom.window, 'opacity'));
  await exiting;
  assert.equal(root.isConnected, false);
});

test('fallback exit clears prewarm and reveal markers without hiding the committed cover', async () => {
  const dom = createFixture();
  const document = dom.window.document;
  const timers = createTimerHarness();
  dom.window.requestAnimationFrame = (callback) => timers.setTimer(callback, 16);
  dom.window.cancelAnimationFrame = timers.clearTimer;
  const { view } = createInjectedView(document, {
    viewOptions: {
      motionProfile: 'compact',
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    }
  });
  const root = document.getElementById('loadingScreen');
  const slit = document.getElementById('loadingLightSlit');
  const appShell = document.getElementById('appShell');
  const targetCover = document.getElementById('vinylCoverA');
  targetCover.dataset.loadingPrewarm = 'true';
  targetCover.style.backgroundImage = 'url("https://example.test/fallback-cover.jpg")';

  slit.style.opacity = '1';
  const exiting = view.exit('compact');
  root.dispatchEvent(transitionEnd(dom.window, 'opacity'));
  slit.style.opacity = '0';
  slit.dispatchEvent(animationEnd(dom.window, 'loading-final-tunnel'));
  assert.equal(await exiting, true);

  assert.equal(root.isConnected, false);
  assert.equal(appShell.classList.contains('is-loading-reveal'), true);
  assert.equal(appShell.hasAttribute('data-loading-handoff'), true);
  assert.equal(targetCover.hasAttribute('data-loading-prewarm'), true);
  assert.equal(targetCover.classList.contains('is-active'), true);
  assert.equal(targetCover.style.backgroundImage, 'url("https://example.test/fallback-cover.jpg")');

  view.completeHandoff();
  assert.equal(appShell.classList.contains('is-loading-reveal'), false);
  assert.equal(appShell.hasAttribute('data-loading-handoff'), false);
  assert.equal(targetCover.hasAttribute('data-loading-prewarm'), false);
  await timers.advance(16);
  assert.equal(targetCover.style.opacity, '');
  assert.equal(targetCover.style.transition, '');
  assert.equal(timers.pending, 0);
});

test('reduced handoff holds the final poster for 500ms before a short crossfade', async () => {
  const dom = createFixture();
  const document = dom.window.document;
  const timers = createTimerHarness();
  const { view } = createInjectedView(document, {
    viewOptions: {
      motionProfile: 'reduce',
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    }
  });
  const root = document.getElementById('loadingScreen');
  const source = document.createElement('img');
  source.className = 'loading-image';
  source.src = 'https://example.test/visible-cover.jpg';
  root.querySelector('[data-loading-slot="archive-05"]').prepend(source);
  const targetCover = document.getElementById('vinylCoverA');
  const appShell = document.getElementById('appShell');

  const exiting = view.exit('reduce');
  await timers.advance(FINAL_HANDOFF_TIMING.reduce.finalHold - 1);
  assert.equal(root.classList.contains('is-exiting'), false);
  assert.equal(appShell.classList.contains('is-loading-reveal'), false);
  assert.equal(targetCover.classList.contains('is-active'), false);
  assert.equal(source.dataset.loadingHandoff, 'true');

  await timers.advance(1);
  assert.equal(root.classList.contains('is-exiting'), true);
  assert.equal(appShell.classList.contains('is-loading-reveal'), true);
  assert.equal(targetCover.classList.contains('is-active'), false);
  assert.equal(targetCover.style.opacity, '');

  await timers.advance(FINAL_HANDOFF_TIMING.reduce.crossfade);
  assert.equal(await exiting, true);

  assert.equal(source.hasAttribute('data-loading-handoff'), false);
  assert.equal(targetCover.hasAttribute('data-loading-handoff'), false);
  assert.equal(targetCover.hasAttribute('data-loading-prewarm'), false);
  assert.equal(targetCover.classList.contains('is-active'), true);
  assert.equal(targetCover.style.backgroundImage, 'url("https://example.test/visible-cover.jpg")');
  assert.equal(appShell.classList.contains('is-loading-reveal'), true);

  view.completeHandoff();
  assert.equal(appShell.classList.contains('is-loading-reveal'), false);
});

test('reapplying the reduced profile cannot cancel an active final handoff', async () => {
  const dom = createFixture();
  const document = dom.window.document;
  const timers = createTimerHarness();
  const { view } = createInjectedView(document, {
    viewOptions: {
      motionProfile: 'reduce',
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    }
  });
  const root = document.getElementById('loadingScreen');
  const source = document.createElement('img');
  source.className = 'loading-image';
  source.src = 'https://example.test/visible-cover.jpg';
  root.querySelector('[data-loading-slot="archive-05"]').prepend(source);

  const exiting = view.exit('reduce');
  view.setProfile('reduce');
  await timers.advance(FINAL_HANDOFF_TIMING.reduce.finalHold);

  assert.equal(root.classList.contains('is-exiting'), true);
  assert.equal(source.dataset.loadingHandoff, 'true');

  await timers.advance(FINAL_HANDOFF_TIMING.reduce.crossfade);
  assert.equal(await exiting, true);
  assert.equal(root.isConnected, false);
});

test('loading screen validates required nodes and requires at least one slot', () => {
  const missingProgress = createFixture();
  missingProgress.window.document.getElementById('loadingProgress').remove();
  assert.throws(
    () => createLoadingScreen(missingProgress.window.document, createControllerHarness().factories),
    /loadingProgress/
  );

  const missingSkip = createFixture();
  missingSkip.window.document.getElementById('loadingSkip').remove();
  assert.throws(
    () => createLoadingScreen(missingSkip.window.document, createControllerHarness().factories),
    /loadingSkip/
  );

  const missingSlots = createFixture();
  missingSlots.window.document.querySelectorAll('[data-loading-slot]').forEach((slot) => slot.remove());
  assert.throws(
    () => createLoadingScreen(missingSlots.window.document, createControllerHarness().factories),
    /at least one loading slot/
  );
});

test('first ready poster enters immediately when the visual prelude is disabled', () => {
  const dom = createFixture();
  const { view, harness } = createInjectedView(dom.window.document);
  const document = dom.window.document;
  const root = document.getElementById('loadingScreen');
  const skip = document.getElementById('loadingSkip');
  const image = document.createElement('img');
  image.src = 'https://example.test/archive-01.jpg';

  view.reset();
  view.setProgress({
    id: 'archive-01',
    status: 'ready',
    completed: 1,
    total: 5,
    result: { id: 'archive-01', image, alt: 'one' }
  });
  assert.equal(root.dataset.openingState, undefined);
  assert.equal(root.classList.contains('is-opening-title'), false);
  assert.equal(skip.hidden, false);
  assert.equal(skip.disabled, false);
  assert.equal(harness.calls.filter(([name]) => name === 'transition.enqueue').length, 1);
});

test('original center-hole prelude settles before the first poster enters', async () => {
  const dom = createFixture();
  const timers = createTimerHarness();
  const { view, harness } = createInjectedView(dom.window.document, {
    viewOptions: {
      loadingPrelude: true,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    }
  });
  const document = dom.window.document;
  const root = document.getElementById('loadingScreen');
  const skip = document.getElementById('loadingSkip');
  const image = document.createElement('img');
  image.src = 'https://example.test/archive-01.jpg';

  view.reset();
  view.setProgress({
    id: 'archive-01',
    status: 'ready',
    completed: 1,
    total: 5,
    result: { id: 'archive-01', image, alt: 'one' }
  });

  assert.equal(root.dataset.preludeState, 'playing');
  assert.equal(root.classList.contains('is-loading-prelude'), true);
  assert.equal(skip.disabled, true);
  assert.equal(harness.calls.some(([name]) => name === 'transition.enqueue'), false);

  await timers.advance(LOADING_PRELUDE_TIMING.reduce - 1);
  assert.equal(harness.calls.some(([name]) => name === 'transition.enqueue'), false);
  await timers.advance(1);

  assert.equal(root.dataset.preludeState, 'settled');
  assert.equal(root.classList.contains('is-loading-prelude'), false);
  assert.equal(root.classList.contains('is-prelude-settled'), true);
  assert.equal(skip.disabled, false);
  assert.equal(harness.calls.filter(([name]) => name === 'transition.enqueue').length, 1);
});

test('center-hole prelude remains visible until the first poster is decoded', async () => {
  const dom = createFixture();
  const timers = createTimerHarness();
  const { view, harness } = createInjectedView(dom.window.document, {
    viewOptions: {
      loadingPrelude: true,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    }
  });
  const document = dom.window.document;
  const root = document.getElementById('loadingScreen');
  const image = document.createElement('img');
  image.src = 'https://example.test/archive-01.jpg';

  view.reset();
  await timers.advance(LOADING_PRELUDE_TIMING.reduce);
  assert.equal(root.dataset.preludeState, 'playing');
  assert.equal(root.classList.contains('is-loading-prelude'), true);
  assert.equal(harness.calls.some(([name]) => name === 'transition.enqueue'), false);

  view.setProgress({
    id: 'archive-01',
    status: 'ready',
    completed: 1,
    total: 5,
    result: { id: 'archive-01', image, alt: 'one' }
  });

  assert.equal(root.dataset.preludeState, 'settled');
  assert.equal(root.classList.contains('is-loading-prelude'), false);
  assert.equal(harness.calls.filter(([name]) => name === 'transition.enqueue').length, 1);
});

test('unavailable canvas context falls back to a finite no-op particle field only', async () => {
  const dom = createFixture();
  dom.window.document.getElementById('loadingParticles').getContext = () => null;
  let fallbackField;
  const harness = createControllerHarness();
  const view = createLoadingScreen(dom.window.document, {
    motionProfile: 'reduce',
    transitionFactory(options) {
      fallbackField = options.particleField;
      return harness.transition;
    }
  });

  await fallbackField.gather({});
  await fallbackField.scatter({});
  await fallbackField.finish();
  fallbackField.setProfile('compact');
  fallbackField.clear();
  assert.equal(fallbackField.getState().profile, 'compact');
  await view.exit('reduce');

  const programmerError = createFixture();
  assert.throws(() => createLoadingScreen(programmerError.window.document, {
    particleFactory() {
      throw new TypeError('particle programmer error');
    },
    transitionFactory: harness.factories.transitionFactory
  }), /particle programmer error/);
});

test('ready progress mounts the exact decoded image in its archive slot', () => {
  const dom = createFixture();
  const { view, harness } = createInjectedView(dom.window.document);
  const decodedImage = dom.window.document.createElement('img');
  const result = {
    id: 'archive-01',
    alt: '加载封面图1',
    src: 'decoded.webp',
    image: decodedImage
  };

  const returnValue = view.setProgress({
    id: result.id,
    status: 'ready',
    completed: 1,
    total: 5,
    result
  });

  const slot = dom.window.document.querySelector('[data-loading-slot="archive-01"]');
  const artworkViewport = slot.querySelector('.loading-artwork-viewport');
  assert.strictEqual(slot.firstElementChild, artworkViewport);
  assert.strictEqual(artworkViewport.firstElementChild, decodedImage);
  assert.equal(artworkViewport.getAttribute('aria-hidden'), 'true');
  assert.equal(decodedImage.alt, '加载封面图1');
  assert.equal(decodedImage.className, 'loading-image');
  assert.equal(decodedImage.dataset.assetId, 'archive-01');
  assert.equal(decodedImage.getAttribute('aria-hidden'), 'true');
  assert.equal(returnValue, undefined);
  const enqueueCall = harness.calls.find(([name]) => name === 'transition.enqueue');
  assert.strictEqual(enqueueCall[1], slot);
  assert.strictEqual(enqueueCall[2], decodedImage);
  assert.equal(dom.window.document.getElementById('loadingProgress').textContent, '01 / 05');
  assert.equal(dom.window.document.getElementById('loadingCopy').textContent, '讯号接入中');
  assert.equal(dom.window.document.getElementById('loadingScreen').style.getPropertyValue('--loading-progress'), '1');
});

test('duplicate ready progress cannot replace an already-admitted visual', () => {
  const dom = createFixture();
  const { view, harness } = createInjectedView(dom.window.document);
  const slot = dom.window.document.querySelector('[data-loading-slot="archive-01"]');
  const first = dom.window.document.createElement('img');
  const second = dom.window.document.createElement('img');

  assert.equal(view.setProgress({
    id: 'archive-01', status: 'ready', completed: 1, total: 5,
    result: { id: 'archive-01', alt: 'one', image: first }
  }), undefined);
  assert.equal(view.setProgress({
    id: 'archive-01', status: 'ready', completed: 2, total: 5,
    result: { id: 'archive-01', alt: 'two', image: second }
  }), undefined);

  const enqueues = harness.calls.filter(([name]) => name === 'transition.enqueue');
  assert.equal(enqueues.length, 1);
  assert.strictEqual(enqueues[0][2], first);
  assert.strictEqual(slot.querySelector('img'), first);
  assert.equal(slot.contains(second), false);
});

test('out-of-order ready images enqueue strictly in DOM order with the final poster last', () => {
  const dom = createFixture();
  const document = dom.window.document;
  const { view, harness } = createInjectedView(document);
  const images = new Map();
  const reportReady = (id, completed) => {
    const image = document.createElement('img');
    image.src = id === 'archive-05'
      ? 'https://example.test/end.jpg'
      : `https://example.test/${id}.jpg`;
    images.set(id, image);
    view.setProgress({
      id,
      status: 'ready',
      completed,
      total: 5,
      result: { id, alt: id, image }
    });
  };

  ['archive-05', 'archive-03', 'archive-02', 'archive-04'].forEach((id, index) => {
    reportReady(id, index + 1);
  });
  assert.equal(
    harness.calls.filter(([name]) => name === 'transition.enqueue').length,
    0
  );

  reportReady('archive-01', 5);

  const enqueues = harness.calls.filter(([name]) => name === 'transition.enqueue');
  assert.deepEqual(
    enqueues.map(([, slot]) => slot.dataset.loadingSlot),
    ['archive-01', 'archive-02', 'archive-03', 'archive-04', 'archive-05']
  );
  assert.deepEqual(
    enqueues.map(([, , image]) => image),
    ['archive-01', 'archive-02', 'archive-03', 'archive-04', 'archive-05']
      .map((id) => images.get(id))
  );
  assert.strictEqual(enqueues.at(-1)[2], images.get('archive-05'));
});

test('skip cancels the visual queue and only admits the final mounted poster', () => {
  const dom = createFixture();
  const document = dom.window.document;
  let skipCalls = 0;
  const { view, harness } = createInjectedView(document, {
    viewOptions: { onSkip: () => { skipCalls += 1; } }
  });
  const root = document.getElementById('loadingScreen');
  const skip = document.getElementById('loadingSkip');

  skip.click();

  assert.equal(root.dataset.state, 'skipping');
  assert.equal(root.dataset.skipRequested, 'true');
  assert.equal(skip.hidden, true);
  assert.equal(skip.disabled, true);
  assert.equal(skipCalls, 1);
  assert.equal(document.getElementById('loadingCopy').textContent, '讯号接入中');

  view.setProgress({
    id: 'archive-02', status: 'ready', completed: 1, total: 5,
    result: { id: 'archive-02', alt: 'two', image: document.createElement('img') }
  });
  const finalImage = document.createElement('img');
  view.setProgress({
    id: 'archive-05', status: 'ready', completed: 2, total: 5,
    result: { id: 'archive-05', alt: 'final', image: finalImage }
  });

  const enqueues = harness.calls.filter((call) => Array.isArray(call) && call[0] === 'transition.enqueue');
  assert.equal(enqueues.length, 1);
  assert.equal(enqueues[0][1].dataset.loadingSlot, 'archive-05');
  assert.strictEqual(enqueues[0][2], finalImage);
  const transitionSkipCalls = harness.calls.filter(
    (call) => Array.isArray(call) && call[0] === 'transition.skipTo'
  );
  assert.equal(transitionSkipCalls.length, 1);
  assert.equal(transitionSkipCalls[0][1].dataset.loadingSlot, 'archive-05');
  assert.strictEqual(transitionSkipCalls[0][2], null);
  assert.equal(harness.calls.includes('transition.reset'), false);
  assert.equal(harness.calls.includes('particles.clear'), false);
  assert.equal(document.getElementById('loadingCopy').textContent, '讯号接入中');
});

test('skip preserves the current ordinary poster until the final image is ready', () => {
  const dom = createFixture();
  const document = dom.window.document;
  const { view, harness } = createInjectedView(document, {
    viewOptions: { motionProfile: 'full' }
  });
  const currentImage = document.createElement('img');
  const currentSlot = document.querySelector('[data-loading-slot="archive-01"]');

  view.setProgress({
    id: 'archive-01', status: 'ready', completed: 1, total: 5,
    result: { id: 'archive-01', alt: 'current', image: currentImage }
  });
  currentSlot.classList.add('is-active', 'is-stable');
  document.getElementById('loadingSkip').click();

  const skipCall = harness.calls.find(
    (call) => Array.isArray(call) && call[0] === 'transition.skipTo'
  );
  assert.equal(skipCall[1].dataset.loadingSlot, 'archive-05');
  assert.strictEqual(skipCall[2], null);
  assert.equal(harness.calls.includes('transition.reset'), false);
  assert.equal(harness.calls.includes('particles.clear'), false);
  assert.equal(currentSlot.classList.contains('is-active'), true);
  assert.equal(
    harness.calls.filter((call) => Array.isArray(call) && call[0] === 'transition.enqueue').length,
    1,
    'no final visual is admitted before its image exists'
  );

  const finalImage = document.createElement('img');
  view.setProgress({
    id: 'archive-05', status: 'ready', completed: 2, total: 5,
    result: { id: 'archive-05', alt: 'final', image: finalImage }
  });

  const enqueues = harness.calls.filter(
    (call) => Array.isArray(call) && call[0] === 'transition.enqueue'
  );
  assert.equal(enqueues.length, 2);
  assert.equal(enqueues.at(-1)[1].dataset.loadingSlot, 'archive-05');
});

test('late skip clears stale work while preserving the active final poster and its prewarm', () => {
  const dom = createFixture();
  const document = dom.window.document;
  const { view, harness } = createInjectedView(document, {
    viewOptions: { motionProfile: 'full' }
  });
  const finalImage = document.createElement('img');
  finalImage.src = 'https://example.test/end.jpg';

  view.setProgress({
    id: 'archive-05', status: 'ready', completed: 5, total: 5,
    result: { id: 'archive-05', alt: 'final', image: finalImage }
  });
  const finalSlot = document.querySelector('[data-loading-slot="archive-05"]');
  const targetCover = document.getElementById('vinylCoverA');
  finalSlot.classList.add('is-active', 'is-stable');
  const resetsBeforeSkip = harness.calls.filter((call) => call === 'transition.reset').length;
  const clearsBeforeSkip = harness.calls.filter((call) => call === 'particles.clear').length;
  const enqueuesBeforeSkip = harness.calls.filter(
    (call) => Array.isArray(call) && call[0] === 'transition.enqueue'
  ).length;

  document.getElementById('loadingSkip').click();
  view.setProgress({
    id: 'archive-04', status: 'ready', completed: 5, total: 5,
    result: { id: 'archive-04', alt: 'stale', image: document.createElement('img') }
  });

  assert.equal(finalSlot.classList.contains('is-active'), true);
  assert.equal(finalSlot.classList.contains('is-stable'), true);
  assert.equal(
    harness.calls.filter((call) => call === 'transition.reset').length,
    resetsBeforeSkip
  );
  assert.equal(
    harness.calls.filter((call) => call === 'particles.clear').length,
    clearsBeforeSkip
  );
  const skipCalls = harness.calls.filter(
    (call) => Array.isArray(call) && call[0] === 'transition.skipTo'
  );
  assert.equal(skipCalls.length, 1);
  assert.strictEqual(skipCalls[0][1], finalSlot);
  assert.strictEqual(skipCalls[0][2], finalImage);
  assert.equal(
    harness.calls.filter((call) => Array.isArray(call) && call[0] === 'transition.enqueue').length,
    enqueuesBeforeSkip
  );
  assert.equal(targetCover.style.backgroundImage, 'url("https://example.test/end.jpg")');
  assert.equal(targetCover.dataset.loadingPrewarm, 'true');
});

test('skip reuses a mounted final image when the final asset reports ready again', () => {
  const dom = createFixture();
  const document = dom.window.document;
  const { view, harness } = createInjectedView(document);
  const firstFinalImage = document.createElement('img');

  view.setProgress({
    id: 'archive-05', status: 'ready', completed: 4, total: 5,
    result: { id: 'archive-05', alt: 'final', image: firstFinalImage }
  });
  document.getElementById('loadingSkip').click();
  const replacement = document.createElement('img');
  view.setProgress({
    id: 'archive-05', status: 'ready', completed: 5, total: 5,
    result: { id: 'archive-05', alt: 'final', image: replacement }
  });

  const finalSlot = document.querySelector('[data-loading-slot="archive-05"]');
  assert.strictEqual(finalSlot.querySelector('img'), firstFinalImage);
  assert.equal(finalSlot.contains(replacement), false);
  assert.equal(
    harness.calls.filter((call) => Array.isArray(call) && call[0] === 'transition.enqueue').length,
    0
  );
  const skipCalls = harness.calls.filter(
    (call) => Array.isArray(call) && call[0] === 'transition.skipTo'
  );
  assert.equal(skipCalls.length, 1);
  assert.strictEqual(skipCalls[0][1], finalSlot);
  assert.strictEqual(skipCalls[0][2], firstFinalImage);
});

test('late reduced-motion skip preserves the prewarm without exposing a duplicate cover', async () => {
  const dom = createFixture();
  const document = dom.window.document;
  const timers = createTimerHarness();
  const { view } = createInjectedView(document, {
    viewOptions: {
      motionProfile: 'reduce',
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    }
  });
  const finalImage = document.createElement('img');
  finalImage.src = 'https://example.test/end.jpg';
  const targetCover = document.getElementById('vinylCoverA');

  view.setProgress({
    id: 'archive-05', status: 'ready', completed: 5, total: 5,
    result: { id: 'archive-05', alt: 'final', image: finalImage }
  });
  assert.equal(targetCover.dataset.loadingPrewarm, 'true');
  assert.equal(targetCover.classList.contains('is-active'), false);

  document.getElementById('loadingSkip').click();
  assert.equal(targetCover.style.backgroundImage, 'url("https://example.test/end.jpg")');
  assert.equal(targetCover.dataset.loadingPrewarm, 'true');
  assert.equal(targetCover.classList.contains('is-active'), false);

  await view.playReadySequence('reduce');
  const exiting = view.exit('reduce');
  await timers.advance(FINAL_HANDOFF_TIMING.reduce.finalHold);
  assert.equal(targetCover.classList.contains('is-active'), false);
  await timers.advance(FINAL_HANDOFF_TIMING.reduce.crossfade);
  assert.equal(await exiting, true);

  assert.equal(targetCover.style.backgroundImage, 'url("https://example.test/end.jpg")');
  assert.equal(targetCover.hasAttribute('data-loading-prewarm'), false);
  assert.equal(targetCover.classList.contains('is-active'), true);
  view.completeHandoff();
});

test('bootstrap skip abandons a blocked full load and requests only the final asset', async () => {
  const dom = createGateFixture();
  const document = dom.window.document;
  const calls = [];
  let requestSkip;

  const ready = startCriticalAssetGate({
    documentRef: document,
    viewportWidth: 390,
    motionProfile: 'reduce',
    createView(_documentRef, options) {
      requestSkip = options.onSkip;
      return {
        reset: () => calls.push('reset'),
        setProgress: (event) => calls.push(['progress', event]),
        showError: (error) => assert.fail(error),
        playReadySequence: () => Promise.resolve(),
        exit: () => Promise.resolve()
      };
    },
    load: (manifest, options) => {
      calls.push(['load', manifest.map(({ id }) => id), options]);
      if (manifest.length > 1) return new Promise(() => {});
      const result = { id: manifest[0].id };
      options.onProgress({
        id: result.id,
        status: 'ready',
        completed: 1,
        total: 1,
        result
      });
      return Promise.resolve([result]);
    }
  });

  await nextTurn();
  requestSkip();
  const results = await ready;

  const loadCalls = calls.filter(([name]) => name === 'load');
  assert.equal(loadCalls.length, 2);
  assert.equal(loadCalls[0][1].length, 10);
  assert.equal(loadCalls[0][2].signal.aborted, true);
  assert.deepEqual(loadCalls[1][1], ['archive-10']);
  assert.deepEqual(results, [{ id: 'archive-10' }]);
  const finalProgress = calls.find(
    ([name, event]) => name === 'progress' && event.id === 'archive-10'
  );
  assert.equal(finalProgress[1].completed, 10);
  assert.equal(finalProgress[1].total, 10);
});

test('ready sequence follows a skip revision instead of exiting on stale completion', async () => {
  const dom = createFixture();
  const resolvers = [];
  const { view } = createInjectedView(dom.window.document, {
    finish: () => new Promise((resolve) => resolvers.push(resolve))
  });
  let settled = false;
  const ready = view.playReadySequence('full').then(() => { settled = true; });

  await Promise.resolve();
  assert.equal(resolvers.length, 1);
  dom.window.document.getElementById('loadingSkip').click();
  resolvers[0]();
  await nextTurn();

  assert.equal(settled, false);
  assert.equal(resolvers.length, 2);
  resolvers[1]();
  await ready;

  assert.equal(settled, true);
  assert.equal(dom.window.document.getElementById('loadingScreen').dataset.state, 'ready');
});

test('showError exposes a retry that resets the view and invokes its callback once', () => {
  const dom = createFixture();
  const { view, harness } = createInjectedView(dom.window.document);
  const root = dom.window.document.getElementById('loadingScreen');
  const retry = dom.window.document.getElementById('loadingRetry');
  const skip = dom.window.document.getElementById('loadingSkip');
  let retryCalls = 0;

  view.showError(new CriticalAssetError([{ id: 'archive-01' }]), () => {
    retryCalls += 1;
  });

  assert.equal(root.dataset.state, 'error');
  assert.equal(root.dataset.errorKind, 'asset');
  assert.equal(root.querySelector('[data-loading-slot="archive-01"] figcaption').getAttribute('aria-hidden'), null);
  assert.equal(retry.hidden, false);
  assert.equal(skip.hidden, true);
  assert.strictEqual(dom.window.document.activeElement, retry);
  assert.equal(dom.window.document.getElementById('loadingCopy').textContent, '影像读取失败：archive-01');

  retry.click();
  retry.click();

  assert.equal(retryCalls, 1);
  assert.equal(root.dataset.state, 'loading');
  assert.equal(retry.hidden, true);
  assert.equal(skip.hidden, false);
  assert.equal(skip.disabled, false);
  assert.deepEqual(
    harness.calls.filter((call) => typeof call === 'string').slice(0, 4),
    ['transition.freeze', 'particles.clear', 'transition.reset', 'particles.clear']
  );
});

test('visual failures freeze playback, clear particles, and use visual error copy', () => {
  const dom = createFixture();
  const { view, harness } = createInjectedView(dom.window.document);
  const cause = new Error('scheduler rejected');

  view.showError(new VisualTransitionError(cause), () => {});

  const root = dom.window.document.getElementById('loadingScreen');
  assert.equal(root.dataset.errorKind, 'visual');
  assert.equal(dom.window.document.getElementById('loadingCopy').textContent, '影像呈现失败，请重新载入');
  assert.deepEqual(
    harness.calls.filter((call) => typeof call === 'string'),
    ['transition.freeze', 'particles.clear']
  );
});

test('ready sequence applies its profile and wraps transition failures', async () => {
  const dom = createFixture();
  const cause = new Error('visual queue failed');
  const { view, harness } = createInjectedView(dom.window.document, {
    finish: () => Promise.reject(cause)
  });

  await assert.rejects(
    view.playReadySequence('full'),
    (error) => error instanceof VisualTransitionError && error.cause === cause
  );

  assert.equal(dom.window.document.getElementById('loadingScreen').dataset.state, 'error');
  assert.equal(dom.window.document.getElementById('loadingScreen').dataset.errorKind, 'visual');
  assert.equal(dom.window.document.getElementById('loadingCopy').textContent, '影像呈现失败，请重新载入');
  assert.deepEqual(harness.calls.slice(-3), [
    ['transition.setProfile', 'full'],
    'transition.freeze',
    'particles.clear'
  ]);
});

test('reset clears the queue, canvas, progress, images, and every visual slot class', () => {
  const dom = createFixture();
  const { view, harness } = createInjectedView(dom.window.document);
  const root = dom.window.document.getElementById('loadingScreen');
  const slot = root.querySelector('[data-loading-slot]');
  const image = dom.window.document.createElement('img');
  slot.append(image);
  slot.dataset.status = 'failed';
  slot.classList.add('is-ready', 'is-failed', 'is-active', 'is-outgoing', 'is-revealing', 'is-scattering', 'is-stable');
  root.dataset.errorKind = 'visual';
  root.classList.add('is-final-resolving', 'is-exiting');
  root.style.setProperty('--loading-progress', '4');

  view.reset();

  assert.deepEqual(harness.calls.slice(-2), ['transition.reset', 'particles.clear']);
  assert.equal(root.dataset.state, 'loading');
  assert.equal(root.dataset.errorKind, undefined);
  assert.equal(root.classList.contains('is-final-resolving'), false);
  assert.equal(root.classList.contains('is-exiting'), false);
  assert.equal(root.style.getPropertyValue('--loading-progress'), '0');
  assert.equal(slot.dataset.status, undefined);
  assert.equal(slot.classList.contains('is-outgoing'), false);
  assert.equal(slot.className, 'loading-frame');
  assert.equal(slot.querySelector('img'), null);
  assert.equal(slot.querySelector('figcaption').getAttribute('aria-hidden'), 'true');
});

test('full exit waits for both root opacity settlement and proven slit opacity zero', async () => {
  const dom = createFixture();
  let releaseGate;
  const gate = new Promise((resolve) => { releaseGate = resolve; });
  const { view, harness } = createInjectedView(dom.window.document, {
    finish: () => gate
  });
  const root = dom.window.document.getElementById('loadingScreen');
  const slit = dom.window.document.getElementById('loadingLightSlit');
  const child = root.querySelector('.loading-intake');
  slit.style.opacity = '1';

  let ready = false;
  const readySequence = view.playReadySequence('full').then(() => { ready = true; });
  await Promise.resolve();
  assert.equal(ready, false);
  releaseGate();
  await readySequence;

  const exiting = view.exit('full');
  assert.equal(root.classList.contains('is-exiting'), true);
  assert.match(root.className, /is-exiting/);

  child.dispatchEvent(transitionEnd(dom.window, 'opacity', { bubbles: true }));
  await Promise.resolve();
  assert.equal(root.isConnected, true);

  root.dispatchEvent(transitionEnd(dom.window, 'transform'));
  await Promise.resolve();
  assert.equal(root.isConnected, true);

  root.dispatchEvent(transitionEnd(dom.window, 'opacity'));
  await Promise.resolve();
  assert.equal(root.isConnected, true, 'root fade alone must not remove a visible slit');
  assert.equal(harness.calls.includes('transition.destroy'), false);

  slit.style.opacity = '0';
  slit.dispatchEvent(animationEnd(dom.window, 'loading-final-tunnel'));
  await exiting;
  assert.equal(root.isConnected, false);
  assert.deepEqual(harness.calls.slice(-2), ['transition.destroy', 'particles.destroy']);
});

test('reset cancels active exit waiters and stale settlement cannot remove the restarted root', async () => {
  const dom = createFixture();
  const timers = createTimerHarness();
  const { view, harness } = createInjectedView(dom.window.document, {
    viewOptions: {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    }
  });
  const root = dom.window.document.getElementById('loadingScreen');
  const slit = dom.window.document.getElementById('loadingLightSlit');
  slit.style.opacity = '1';
  let exitSettled = false;
  const exiting = view.exit('full').then(() => { exitSettled = true; });
  assert.equal(timers.pending, 2);

  view.reset();
  await exiting;

  assert.equal(exitSettled, true);
  assert.equal(timers.pending, 0);
  assert.equal(root.isConnected, true);
  assert.equal(root.classList.contains('is-exiting'), false);
  assert.equal(slit.style.animation, '');
  assert.equal(slit.style.opacity, '');
  assert.equal(harness.calls.includes('transition.destroy'), false);
  assert.equal(harness.calls.includes('particles.destroy'), false);

  root.dispatchEvent(transitionEnd(dom.window, 'opacity'));
  slit.style.opacity = '0';
  slit.dispatchEvent(animationEnd(dom.window, 'loading-final-tunnel'));
  await timers.advance(POSTER_TIMING.full.finalResolve + POSTER_TIMING.full.rootFade + 200);
  assert.equal(root.isConnected, true);
  assert.equal(harness.calls.includes('transition.destroy'), false);
});

test('freezing for an error cancels active exit cleanup before controller destruction', async () => {
  const dom = createFixture();
  const timers = createTimerHarness();
  const { view, harness } = createInjectedView(dom.window.document, {
    viewOptions: {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    }
  });
  const root = dom.window.document.getElementById('loadingScreen');
  const slit = dom.window.document.getElementById('loadingLightSlit');
  slit.style.opacity = '1';
  let exitSettled = false;
  const exiting = view.exit('compact').then(() => { exitSettled = true; });

  view.showError(new VisualTransitionError(new Error('late visual failure')), () => {});
  await exiting;

  assert.equal(exitSettled, true);
  assert.equal(timers.pending, 0);
  assert.equal(root.isConnected, true);
  assert.equal(root.dataset.state, 'error');
  assert.equal(harness.calls.includes('transition.freeze'), true);
  assert.equal(harness.calls.includes('transition.destroy'), false);
  assert.equal(harness.calls.includes('particles.destroy'), false);
});

test('destroy cancels active exit waiters before removing the root and controllers once', async () => {
  const dom = createFixture();
  const timers = createTimerHarness();
  const { view, harness } = createInjectedView(dom.window.document, {
    viewOptions: {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    }
  });
  const root = dom.window.document.getElementById('loadingScreen');
  const slit = dom.window.document.getElementById('loadingLightSlit');
  slit.style.opacity = '1';
  const exiting = view.exit('full');
  assert.equal(timers.pending, 2);

  view.destroy();
  view.destroy();
  await exiting;

  assert.equal(timers.pending, 0);
  assert.equal(root.isConnected, false);
  assert.equal(harness.calls.filter((call) => call === 'transition.destroy').length, 1);
  assert.equal(harness.calls.filter((call) => call === 'particles.destroy').length, 1);
  slit.style.opacity = '0';
  slit.dispatchEvent(animationEnd(dom.window, 'loading-final-tunnel'));
  await timers.advance(POSTER_TIMING.full.finalResolve + POSTER_TIMING.full.rootFade + 200);
  assert.equal(harness.calls.filter((call) => call === 'transition.destroy').length, 1);
  assert.equal(harness.calls.filter((call) => call === 'particles.destroy').length, 1);
});

test('destroy is terminal and later public calls cannot remount work or retain retry callbacks', async () => {
  const dom = createFixture();
  const timers = createTimerHarness();
  const observerCalls = [];
  dom.window.ResizeObserver = class {
    observe(node) { observerCalls.push(['observe', node]); }
    disconnect() { observerCalls.push(['disconnect']); }
  };
  const { view, harness } = createInjectedView(dom.window.document, {
    viewOptions: {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    }
  });
  const root = dom.window.document.getElementById('loadingScreen');
  const retry = dom.window.document.getElementById('loadingRetry');
  const image = dom.window.document.createElement('img');
  let retryCalls = 0;

  view.showError(new CriticalAssetError([{ id: 'archive-01' }]), () => {
    retryCalls += 1;
  });
  assert.equal(typeof retry.onclick, 'function');
  view.destroy();
  const callsAfterDestroy = harness.calls.length;

  view.reset();
  view.setProgress({
    id: 'archive-01',
    status: 'ready',
    completed: 1,
    total: 5,
    result: { id: 'archive-01', alt: 'late image', image }
  });
  view.showError(new CriticalAssetError([{ id: 'archive-02' }]), () => {
    retryCalls += 1;
  });
  const readyAfterDestroy = view.playReadySequence('full');
  const exitAfterDestroy = view.exit('full');
  retry.click();
  await timers.advance(POSTER_TIMING.full.finalResolve + POSTER_TIMING.full.rootFade + 200);
  await Promise.all([readyAfterDestroy, exitAfterDestroy]);

  assert.equal(root.isConnected, false);
  assert.equal(retry.onclick, null);
  assert.equal(retryCalls, 0);
  assert.equal(image.isConnected, false);
  assert.equal(timers.pending, 0);
  assert.deepEqual(observerCalls.map(([name]) => name), ['observe', 'disconnect']);
  assert.equal(harness.calls.length, callsAfterDestroy);
});

test('exit fallback preserves the slit tail and destroys controllers only after both bounds', async () => {
  const dom = createFixture();
  const timers = createTimerHarness();
  const { view, harness } = createInjectedView(dom.window.document, {
    viewOptions: {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    }
  });
  const root = dom.window.document.getElementById('loadingScreen');
  const slit = dom.window.document.getElementById('loadingLightSlit');
  slit.style.opacity = '1';
  let settled = false;
  const exiting = view.exit('compact').then(() => { settled = true; });

  const timing = POSTER_TIMING.compact;
  assert.equal(timing.finalResolve - timing.exitLead, 0);
  await timers.advance(79);
  assert.equal(root.isConnected, true);
  assert.equal(settled, false);
  assert.equal(harness.calls.includes('transition.destroy'), false);

  slit.style.opacity = '0';
  await timers.advance(1);
  assert.equal(root.isConnected, true, 'root fallback must still observe the 680ms fade');
  assert.equal(harness.calls.includes('particles.destroy'), false);

  await timers.advance(timing.rootFade);
  await exiting;
  assert.equal(root.isConnected, false);
  assert.equal(settled, true);
  assert.deepEqual(harness.calls.slice(-2), ['transition.destroy', 'particles.destroy']);
});

test('reduced exit uses only the 120ms linear root fade before cleanup', async () => {
  const dom = createFixture();
  const { view, harness } = createInjectedView(dom.window.document);
  const root = dom.window.document.getElementById('loadingScreen');
  const exiting = view.exit('reduce');

  assert.equal(root.classList.contains('is-exiting'), true);
  assert.equal(root.isConnected, true);
  assert.equal(harness.calls.includes('transition.destroy'), false);
  root.dispatchEvent(transitionEnd(dom.window, 'opacity'));
  await exiting;

  assert.equal(dom.window.document.querySelector('#loadingLightSlit')?.classList.contains('is-lit') ?? false, false);
  assert.deepEqual(harness.calls.slice(-2), ['transition.destroy', 'particles.destroy']);
  assert.equal(dom.window.document.getElementById('loadingScreen'), null);
});

test('throwing visual cleanup is best-effort and cannot re-enter the gate error path', async () => {
  const dom = createGateFixture();
  const document = dom.window.document;
  const harness = createControllerHarness({
    transitionDestroy() { throw new Error('transition cleanup failed'); },
    particleDestroy() { throw new Error('particle cleanup failed'); }
  });
  const view = createLoadingScreen(document, {
    motionProfile: 'reduce',
    loadingPrelude: false,
    ...harness.factories
  });
  let showErrorCalls = 0;
  const showError = view.showError;
  view.showError = (...args) => {
    showErrorCalls += 1;
    return showError(...args);
  };

  const results = [{ id: 'archive-01' }];
  const ready = startCriticalAssetGate({
    documentRef: document,
    viewportWidth: 390,
    motionProfile: 'reduce',
    createView: () => view,
    load: async () => results
  });

  assert.strictEqual(await ready, results);
  assert.equal(showErrorCalls, 0);
  assert.equal(document.getElementById('loadingScreen'), null);
  assert.equal(document.getElementById('appRoot').hasAttribute('inert'), false);
  assert.deepEqual(
    harness.calls.filter((call) => typeof call === 'string').slice(-2),
    ['transition.destroy', 'particles.destroy']
  );
});

test('failure keeps the application inert until one retry succeeds', async () => {
  const dom = createGateFixture();
  const document = dom.window.document;
  const appRoot = document.getElementById('appRoot');
  const appShell = document.getElementById('appShell');
  const retry = document.getElementById('loadingRetry');
  const results = Array.from({ length: 5 }, (_, index) => ({ id: `archive-0${index + 1}` }));
  let loadCalls = 0;
  let readyResolutions = 0;

  const ready = startCriticalAssetGate({
    documentRef: document,
    viewportWidth: 390,
    motionProfile: 'reduce',
    createView: (documentRef) => createInjectedView(documentRef).view,
    load: async () => {
      loadCalls += 1;
      if (loadCalls === 1) {
        const error = new Error('Critical images failed');
        error.failures = [{ id: 'archive-01' }];
        throw error;
      }
      return results;
    }
  });
  void ready.then(() => {
    readyResolutions += 1;
  });

  await nextTurn();

  assert.equal(readyResolutions, 0);
  assert.equal(loadCalls, 1);
  assert.equal(appRoot.hasAttribute('inert'), true);
  assert.equal(appRoot.getAttribute('aria-hidden'), 'true');
  assert.equal(appShell.classList.contains('is-ready'), false);
  assert.strictEqual(document.activeElement, retry);

  retry.click();
  retry.click();

  assert.strictEqual(await ready, results);
  await Promise.resolve();
  assert.equal(loadCalls, 2);
  assert.equal(readyResolutions, 1);
  assert.equal(appRoot.hasAttribute('inert'), false);
  assert.equal(appRoot.hasAttribute('aria-hidden'), false);
  assert.equal(appShell.classList.contains('is-ready'), true);
  assert.equal(document.getElementById('loadingScreen'), null);
});

test('bootstrap waits for visual finish before releasing the application and resolves after exit', async () => {
  const dom = createGateFixture();
  const document = dom.window.document;
  const appRoot = document.getElementById('appRoot');
  const calls = [];
  let finishVisual;
  let finishExit;
  const visual = new Promise((resolve) => { finishVisual = resolve; });
  const exited = new Promise((resolve) => { finishExit = resolve; });
  const result = { id: 'archive-01' };

  const ready = startCriticalAssetGate({
    documentRef: document,
    viewportWidth: 390,
    motionProfile: 'compact',
    createView(documentRef, options) {
      calls.push(['createView', documentRef, options]);
      return {
        reset: () => calls.push('reset'),
        setProgress: () => {},
        showError: () => assert.fail('unexpected gate error'),
        playReadySequence: (profile) => {
          calls.push(['ready', profile]);
          return visual;
        },
        exit: (profile) => {
          calls.push(['exit', profile]);
          return exited;
        },
        completeHandoff: () => calls.push('completeHandoff')
      };
    },
    load: async (_manifest, options) => {
      calls.push(['load', options.retries, options.concurrency]);
      return [result];
    }
  });

  await nextTurn();
  assert.equal(appRoot.hasAttribute('inert'), true);
  assert.equal(calls[0][0], 'createView');
  assert.strictEqual(calls[0][1], document);
  assert.equal(calls[0][2].motionProfile, 'compact');
  assert.equal(typeof calls[0][2].onSkip, 'function');
  assert.deepEqual(calls.find(([name]) => name === 'load'), ['load', 2, 2]);

  finishVisual();
  await nextTurn();
  assert.equal(appRoot.hasAttribute('inert'), true);
  assert.equal(appRoot.getAttribute('aria-hidden'), 'true');
  assert.equal(document.getElementById('appShell').classList.contains('is-ready'), false);
  assert.equal(await Promise.race([ready.then(() => true), Promise.resolve(false)]), false);

  finishExit();
  assert.deepEqual(await ready, [result]);
  assert.equal(appRoot.hasAttribute('inert'), false);
  assert.equal(appRoot.hasAttribute('aria-hidden'), false);
  assert.equal(document.getElementById('appShell').classList.contains('is-ready'), true);
  assert.equal(calls.at(-1), 'completeHandoff');
});

test('bootstrap keeps the application inert when the handoff exit is cancelled', async () => {
  const dom = createGateFixture();
  const document = dom.window.document;
  const appRoot = document.getElementById('appRoot');
  const appShell = document.getElementById('appShell');
  let completedHandoffs = 0;

  const ready = startCriticalAssetGate({
    documentRef: document,
    viewportWidth: 390,
    motionProfile: 'compact',
    createView: () => ({
      reset() {},
      setProgress() {},
      showError: () => assert.fail('cancelled exits are not visual errors'),
      playReadySequence: () => Promise.resolve(),
      exit: () => Promise.resolve(false),
      completeHandoff() { completedHandoffs += 1; }
    }),
    load: async () => [{ id: 'archive-01' }]
  });

  await nextTurn();
  await nextTurn();
  assert.equal(appRoot.hasAttribute('inert'), true);
  assert.equal(appRoot.getAttribute('aria-hidden'), 'true');
  assert.equal(appShell.classList.contains('is-ready'), false);
  assert.equal(completedHandoffs, 0);
  assert.equal(await Promise.race([ready.then(() => true), Promise.resolve(false)]), false);
});

test('bootstrap retries a cancelled handoff with the latest motion profile', async () => {
  const dom = createGateFixture();
  const document = dom.window.document;
  const appRoot = document.getElementById('appRoot');
  const appShell = document.getElementById('appShell');
  const exitProfiles = [];
  let completeHandoffs = 0;
  let resolveFirstExit;
  const firstExit = new Promise((resolve) => { resolveFirstExit = resolve; });

  const ready = startCriticalAssetGate({
    documentRef: document,
    viewportWidth: 1280,
    motionProfile: 'full',
    createView: () => ({
      reset() {},
      setProgress() {},
      setProfile() {},
      showError: () => assert.fail('profile handoff retry is not a visual error'),
      playReadySequence: () => Promise.resolve(),
      exit(profile) {
        exitProfiles.push(profile);
        return profile === 'full' ? firstExit : Promise.resolve(true);
      },
      completeHandoff() { completeHandoffs += 1; }
    }),
    load: async () => [{ id: 'archive-01' }]
  });

  await nextTurn();
  assert.deepEqual(exitProfiles, ['full']);
  ready.setProfile('reduce');
  resolveFirstExit(false);

  assert.deepEqual(await ready, [{ id: 'archive-01' }]);
  assert.deepEqual(exitProfiles, ['full', 'reduce']);
  assert.equal(completeHandoffs, 1);
  assert.equal(appRoot.hasAttribute('inert'), false);
  assert.equal(appRoot.hasAttribute('aria-hidden'), false);
  assert.equal(appShell.classList.contains('is-ready'), true);
});

test('bootstrap retries a cancelled handoff after the same profile is reapplied', async () => {
  const dom = createGateFixture();
  const document = dom.window.document;
  const exitProfiles = [];
  let resolveFirstExit;
  const firstExit = new Promise((resolve) => { resolveFirstExit = resolve; });

  const ready = startCriticalAssetGate({
    documentRef: document,
    viewportWidth: 390,
    motionProfile: 'compact',
    createView: () => ({
      reset() {},
      setProgress() {},
      setProfile() {},
      showError: () => assert.fail('profile handoff retry is not a visual error'),
      playReadySequence: () => Promise.resolve(),
      exit(profile) {
        exitProfiles.push(profile);
        return exitProfiles.length === 1 ? firstExit : Promise.resolve(true);
      }
    }),
    load: async () => [{ id: 'archive-01' }]
  });

  await nextTurn();
  assert.deepEqual(exitProfiles, ['compact']);
  ready.setProfile('compact');
  resolveFirstExit(false);

  assert.deepEqual(await ready, [{ id: 'archive-01' }]);
  assert.deepEqual(exitProfiles, ['compact', 'compact']);
  assert.equal(document.getElementById('appRoot').hasAttribute('inert'), false);
  assert.equal(document.getElementById('appShell').classList.contains('is-ready'), true);
});

test('bootstrap exposes a backward-compatible live loading-profile setter', async () => {
  const dom = createGateFixture();
  const document = dom.window.document;
  const calls = [];
  const result = { id: 'archive-01' };
  let resolveLoad;
  let resolveVisual;
  let resolveExit;
  const load = new Promise((resolve) => { resolveLoad = resolve; });
  const visual = new Promise((resolve) => { resolveVisual = resolve; });
  const exited = new Promise((resolve) => { resolveExit = resolve; });

  const ready = startCriticalAssetGate({
    documentRef: document,
    viewportWidth: 390,
    motionProfile: 'full',
    createView() {
      return {
        reset: () => calls.push('reset'),
        setProgress: () => {},
        setProfile: (profile) => calls.push(['profile', profile]),
        showError: () => assert.fail('unexpected gate error'),
        playReadySequence: (profile) => {
          calls.push(['ready', profile]);
          return visual;
        },
        exit: (profile) => {
          calls.push(['exit', profile]);
          return exited;
        }
      };
    },
    load: () => load
  });

  assert.equal(typeof ready.then, 'function');
  assert.equal(typeof ready.setProfile, 'function');
  ready.setProfile('reduce');
  resolveLoad([result]);
  await nextTurn();
  assert.deepEqual(calls.filter((call) => Array.isArray(call)), [
    ['profile', 'reduce'],
    ['ready', 'reduce']
  ]);

  ready.setProfile('compact');
  resolveVisual();
  await nextTurn();
  assert.deepEqual(calls.filter((call) => Array.isArray(call)), [
    ['profile', 'reduce'],
    ['ready', 'reduce'],
    ['profile', 'compact'],
    ['exit', 'compact']
  ]);

  resolveExit();
  assert.deepEqual(await ready, [result]);
});

test('bootstrap keeps the app gated when visual finish fails and reruns after retry', async () => {
  const dom = createGateFixture();
  const document = dom.window.document;
  const appRoot = document.getElementById('appRoot');
  const cause = new Error('visual queue failed');
  let runCount = 0;
  let retry;
  let showErrorValue;

  const ready = startCriticalAssetGate({
    documentRef: document,
    viewportWidth: 390,
    motionProfile: 'reduce',
    createView: () => ({
      reset() { runCount += 1; },
      setProgress() {},
      playReadySequence() {
        return runCount === 1
          ? Promise.reject(new VisualTransitionError(cause))
          : Promise.resolve();
      },
      showError(error, onRetry) {
        showErrorValue = error;
        retry = onRetry;
      },
      exit() { return Promise.resolve(); }
    }),
    load: async () => [{ id: 'archive-01' }]
  });

  await nextTurn();
  assert.strictEqual(showErrorValue.cause, cause);
  assert.equal(appRoot.hasAttribute('inert'), true);
  assert.equal(appRoot.getAttribute('aria-hidden'), 'true');

  retry();
  await ready;
  assert.equal(runCount, 2);
  assert.equal(appRoot.hasAttribute('inert'), false);
});

test('application markup starts as one inert root outside the loading screen', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const document = new JSDOM(html).window.document;
  const loadingScreen = document.getElementById('loadingScreen');
  const appRoot = document.getElementById('appRoot');

  assert.equal(appRoot.hasAttribute('inert'), true);
  assert.equal(appRoot.getAttribute('aria-hidden'), 'true');
  assert.equal(appRoot.contains(loadingScreen), false);
  assert.equal(loadingScreen.hasAttribute('aria-live'), false);
  assert.equal(loadingScreen.querySelectorAll('[aria-live]').length, 1);
  for (const id of ['appShell', 'resultArea', 'playlistArea', 'contactLink', 'copyToast']) {
    assert.equal(appRoot.contains(document.getElementById(id)), true, `${id} must be gated by appRoot`);
  }

  const slots = [...loadingScreen.querySelectorAll('figure.loading-frame[data-loading-slot]')];
  const expectedOrdinals = Array.from({ length: 10 }, (_, index) => String(index + 1).padStart(2, '0'));
  assert.deepEqual(slots.map((slot) => slot.dataset.loadingSlot), expectedOrdinals.map((id) => `archive-${id}`));
  assert.deepEqual(slots.map((slot) => slot.textContent.trim()), expectedOrdinals.map((id) => `AR-${id}`));
  assert.ok(slots.every((slot) => slot.querySelector('figcaption').getAttribute('aria-hidden') === 'true'));
  assert.doesNotMatch(loadingScreen.textContent, /LIGHT ARCHIVE|PROJECTION/);
  assert.equal(loadingScreen.querySelectorAll('canvas#loadingParticles').length, 1);
  assert.equal(loadingScreen.classList.contains('is-loading-prelude'), true);
  assert.equal(loadingScreen.dataset.preludeState, 'playing');
  assert.equal(loadingScreen.querySelectorAll('#loadingHole > i').length, 10);
  assert.equal(loadingScreen.querySelector('#loadingHole').getAttribute('aria-hidden'), 'true');
  assert.equal(loadingScreen.querySelectorAll('div#loadingTopPortal').length, 1);
  assert.equal(loadingScreen.querySelectorAll('div#loadingBottomPortal').length, 1);
  assert.equal(loadingScreen.querySelectorAll('button').length, 2);
  assert.equal(loadingScreen.querySelector('#loadingSkip').textContent.trim(), '跳过');
  assert.equal(loadingScreen.querySelectorAll('img').length, 0);
  assert.equal(loadingScreen.querySelector('[src]'), null);
  assert.equal(document.querySelectorAll('#loadingProgress.sr-only').length, 1);
  assert.equal(document.querySelector('.loading-progress-rail'), null);
  assert.equal(loadingScreen.querySelector('#loadingProgress').getAttribute('aria-live'), 'polite');
  assert.equal(loadingScreen.querySelector('#loadingProgress').getAttribute('aria-atomic'), 'true');

  const criticalStyle = document.querySelector('style').textContent;
  assert.match(criticalStyle, /\.loading-screen\s*\{[^}]*box-sizing:\s*border-box/s);
  assert.match(criticalStyle, /padding:\s*max\(24px, env\(safe-area-inset-top\)\)\s+max\(24px, env\(safe-area-inset-right\)\)\s+max\(24px, env\(safe-area-inset-bottom\)\)\s+max\(24px, env\(safe-area-inset-left\)\)/s);
  assert.match(criticalStyle, /\.loading-intake\s*\{[^}]*width:\s*min\(100%, 680px\)[^}]*height:\s*min\(100%, 820px\)/s);
  assert.match(criticalStyle, /\.loading-hole,[\s\S]*?\.loading-hole i\s*\{\s*position:\s*absolute/s);
});

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

test('loading CSS defines the projection layers and motion-specific fallbacks', () => {
  // Windows checkouts may smudge CRLF endings; the declaration pins embed \n.
  const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const loadingBlock = css.slice(css.indexOf('.loading-screen {'), css.indexOf('.app-shell {'));

  assert.doesNotMatch(css, /fonts\.googleapis/i);
  assert.doesNotMatch(css, /fonts\.gstatic/i);
  assert.doesNotMatch(css, /@import\s+url\(\s*["']?https?:/i);
  assert.match(loadingBlock, /\.loading-screen\s*\{[^}]*z-index:\s*1000/s);
  assert.match(loadingBlock, /\.loading-screen\s*\{[^}]*box-sizing:\s*border-box/s);
  assert.match(loadingBlock, /padding:\s*max\(24px, env\(safe-area-inset-top\)\)\s+max\(24px, env\(safe-area-inset-right\)\)\s+max\(24px, env\(safe-area-inset-bottom\)\)\s+max\(24px, env\(safe-area-inset-left\)\)/s);
  assert.match(loadingBlock, /\.loading-intake\s*\{[^}]*width:\s*min\(100%, 680px\)[^}]*height:\s*min\(100%, 820px\)/s);
  assert.deepEqual(LOADING_PRELUDE_TIMING, { full: 1200, compact: 900, reduce: 120 });
  assert.match(loadingBlock, /\.loading-screen\.is-loading-prelude \.loading-hole\s*\{[^}]*opacity:\s*1/s);
  assert.match(
    loadingBlock,
    /\.loading-hole i\s*\{[^}]*animation:\s*loading-hole-scale 3s var\(--loading-light-ease\) infinite/s
  );
  assert.equal(loadingBlock.match(/\.loading-hole i:nth-child\(\d+\)/g)?.length, 10);
  const holeKeyframes = expectKeyframeStops(loadingBlock, 'loading-hole-scale', {
    '0%': { opacity: '0', transform: 'translate3d(0, 0, 0) scale(2)' },
    '50%': { opacity: '1', transform: 'translate3d(0, -5px, 0) scale(1)' },
    '100%': { opacity: '0', transform: 'translate3d(0, 5px, 0) scale(0.1)' }
  });
  assert.doesNotMatch(holeKeyframes, /(?:filter|box-shadow|top|left|width|height)\s*:/);
  assert.match(loadingBlock, /\.loading-poster-stack\s*\{[^}]*z-index:\s*2/s);
  assert.match(loadingBlock, /\.loading-particles\s*\{[^}]*z-index:\s*3/s);
  assert.match(loadingBlock, /\.loading-light-slit\s*\{[^}]*z-index:\s*4/s);
  for (const selector of [
    '.loading-light-core',
    '.loading-light-edge.is-warm',
    '.loading-light-edge.is-cool'
  ]) {
    const beam = extractCssBlock(loadingBlock, selector);
    assert.match(beam, /background:\s*linear-gradient\(/, `${selector} must use a gradient beam`);
    assert.match(beam, /rgba\([^)]*,\s*0\)\s+0%/, `${selector} must start transparent`);
    assert.match(beam, /rgba\([^)]*,\s*0\)\s+100%/, `${selector} must end transparent`);
    assert.doesNotMatch(beam, /background:\s*rgba\(/, `${selector} must not be a solid rectangle`);
  }
  assert.match(extractCssBlock(loadingBlock, '.loading-light-edge.is-warm'), /rgba\(255, 244, 222, 0\.26\)\s+52%/);
  assert.match(extractCssBlock(loadingBlock, '.loading-light-edge.is-cool'), /rgba\(220, 241, 255, 0\.24\)\s+52%/);
  const coreBeam = extractCssBlock(loadingBlock, '.loading-light-core');
  assert.match(coreBeam, /rgba\(255, 255, 255, 0\)\s+20%/);
  assert.match(coreBeam, /rgba\(255, 255, 255, 0\.72\)\s+48%/);
  expectDeclarations(
    extractCssBlock(loadingBlock, '.loading-light-slit > span'),
    { filter: 'blur(18px)' },
    'fixed desktop beam blur'
  );
  assert.match(
    loadingBlock,
    /\.loading-screen\[data-motion-profile="compact"\] \.loading-stage::before\s*\{[^}]*filter:\s*blur\(0\.6px\)/s,
    'compact scan line should retain a soft subpixel blur'
  );
  assert.match(
    loadingBlock,
    /\.loading-screen\[data-motion-profile="compact"\] \.loading-stage::after,\s*\.loading-screen\[data-motion-profile="compact"\] \.loading-frame::before\s*\{[^}]*filter:\s*blur\(7px\)/s,
    'compact poster wake and final ambient layers retain a bounded soft glow'
  );
  expectDeclarations(
    extractCssBlock(loadingBlock, '.loading-stage::before'),
    { height: '1px', filter: 'blur(1px)' },
    'fixed scan gate line'
  );
  assert.match(
    loadingBlock,
    /\.loading-stage::after\s*\{[^}]*height:\s*30px[^}]*filter:\s*blur\(12px\)/s,
    'fixed scan gate halo must use a small, statically blurred layer'
  );
  expectDeclarations(
    extractCssBlock(loadingBlock, '.loading-frame::before'),
    { filter: 'blur(18px)' },
    'poster wake glow'
  );
  assert.match(loadingBlock, /\.loading-controls\s*\{[^}]*z-index:\s*5/s);
  assert.match(loadingBlock, /\.loading-image\s*\{[^}]*object-fit:\s*contain/s);
  assert.match(loadingBlock, /--loading-motion-ease:\s*cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
  assert.match(loadingBlock, /--loading-handoff-ease:\s*cubic-bezier\(0\.42, 0, 0\.58, 1\)/);
  assert.match(loadingBlock, /--loading-light-ease:\s*cubic-bezier\(0\.4, 0, 0\.2, 1\)/);
  assert.match(loadingBlock, /--loading-settle-ease:\s*cubic-bezier\(0\.32, 0\.72, 0, 1\)/);
  assert.match(loadingBlock, /\.loading-screen\s*\{[^}]*transition:\s*opacity 680ms var\(--loading-settle-ease\)/s);
  assert.match(loadingBlock, /\.loading-frame\s*\{[^}]*visibility:\s*hidden/s);
  assert.match(loadingBlock, /\.loading-frame\.is-active,\s*\.loading-frame\.is-outgoing,\s*\.loading-frame\.is-failed\s*\{[^}]*visibility:\s*visible/s);
  assert.doesNotMatch(extractCssBlock(loadingBlock, '.loading-frame'), /transition[^;]*opacity|opacity[^;]*transition/);
  assert.doesNotMatch(loadingBlock, /\.loading-frame\.is-active figcaption/);
  assert.match(loadingBlock, /\.loading-frame\.is-failed figcaption\s*\{[^}]*opacity:\s*1/s);
  assert.equal(POSTER_TIMING.full.finalResolve, 1280);
  assert.equal(POSTER_TIMING.full.exitLead, 1280);
  assert.equal(POSTER_TIMING.full.rootFade, 680);
  assert.equal(POSTER_TIMING.compact.finalResolve, 920);
  assert.equal(POSTER_TIMING.compact.exitLead, 920);
  assert.equal(POSTER_TIMING.compact.rootFade, 680);
  for (const profile of ['full', 'compact']) {
    const timing = FINAL_HANDOFF_TIMING[profile];
    assert.equal(
      timing.revealAt + timing.playerReveal,
      timing.morph,
      `${profile} player reveal must finish with the poster morph`
    );
    assert.equal(
      timing.backdropExit,
      timing.morph,
      `${profile} backdrop exit must finish with the poster morph`
    );
  }
  assert.match(loadingBlock, /--slit-duration:\s*760ms/);
  assert.match(loadingBlock, /\.loading-image\s*\{[^}]*opacity var\(--poster-handoff-ms, 600ms\) var\(--loading-handoff-ease\)/s);
  assert.match(loadingBlock, /\.loading-image\s*\{[^}]*transform var\(--poster-handoff-ms, 600ms\) var\(--loading-settle-ease\)/s);
  assert.match(loadingBlock, /\.loading-screen\[data-motion-profile="compact"\]\s*\{[^}]*--poster-handoff-ms:\s*480ms[^}]*--slit-duration:\s*760ms/s);

  for (const [selector, animationName] of [
    [
      'html:not([data-motion-profile="reduce"]) .app-shell.is-loading-reveal[data-loading-handoff="true"] .vinyl-grooves',
      'loading-vinyl-grooves-reveal'
    ],
    [
      'html:not([data-motion-profile="reduce"]) .app-shell.is-loading-reveal[data-loading-handoff="true"] .vinyl-highlight',
      'loading-vinyl-highlight-reveal'
    ],
    [
      'html:not([data-motion-profile="reduce"]) .app-shell.is-loading-reveal[data-loading-handoff="true"] .vinyl-record::after',
      'loading-vinyl-surface-reveal'
    ]
  ]) {
    expectDeclarations(
      extractCssBlock(css, selector),
      {
        animation: `${animationName}
                var(--loading-player-reveal-ms, 794ms)
                linear
                var(--loading-player-reveal-delay-ms, 486ms)
                both`
      },
      `${animationName} handoff timing`
    );
  }

  for (const [name, finalOpacity] of [
    ['loading-player-shell-reveal', '1'],
    ['loading-vinyl-grooves-reveal', '0.76'],
    ['loading-vinyl-highlight-reveal', '0.62'],
    ['loading-vinyl-surface-reveal', '1'],
    ['loading-handoff-hole-reveal', '1']
  ]) {
    expectKeyframeStops(css, name, {
      '88%, 100%': { opacity: finalOpacity }
    });
  }
  expectKeyframeStops(css, 'loading-backdrop-reveal', {
    '88%, 100%': { 'background-color': 'transparent' }
  });
  expectKeyframeStops(css, 'loading-final-ambient-converge', {
    '88%, 100%': { opacity: '0' }
  });

  const handoffHole = extractCssBlock(
    css,
    'html:not([data-motion-profile="reduce"]) .loading-screen.is-final-resolving[data-handoff-ready="true"] .loading-frame[data-final-poster="true"]::after'
  );
  expectDeclarations(handoffHole, {
    'z-index': '7',
    width: '12px',
    height: '12px',
    background: 'var(--bg-base)',
    animation: 'loading-handoff-hole-reveal var(--loading-handoff-morph-ms, 1280ms) linear both'
  }, 'final handoff center hole');
  const handoffHoleFinal = extractCssBlock(
    extractCssBlock(css, '@keyframes loading-handoff-hole-reveal'),
    '88%, 100%'
  );
  assert.match(handoffHoleFinal, /calc\(-50% \+ var\(--poster-final-x, 0px\)\)/);
  assert.match(handoffHoleFinal, /calc\(-50% \+ var\(--poster-final-y, 0px\)\)/);

  const grooveRules = [...css.matchAll(/(?:^|\})\s*\.vinyl-grooves\s*\{([^}]*)\}/gm)]
    .map((match) => match[1]);
  assert.ok(grooveRules.length >= 2, 'expected base and archive groove rules');
  assert.ok(
    grooveRules.every((rule) => /repeating-radial-gradient\(\s*circle at center/.test(rule)),
    'every groove layer must use one centered circular micro-groove field'
  );
  assert.match(grooveRules.at(-1), /opacity:\s*0\.76/);

  const centerRingToken = extractCssBlock(css, '.loading-handoff-resident,\n        .vinyl-sticker');
  assert.match(centerRingToken, /--vinyl-center-ring:/);
  assert.match(centerRingToken, /rgba\(6, 9, 16, 0\.34\) 23\.5% 25\.5%/);
  for (const selector of ['.loading-handoff-resident::before', '.vinyl-sticker::before']) {
    assert.match(
      extractCssBlock(css, selector),
      /background:\s*var\(--vinyl-center-ring\)/,
      `${selector} must share the centered pressing ring`
    );
  }

  expectDeclarations(
    extractCssBlock(loadingBlock, '.loading-frame.is-scattering .loading-image'),
    {
      transition: 'opacity var(--poster-handoff-ms, 600ms) var(--loading-handoff-ease),\n                transform var(--poster-handoff-ms, 600ms) var(--loading-settle-ease)'
    },
    'outgoing scatter duration'
  );

  expectDeclarations(
    extractCssBlock(loadingBlock, '.loading-image'),
    {
      '--poster-enter-y': '-32%',
      '--poster-enter-scale': '0.24',
      '--poster-exit-y': '9%',
      '--poster-exit-scale': '1.08',
      transform: 'translate3d(0, var(--poster-enter-y), 0) scale(var(--poster-enter-scale))'
    },
    'fast full-profile poster tunnel geometry'
  );
  expectDeclarations(
    extractCssBlock(loadingBlock, '.loading-frame[data-slit-direction="vertical"] .loading-image'),
    { transform: 'translate3d(0, var(--poster-enter-y), 0) scale(var(--poster-enter-scale))' },
    'vertical poster entry geometry'
  );
  expectDeclarations(
    extractCssBlock(loadingBlock, '.loading-frame.is-scattering[data-slit-direction="vertical"] .loading-image'),
    {
      opacity: '0',
      transform: 'translate3d(0, var(--poster-exit-y), 0) scale(var(--poster-exit-scale))'
    },
    'vertical poster exit geometry'
  );
  expectDeclarations(
    extractCssBlock(loadingBlock, '.loading-frame[data-motion-profile="compact"][data-slit-direction="vertical"] .loading-image'),
    {
      '--poster-enter-y': '-24%',
      '--poster-enter-scale': '0.36',
      '--poster-exit-y': '7%',
      '--poster-exit-scale': '1.055'
    },
    'fast compact poster tunnel geometry'
  );

  for (const [selector, animation] of [
    [
      '.loading-screen:not([data-motion-profile="reduce"]) .loading-frame.is-revealing[data-slit-direction="vertical"] .loading-image',
      'loading-poster-enter var(--poster-handoff-ms, 600ms) var(--loading-settle-ease) both'
    ],
    [
      '.loading-screen:not([data-motion-profile="reduce"]) .loading-frame.is-revealing[data-slit-direction="vertical"]::before',
      'loading-poster-wake var(--poster-handoff-ms, 600ms) var(--loading-settle-ease) both'
    ],
    [
      '.loading-screen:not([data-motion-profile="reduce"]) .loading-frame.is-scattering[data-slit-direction="vertical"] .loading-image',
      'loading-poster-exit var(--poster-handoff-ms, 600ms) var(--loading-settle-ease) both'
    ],
    [
      '.loading-light-slit.is-lit[data-direction="vertical"]',
      'loading-tunnel-pass var(--slit-duration, 760ms) var(--loading-light-ease) both'
    ],
    [
      '.loading-light-slit.is-lit .loading-light-core',
      'loading-tunnel-core var(--slit-duration, 760ms) var(--loading-light-ease) both'
    ],
    [
      '.loading-light-slit.is-lit .loading-light-edge.is-warm',
      'loading-tunnel-warm var(--slit-duration, 760ms) var(--loading-light-ease) both'
    ],
    [
      '.loading-light-slit.is-lit .loading-light-edge.is-cool',
      'loading-tunnel-cool var(--slit-duration, 760ms) var(--loading-light-ease) both'
    ],
    [
      '.loading-screen.is-scanning .loading-stage::before',
      'loading-scan-gate-line var(--slit-duration, 760ms) var(--loading-light-ease) both'
    ],
    [
      '.loading-screen.is-scanning .loading-stage::after',
      'loading-scan-gate-halo var(--slit-duration, 760ms) var(--loading-light-ease) both'
    ],
    [
      '.loading-screen.is-final-resolving .loading-light-slit[data-direction="vertical"]',
      'loading-final-tunnel var(--final-resolve-ms, 1280ms) var(--loading-light-ease) both'
    ],
    [
      '.loading-screen.is-final-resolving .loading-stage::before',
      'loading-final-scan-gate-line var(--final-resolve-ms, 1280ms) var(--loading-light-ease) both'
    ],
    [
      '.loading-screen.is-final-resolving .loading-stage::after',
      'loading-final-scan-gate-halo var(--final-resolve-ms, 1280ms) var(--loading-light-ease) both'
    ],
    [
      '.loading-screen.is-final-resolving[data-handoff-ready="true"] .loading-image[data-loading-handoff="true"]',
      'loading-poster-to-player-motion var(--loading-handoff-morph-ms, 1280ms) linear both,\n                loading-poster-to-player-shape var(--loading-handoff-morph-ms, 1280ms) linear both'
    ]
  ]) {
    expectDeclarations(extractCssBlock(loadingBlock, selector), { animation }, selector);
  }

  const keyframes = [
    expectKeyframeStops(loadingBlock, 'loading-poster-enter', {
      '0%, 10%': {
        opacity: '0',
        transform: 'translate3d(0, var(--poster-enter-y), 0) scale(var(--poster-enter-scale))'
      },
      '20%': {
        opacity: '0.08',
        transform: 'translate3d(0, -27%, 0) scale(0.34)'
      },
      '36%': {
        opacity: '0.68',
        transform: 'translate3d(0, -7.5%, 0) scale(0.84)'
      },
      '47%': {
        opacity: '1',
        transform: 'translate3d(0, 1.2%, 0) scale(1.034)'
      },
      '66%, 100%': {
        opacity: '1',
        transform: 'translate3d(0, 0, 0) scale(1)'
      }
    }),
    expectKeyframeStops(loadingBlock, 'loading-poster-wake', {
      '0%, 10%': {
        opacity: '0',
        transform: 'translate3d(-50%, -32%, 0) scale3d(0.22, 0.62, 1)'
      },
      '30%': {
        opacity: '0.26',
        transform: 'translate3d(-50%, -12%, 0) scale3d(0.52, 1.04, 1)'
      },
      '47%': {
        opacity: '0.16',
        transform: 'translate3d(-50%, 3%, 0) scale3d(1.02, 0.82, 1)'
      },
      '66%, 100%': {
        opacity: '0',
        transform: 'translate3d(-50%, 8%, 0) scale3d(1.08, 0.46, 1)'
      }
    }),
    expectKeyframeStops(loadingBlock, 'loading-poster-exit', {
      '0%, 12%': {
        opacity: '1',
        transform: 'translate3d(0, 0, 0) scale(1)'
      },
      '22%': {
        opacity: '0.36',
        transform: 'translate3d(0, 2%, 0) scale(1.025)'
      },
      '30%': {
        opacity: '0.08',
        transform: 'translate3d(0, 5%, 0) scale(1.058)'
      },
      '38%, 100%': {
        opacity: '0',
        transform: 'translate3d(0, var(--poster-exit-y), 0) scale(var(--poster-exit-scale))'
      }
    }),
    expectKeyframeStops(loadingBlock, 'loading-scan-gate-line', {
      '35%': {
        opacity: '0.18',
        transform: 'translate3d(-50%, -50%, 0) scaleX(0.72)'
      },
      '43%': {
        opacity: '0.86',
        transform: 'translate3d(-50%, -50%, 0) scaleX(1)'
      },
      '50%': {
        opacity: '0.16',
        transform: 'translate3d(-50%, -50%, 0) scaleX(1.045)'
      }
    }),
    expectKeyframeStops(loadingBlock, 'loading-scan-gate-halo', {
      '43%': {
        opacity: '0.34',
        transform: 'translate3d(-50%, -50%, 0) scaleX(1)'
      }
    }),
    expectKeyframeStops(loadingBlock, 'loading-final-scan-gate-line', {
      '46%': {
        opacity: '0.16',
        transform: 'translate3d(-50%, -50%, 0) scaleX(0.7)'
      },
      '52%': {
        opacity: '0.82',
        transform: 'translate3d(-50%, -50%, 0) scaleX(1)'
      },
      '60%': {
        opacity: '0.14',
        transform: 'translate3d(-50%, -50%, 0) scaleX(1.045)'
      }
    }),
    expectKeyframeStops(loadingBlock, 'loading-final-scan-gate-halo', {
      '52%': {
        opacity: '0.3',
        transform: 'translate3d(-50%, -50%, 0) scaleX(1)'
      }
    }),
    expectKeyframeStops(loadingBlock, 'loading-tunnel-pass', {
      '0%': {
        opacity: '0',
        transform: 'translate3d(-50%, -112%, 0) scale3d(0.56, 0.28, 1)'
      },
      '31%': {
        opacity: '0.18',
        transform: 'translate3d(-50%, -68%, 0) scale3d(0.68, 0.68, 1)'
      },
      '43%': {
        opacity: '0.28',
        transform: 'translate3d(-50%, -40%, 0) scale3d(1.05, 1.05, 1)'
      },
      '100%': {
        opacity: '0',
        transform: 'translate3d(-50%, 18%, 0) scale3d(0.54, 0.38, 1)'
      }
    }),
    expectKeyframeStops(loadingBlock, 'loading-tunnel-core', {
      '0%': { opacity: '0', transform: 'scale3d(0.58, 0.25, 1)' },
      '43%': { opacity: '0.62', transform: 'scale3d(1, 1, 1)' },
      '100%': { opacity: '0', transform: 'scale3d(0.62, 0.3, 1)' }
    }),
    expectKeyframeStops(loadingBlock, 'loading-tunnel-warm', {
      '0%': { opacity: '0', transform: 'translate3d(4%, -5%, 0) scale3d(0.52, 0.2, 1)' },
      '43%': { opacity: '0.26', transform: 'translate3d(-1%, 2%, 0) scale3d(1, 1, 1)' },
      '100%': { opacity: '0', transform: 'translate3d(-6%, 8%, 0) scale3d(0.58, 0.3, 1)' }
    }),
    expectKeyframeStops(loadingBlock, 'loading-tunnel-cool', {
      '0%': { opacity: '0', transform: 'translate3d(-4%, -5%, 0) scale3d(0.52, 0.2, 1)' },
      '43%': { opacity: '0.23', transform: 'translate3d(1%, 2%, 0) scale3d(1, 1, 1)' },
      '100%': { opacity: '0', transform: 'translate3d(6%, 8%, 0) scale3d(0.58, 0.3, 1)' }
    }),
    expectKeyframeStops(loadingBlock, 'loading-final-tunnel', {
      '0%': {
        opacity: '0',
        transform: 'translate3d(-50%, -108%, 0) scale3d(0.54, 0.26, 1)'
      },
      '52%': {
        opacity: '0.22',
        transform: 'translate3d(-50%, -40%, 0) scale3d(1.04, 1.02, 1)'
      },
      '100%': {
        opacity: '0',
        transform: 'translate3d(-50%, 18%, 0) scale3d(0.54, 0.34, 1)'
      }
    }),
    expectKeyframeStops(loadingBlock, 'loading-final-core', {
      '38%': { opacity: '0.52', transform: 'scale3d(0.86, 0.8, 1)' },
      '100%': { opacity: '0', transform: 'scale3d(0.58, 0.28, 1)' }
    }),
    expectKeyframeStops(loadingBlock, 'loading-final-warm', {
      '38%': { opacity: '0.22', transform: 'translate3d(1%, 0, 0) scale3d(0.84, 0.76, 1)' },
      '100%': { opacity: '0', transform: 'translate3d(-7%, 8%, 0) scale3d(0.56, 0.26, 1)' }
    }),
    expectKeyframeStops(loadingBlock, 'loading-final-cool', {
      '38%': { opacity: '0.2', transform: 'translate3d(-1%, 0, 0) scale3d(0.84, 0.76, 1)' },
      '100%': { opacity: '0', transform: 'translate3d(7%, 8%, 0) scale3d(0.56, 0.26, 1)' }
    }),
    expectKeyframeStops(loadingBlock, 'loading-poster-to-player-motion', {
      '0%': { transform: 'translate3d(0, 0, 0) scale(1)' },
      '82%, 100%': {
        transform: 'translate3d(var(--poster-final-x, 0px), var(--poster-final-y, 0px), 0) scale(var(--poster-final-scale, 0.4))'
      }
    }),
    expectKeyframeStops(loadingBlock, 'loading-poster-to-player-shape', {
      '0%': {},
      '82%, 100%': {}
    })
  ];
  for (const keyframe of keyframes) {
    assert.doesNotMatch(keyframe, /(?:filter|box-shadow|backdrop-filter|top|left|width|height)\s*:/);
  }
  for (const keyframe of keyframes.slice(0, -1)) {
    assert.doesNotMatch(keyframe, /(?:-webkit-)?clip-path\s*:/);
  }
  const finalHandoff = keyframes.at(-1);
  const finalMotion = keyframes.at(-2);
  assert.match(extractCssBlock(finalMotion, '0%'), /animation-timing-function:\s*cubic-bezier\(0\.4, 0\.14, 0\.3, 1\)/);
  assert.doesNotMatch(finalMotion, /(?:-webkit-)?clip-path\s*:|\bopacity\s*:/);
  assert.match(extractCssBlock(finalHandoff, '0%'), /animation-timing-function:\s*cubic-bezier\(0, 0, 0\.3, 1\)/);
  assert.doesNotMatch(finalHandoff, /\bopacity\s*:|\btransform\s*:/);
  assert.match(
    extractCssBlock(finalHandoff, '0%'),
    /clip-path:\s*inset\(\s*var\(--poster-source-inset-top, 0%\)\s*var\(--poster-source-inset-right, 0%\)\s*var\(--poster-source-inset-bottom, 0%\)\s*var\(--poster-source-inset-left, 0%\)\s*round 0%\s*\)/s
  );
  assert.match(
    extractCssBlock(finalHandoff, '82%, 100%'),
    /clip-path:\s*inset\(\s*var\(--poster-final-inset-top, 0%\)\s*var\(--poster-final-inset-right, 0%\)\s*var\(--poster-final-inset-bottom, 0%\)\s*var\(--poster-final-inset-left, 0%\)\s*round var\(--poster-final-radius, 999px\)\s*\)/s,
    'the shape track must become circular in sync with the final translation'
  );
  const targetCoverBinding = extractCssBlock(css, '.vinyl-cover:is([data-loading-prewarm="true"], [data-loading-handoff="true"])');
  expectDeclarations(targetCoverBinding, {
    transition: 'none',
    animation: 'none',
    opacity: '0',
    transform: 'scale(1) rotate(0deg)'
  }, 'loading handoff target cover');
  assert.doesNotMatch(css, /@keyframes loading-target-cover-reveal/);
  assert.doesNotMatch(loadingBlock, /loading-handoff-flight|loading-poster-handoff-source/);
  assert.doesNotMatch(loadingBlock, /loading-(?:slit-(?:ltr|rtl)|curtain|final-(?:ltr|rtl))/);
  assert.match(loadingBlock, /\.loading-copy\s*\{[^}]*transition:\s*opacity 0\.24s var\(--loading-motion-ease\)/s);
  assert.match(
    loadingBlock,
    /\.loading-copy\s*\{[^}]*animation:\s*copy-fade 1\.6s var\(--loading-motion-ease\) infinite/s
  );
  assert.doesNotMatch(loadingBlock, /loading-opening-(?:title|sweep|reduce)|is-opening-title/);
  assert.doesNotMatch(loadingBlock, /\.loading-copy::after/);
  expectKeyframeStops(loadingBlock, 'copy-fade', {
    '0%, 100%': { opacity: '0.55', transform: 'translateY(0)' },
    '50%': { opacity: '1', transform: 'translateY(-2px)' }
  });
  assert.match(
    loadingBlock,
    /\.loading-status\s*\{[^}]*transition:\s*opacity 180ms var\(--loading-motion-ease\)/s
  );
  assert.doesNotMatch(
    loadingBlock,
    /\.loading-screen\.is-portal-active \.loading-status\s*\{[^}]*opacity:\s*0/s
  );
  expectDeclarations(
    extractCssBlock(loadingBlock, '.loading-screen.is-final-resolving .loading-status'),
    {
      animation: 'loading-status-final-fade var(--final-resolve-ms, 1280ms) var(--loading-motion-ease) both'
    },
    'final status crossfade'
  );
  expectKeyframeStops(loadingBlock, 'loading-status-final-fade', {
    '0%, 6%': { opacity: '1' },
    '18%, 100%': { opacity: '0' }
  });
  expectDeclarations(
    extractCssBlock(
      loadingBlock,
      '.loading-screen[data-motion-profile="reduce"].is-final-resolving .loading-status'
    ),
    { opacity: '0', animation: 'none' },
    'reduced-motion final status'
  );
  expectDeclarations(extractCssBlock(loadingBlock, '.loading-skip'), {
    position: 'fixed',
    bottom: 'max(18px, env(safe-area-inset-bottom))',
    left: '50%',
    'min-width': '88px',
    'min-height': '44px',
    'border-radius': '999px',
    transform: 'translate3d(-50%, 0, 0)'
  }, 'centered loading skip control');
  assert.deepEqual(loadingBlock.match(/transition:[^;]*linear;/g), [
    'transition: opacity 120ms linear;',
    'transition: opacity 120ms linear;'
  ]);
  for (const selector of ['.loading-frame', '.loading-image', '.loading-light-slit']) {
    assert.doesNotMatch(
      extractCssBlock(loadingBlock, selector),
      /(?:filter|box-shadow|backdrop-filter)\s*:/,
      `${selector} must not blur its content layer`
    );
  }
  assert.doesNotMatch(loadingBlock, /letter-spacing:\s*-/);
  assert.doesNotMatch(loadingBlock, /(?:url\(|background-image)/);
  const loadingSkip = extractCssBlock(loadingBlock, '.loading-skip');
  assert.match(loadingSkip, /var\(--glass-fill\)/);
  assert.doesNotMatch(loadingSkip, /backdrop-filter\s*:/, 'the small control must not allocate another live blur surface');
  assert.match(
    extractCssBlock(
      loadingBlock,
      '.loading-screen.is-final-resolving[data-handoff-ready="true"] .loading-image[data-loading-handoff="true"]'
    ),
    /will-change:\s*transform, clip-path/,
    'only the short-lived final handoff may pre-promote its animated properties'
  );
  assert.doesNotMatch(loadingBlock, /translateX\s*[:(]/);
  expectDeclarations(
    extractCssBlock(loadingBlock, '.loading-frame'),
    {
      perspective: '1200px',
      'transform-style': 'preserve-3d'
    },
    'bounded resting-poster depth'
  );
  const allLoadingScales = [...loadingBlock.matchAll(/(?<!X)scale\(([0-9.]+)\)/g)]
    .map(([, scale]) => Number(scale));
  const holeOnlyScales = allLoadingScales.filter((scale) => scale === 2 || scale === 0.1);
  assert.deepEqual([...new Set(holeOnlyScales)].sort(), [0.1, 2]);
  const posterScales = allLoadingScales.filter((scale) => scale !== 2 && scale !== 0.1);
  assert.ok(posterScales.length > 0);
  assert.ok(posterScales.every((scale) => scale >= 0.24 && scale <= 1.08));
  assert.match(loadingBlock, /\.loading-screen\[data-motion-profile="reduce"\]\s*\{[^}]*transition:\s*opacity 120ms linear/s);
  assert.match(loadingBlock, /\.loading-screen\[data-motion-profile="reduce"\] \.loading-frame\s*\{[^}]*transition:\s*none/s);
  assert.match(loadingBlock, /\.loading-screen\[data-motion-profile="reduce"\] \.loading-image\s*\{[^}]*animation:\s*none/s);
  assert.match(loadingBlock, /\.loading-screen\[data-motion-profile="reduce"\] \.loading-stage::before,[^}]*\.loading-stage::after\s*\{[^}]*display:\s*none/s);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.loading-particles[\s\S]*display:\s*none/s);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.loading-image[\s\S]*120ms/s);
});

test('application startup atomically hands the final critical image to the player cover', async () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, {
    pretendToBeVisual: true,
    url: 'http://localhost/'
  });
  const { document } = dom.window;
  const srcAssignments = [];
  const context = {
    setTransform() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {},
    moveTo() {}, lineTo() {}, stroke() {}
  };
  dom.window.HTMLCanvasElement.prototype.getContext = () => context;
  const matchMedia = (query) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener() {},
    removeEventListener() {}
  });
  dom.window.matchMedia = matchMedia;

  function StartupImage() {
    const image = document.createElement('img');
    let currentSrc = '';
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 320 });
    Object.defineProperty(image, 'src', {
      configurable: true,
      get: () => currentSrc,
      set(value) {
        currentSrc = String(value);
        srcAssignments.push(currentSrc);
        queueMicrotask(() => image.onload?.());
      }
    });
    image.decode = async () => {};
    return image;
  }

  const globals = {
    window: dom.window,
    document,
    navigator: dom.window.navigator,
    Element: dom.window.Element,
    Image: StartupImage,
    matchMedia,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window)
  };
  const previous = new Map();
  for (const [name, value] of Object.entries(globals)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }

  try {
    await import(new URL(`../../src/main.js?startup=${Date.now()}`, import.meta.url));
    const deadline = Date.now() + 3000;
    while (document.getElementById('loadingScreen') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal(document.getElementById('loadingScreen'), null);
    assert.equal(srcAssignments.length, 10);
    assert.equal(new Set(srcAssignments).size, 10);
    assert.ok(srcAssignments.every((src) => src.includes('/covers/') && src.includes('x-oss-process=')));
    const primaryCover = document.getElementById('vinylCoverA');
    assert.match(primaryCover.style.backgroundImage, /\/covers\/end\.jpg/);
    assert.equal(primaryCover.classList.contains('is-active'), true);
    assert.equal(primaryCover.hasAttribute('data-loading-handoff'), false);
    assert.equal(document.getElementById('appShell').classList.contains('is-loading-reveal'), false);
    assert.equal(document.getElementById('vinylCoverB').style.backgroundImage, '');
    assert.equal(document.documentElement.style.getPropertyValue('--cover-art-url'), '');
    assert.equal(document.body.style.getPropertyValue('--cover-art-url'), '');
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    dom.window.close();
  }

  const mainSource = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  const startupCoverBlock = mainSource.slice(
    mainSource.indexOf('// 抽取前'),
    mainSource.indexOf('const revealLyricContentImmediately')
  );
  assert.doesNotMatch(startupCoverBlock, /backgroundImage|setCoverArtworkUrl|artworkSrc/);
});
