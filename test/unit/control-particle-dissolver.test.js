import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createControlParticleDissolver } from '../../src/ui/control-particle-dissolver.js';

const createHarness = (profile = 'compact') => {
  const dom = new JSDOM(`<!doctype html><body>
    <button id="exit" data-particle-exit>关闭</button>
    <button id="other" data-particle-exit>跳过</button>
    <button id="plain">保留</button>
  </body>`, { pretendToBeVisual: true });
  const { document } = dom.window;
  const context = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    drawImageCount: 0,
    setTransform() {},
    clearRect() {},
    fillRect() {},
    drawImage() { this.drawImageCount += 1; },
    beginPath() {},
    arc() {},
    fill() {},
    createRadialGradient() {
      return { addColorStop() {} };
    }
  };
  Object.defineProperty(dom.window.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => context
  });
  const frames = [];
  const cancelledFrames = [];
  const timers = new Map();
  let nextTimerId = 0;
  let clock = 100;
  const dissolver = createControlParticleDissolver({
    documentRef: document,
    windowRef: dom.window,
    profile,
    random: () => 0.5,
    now: () => clock,
    requestFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
    cancelFrame(id) {
      cancelledFrames.push(id);
    },
    setTimer(callback) {
      const id = ++nextTimerId;
      timers.set(id, callback);
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    }
  });
  const button = document.getElementById('exit');
  const otherButton = document.getElementById('other');
  const canvas = document.querySelector('.control-particle-canvas');
  const canvasResizes = [];
  let canvasWidth = canvas.width;
  let canvasHeight = canvas.height;
  Object.defineProperties(canvas, {
    width: {
      configurable: true,
      get: () => canvasWidth,
      set(value) {
        canvasWidth = value;
        canvasResizes.push(['width', value]);
      }
    },
    height: {
      configurable: true,
      get: () => canvasHeight,
      set(value) {
        canvasHeight = value;
        canvasResizes.push(['height', value]);
      }
    }
  });
  button.getBoundingClientRect = () => ({
    left: 40,
    top: 72,
    width: 120,
    height: 48,
    right: 160,
    bottom: 120,
    x: 40,
    y: 72,
    toJSON() { return this; }
  });
  otherButton.getBoundingClientRect = () => ({
    left: 220,
    top: 680,
    width: 96,
    height: 48,
    right: 316,
    bottom: 728,
    x: 220,
    y: 680,
    toJSON() { return this; }
  });
  return {
    dom,
    document,
    button,
    otherButton,
    dissolver,
    context,
    canvasResizes,
    frames,
    cancelledFrames,
    timers,
    setClock(value) { clock = value; },
    runTimers() {
      [...timers.values()].forEach((callback) => callback());
    }
  };
};

test('pointer activation hands the disappearing button to one ghost and restores visibility', () => {
  const harness = createHarness();
  harness.button.style.visibility = 'visible';
  harness.button.dispatchEvent(new harness.dom.window.MouseEvent('click', {
    bubbles: true,
    detail: 1,
    clientX: 82,
    clientY: 96
  }));

  assert.equal(harness.button.style.visibility, 'hidden');
  assert.equal(harness.button.hasAttribute('data-particle-exiting'), true);
  assert.equal(harness.document.querySelectorAll('.control-particle-ghost').length, 1);
  assert.equal(harness.document.querySelector('.control-particle-layer').hidden, false);
  assert.ok(harness.dissolver.getState().particleCount > 0);

  harness.button.dispatchEvent(new harness.dom.window.MouseEvent('click', {
    bubbles: true,
    detail: 1,
    clientX: 82,
    clientY: 96
  }));
  assert.equal(harness.document.querySelectorAll('.control-particle-ghost').length, 1);

  harness.runTimers();
  assert.equal(harness.button.style.visibility, 'visible');
  assert.equal(harness.button.hasAttribute('data-particle-exiting'), false);
  assert.equal(harness.document.querySelectorAll('.control-particle-ghost').length, 0);
});

test('keyboard activation and ordinary buttons do not create particle exits', () => {
  const harness = createHarness();
  harness.button.click();
  harness.document.getElementById('plain').dispatchEvent(new harness.dom.window.MouseEvent('click', {
    bubbles: true,
    detail: 1
  }));

  assert.equal(harness.button.style.visibility, '');
  assert.equal(harness.dissolver.getState().activeGhosts, 0);
  assert.equal(harness.dissolver.getState().particleCount, 0);
});

test('a new dissolve retargets a pending frame without dropping active particles', () => {
  const harness = createHarness();
  harness.button.dispatchEvent(new harness.dom.window.MouseEvent('click', {
    bubbles: true,
    detail: 1,
    clientX: 82,
    clientY: 96
  }));
  const firstCount = harness.dissolver.getState().particleCount;
  assert.equal(harness.frames.length, 1);

  harness.otherButton.dispatchEvent(new harness.dom.window.MouseEvent('click', {
    bubbles: true,
    detail: 1,
    clientX: 260,
    clientY: 704
  }));

  assert.deepEqual(harness.cancelledFrames, [1]);
  assert.equal(harness.frames.length, 2);
  assert.equal(harness.dissolver.getState().activeGhosts, 2);
  assert.ok(harness.dissolver.getState().particleCount > firstCount);
});

test('unchanged viewport dimensions reuse the canvas and real frames never rewind the burst', () => {
  const harness = createHarness();
  harness.button.dispatchEvent(new harness.dom.window.MouseEvent('click', {
    bubbles: true,
    detail: 1,
    clientX: 82,
    clientY: 96
  }));

  const synchronousDraws = harness.context.drawImageCount;
  assert.ok(synchronousDraws > 0);
  assert.deepEqual(harness.canvasResizes, []);

  harness.setClock(116);
  harness.frames[0](116);
  assert.ok(harness.context.drawImageCount > synchronousDraws);
});

test('reduce profile suppresses particles while switching to reduce clears active ghosts', () => {
  const harness = createHarness('full');
  harness.button.dispatchEvent(new harness.dom.window.MouseEvent('click', {
    bubbles: true,
    detail: 1,
    clientX: 82,
    clientY: 96
  }));
  assert.equal(harness.dissolver.getState().activeGhosts, 1);

  harness.dissolver.setProfile('reduce');
  assert.equal(harness.button.style.visibility, '');
  assert.equal(harness.dissolver.getState().activeGhosts, 0);
  assert.equal(harness.dissolver.getState().particleCount, 0);

  harness.button.dispatchEvent(new harness.dom.window.MouseEvent('click', {
    bubbles: true,
    detail: 1,
    clientX: 82,
    clientY: 96
  }));
  assert.equal(harness.dissolver.getState().activeGhosts, 0);
});

test('transient mobile viewport height changes preserve an active dissolve', () => {
  const harness = createHarness();
  harness.button.dispatchEvent(new harness.dom.window.MouseEvent('click', {
    bubbles: true,
    detail: 1,
    clientX: 82,
    clientY: 96
  }));
  assert.equal(harness.dissolver.getState().activeGhosts, 1);

  Object.defineProperty(harness.dom.window, 'innerHeight', { configurable: true, value: 700 });
  const drawsBeforeResize = harness.context.drawImageCount;
  harness.dom.window.dispatchEvent(new harness.dom.window.Event('resize'));
  assert.equal(harness.dissolver.getState().activeGhosts, 1);
  assert.deepEqual(harness.canvasResizes.map(([property]) => property), ['height']);
  assert.ok(harness.context.drawImageCount > drawsBeforeResize);

  Object.defineProperty(harness.dom.window, 'innerWidth', { configurable: true, value: 640 });
  harness.dom.window.dispatchEvent(new harness.dom.window.Event('resize'));
  assert.equal(harness.dissolver.getState().activeGhosts, 0);
});

test('destroy removes the capture layer and restores an in-flight control', () => {
  const harness = createHarness();
  harness.button.dispatchEvent(new harness.dom.window.MouseEvent('click', {
    bubbles: true,
    detail: 1,
    clientX: 82,
    clientY: 96
  }));

  harness.dissolver.destroy();
  assert.equal(harness.button.style.visibility, '');
  assert.equal(harness.document.querySelector('.control-particle-layer'), null);
  assert.deepEqual(harness.dissolver.getState(), {
    profile: 'compact',
    particleCount: 0,
    activeGhosts: 0,
    animating: false,
    destroyed: true,
    canvasConnected: false
  });
});
