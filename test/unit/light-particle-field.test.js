import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  PARTICLE_PROFILES,
  createLightParticleField
} from '../../src/ui/light-particle-field.js';

const createContext = () => {
  const calls = [];
  let fillStyle = '';
  let strokeStyle = '';
  const context = {
    calls,
    setTransform: (...args) => calls.push(['setTransform', ...args]),
    clearRect: (...args) => calls.push(['clearRect', ...args]),
    beginPath: () => calls.push(['beginPath']),
    arc: (...args) => calls.push(['arc', ...args]),
    fill: () => calls.push(['fill']),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    stroke: () => calls.push(['stroke'])
  };
  Object.defineProperties(context, {
    fillStyle: {
      get: () => fillStyle,
      set(value) {
        fillStyle = value;
        calls.push(['fillStyle', value]);
      }
    },
    strokeStyle: {
      get: () => strokeStyle,
      set(value) {
        strokeStyle = value;
        calls.push(['strokeStyle', value]);
      }
    }
  });
  return context;
};

const renderedFrames = (calls) => {
  const frames = [];
  let frame = null;
  for (const call of calls) {
    if (call[0] === 'clearRect') {
      if (frame?.some(([name]) => name === 'arc')) frames.push(frame);
      frame = [];
      continue;
    }
    frame?.push(call);
  }
  if (frame?.some(([name]) => name === 'arc')) frames.push(frame);
  return frames;
};

const renderFingerprint = (frame) => frame.filter(([name]) => (
  name === 'arc'
  || name === 'moveTo'
  || name === 'lineTo'
  || name === 'fillStyle'
  || name === 'strokeStyle'
));

const lastRenderFingerprint = (calls) => renderFingerprint(renderedFrames(calls).at(-1));

const createScheduler = () => {
  let nextId = 1;
  const pending = new Map();

  return {
    requestFrame(callback) {
      const id = nextId;
      nextId += 1;
      pending.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      pending.delete(id);
    },
    step(timestamp) {
      const entries = [...pending.values()];
      pending.clear();
      for (const callback of entries) callback(timestamp);
    },
    takeCallbacks() {
      const entries = [...pending.values()];
      pending.clear();
      return entries;
    },
    get pendingCount() {
      return pending.size;
    }
  };
};

const createFixture = ({ width = 320, height = 180, dpr = 3 } = {}) => {
  const dom = new JSDOM('<canvas data-phase="idle"></canvas>');
  const { document } = dom.window;
  const canvas = document.querySelector('canvas');
  const context = createContext();
  const scheduler = createScheduler();
  let hidden = false;

  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden
  });
  Object.defineProperty(dom.window, 'devicePixelRatio', {
    configurable: true,
    value: dpr
  });
  canvas.getContext = () => context;
  canvas.getBoundingClientRect = () => ({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 10 + width,
    bottom: 20 + height,
    width,
    height
  });

  return {
    dom,
    document,
    canvas,
    context,
    scheduler,
    setHidden(value) {
      hidden = value;
      document.dispatchEvent(new dom.window.Event('visibilitychange'));
    }
  };
};

const createField = (fixture, profile = 'compact') => createLightParticleField({
  canvas: fixture.canvas,
  documentRef: fixture.document,
  windowRef: fixture.dom.window,
  profile,
  random: () => 0.375,
  requestFrame: fixture.scheduler.requestFrame,
  cancelFrame: fixture.scheduler.cancelFrame
});

const runToIdle = async (fixture, promise, { start = 0, step = 50 } = {}) => {
  let timestamp = start;
  let guard = 0;
  while (fixture.scheduler.pendingCount > 0) {
    fixture.scheduler.step(timestamp);
    timestamp += step;
    guard += 1;
    assert.ok(guard < 20, 'animation should settle in a finite number of frames');
  }
  await promise;
};

test('exports exact frozen profiles and caps backing-store DPR', () => {
  assert.deepEqual(PARTICLE_PROFILES, {
    full: { count: 64, dpr: 1.5, gatherMs: 160, scatterMs: 140 },
    compact: { count: 28, dpr: 1.25, gatherMs: 100, scatterMs: 90 },
    reduce: { count: 0, dpr: 1, gatherMs: 0, scatterMs: 0 }
  });
  assert.equal(Object.isFrozen(PARTICLE_PROFILES), true);
  assert.equal(Object.isFrozen(PARTICLE_PROFILES.full), true);
  assert.equal(Object.isFrozen(PARTICLE_PROFILES.compact), true);
  assert.equal(Object.isFrozen(PARTICLE_PROFILES.reduce), true);

  const fullFixture = createFixture({ width: 200, height: 100, dpr: 3 });
  const full = createField(fullFixture, 'full');
  assert.equal(fullFixture.canvas.width, 300);
  assert.equal(fullFixture.canvas.height, 150);
  assert.deepEqual(full.getState(), {
    profile: 'full', particleCount: 0, dpr: 1.5, animating: false, destroyed: false
  });
  assert.deepEqual(
    fullFixture.context.calls.find(([name]) => name === 'setTransform'),
    ['setTransform', 1.5, 0, 0, 1.5, 0, 0]
  );
  const clearStart = fullFixture.context.calls.length;
  full.clear();
  assert.deepEqual(fullFixture.context.calls.slice(clearStart), [
    ['setTransform', 1, 0, 0, 1, 0, 0],
    ['clearRect', 0, 0, 300, 150],
    ['setTransform', 1.5, 0, 0, 1.5, 0, 0]
  ]);

  const compactFixture = createFixture({ width: 200, height: 100, dpr: 3 });
  const compact = createField(compactFixture, 'compact');
  assert.equal(compactFixture.canvas.width, 250);
  assert.equal(compactFixture.canvas.height, 125);
  assert.equal(compact.getState().dpr, 1.25);

  full.destroy();
  compact.destroy();
});

test('gather renders 64 bounded particles and retains its final pixels without an idle frame', async () => {
  const fixture = createFixture();
  const field = createField(fixture, 'full');
  const gathering = field.gather({ left: -50, top: 40, right: 500, bottom: 150 });

  assert.deepEqual(field.getState(), {
    profile: 'full', particleCount: 64, dpr: 1.5, animating: true, destroyed: false
  });
  assert.equal(fixture.scheduler.pendingCount, 1);
  assert.equal(fixture.canvas.dataset.phase, 'gather');

  await runToIdle(fixture, gathering, { step: 45 });

  assert.ok(fixture.context.calls.some(([name]) => name === 'arc'));
  assert.ok(fixture.context.calls.some(([name]) => name === 'lineTo'));
  const coordinates = fixture.context.calls
    .filter(([name]) => name === 'arc' || name === 'moveTo' || name === 'lineTo')
    .flatMap(([, x, y]) => [x, y]);
  assert.ok(coordinates.every(Number.isFinite));
  assert.equal(fixture.scheduler.pendingCount, 0);
  assert.equal(fixture.canvas.dataset.phase, 'gathered');
  assert.ok(Number(fixture.canvas.dataset.frameCount) > 0);
  assert.equal(field.getState().animating, false);
  assert.equal(field.getState().particleCount, 64);
  assert.equal(renderedFrames(fixture.context.calls).at(-1).filter(([name]) => name === 'arc').length, 64);
  field.destroy();
});

test('scatter starts from the exact gathered render and only then clears on settlement', async () => {
  const fixture = createFixture();
  const field = createField(fixture, 'compact');
  const gathering = field.gather({ left: 60, top: 50, width: 100, height: 80 });
  fixture.scheduler.step(0);
  fixture.scheduler.step(PARTICLE_PROFILES.compact.gatherMs);
  await gathering;
  assert.equal(fixture.canvas.dataset.phase, 'gathered');
  assert.equal(field.getState().animating, false);
  assert.equal(fixture.scheduler.pendingCount, 0, 'gathered particles must not keep an idle RAF');
  const gatheredFingerprint = lastRenderFingerprint(fixture.context.calls);
  const gatheredFrameCount = renderedFrames(fixture.context.calls).length;

  const scattering = field.scatter({ left: 60, top: 50, width: 100, height: 80 });
  fixture.scheduler.step(PARTICLE_PROFILES.compact.gatherMs);
  const scatterFrames = renderedFrames(fixture.context.calls);
  assert.deepEqual(renderFingerprint(scatterFrames[gatheredFrameCount]), gatheredFingerprint);
  assert.equal(field.getState().particleCount, 28);
  assert.equal(fixture.scheduler.pendingCount, 1);
  assert.equal(fixture.canvas.dataset.phase, 'scatter');

  await runToIdle(fixture, scattering, {
    start: PARTICLE_PROFILES.compact.gatherMs + 30,
    step: 30
  });
  assert.ok(fixture.context.calls.filter(([name]) => name === 'stroke').length >= 28);
  assert.equal(fixture.scheduler.pendingCount, 0);
  assert.equal(fixture.canvas.dataset.phase, 'idle');
  const lastClearIndex = fixture.context.calls.findLastIndex(([name]) => name === 'clearRect');
  assert.equal(fixture.context.calls.slice(lastClearIndex + 1).some(([name]) => name === 'arc'), false);
  field.destroy();
});

test('reduce, clear, render failure, profile replacement, and destroy erase and settle work', async () => {
  const cases = [
    ['clear', (field) => field.clear()],
    ['reduce', (field) => field.setProfile('reduce')],
    ['replacement', (field) => field.setProfile('full')],
    ['destroy', (field) => field.destroy()]
  ];

  for (const [, cancel] of cases) {
    const fixture = createFixture();
    const field = createField(fixture, 'compact');
    const pending = field.gather({ left: 60, top: 50, width: 100, height: 80 });
    fixture.scheduler.step(0);
    cancel(field);
    await pending;
    assert.equal(fixture.scheduler.pendingCount, 0);
    assert.equal(fixture.canvas.dataset.phase, 'idle');
    assert.equal(field.getState().animating, false);
    if (!field.getState().destroyed) field.destroy();
  }

  const failureFixture = createFixture();
  const originalArc = failureFixture.context.arc;
  failureFixture.context.arc = (...args) => {
    originalArc(...args);
    throw new Error('render failed');
  };
  const failureField = createField(failureFixture, 'compact');
  const failed = failureField.gather({ left: 60, top: 50, width: 100, height: 80 });
  assert.doesNotThrow(() => failureFixture.scheduler.step(0));
  await failed;
  assert.equal(failureFixture.scheduler.pendingCount, 0);
  assert.equal(failureFixture.canvas.dataset.phase, 'idle');
  assert.equal(failureField.getState().animating, false);
  failureField.destroy();
});

test('a copied stale frame cannot mutate or duplicate a replacement command frame', async () => {
  const fixture = createFixture();
  const field = createField(fixture, 'compact');
  const gathering = field.gather({ left: 60, top: 50, width: 100, height: 80 });
  const [staleFrame] = fixture.scheduler.takeCallbacks();
  assert.equal(typeof staleFrame, 'function');

  const scattering = field.scatter({ left: 60, top: 50, width: 100, height: 80 });
  await gathering;
  assert.equal(fixture.scheduler.pendingCount, 1);

  staleFrame(500);
  assert.equal(fixture.scheduler.pendingCount, 1, 'stale callback must leave the valid frame untouched');
  assert.equal(fixture.canvas.dataset.frameCount, '0');
  assert.equal(fixture.canvas.dataset.phase, 'scatter');

  field.destroy();
  await scattering;
  assert.equal(fixture.scheduler.pendingCount, 0);
});

test('each animated command refreshes CSS size and DPR before creating particles', async () => {
  const fixture = createFixture({ width: 200, height: 100, dpr: 1 });
  const field = createField(fixture, 'full');
  assert.equal(fixture.canvas.width, 200);
  assert.equal(field.getState().dpr, 1);

  fixture.canvas.getBoundingClientRect = () => ({
    x: 30,
    y: 40,
    left: 30,
    top: 40,
    right: 153.4,
    bottom: 107.6,
    width: 123.4,
    height: 67.6
  });
  Object.defineProperty(fixture.dom.window, 'devicePixelRatio', {
    configurable: true,
    value: 3
  });

  const gathering = field.gather({ left: 50, top: 50, width: 80, height: 40 });
  assert.equal(fixture.canvas.width, 185);
  assert.equal(fixture.canvas.height, 101);
  assert.equal(field.getState().dpr, 1.5);
  assert.equal(field.getState().particleCount, 64);

  field.destroy();
  await gathering;
});

test('visibility pause cancels its frame and excludes hidden wall time on one-frame resume', async () => {
  const fixture = createFixture();
  const field = createField(fixture, 'compact');
  const gathering = field.gather({ left: 60, top: 50, width: 100, height: 80 });

  fixture.scheduler.step(0);
  fixture.scheduler.step(40);
  fixture.setHidden(true);
  assert.equal(fixture.scheduler.pendingCount, 0);

  fixture.setHidden(false);
  fixture.setHidden(false);
  assert.equal(fixture.scheduler.pendingCount, 1);
  fixture.scheduler.step(1040);
  assert.equal(field.getState().animating, true, 'hidden wall time must not complete the animation');
  assert.equal(fixture.scheduler.pendingCount, 1);
  fixture.scheduler.step(1090);
  assert.equal(field.getState().animating, true);
  fixture.scheduler.step(1100);

  await gathering;
  assert.equal(fixture.scheduler.pendingCount, 0);
  assert.equal(fixture.canvas.dataset.phase, 'gathered');
  field.destroy();
});

test('reduce schedules no frames and clear erases the complete backing store', async () => {
  const fixture = createFixture({ width: 101, height: 51, dpr: 3 });
  const field = createField(fixture, 'reduce');

  await field.gather({ left: 0, top: 0, right: 10, bottom: 10 });
  await field.scatter({ left: 0, top: 0, right: 10, bottom: 10 });
  assert.equal(field.getState().particleCount, 0);
  assert.equal(fixture.scheduler.pendingCount, 0);

  field.clear();
  assert.ok(fixture.context.calls.some((call) => (
    call[0] === 'clearRect' && call[1] === 0 && call[2] === 0 && call[3] === 101 && call[4] === 51
  )));
  field.destroy();
});

test('finish, clear, and destroy settle promises and destroy has an exact terminal state', async () => {
  const fixture = createFixture({ width: 200, height: 100, dpr: 3 });
  const field = createField(fixture, 'full');
  field.setProfile('compact');
  assert.equal(fixture.canvas.width, 250);
  assert.equal(fixture.canvas.height, 125);

  const finished = field.gather({ left: 20, top: 30, width: 40, height: 50 });
  field.finish();
  await finished;
  const cleared = field.scatter({ left: 20, top: 30, width: 40, height: 50 });
  field.clear();
  await cleared;
  const destroyed = field.gather({ left: 20, top: 30, width: 40, height: 50 });
  field.destroy();
  await destroyed;
  assert.equal(fixture.scheduler.pendingCount, 0);
  field.destroy();

  assert.equal(fixture.canvas.width, 0);
  assert.equal(fixture.canvas.height, 0);
  assert.deepEqual(field.getState(), {
    profile: 'compact', particleCount: 0, dpr: 1.25, animating: false, destroyed: true
  });
});

test('rejects unknown profiles and missing 2D contexts', () => {
  const fixture = createFixture();
  assert.throws(() => createField(fixture, 'unknown'), /Unknown particle profile/);
  fixture.canvas.getContext = () => null;
  assert.throws(() => createField(fixture), /2D canvas context/);
  assert.throws(() => createLightParticleField({ canvas: null }), /canvas/);
});
