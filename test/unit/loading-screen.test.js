import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { startCriticalAssetGate } from '../../src/app/bootstrap.js';
import { CriticalAssetError } from '../../src/media/asset-loader.js';
import {
  VisualTransitionError,
  createLoadingScreen
} from '../../src/ui/loading-screen.js';
import { POSTER_TIMING } from '../../src/ui/poster-transition.js';

const createFixture = () => new JSDOM(`
  <div class="loading-screen" id="loadingScreen" data-state="loading">
    <div class="loading-intake">
      <div class="loading-controls">
        <div class="loading-intake-head">
          <output id="loadingProgress" aria-label="加载进度" aria-live="polite" aria-atomic="true">00 / 05</output>
        </div>
        <p class="loading-copy" id="loadingCopy">影像读取中</p>
        <button class="loading-retry" id="loadingRetry" type="button" hidden>重新载入</button>
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
        <div class="loading-light-slit" id="loadingLightSlit"></div>
        <div class="loading-progress-rail" aria-hidden="true"><span></span></div>
      </div>
    </div>
  </div>
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
    finish: finish || (() => {
      calls.push('transition.finish');
      return Promise.resolve();
    }),
    freeze: () => calls.push('transition.freeze'),
    reset: () => calls.push('transition.reset'),
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
    <output id="loadingProgress" aria-label="加载进度" aria-live="polite" aria-atomic="true">00 / 05</output>
    <div data-loading-slot="archive-01"></div>
    <div data-loading-slot="archive-02"></div>
    <div data-loading-slot="archive-03"></div>
    <div data-loading-slot="archive-04"></div>
    <div data-loading-slot="archive-05"></div>
    <canvas id="loadingParticles"></canvas>
    <div id="loadingLightSlit"></div>
    <div class="loading-progress-rail" aria-hidden="true"><span></span></div>
    <button id="loadingRetry" type="button" hidden>重新载入</button>
    <p id="loadingCopy">影像读取中</p>
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
  const slit = dom.window.document.getElementById('loadingLightSlit');
  const particleCall = harness.calls.find(([name]) => name === 'particleFactory');
  const transitionCall = harness.calls.find(([name]) => name === 'transitionFactory');

  assert.strictEqual(particleCall[1].canvas, canvas);
  assert.strictEqual(particleCall[1].documentRef, dom.window.document);
  assert.strictEqual(particleCall[1].windowRef, dom.window);
  assert.equal(particleCall[1].profile, 'full');
  assert.strictEqual(transitionCall[1].root, root);
  assert.strictEqual(transitionCall[1].slit, slit);
  assert.strictEqual(transitionCall[1].particleField, harness.particleField);
  assert.equal(transitionCall[1].profile, 'full');
  assert.equal(typeof transitionCall[1].onError, 'function');
});

test('loading screen validates required nodes and the exact slot count', () => {
  const missingProgress = createFixture();
  missingProgress.window.document.getElementById('loadingProgress').remove();
  assert.throws(
    () => createLoadingScreen(missingProgress.window.document, createControllerHarness().factories),
    /loadingProgress/
  );

  const missingSlot = createFixture();
  missingSlot.window.document.querySelector('[data-loading-slot="archive-05"]').remove();
  assert.throws(
    () => createLoadingScreen(missingSlot.window.document, createControllerHarness().factories),
    /exactly 5 loading slots/
  );
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
  assert.strictEqual(slot.firstElementChild, decodedImage);
  assert.equal(decodedImage.alt, '加载封面图1');
  assert.equal(decodedImage.className, 'loading-image');
  assert.equal(decodedImage.dataset.assetId, 'archive-01');
  assert.equal(decodedImage.getAttribute('aria-hidden'), 'true');
  assert.equal(returnValue, undefined);
  const enqueueCall = harness.calls.find(([name]) => name === 'transition.enqueue');
  assert.strictEqual(enqueueCall[1], slot);
  assert.strictEqual(enqueueCall[2], decodedImage);
  assert.equal(dom.window.document.getElementById('loadingProgress').textContent, '01 / 05');
  assert.equal(dom.window.document.getElementById('loadingCopy').textContent, '已归档 1 / 5');
  assert.equal(dom.window.document.getElementById('loadingScreen').style.getPropertyValue('--loading-progress'), '1');
});

test('rapid ready progress only synchronously enqueues visual playback', () => {
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
  assert.equal(enqueues.length, 2);
  assert.strictEqual(enqueues[0][2], first);
  assert.strictEqual(enqueues[1][2], second);
  assert.strictEqual(slot.querySelector('img'), second);
});

test('showError exposes a retry that resets the view and invokes its callback once', () => {
  const dom = createFixture();
  const { view, harness } = createInjectedView(dom.window.document);
  const root = dom.window.document.getElementById('loadingScreen');
  const retry = dom.window.document.getElementById('loadingRetry');
  let retryCalls = 0;

  view.showError(new CriticalAssetError([{ id: 'archive-01' }]), () => {
    retryCalls += 1;
  });

  assert.equal(root.dataset.state, 'error');
  assert.equal(root.dataset.errorKind, 'asset');
  assert.equal(root.querySelector('[data-loading-slot="archive-01"] figcaption').getAttribute('aria-hidden'), null);
  assert.equal(retry.hidden, false);
  assert.strictEqual(dom.window.document.activeElement, retry);
  assert.equal(dom.window.document.getElementById('loadingCopy').textContent, '影像读取失败：archive-01');

  retry.click();
  retry.click();

  assert.equal(retryCalls, 1);
  assert.equal(root.dataset.state, 'loading');
  assert.equal(retry.hidden, true);
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
  root.classList.add('is-final-exposure', 'is-exiting');
  root.style.setProperty('--loading-progress', '4');

  view.reset();

  assert.deepEqual(harness.calls.slice(-2), ['transition.reset', 'particles.clear']);
  assert.equal(root.dataset.state, 'loading');
  assert.equal(root.dataset.errorKind, undefined);
  assert.equal(root.classList.contains('is-final-exposure'), false);
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
  slit.dispatchEvent(animationEnd(dom.window, 'loading-final-exposure'));
  await exiting;
  assert.equal(root.isConnected, false);
  assert.deepEqual(harness.calls.slice(-2), ['transition.destroy', 'particles.destroy']);
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

  await timers.advance(POSTER_TIMING.finalExposure - POSTER_TIMING.exitLead - 1);
  assert.equal(root.isConnected, true);
  assert.equal(settled, false);
  assert.equal(harness.calls.includes('transition.destroy'), false);

  slit.style.opacity = '0';
  await timers.advance(101);
  assert.equal(root.isConnected, true, 'root fallback must still observe the 480ms fade');
  assert.equal(harness.calls.includes('particles.destroy'), false);

  await timers.advance(100);
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
        }
      };
    },
    load: async (_manifest, options) => {
      calls.push(['load', options.retries, options.concurrency]);
      return [result];
    }
  });

  await nextTurn();
  assert.equal(appRoot.hasAttribute('inert'), true);
  assert.deepEqual(calls[0], ['createView', document, { motionProfile: 'compact' }]);
  assert.deepEqual(calls.find(([name]) => name === 'load'), ['load', 2, 2]);

  finishVisual();
  await nextTurn();
  assert.equal(appRoot.hasAttribute('inert'), false);
  assert.equal(document.getElementById('appShell').classList.contains('is-ready'), true);
  assert.equal(await Promise.race([ready.then(() => true), Promise.resolve(false)]), false);

  finishExit();
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
  assert.deepEqual(slots.map((slot) => slot.dataset.loadingSlot), [
    'archive-01', 'archive-02', 'archive-03', 'archive-04', 'archive-05'
  ]);
  assert.deepEqual(slots.map((slot) => slot.textContent.trim()), ['AR-01', 'AR-02', 'AR-03', 'AR-04', 'AR-05']);
  assert.ok(slots.every((slot) => slot.querySelector('figcaption').getAttribute('aria-hidden') === 'true'));
  assert.doesNotMatch(loadingScreen.textContent, /LIGHT ARCHIVE|PROJECTION/);
  assert.equal(loadingScreen.querySelectorAll('canvas#loadingParticles').length, 1);
  assert.equal(loadingScreen.querySelectorAll('div#loadingLightSlit').length, 1);
  assert.equal(loadingScreen.querySelectorAll('button').length, 1);
  assert.equal(loadingScreen.querySelectorAll('img').length, 0);
  assert.equal(loadingScreen.querySelector('[src]'), null);
  assert.equal(loadingScreen.querySelector('#loadingProgress').getAttribute('aria-live'), 'polite');
  assert.equal(loadingScreen.querySelector('#loadingProgress').getAttribute('aria-atomic'), 'true');
  assert.equal(loadingScreen.querySelector('.loading-progress-rail').getAttribute('aria-hidden'), 'true');

  const criticalStyle = document.querySelector('style').textContent;
  assert.match(criticalStyle, /\.loading-screen\s*\{[^}]*box-sizing:\s*border-box/s);
  assert.match(criticalStyle, /padding:\s*max\(24px, env\(safe-area-inset-top\)\)\s+max\(24px, env\(safe-area-inset-right\)\)\s+max\(24px, env\(safe-area-inset-bottom\)\)\s+max\(24px, env\(safe-area-inset-left\)\)/s);
  assert.match(criticalStyle, /\.loading-intake\s*\{[^}]*width:\s*min\(100%, 680px\)[^}]*height:\s*min\(100%, 820px\)/s);
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
  const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8');
  const loadingBlock = css.slice(css.indexOf('.loading-screen {'), css.indexOf('.app-shell {'));

  assert.doesNotMatch(css, /fonts\.googleapis/i);
  assert.doesNotMatch(css, /fonts\.gstatic/i);
  assert.doesNotMatch(css, /@import\s+url\(\s*["']?https?:/i);
  assert.match(loadingBlock, /\.loading-screen\s*\{[^}]*z-index:\s*1000/s);
  assert.match(loadingBlock, /\.loading-screen\s*\{[^}]*box-sizing:\s*border-box/s);
  assert.match(loadingBlock, /padding:\s*max\(24px, env\(safe-area-inset-top\)\)\s+max\(24px, env\(safe-area-inset-right\)\)\s+max\(24px, env\(safe-area-inset-bottom\)\)\s+max\(24px, env\(safe-area-inset-left\)\)/s);
  assert.match(loadingBlock, /\.loading-intake\s*\{[^}]*width:\s*min\(100%, 680px\)[^}]*height:\s*min\(100%, 820px\)/s);
  assert.match(loadingBlock, /\.loading-poster-stack\s*\{[^}]*z-index:\s*2/s);
  assert.match(loadingBlock, /\.loading-particles\s*\{[^}]*z-index:\s*3/s);
  assert.match(loadingBlock, /\.loading-light-slit\s*\{[^}]*z-index:\s*4/s);
  assert.match(loadingBlock, /\.loading-controls\s*\{[^}]*z-index:\s*5/s);
  assert.match(loadingBlock, /\.loading-image\s*\{[^}]*object-fit:\s*contain/s);
  assert.match(loadingBlock, /\.loading-screen\s*\{[^}]*transition:\s*opacity 480ms cubic-bezier\(0\.32, 0\.72, 0, 1\)/s);
  assert.match(loadingBlock, /\.loading-frame\s*\{[^}]*visibility:\s*hidden/s);
  assert.match(loadingBlock, /\.loading-frame\.is-active,\s*\.loading-frame\.is-outgoing,\s*\.loading-frame\.is-failed\s*\{[^}]*visibility:\s*visible/s);
  assert.doesNotMatch(extractCssBlock(loadingBlock, '.loading-frame'), /transition[^;]*opacity|opacity[^;]*transition/);
  assert.doesNotMatch(loadingBlock, /clip-path/);
  assert.doesNotMatch(loadingBlock, /\.loading-frame\.is-active figcaption/);
  assert.match(loadingBlock, /\.loading-frame\.is-failed figcaption\s*\{[^}]*opacity:\s*1/s);
  assert.equal(POSTER_TIMING.finalExposure, 560);
  assert.equal(POSTER_TIMING.exitLead, 180);
  assert.match(loadingBlock, /--slit-duration:\s*440ms/);
  assert.match(loadingBlock, /\.loading-image\s*\{[^}]*opacity var\(--poster-reveal-ms, 440ms\) cubic-bezier\(0\.32, 0\.72, 0, 1\)/s);
  assert.match(loadingBlock, /\.loading-image\s*\{[^}]*transform var\(--poster-reveal-ms, 440ms\) cubic-bezier\(0\.32, 0\.72, 0, 1\)/s);

  expectDeclarations(
    extractCssBlock(loadingBlock, '.loading-frame.is-scattering .loading-image'),
    {
      transition: 'opacity var(--poster-reveal-ms, 440ms) cubic-bezier(0.32, 0.72, 0, 1),\n                transform var(--poster-scatter-ms, 360ms) cubic-bezier(0.32, 0.72, 0, 1)'
    },
    'outgoing scatter duration'
  );

  for (const [selector, transform] of [
    ['.loading-frame[data-slit-direction="ltr"] .loading-image', 'translateX(-1.6%) scale(0.996)'],
    ['.loading-frame[data-slit-direction="rtl"] .loading-image', 'translateX(1.6%) scale(0.996)'],
    ['.loading-screen[data-motion-profile="compact"] .loading-frame[data-slit-direction="ltr"] .loading-image', 'translateX(-10px) scale(0.996)'],
    ['.loading-screen[data-motion-profile="compact"] .loading-frame[data-slit-direction="rtl"] .loading-image', 'translateX(10px) scale(0.996)']
  ]) {
    expectDeclarations(extractCssBlock(loadingBlock, selector), { transform }, selector);
  }

  for (const [selector, transform] of [
    [
      '.loading-frame.is-scattering[data-slit-direction="ltr"] .loading-image',
      'translateX(1.2%) scale(0.992)'
    ],
    [
      '.loading-frame.is-scattering[data-slit-direction="rtl"] .loading-image',
      'translateX(-1.2%) scale(0.992)'
    ],
    [
      '.loading-screen[data-motion-profile="compact"] .loading-frame.is-scattering[data-slit-direction="ltr"] .loading-image',
      'translateX(8px) scale(0.992)'
    ],
    [
      '.loading-screen[data-motion-profile="compact"] .loading-frame.is-scattering[data-slit-direction="rtl"] .loading-image',
      'translateX(-8px) scale(0.992)'
    ]
  ]) {
    expectDeclarations(extractCssBlock(loadingBlock, selector), { transform }, selector);
  }

  for (const [selector, animation] of [
    [
      '.loading-light-slit.is-lit[data-direction="ltr"]',
      'loading-slit-ltr var(--slit-duration, 440ms) cubic-bezier(0.32, 0.72, 0, 1) both'
    ],
    [
      '.loading-light-slit.is-lit[data-direction="rtl"]',
      'loading-slit-rtl var(--slit-duration, 440ms) cubic-bezier(0.32, 0.72, 0, 1) both'
    ],
    [
      '.loading-light-slit.is-lit .loading-light-core',
      'loading-curtain-core var(--slit-duration, 440ms) cubic-bezier(0.32, 0.72, 0, 1) both'
    ],
    [
      '.loading-light-slit.is-lit .loading-light-edge.is-warm',
      'loading-curtain-warm var(--slit-duration, 440ms) cubic-bezier(0.32, 0.72, 0, 1) both'
    ],
    [
      '.loading-light-slit.is-lit .loading-light-edge.is-cool',
      'loading-curtain-cool var(--slit-duration, 440ms) cubic-bezier(0.32, 0.72, 0, 1) both'
    ]
  ]) {
    expectDeclarations(extractCssBlock(loadingBlock, selector), { animation }, selector);
  }

  expectKeyframeStops(loadingBlock, 'loading-slit-ltr', {
    '0%': { opacity: '0', transform: 'translate(-150%, -50%) scaleX(0.004)' },
    '12%': { opacity: '0.06' },
    '30%': { opacity: '0.42' },
    '52%': { opacity: '0.22' },
    '76%': { opacity: '0.08' },
    '100%': { opacity: '0', transform: 'translate(50%, -50%) scaleX(0.004)' }
  });

  expectKeyframeStops(loadingBlock, 'loading-slit-rtl', {
    '0%': { opacity: '0', transform: 'translate(50%, -50%) scaleX(0.004)' },
    '12%': { opacity: '0.06' },
    '30%': { opacity: '0.42' },
    '52%': { opacity: '0.22' },
    '76%': { opacity: '0.08' },
    '100%': { opacity: '0', transform: 'translate(-150%, -50%) scaleX(0.004)' }
  });

  expectKeyframeStops(loadingBlock, 'loading-curtain-core', {
    '0%': { opacity: '0', transform: 'scaleX(0.08)' },
    '30%': { opacity: '1', transform: 'scaleX(1)' },
    '52%': { opacity: '0.46', transform: 'scaleX(0.72)' },
    '100%': { opacity: '0', transform: 'scaleX(0.18)' }
  });

  expectKeyframeStops(loadingBlock, 'loading-curtain-warm', {
    '0%': { opacity: '0', transform: 'translateX(8%) scaleX(0.04)' },
    '30%': { opacity: '0.82', transform: 'translateX(0) scaleX(1)' },
    '52%': { opacity: '0.34', transform: 'translateX(-10%) scaleX(0.80)' },
    '100%': { opacity: '0', transform: 'translateX(-18%) scaleX(0.56)' }
  });

  expectKeyframeStops(loadingBlock, 'loading-curtain-cool', {
    '0%': { opacity: '0', transform: 'translateX(-8%) scaleX(0.04)' },
    '30%': { opacity: '0.78', transform: 'translateX(0) scaleX(1)' },
    '52%': { opacity: '0.32', transform: 'translateX(10%) scaleX(0.80)' },
    '100%': { opacity: '0', transform: 'translateX(18%) scaleX(0.56)' }
  });

  expectDeclarations(
    extractCssBlock(loadingBlock, '.loading-screen.is-final-exposure .loading-light-slit'),
    {
      animation: `loading-final-exposure ${POSTER_TIMING.finalExposure}ms cubic-bezier(0.32, 0.72, 0, 1) both`
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
  assert.match(loadingBlock, /\.loading-progress-rail span\s*\{[^}]*transition:\s*width 180ms cubic-bezier\(0\.32, 0\.72, 0, 1\)/s);
  assert.match(loadingBlock, /\.loading-copy\s*\{[^}]*transition:\s*opacity 0\.24s cubic-bezier\(0\.32, 0\.72, 0, 1\)/s);
  assert.deepEqual(loadingBlock.match(/transition:[^;]*linear;/g), [
    'transition: opacity 120ms linear;',
    'transition: opacity 120ms linear;'
  ]);
  assert.doesNotMatch(loadingBlock, /(?:\.loading-frame|\.loading-image|\.loading-light-slit)[^{]*\{[^}]*(?:filter|box-shadow|backdrop-filter)\s*:/s);
  assert.doesNotMatch(loadingBlock, /letter-spacing:\s*-/);
  assert.doesNotMatch(loadingBlock, /(?:url\(|background-image|backdrop-filter|will-change)/);
  assert.doesNotMatch(loadingBlock, /(?:perspective|rotate|translateY)\s*[:(]/);
  const posterScales = [...loadingBlock.matchAll(/(?<!X)scale\(([0-9.]+)\)/g)]
    .map(([, scale]) => Number(scale));
  assert.ok(posterScales.length > 0);
  assert.ok(posterScales.every((scale) => scale >= 0.992 && scale <= 1));
  assert.match(loadingBlock, /\.loading-screen\[data-motion-profile="reduce"\]\s*\{[^}]*transition:\s*opacity 120ms linear/s);
  assert.match(loadingBlock, /\.loading-screen\[data-motion-profile="reduce"\] \.loading-frame\s*\{[^}]*transition:\s*none/s);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.loading-particles[\s\S]*display:\s*none/s);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.loading-image[\s\S]*120ms/s);
});

test('application startup assigns only the five critical images and leaves player artwork unset', async () => {
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
    assert.equal(srcAssignments.length, 5);
    assert.equal(new Set(srcAssignments).size, 5);
    assert.ok(srcAssignments.every((src) => src.includes('/cover/') && src.includes('x-oss-process=')));
    assert.equal(document.getElementById('vinylCoverA').style.backgroundImage, '');
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
    mainSource.indexOf('const updateCurrentLyric')
  );
  assert.doesNotMatch(startupCoverBlock, /backgroundImage|setCoverArtworkUrl|artworkSrc/);
});
