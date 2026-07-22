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

const createFixture = () => new JSDOM(`
  <div class="loading-screen" id="loadingScreen" data-state="loading" aria-live="polite">
    <div class="loading-intake">
      <div class="loading-controls">
        <div class="loading-intake-head">
          <span>LIGHT ARCHIVE / PROJECTION</span>
          <output id="loadingProgress">00 / 05</output>
        </div>
        <p class="loading-copy" id="loadingCopy">影像读取中</p>
        <button class="loading-retry" id="loadingRetry" type="button" hidden>重新载入</button>
      </div>
      <div class="loading-stage">
        <div class="loading-poster-stack">
        <figure class="loading-frame" data-loading-slot="archive-01"><figcaption>AR-01</figcaption></figure>
        </div>
        <canvas class="loading-particles" id="loadingParticles"></canvas>
        <div class="loading-light-slit" id="loadingLightSlit"></div>
        <div class="loading-progress-rail" aria-hidden="true"><span></span></div>
      </div>
    </div>
  </div>
`);

const createControllerHarness = ({ finish } = {}) => {
  const calls = [];
  const particleField = {
    clear: () => calls.push('particles.clear'),
    destroy: () => calls.push('particles.destroy')
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
    destroy: () => calls.push('transition.destroy')
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
  const harness = createControllerHarness(options);
  return {
    harness,
    view: createLoadingScreen(documentRef, {
      motionProfile: 'reduce',
      ...harness.factories
    })
  };
};

const transitionEnd = (window, propertyName, { bubbles = false } = {}) => {
  const event = new window.Event('transitionend', { bubbles });
  Object.defineProperty(event, 'propertyName', { value: propertyName });
  return event;
};

const createGateFixture = () => new JSDOM(`
  <div class="loading-screen" id="loadingScreen" data-state="loading" aria-live="polite">
    <output id="loadingProgress">00 / 05</output>
    <div data-loading-slot="archive-01"></div>
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
  slot.classList.add('is-ready', 'is-failed', 'is-active', 'is-revealing', 'is-scattering', 'is-stable');
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
  assert.equal(slot.className, 'loading-frame');
  assert.equal(slot.querySelector('img'), null);
});

test('compact exit ignores bubbled child transitions and removes on the root opacity transition', async () => {
  const dom = createFixture();
  const { view, harness } = createInjectedView(dom.window.document);
  const root = dom.window.document.getElementById('loadingScreen');
  const child = root.querySelector('.loading-intake');
  const exiting = view.exit('compact');

  child.dispatchEvent(transitionEnd(dom.window, 'opacity', { bubbles: true }));
  await Promise.resolve();
  assert.equal(root.isConnected, true);

  root.dispatchEvent(transitionEnd(dom.window, 'transform'));
  await Promise.resolve();
  assert.equal(root.isConnected, true);

  root.dispatchEvent(transitionEnd(dom.window, 'opacity'));
  await exiting;
  assert.equal(root.isConnected, false);
  assert.deepEqual(harness.calls.slice(-2), ['transition.destroy', 'particles.destroy']);
});

test('reduced exit destroys transition then particles without waiting', async () => {
  const dom = createFixture();
  const { view, harness } = createInjectedView(dom.window.document);
  await view.exit('reduce');

  assert.deepEqual(harness.calls.slice(-2), ['transition.destroy', 'particles.destroy']);
  assert.equal(dom.window.document.getElementById('loadingScreen'), null);
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
  for (const id of ['appShell', 'resultArea', 'playlistArea', 'contactLink', 'copyToast']) {
    assert.equal(appRoot.contains(document.getElementById(id)), true, `${id} must be gated by appRoot`);
  }

  const slots = [...loadingScreen.querySelectorAll('figure.loading-frame[data-loading-slot]')];
  assert.deepEqual(slots.map((slot) => slot.dataset.loadingSlot), [
    'archive-01', 'archive-02', 'archive-03', 'archive-04', 'archive-05'
  ]);
  assert.deepEqual(slots.map((slot) => slot.textContent.trim()), ['AR-01', 'AR-02', 'AR-03', 'AR-04', 'AR-05']);
  assert.equal(loadingScreen.querySelectorAll('canvas#loadingParticles').length, 1);
  assert.equal(loadingScreen.querySelectorAll('div#loadingLightSlit').length, 1);
  assert.equal(loadingScreen.querySelectorAll('button').length, 1);
  assert.equal(loadingScreen.querySelectorAll('img').length, 0);
  assert.equal(loadingScreen.querySelector('[src]'), null);
  assert.equal(loadingScreen.querySelector('#loadingProgress').getAttribute('aria-live'), 'polite');
  assert.equal(loadingScreen.querySelector('#loadingProgress').getAttribute('aria-atomic'), 'true');
  assert.equal(loadingScreen.querySelector('.loading-progress-rail').getAttribute('aria-hidden'), 'true');
});

test('loading CSS defines the projection layers and motion-specific fallbacks', () => {
  const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8');
  const loadingBlock = css.slice(css.indexOf('.loading-screen {'), css.indexOf('.app-shell {'));

  assert.match(loadingBlock, /\.loading-screen\s*\{[^}]*z-index:\s*1000/s);
  assert.match(loadingBlock, /\.loading-poster-stack\s*\{[^}]*z-index:\s*2/s);
  assert.match(loadingBlock, /\.loading-particles\s*\{[^}]*z-index:\s*3/s);
  assert.match(loadingBlock, /\.loading-light-slit\s*\{[^}]*z-index:\s*4/s);
  assert.match(loadingBlock, /\.loading-controls\s*\{[^}]*z-index:\s*5/s);
  assert.match(loadingBlock, /\.loading-image\s*\{[^}]*object-fit:\s*contain/s);
  assert.match(loadingBlock, /\.loading-frame\s*\{[^}]*visibility:\s*hidden/s);
  assert.match(loadingBlock, /\.loading-frame\.is-active,\s*\.loading-frame\.is-failed\s*\{[^}]*visibility:\s*visible/s);
  assert.doesNotMatch(loadingBlock, /(?:\.loading-frame|\.loading-image)[^{]*\{[^}]*(?:filter|box-shadow)\s*:/s);
  assert.doesNotMatch(loadingBlock, /(?:url\(|background-image|backdrop-filter|will-change)/);
  assert.match(loadingBlock, /data-motion-profile="compact"[^{]*\{[^}]*perspective:\s*none/s);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.loading-particles[\s\S]*display:\s*none/s);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.loading-image[\s\S]*120ms/s);
});
