import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  PARTICLE_PROFILES,
  createLightParticleField
} from '../../src/ui/light-particle-field.js';

const createSpriteContext = () => {
  const calls = [];
  let fillStyle = '';
  const gradient = {
    addColorStop: (...args) => calls.push(['addColorStop', ...args])
  };
  const context = {
    calls,
    createRadialGradient: (...args) => {
      calls.push(['createRadialGradient', ...args]);
      return gradient;
    },
    fillRect: (...args) => calls.push(['fillRect', ...args])
  };
  Object.defineProperty(context, 'fillStyle', {
    get: () => fillStyle,
    set(value) {
      fillStyle = value;
      calls.push(['fillStyle', value]);
    }
  });
  return context;
};

const createContext = () => {
  const calls = [];
  let fillStyle = '';
  let globalAlpha = 1;
  let globalCompositeOperation = 'source-over';
  let hasPixels = false;
  const context = {
    calls,
    setTransform: (...args) => calls.push(['setTransform', ...args]),
    clearRect: (...args) => {
      hasPixels = false;
      calls.push(['clearRect', ...args]);
    },
    beginPath: () => calls.push(['beginPath']),
    arc: (...args) => calls.push(['arc', ...args]),
    fill: () => {
      if (globalAlpha > 0) hasPixels = true;
      calls.push(['fill']);
    },
    drawImage: (...args) => {
      if (globalAlpha > 0) hasPixels = true;
      calls.push(['drawImage', ...args]);
    },
    resetBackingStore(property, value) {
      hasPixels = false;
      calls.push(['backingStoreReset', property, value]);
    }
  };
  Object.defineProperties(context, {
    fillStyle: {
      get: () => fillStyle,
      set(value) {
        fillStyle = value;
        calls.push(['fillStyle', value]);
      }
    },
    globalAlpha: {
      get: () => globalAlpha,
      set(value) {
        globalAlpha = value;
        calls.push(['globalAlpha', value]);
      }
    },
    globalCompositeOperation: {
      get: () => globalCompositeOperation,
      set(value) {
        globalCompositeOperation = value;
        calls.push(['globalCompositeOperation', value]);
      }
    },
    hasPixels: {
      get: () => hasPixels
    }
  });
  return context;
};

const isPointDraw = ([name]) => name === 'drawImage' || name === 'arc';

const renderedFrames = (calls) => {
  const frames = [];
  let frame = null;
  for (const call of calls) {
    if (call[0] === 'clearRect') {
      if (frame?.some(isPointDraw)) frames.push(frame);
      frame = [];
      continue;
    }
    frame?.push(call);
  }
  if (frame?.some(isPointDraw)) frames.push(frame);
  return frames;
};

const pointCenters = (frame) => frame.filter(isPointDraw).map((call) => {
  if (call[0] === 'arc') return [call[1], call[2]];
  const [, , x, y, width, height] = call;
  return [x + (width / 2), y + (height / 2)];
});

const frameAlphas = (frame) => frame
  .filter(([name]) => name === 'globalAlpha')
  .map(([, alpha]) => alpha);

const assertTerminalClear = (calls, label) => {
  const lastClearIndex = calls.findLastIndex(([name]) => name === 'clearRect');
  assert.notEqual(lastClearIndex, -1, `${label} must clear the Canvas`);
  const drawing = new Set(['arc', 'fill', 'drawImage']);
  assert.equal(
    calls.slice(lastClearIndex + 1).some(([name]) => drawing.has(name)),
    false,
    `${label} must not draw after its final clear`
  );
};

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
  const spriteContexts = [];
  const spriteCanvases = [];
  const nativeCreateElement = document.createElement.bind(document);
  let hidden = false;
  let cssWidth = width;
  let cssHeight = height;
  let backingWidth = canvas.width;
  let backingHeight = canvas.height;
  const backingWrites = [];

  document.createElement = (name, options) => {
    const element = nativeCreateElement(name, options);
    if (String(name).toLowerCase() !== 'canvas') return element;
    const spriteContext = createSpriteContext();
    element.getContext = () => spriteContext;
    spriteContexts.push(spriteContext);
    spriteCanvases.push(element);
    return element;
  };
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden
  });
  Object.defineProperty(dom.window, 'devicePixelRatio', {
    configurable: true,
    value: dpr
  });
  canvas.getContext = () => context;
  Object.defineProperties(canvas, {
    width: {
      configurable: true,
      get: () => backingWidth,
      set(value) {
        backingWidth = Number(value);
        backingWrites.push(['width', backingWidth]);
        context.resetBackingStore('width', backingWidth);
      }
    },
    height: {
      configurable: true,
      get: () => backingHeight,
      set(value) {
        backingHeight = Number(value);
        backingWrites.push(['height', backingHeight]);
        context.resetBackingStore('height', backingHeight);
      }
    }
  });
  canvas.getBoundingClientRect = () => ({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 10 + cssWidth,
    bottom: 20 + cssHeight,
    width: cssWidth,
    height: cssHeight
  });

  return {
    dom,
    document,
    canvas,
    backingWrites,
    context,
    scheduler,
    spriteCanvases,
    spriteContexts,
    setSize(nextWidth, nextHeight) {
      cssWidth = nextWidth;
      cssHeight = nextHeight;
    },
    setHidden(value) {
      hidden = value;
      document.dispatchEvent(new dom.window.Event('visibilitychange'));
    }
  };
};

const createField = (fixture, profile = 'compact', random = () => 0.375) => createLightParticleField({
  canvas: fixture.canvas,
  documentRef: fixture.document,
  windowRef: fixture.dom.window,
  profile,
  random,
  requestFrame: fixture.scheduler.requestFrame,
  cancelFrame: fixture.scheduler.cancelFrame
});

const runToIdle = async (fixture, promises, { start = 0, step = 25 } = {}) => {
  let timestamp = start;
  let guard = 0;
  while (fixture.scheduler.pendingCount > 0) {
    fixture.scheduler.step(timestamp);
    timestamp += step;
    guard += 1;
    assert.ok(guard < 80, 'animation should settle in a finite number of frames');
  }
  await Promise.all(Array.isArray(promises) ? promises : [promises]);
};

test('exports exact frozen pool profiles, caches radial sprites, and caps DPR at one', () => {
  assert.deepEqual(PARTICLE_PROFILES, {
    full: {
      count: 320,
      holdCount: 112,
      holdRampMs: 240,
      holdBirthCap: 8,
      dpr: 1,
      gatherMs: 160,
      scatterMs: 140,
      holdMs: 500
    },
    compact: {
      count: 180,
      holdCount: 64,
      holdRampMs: 220,
      holdBirthCap: 5,
      dpr: 1,
      gatherMs: 100,
      scatterMs: 90,
      holdMs: 440
    },
    reduce: {
      count: 0,
      holdCount: 0,
      holdRampMs: 0,
      holdBirthCap: 0,
      dpr: 1,
      gatherMs: 0,
      scatterMs: 0,
      holdMs: 0
    }
  });
  assert.equal(Object.isFrozen(PARTICLE_PROFILES), true);
  assert.equal(Object.isFrozen(PARTICLE_PROFILES.full), true);

  const fixture = createFixture({ width: 200, height: 100, dpr: 4 });
  const field = createField(fixture, 'full');
  assert.equal(fixture.canvas.width, 200);
  assert.equal(fixture.canvas.height, 100);
  assert.equal(field.getState().dpr, 1);
  assert.equal(fixture.spriteContexts.length, 2);
  for (const spriteContext of fixture.spriteContexts) {
    assert.equal(spriteContext.calls.filter(([name]) => name === 'createRadialGradient').length, 1);
    assert.deepEqual(
      spriteContext.calls
        .filter(([name]) => name === 'addColorStop')
        .map(([, stop]) => stop),
      [0.025, 0.1, 0.25, 1]
    );
  }
  assert.deepEqual(field.getState(), {
    profile: 'full', particleCount: 0, dpr: 1, animating: false, destroyed: false
  });
  assert.equal(typeof field.gather, 'function');
  assert.equal(typeof field.scatter, 'function');
  assert.equal(typeof field.hold, 'function');
  field.destroy();
});

test('a portal burst uses the full fixed pool, one RAF, additive sprites, and bounded seam origins', async () => {
  const fixture = createFixture();
  const field = createField(fixture, 'full', () => 0.5);
  const gathering = field.gather({ left: 60, top: 50, right: 160, bottom: 50 }, 120);

  assert.equal(field.getState().particleCount, 320);
  assert.equal(fixture.scheduler.pendingCount, 1);
  assert.equal(fixture.canvas.dataset.phase, 'gather');
  fixture.scheduler.step(0);
  const firstFrame = renderedFrames(fixture.context.calls).at(-1);
  const points = pointCenters(firstFrame);
  assert.equal(points.length, 320);
  assert.ok(points.every(([x, y]) => x >= 50 && x <= 150 && Math.abs(y - 30) < 1.31));
  assert.ok(frameAlphas(firstFrame).every(Number.isFinite));
  assert.ok(fixture.context.calls.some(([name, value]) => (
    name === 'globalCompositeOperation' && value === 'lighter'
  )));
  assert.equal(fixture.context.globalCompositeOperation, 'source-over');
  assert.equal(fixture.scheduler.pendingCount, 1);

  await runToIdle(fixture, gathering, { start: 30, step: 30 });
  assert.equal(field.getState().particleCount, 0);
  assert.equal(fixture.canvas.dataset.phase, 'idle');
  assert.equal(fixture.context.hasPixels, false);
  assertTerminalClear(fixture.context.calls, 'settled burst');
  field.destroy();
});

test('trajectory options keep slit particles and poster-edge trail particles in one simulation', async () => {
  const fixture = createFixture();
  const field = createField(fixture, 'compact', () => 0.5);
  const bounds = { left: 60, top: 130, right: 160, bottom: 130 };
  const scattering = field.scatter(bounds, 160, {
    trajectory: {
      distance: 60,
      duration: 160,
      easing: { sample: (progress) => progress, derivative: () => 1 },
      side: 'bottom'
    }
  });

  assert.equal(field.getState().particleCount, 126);
  fixture.scheduler.step(0);
  const firstPoints = pointCenters(renderedFrames(fixture.context.calls).at(-1));
  assert.equal(firstPoints.filter(([, y]) => Math.abs(y - 110) < 1.31).length, 116);
  assert.equal(firstPoints.filter(([, y]) => Math.abs(y - 50) < 0.01).length, 10);

  fixture.scheduler.step(24);
  const movingPoints = pointCenters(renderedFrames(fixture.context.calls).at(-1));
  assert.ok(
    movingPoints.some(([, y]) => y > 50.5 && y < 80),
    'bottom-exit trail inherits the poster downward velocity'
  );
  assert.ok(
    movingPoints.some(([, y]) => y < 109),
    'bottom slit particles simultaneously stream inward from the seam'
  );
  assert.ok(field.getState().particleCount <= 180);

  await runToIdle(fixture, scattering, { start: 48, step: 24 });
  field.destroy();
});

test('caller easing derivative changes inherited trajectory speed without changing its direction', async () => {
  const sampleTrailY = (derivative) => {
    const fixture = createFixture();
    const field = createField(fixture, 'compact', () => 0.5);
    const pending = field.scatter(
      { left: 60, top: 130, right: 160, bottom: 130 },
      200,
      {
        trajectory: {
          distance: 80,
          duration: 200,
          side: 'bottom',
          easing: { sample: (progress) => progress, derivative: () => derivative }
        }
      }
    );
    fixture.scheduler.step(0);
    fixture.scheduler.step(20);
    const points = pointCenters(renderedFrames(fixture.context.calls).at(-1));
    const trail = points.filter(([, y]) => y < 80);
    const averageY = trail.reduce((sum, [, y]) => sum + y, 0) / trail.length;
    field.finish();
    return { averageY, pending };
  };

  const slow = sampleTrailY(0.35);
  const fast = sampleTrailY(2);
  await Promise.all([slow.pending, fast.pending]);
  assert.ok(Number.isFinite(slow.averageY));
  assert.ok(Number.isFinite(fast.averageY));
  assert.ok(fast.averageY > slow.averageY, 'larger easing velocity produces a faster inherited wake');
});

test('gather, scatter, and hold coexist without clearing and share exactly one RAF under the cap', async () => {
  const fixture = createFixture();
  const field = createField(fixture, 'compact', () => 0.5);
  const bounds = { left: 30, top: 50, right: 90, bottom: 50 };
  let gathered = false;
  const gathering = field.gather(bounds, 200, {
    trajectory: { distance: 70, duration: 200, easing: 'linear', side: 'top' }
  }).then(() => { gathered = true; });
  fixture.scheduler.step(0);
  assert.equal(fixture.context.hasPixels, false, 'birth frame is transparent');
  fixture.scheduler.step(20);
  assert.equal(fixture.context.hasPixels, true);
  const clearCountBeforeOverlap = fixture.context.calls.filter(([name]) => name === 'clearRect').length;

  const scattering = field.scatter(
    { left: 130, top: 130, right: 190, bottom: 130 },
    200,
    { trajectory: { distance: 70, duration: 200, easing: 'linear', side: 'bottom' } }
  );
  const holding = field.hold({ left: 230, top: 50, width: 60, height: 70 }, 200);

  assert.equal(gathered, false, 'starting a new emitter must not settle the first one');
  assert.equal(fixture.canvas.dataset.emitterCount, '3');
  assert.equal(fixture.canvas.dataset.phase, 'mixed');
  assert.equal(fixture.canvas.dataset.portalSide, 'mixed');
  assert.equal(fixture.scheduler.pendingCount, 1, 'all emitters share one scheduled frame');
  assert.equal(
    fixture.context.calls.filter(([name]) => name === 'clearRect').length,
    clearCountBeforeOverlap,
    'adding emitters does not clear the previous composited frame'
  );
  assert.equal(field.getState().particleCount, 180);

  fixture.scheduler.step(40);
  const overlappingPoints = pointCenters(renderedFrames(fixture.context.calls).at(-1));
  assert.ok(overlappingPoints.some(([x]) => x >= 10 && x <= 100), 'gather keeps a live owner quota');
  assert.ok(overlappingPoints.some(([x]) => x >= 110 && x <= 200), 'scatter receives a live owner quota');
  assert.equal(
    overlappingPoints.some(([x]) => x >= 210 && x <= 310),
    false,
    'hold does not evict a full pool of live motion particles to create a one-frame pulse'
  );

  await runToIdle(fixture, [gathering, scattering, holding], { start: 65, step: 25 });
  assert.equal(fixture.canvas.dataset.emitterCount, '0');
  assert.equal(field.getState().particleCount, 0);
  field.destroy();
});

test('hold eases toward its dedicated limit without a one-frame particle jump', async () => {
  for (const [profile, expected, birthCap, rampEnd] of [
    ['full', 112, 8, 320],
    ['compact', 64, 5, 304]
  ]) {
    const fixture = createFixture();
    const field = createField(fixture, profile, () => 0.375);
    const holding = field.hold({ left: 60, top: 50, width: 100, height: 70 }, 500);
    assert.equal(field.getState().particleCount, 0);
    fixture.scheduler.step(0);
    const counts = [field.getState().particleCount];
    for (let timestamp = 16; timestamp <= rampEnd; timestamp += 16) {
      fixture.scheduler.step(timestamp);
      counts.push(field.getState().particleCount);
    }
    const increases = counts.slice(1).map((count, index) => count - counts[index]);
    assert.ok(increases.every((increase) => increase <= birthCap));
    assert.ok(increases.some((increase) => increase > 0));
    assert.equal(Math.max(...counts), expected);
    const points = pointCenters(renderedFrames(fixture.context.calls).at(-1));
    assert.equal(points.length, expected);
    assert.ok(points.every(([, y]) => y > 100), 'hold source remains below the poster bottom');
    await runToIdle(fixture, holding, { start: rampEnd + 32, step: 32 });
    field.destroy();
  }
});

test('pool capacity remains bounded across repeated overlapping emitters', async () => {
  for (const [profile, limit] of [['full', 320], ['compact', 180]]) {
    const fixture = createFixture();
    const field = createField(fixture, profile, () => 0.5);
    const pending = [];
    for (let index = 0; index < 8; index += 1) {
      pending.push(field[index % 2 === 0 ? 'gather' : 'scatter'](
        { left: 50 + index, top: 70, right: 150 + index, bottom: 70 },
        180,
        {
          trajectory: {
            distance: 50,
            duration: 180,
            easing: 'linear',
            side: index % 2 === 0 ? 'top' : 'bottom'
          }
        }
      ));
      assert.ok(field.getState().particleCount <= limit);
      assert.equal(fixture.scheduler.pendingCount, 1);
    }
    fixture.scheduler.step(0);
    for (let timestamp = 20; timestamp <= 180; timestamp += 20) {
      fixture.scheduler.step(timestamp);
      assert.ok(field.getState().particleCount <= limit);
    }
    await runToIdle(fixture, pending, { start: 200, step: 25 });
    field.destroy();
  }
});

test('particle frames reuse sprites and seeded random state when no trajectory emitter is active', async () => {
  let randomCalls = 0;
  const fixture = createFixture();
  const field = createLightParticleField({
    canvas: fixture.canvas,
    documentRef: fixture.document,
    windowRef: fixture.dom.window,
    profile: 'compact',
    random: () => {
      randomCalls += 1;
      return 0.375;
    },
    requestFrame: fixture.scheduler.requestFrame,
    cancelFrame: fixture.scheduler.cancelFrame
  });
  const pending = field.gather({ left: 60, top: 50, width: 100, height: 0 }, 100);
  const callsAfterSeed = randomCalls;
  fixture.scheduler.step(0);
  fixture.scheduler.step(30);
  fixture.scheduler.step(60);
  assert.equal(randomCalls, callsAfterSeed);
  assert.equal(fixture.spriteContexts.length, 2);
  await runToIdle(fixture, pending, { start: 90, step: 30 });
  field.setProfile('full');
  assert.equal(fixture.spriteContexts.length, 2, 'profile changes reuse the cached glow sprites');
  field.destroy();
});

test('resize rescales and redraws an active pool without scheduling another RAF', async () => {
  const fixture = createFixture({ width: 320, height: 180, dpr: 3 });
  const field = createField(fixture, 'compact');
  const pending = field.gather({ left: 60, top: 50, width: 100, height: 0 }, 140);
  fixture.scheduler.step(0);
  fixture.scheduler.step(30);
  const framesBefore = renderedFrames(fixture.context.calls).length;
  const pendingFrames = fixture.scheduler.pendingCount;
  fixture.setSize(160, 90);
  field.resize();

  assert.equal(fixture.canvas.width, 160);
  assert.equal(fixture.canvas.height, 90);
  assert.equal(fixture.scheduler.pendingCount, pendingFrames);
  assert.equal(renderedFrames(fixture.context.calls).length, framesBefore + 1);
  const points = pointCenters(renderedFrames(fixture.context.calls).at(-1));
  assert.ok(points.every(([x, y]) => x >= 0 && x <= 160 && y >= 0 && y <= 90));
  field.finish();
  await pending;
  field.destroy();
});

test('explicit command durations resolve independently while particle tails continue on the shared RAF', async () => {
  const fixture = createFixture();
  const field = createField(fixture, 'compact', () => 0.5);
  let resolved = false;
  const pending = field.gather(
    { left: 60, top: 50, width: 100, height: 0 },
    80,
    { trajectory: { distance: 70, duration: 180, easing: 'linear', side: 'top' } }
  ).then(() => { resolved = true; });
  fixture.scheduler.step(0);
  fixture.scheduler.step(79);
  await Promise.resolve();
  assert.equal(resolved, false);
  fixture.scheduler.step(80);
  await Promise.resolve();
  assert.equal(resolved, true);
  assert.equal(fixture.canvas.dataset.phase, 'gather');
  assert.equal(fixture.canvas.dataset.emitterCount, '1');
  const midTrajectory = pointCenters(renderedFrames(fixture.context.calls).at(-1));
  assert.ok(midTrajectory.some(([, y]) => y > 45 && y < 80));
  assert.ok(midTrajectory.every(([, y]) => y < 92), '180ms trajectory must not finish at 80ms');
  assert.equal(fixture.scheduler.pendingCount, 1);
  await runToIdle(fixture, pending, { start: 105, step: 25 });
  field.destroy();
});

test('visibility loss clears emitters, RAF, Canvas, and pool without restarting on restore', async () => {
  const fixture = createFixture();
  const field = createField(fixture, 'compact');
  const gathering = field.gather(
    { left: 60, top: 50, width: 100, height: 0 },
    200,
    { trajectory: { distance: 60, duration: 200, easing: 'linear', side: 'top' } }
  );
  const holding = field.hold({ left: 60, top: 50, width: 100, height: 70 }, 200);
  fixture.scheduler.step(0);
  fixture.scheduler.step(30);
  fixture.setHidden(true);
  await Promise.all([gathering, holding]);
  const framesAtHide = Number(fixture.canvas.dataset.frameCount);

  assert.equal(fixture.scheduler.pendingCount, 0);
  assert.equal(fixture.canvas.dataset.phase, 'idle');
  assert.equal(fixture.canvas.dataset.emitterCount, '0');
  assert.equal(field.getState().particleCount, 0);
  assert.equal(fixture.context.hasPixels, false);
  fixture.setHidden(false);
  assert.equal(fixture.scheduler.pendingCount, 0);
  assert.equal(Number(fixture.canvas.dataset.frameCount), framesAtHide);
  field.destroy();
});

test('fixed substeps keep particle displacement coherent across a 160ms dropped frame', async () => {
  const smoothFixture = createFixture();
  const stalledFixture = createFixture();
  const smoothField = createField(smoothFixture, 'compact', () => 0.5);
  const stalledField = createField(stalledFixture, 'compact', () => 0.5);
  const bounds = { left: 60, top: 50, width: 100, height: 0 };
  const smoothPending = smoothField.gather(bounds, 400);
  const stalledPending = stalledField.gather(bounds, 400);

  smoothFixture.scheduler.step(0);
  stalledFixture.scheduler.step(0);
  for (const timestamp of [32, 64, 96, 128, 160]) smoothFixture.scheduler.step(timestamp);
  stalledFixture.scheduler.step(160);

  const smoothPoint = pointCenters(renderedFrames(smoothFixture.context.calls).at(-1))[0];
  const stalledPoint = pointCenters(renderedFrames(stalledFixture.context.calls).at(-1))[0];
  assert.ok(Math.abs(smoothPoint[0] - stalledPoint[0]) < 0.001);
  assert.ok(Math.abs(smoothPoint[1] - stalledPoint[1]) < 0.001);
  assert.equal(smoothFixture.canvas.dataset.frameCount, '0', 'frame diagnostics are not written in RAF');
  assert.equal(stalledFixture.canvas.dataset.frameCount, '0', 'dropped frame does not force DOM writes');

  smoothField.finish();
  stalledField.finish();
  await Promise.all([smoothPending, stalledPending]);
  assert.ok(Number(smoothFixture.canvas.dataset.frameCount) > 0);
  assert.ok(Number(stalledFixture.canvas.dataset.frameCount) > 0);
  smoothField.destroy();
  stalledField.destroy();
});

test('reduce, finish, clear, profile replacement, and render failures settle and erase all work', async () => {
  const reducedFixture = createFixture({ width: 101, height: 51, dpr: 4 });
  const reduced = createField(reducedFixture, 'reduce');
  await reduced.gather({ left: 0, top: 0, right: 10, bottom: 10 });
  await reduced.scatter({ left: 0, top: 0, right: 10, bottom: 10 });
  await reduced.hold({ left: 0, top: 0, right: 10, bottom: 10 });
  assert.equal(reducedFixture.scheduler.pendingCount, 0);
  assert.equal(reduced.getState().particleCount, 0);
  reduced.clear();
  assert.ok(reducedFixture.context.calls.some(([name, x, y, width, height]) => (
    name === 'clearRect' && x === 0 && y === 0 && width === 101 && height === 51
  )));
  reduced.destroy();

  for (const [label, settle] of [
    ['finish', (field) => field.finish()],
    ['clear', (field) => field.clear()],
    ['profile replacement', (field) => field.setProfile('full')]
  ]) {
    const fixture = createFixture();
    const field = createField(fixture, 'compact');
    const gathering = field.gather({ left: 60, top: 50, width: 100, height: 0 }, 200);
    const holding = field.hold({ left: 60, top: 50, width: 100, height: 70 }, 200);
    fixture.scheduler.step(0);
    settle(field);
    await Promise.all([gathering, holding]);
    assert.equal(fixture.scheduler.pendingCount, 0);
    assert.equal(field.getState().particleCount, 0);
    assert.equal(field.getState().animating, false);
    assertTerminalClear(fixture.context.calls, label);
    field.destroy();
  }

  const failureFixture = createFixture();
  const originalDrawImage = failureFixture.context.drawImage;
  failureFixture.context.drawImage = (...args) => {
    originalDrawImage(...args);
    throw new Error('render failed');
  };
  const failedField = createField(failureFixture, 'compact');
  const failed = failedField.gather({ left: 60, top: 50, width: 100, height: 0 }, 100);
  assert.doesNotThrow(() => failureFixture.scheduler.step(0));
  await failed;
  assert.equal(failureFixture.scheduler.pendingCount, 0);
  assert.equal(failedField.getState().particleCount, 0);
  assertTerminalClear(failureFixture.context.calls, 'render failure');
  failedField.destroy();
});

test('a stale canceled callback cannot mutate a replacement simulation', async () => {
  const fixture = createFixture();
  const field = createField(fixture, 'compact');
  const gathering = field.gather({ left: 60, top: 50, width: 100, height: 0 }, 200);
  const [staleFrame] = fixture.scheduler.takeCallbacks();
  field.finish();
  await gathering;
  const scattering = field.scatter({ left: 60, top: 130, width: 100, height: 0 }, 200);
  assert.equal(fixture.scheduler.pendingCount, 1);
  staleFrame(500);
  assert.equal(fixture.scheduler.pendingCount, 1);
  assert.equal(fixture.canvas.dataset.frameCount, '0');
  assert.equal(fixture.canvas.dataset.phase, 'scatter');
  field.destroy();
  await scattering;
});

test('destroy settles promises and releases Canvas and sprite backing stores', async () => {
  const fixture = createFixture({ width: 200, height: 100, dpr: 3 });
  const field = createField(fixture, 'full');
  const gathering = field.gather({ left: 20, top: 30, width: 40, height: 0 });
  const holding = field.hold({ left: 20, top: 30, width: 40, height: 50 });
  field.destroy();
  await Promise.all([gathering, holding]);
  assert.equal(fixture.scheduler.pendingCount, 0);
  assert.equal(fixture.canvas.width, 0);
  assert.equal(fixture.canvas.height, 0);
  assert.ok(fixture.spriteCanvases.every((sprite) => sprite.width === 0 && sprite.height === 0));
  assert.deepEqual(field.getState(), {
    profile: 'full', particleCount: 0, dpr: 1, animating: false, destroyed: true
  });
  field.destroy();
});

test('rejects unknown profiles and missing 2D contexts', () => {
  const fixture = createFixture();
  assert.throws(() => createField(fixture, 'unknown'), /Unknown particle profile/);
  fixture.canvas.getContext = () => null;
  assert.throws(() => createField(fixture), /2D canvas context/);
  assert.throws(() => createLightParticleField({ canvas: null }), /canvas/);
});
