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
  let strokeStyle = '';
  let globalAlpha = 1;
  let globalCompositeOperation = 'source-over';
  let lineWidth = 1;
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
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    stroke: () => {
      if (globalAlpha > 0) hasPixels = true;
      calls.push(['stroke']);
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
    strokeStyle: {
      get: () => strokeStyle,
      set(value) {
        strokeStyle = value;
        calls.push(['strokeStyle', value]);
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
    lineWidth: {
      get: () => lineWidth,
      set(value) {
        lineWidth = value;
        calls.push(['lineWidth', value]);
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

const frameCoordinates = (frame) => frame.flatMap((call) => {
  if (call[0] === 'drawImage') {
    const [, , x, y, width, height] = call;
    return [x + (width / 2), y + (height / 2)];
  }
  if (call[0] === 'arc' || call[0] === 'moveTo' || call[0] === 'lineTo') {
    return [call[1], call[2]];
  }
  return [];
});

const maxFrameAlpha = (frame) => {
  const alphas = frame
    .filter(([name, value]) => name === 'globalAlpha' && value < 1)
    .map(([, value]) => value);
  return alphas.length > 0 ? Math.max(...alphas) : null;
};

const assertTerminalClear = (calls, label) => {
  const lastClearIndex = calls.findLastIndex(([name]) => name === 'clearRect');
  assert.notEqual(lastClearIndex, -1, `${label} must clear the Canvas`);
  const drawCalls = new Set(['arc', 'fill', 'drawImage', 'moveTo', 'lineTo', 'stroke']);
  assert.equal(
    calls.slice(lastClearIndex + 1).some(([name]) => drawCalls.has(name)),
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

test('exports exact frozen profiles, caches two sprites, and caps backing-store DPR', () => {
  assert.deepEqual(PARTICLE_PROFILES, {
    full: { count: 260, holdCount: 104, dpr: 1, gatherMs: 160, scatterMs: 140, holdMs: 500 },
    compact: { count: 160, holdCount: 68, dpr: 1, gatherMs: 100, scatterMs: 90, holdMs: 440 },
    reduce: { count: 0, holdCount: 0, dpr: 1, gatherMs: 0, scatterMs: 0, holdMs: 0 }
  });
  assert.equal(Object.isFrozen(PARTICLE_PROFILES), true);
  assert.equal(Object.isFrozen(PARTICLE_PROFILES.full), true);
  assert.equal(Object.isFrozen(PARTICLE_PROFILES.compact), true);
  assert.equal(Object.isFrozen(PARTICLE_PROFILES.reduce), true);

  const fullFixture = createFixture({ width: 200, height: 100, dpr: 3 });
  const full = createField(fullFixture, 'full');
  assert.equal(fullFixture.canvas.width, 200);
  assert.equal(fullFixture.canvas.height, 100);
  assert.equal(fullFixture.spriteContexts.length, 2);
  for (const spriteContext of fullFixture.spriteContexts) {
    assert.equal(spriteContext.calls.filter(([name]) => name === 'createRadialGradient').length, 1);
    assert.deepEqual(
      spriteContext.calls
        .filter(([name]) => name === 'addColorStop')
        .map(([, stop]) => stop),
      [0.025, 0.1, 0.25, 1],
      'ScannerCardStream-style sprites keep a pin-white center and broad transparent halo'
    );
    assert.equal(spriteContext.calls.filter(([name]) => name === 'fillRect').length, 1);
  }
  assert.deepEqual(full.getState(), {
    profile: 'full', particleCount: 0, dpr: 1, animating: false, destroyed: false
  });
  assert.equal(typeof full.hold, 'function');
  assert.deepEqual(
    fullFixture.context.calls.find(([name]) => name === 'setTransform'),
    ['setTransform', 1, 0, 0, 1, 0, 0]
  );

  const compactFixture = createFixture({ width: 200, height: 100, dpr: 3 });
  const compact = createField(compactFixture, 'compact');
  assert.equal(compactFixture.canvas.width, 200);
  assert.equal(compactFixture.canvas.height, 100);
  assert.equal(compact.getState().dpr, 1);

  full.destroy();
  compact.destroy();
});

test('gather renders 260 bounded additive scanner sprites and clears at settlement', async () => {
  const fixture = createFixture();
  const field = createField(fixture, 'full');
  const gathering = field.gather({ left: -50, top: 40, right: 500, bottom: 150 });

  assert.deepEqual(field.getState(), {
    profile: 'full', particleCount: 260, dpr: 1, animating: true, destroyed: false
  });
  assert.equal(fixture.scheduler.pendingCount, 1);
  assert.equal(fixture.canvas.dataset.phase, 'gather');

  await runToIdle(fixture, gathering, { step: 45 });

  const frames = renderedFrames(fixture.context.calls);
  assert.ok(frames.length > 1);
  assert.equal(frames[0].filter(([name]) => name === 'drawImage').length, 260);
  const coordinates = frames.flatMap(frameCoordinates);
  assert.ok(coordinates.every(Number.isFinite));
  assert.ok(coordinates.every((coordinate, index) => (
    coordinate >= 0 && coordinate <= (index % 2 === 0 ? 320 : 180)
  )));
  assert.ok(fixture.context.calls.some((call) => (
    call[0] === 'globalCompositeOperation' && call[1] === 'lighter'
  )));
  assert.equal(fixture.context.globalCompositeOperation, 'source-over');
  assert.equal(fixture.scheduler.pendingCount, 0);
  assert.equal(fixture.canvas.dataset.phase, 'idle');
  assert.equal(fixture.canvas.dataset.portalSide, undefined);
  assert.ok(Number(fixture.canvas.dataset.frameCount) > 0);
  assert.deepEqual(field.getState(), {
    profile: 'full', particleCount: 0, dpr: 1, animating: false, destroyed: false
  });
  assert.equal(fixture.context.hasPixels, false);
  assertTerminalClear(fixture.context.calls, 'settled gather');
  field.destroy();
});

test('top gather and bottom scatter are born at their actual seam and stream toward stage center', async () => {
  const fixture = createFixture();
  const field = createLightParticleField({
    canvas: fixture.canvas,
    documentRef: fixture.document,
    windowRef: fixture.dom.window,
    profile: 'compact',
    random: () => 0.5,
    requestFrame: fixture.scheduler.requestFrame,
    cancelFrame: fixture.scheduler.cancelFrame
  });
  const bounds = { left: 60, top: 50, width: 100, height: 80 };

  const gathering = field.gather(bounds, 100, { portalSide: 'top' });
  fixture.scheduler.step(0);
  const gatherStart = pointCenters(renderedFrames(fixture.context.calls).at(-1));
  assert.ok(gatherStart.every(([, y]) => Math.abs(y - 30) < 0.001));
  assert.equal(fixture.canvas.dataset.portalSide, 'top');
  fixture.scheduler.step(100);
  await gathering;
  const gatherEnd = pointCenters(renderedFrames(fixture.context.calls).at(-1));
  assert.ok(gatherEnd.every(([, y]) => Math.abs(y - 98) < 0.001));
  assert.ok(gatherEnd.every(([, y], index) => y > gatherStart[index][1]));
  assert.equal(fixture.context.hasPixels, false);

  const scattering = field.scatter(bounds, 100, { portalSide: 'bottom' });
  assert.equal(fixture.context.hasPixels, false, 'scatter must not retain gather pixels');
  fixture.scheduler.step(200);
  const scatterStart = pointCenters(renderedFrames(fixture.context.calls).at(-1));
  assert.ok(scatterStart.every(([, y]) => Math.abs(y - 110) < 0.001));
  assert.equal(fixture.canvas.dataset.portalSide, 'bottom');
  fixture.scheduler.step(300);
  await scattering;
  const scatterEnd = pointCenters(renderedFrames(fixture.context.calls).at(-1));
  assert.ok(scatterEnd.every(([, y]) => Math.abs(y - 42) < 0.001));
  assert.ok(scatterEnd.every(([, y], index) => y < scatterStart[index][1]));
  const forbiddenLinearDraws = new Set(['moveTo', 'lineTo', 'stroke']);
  assert.equal(
    renderedFrames(fixture.context.calls)
      .flat()
      .some(([name]) => forbiddenLinearDraws.has(name)),
    false,
    'soft seam particles must not render linear stroke trails'
  );
  assert.equal(fixture.canvas.dataset.phase, 'idle');
  assert.equal(fixture.context.hasPixels, false);
  field.destroy();
});

test('motionDistance maps poster travel to an 18 percent particle range clamped between 56 and 128 pixels', async () => {
  const cases = [
    { motionDistance: 100, expectedTravel: 56 },
    { motionDistance: 600, expectedTravel: 108 },
    { motionDistance: 1000, expectedTravel: 128 }
  ];

  for (const { motionDistance, expectedTravel } of cases) {
    const fixture = createFixture();
    const field = createLightParticleField({
      canvas: fixture.canvas,
      documentRef: fixture.document,
      windowRef: fixture.dom.window,
      profile: 'compact',
      random: () => 0.5,
      requestFrame: fixture.scheduler.requestFrame,
      cancelFrame: fixture.scheduler.cancelFrame
    });
    const gathering = field.gather(
      { left: 60, top: 50, width: 100, height: 80 },
      100,
      { portalSide: 'top', motionDistance }
    );

    fixture.scheduler.step(0);
    fixture.scheduler.step(100);
    await gathering;
    const endpoints = pointCenters(renderedFrames(fixture.context.calls).at(-1));
    assert.ok(endpoints.every(([, y]) => Math.abs(y - (30 + expectedTravel)) < 0.001));
    field.destroy();
  }
});

test('motionDistance seeds one quarter of particles along the poster path as an inertial wake', async () => {
  const fixture = createFixture();
  let randomCall = 0;
  const field = createLightParticleField({
    canvas: fixture.canvas,
    documentRef: fixture.document,
    windowRef: fixture.dom.window,
    profile: 'compact',
    random: () => {
      const property = randomCall % 8;
      const particle = Math.floor(randomCall / 8);
      randomCall += 1;
      if (property === 1) return (particle % 9) / 9;
      return 0.5;
    },
    requestFrame: fixture.scheduler.requestFrame,
    cancelFrame: fixture.scheduler.cancelFrame
  });
  const bounds = { left: 60, top: 50, width: 100, height: 80 };

  const gathering = field.gather(bounds, 100, { portalSide: 'top', motionDistance: 600 });
  fixture.scheduler.step(0);
  const gatherStarts = pointCenters(renderedFrames(fixture.context.calls).at(-1));
  const gatherWake = gatherStarts.filter(([, y]) => y > 30.001);
  assert.equal(gatherWake.length, 40);
  assert.ok(new Set(gatherWake.map(([, y]) => y.toFixed(3))).size > 5);
  assert.equal(gatherStarts.filter(([, y]) => Math.abs(y - 30) < 0.001).length, 120);
  fixture.scheduler.step(100);
  await gathering;

  const scattering = field.scatter(bounds, 100, { portalSide: 'bottom', motionDistance: 600 });
  fixture.scheduler.step(200);
  const scatterStarts = pointCenters(renderedFrames(fixture.context.calls).at(-1));
  const scatterWake = scatterStarts.filter(([, y]) => y < 109.999);
  assert.equal(scatterWake.length, 40);
  assert.ok(new Set(scatterWake.map(([, y]) => y.toFixed(3))).size > 5);
  assert.equal(scatterStarts.filter(([, y]) => Math.abs(y - 110) < 0.001).length, 120);
  fixture.scheduler.step(300);
  await scattering;

  field.destroy();
});

test('hold phase keeps a bounded field of floating particles below the resting poster', async () => {
  const fixture = createFixture();
  const field = createField(fixture, 'full');
  const holding = field.hold({ left: 60, top: 50, width: 100, height: 80 }, 100);

  assert.equal(fixture.canvas.dataset.phase, 'hold');
  assert.equal(field.getState().particleCount, 104);
  fixture.scheduler.step(0);
  fixture.scheduler.step(50);
  const points = pointCenters(renderedFrames(fixture.context.calls).at(-1));
  assert.equal(points.length, 104);
  assert.ok(points.every(([, y]) => y > 110), 'hold particles remain below the artwork bottom');

  fixture.scheduler.step(100);
  await holding;
  assert.equal(fixture.canvas.dataset.phase, 'idle');
  assert.equal(fixture.context.hasPixels, false);
  field.destroy();
});

test('scanner particles drift subtly left and right while moving away from a horizontal seam', async () => {
  const fixture = createFixture();
  let randomCall = 0;
  const field = createLightParticleField({
    canvas: fixture.canvas,
    documentRef: fixture.document,
    windowRef: fixture.dom.window,
    profile: 'compact',
    random: () => {
      const property = randomCall % 8;
      const particle = Math.floor(randomCall / 8);
      randomCall += 1;
      if (property === 1) return particle % 2 === 0 ? 0.1 : 0.9;
      return 0.5;
    },
    requestFrame: fixture.scheduler.requestFrame,
    cancelFrame: fixture.scheduler.cancelFrame
  });
  const bounds = { left: 60, top: 50, width: 100, height: 80 };

  const gathering = field.gather(bounds, 100);
  fixture.scheduler.step(0);
  const starts = pointCenters(renderedFrames(fixture.context.calls).at(-1));
  fixture.scheduler.step(100);
  await gathering;
  const ends = pointCenters(renderedFrames(fixture.context.calls).at(-1));

  assert.ok(starts.every(([x, y]) => Math.abs(x - 100) < 0.001 && Math.abs(y - 30) < 0.001));
  const horizontalTravel = ends.map(([x], index) => x - starts[index][0]);
  assert.ok(horizontalTravel.some((distance) => distance < -7.5));
  assert.ok(horizontalTravel.some((distance) => distance > 7.5));
  field.destroy();
});

test('seam particles arc away from the slit instead of interpolating along straight rays', async () => {
  const fixture = createFixture();
  const field = createLightParticleField({
    canvas: fixture.canvas,
    documentRef: fixture.document,
    windowRef: fixture.dom.window,
    profile: 'compact',
    random: () => 0.5,
    requestFrame: fixture.scheduler.requestFrame,
    cancelFrame: fixture.scheduler.cancelFrame
  });
  const gathering = field.gather(
    { left: 60, top: 50, width: 100, height: 80 },
    100,
    { portalSide: 'top' }
  );

  fixture.scheduler.step(0);
  fixture.scheduler.step(50);
  const midpoints = pointCenters(renderedFrames(fixture.context.calls).at(-1));
  assert.ok(midpoints.some(([x]) => x < 99), 'one half of the burst should curl left of the seam normal');
  assert.ok(midpoints.some(([x]) => x > 101), 'the mirrored half should curl right of the seam normal');

  fixture.scheduler.step(100);
  await gathering;
  const endpoints = pointCenters(renderedFrames(fixture.context.calls).at(-1));
  assert.ok(endpoints.every(([x]) => Math.abs(x - 100) < 0.001));
  field.destroy();
});

test('particles are transparent at birth and settlement and fade as travel distance grows', async () => {
  const cases = [
    { method: 'gather', portalSide: 'top', seamY: 30 },
    { method: 'scatter', portalSide: 'bottom', seamY: 110 }
  ];

  for (const { method, portalSide, seamY } of cases) {
    const fixture = createFixture();
    const field = createLightParticleField({
      canvas: fixture.canvas,
      documentRef: fixture.document,
      windowRef: fixture.dom.window,
      profile: 'compact',
      random: () => 0.5,
      requestFrame: fixture.scheduler.requestFrame,
      cancelFrame: fixture.scheduler.cancelFrame
    });
    const pending = field[method](
      { left: 60, top: 50, width: 100, height: 80 },
      100,
      { portalSide }
    );

    for (const timestamp of [0, 20, 70, 100]) fixture.scheduler.step(timestamp);
    await pending;

    const frames = renderedFrames(fixture.context.calls).slice(-4);
    assert.equal(frames.length, 4, `${method} should render every sampled frame`);
    const samples = frames.map((frame) => {
      const [, y] = pointCenters(frame)[0];
      return {
        alpha: maxFrameAlpha(frame),
        distance: Math.abs(y - seamY)
      };
    });

    assert.equal(samples[0].alpha, 0, `${method} must be transparent at birth`);
    assert.ok(samples[1].alpha > 0, `${method} must become visible after birth`);
    assert.ok(samples[2].alpha > 0, `${method} must remain softly visible during travel`);
    assert.ok(samples[2].distance > samples[1].distance, `${method} must travel away from its seam`);
    assert.ok(samples[2].alpha < samples[1].alpha, `${method} must fade as distance grows`);
    assert.equal(samples[3].alpha, 0, `${method} must be transparent before settlement`);
    field.destroy();
  }
});

test('frames reuse seeded storage without random regeneration or sprite recreation', async () => {
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
  const gathering = field.gather({ left: 60, top: 50, width: 100, height: 80 }, 100);
  const callsAfterSeed = randomCalls;

  fixture.scheduler.step(0);
  fixture.scheduler.step(35);
  fixture.scheduler.step(70);
  assert.equal(randomCalls, callsAfterSeed);
  assert.equal(fixture.spriteContexts.length, 2);
  fixture.scheduler.step(100);
  await gathering;

  const scattering = field.scatter({ left: 60, top: 50, width: 100, height: 80 }, 100);
  const callsAfterScatterSeed = randomCalls;
  fixture.scheduler.step(100);
  fixture.scheduler.step(200);
  await scattering;
  assert.equal(randomCalls, callsAfterScatterSeed);
  assert.equal(fixture.spriteContexts.length, 2);
  field.setProfile('full');
  assert.equal(fixture.spriteContexts.length, 2);
  field.destroy();
});

test('resize redraws an active frame once without a new RAF or random regeneration', async () => {
  let randomCalls = 0;
  const fixture = createFixture({ width: 320, height: 180, dpr: 1 });
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
  const gathering = field.gather({ left: 60, top: 50, width: 100, height: 80 }, 100);
  fixture.scheduler.step(0);
  fixture.scheduler.step(35);
  const callsBeforeResize = randomCalls;
  const pendingBeforeResize = fixture.scheduler.pendingCount;
  const framesBeforeResize = renderedFrames(fixture.context.calls).length;

  fixture.setSize(160, 90);
  field.resize();

  assert.equal(randomCalls, callsBeforeResize);
  assert.equal(fixture.scheduler.pendingCount, pendingBeforeResize);
  assert.equal(renderedFrames(fixture.context.calls).length, framesBeforeResize + 1);
  const coordinates = frameCoordinates(renderedFrames(fixture.context.calls).at(-1));
  assert.ok(coordinates.every((coordinate, index) => (
    coordinate >= 0 && coordinate <= (index % 2 === 0 ? 160 : 90)
  )));

  field.destroy();
  await gathering;
});

test('explicit scene durations override particle profile defaults', async () => {
  const fixture = createFixture();
  const field = createField(fixture, 'full');
  const bounds = { left: 60, top: 50, width: 100, height: 80 };

  const gathering = field.gather(bounds, 80);
  fixture.scheduler.step(0);
  fixture.scheduler.step(79);
  assert.equal(field.getState().animating, true);
  fixture.scheduler.step(80);
  await gathering;
  assert.equal(fixture.canvas.dataset.phase, 'idle');

  const scattering = field.scatter(bounds, 240);
  fixture.scheduler.step(80);
  fixture.scheduler.step(319);
  assert.equal(field.getState().animating, true);
  fixture.scheduler.step(320);
  await scattering;
  assert.equal(fixture.canvas.dataset.phase, 'idle');
  field.destroy();
});

test('resize after settlement keeps the Canvas empty and does not restart frames', async () => {
  const fixture = createFixture({ width: 320, height: 180, dpr: 1 });
  const field = createField(fixture, 'compact');
  const gathering = field.gather({ left: 60, top: 50, width: 100, height: 80 });
  await runToIdle(fixture, gathering, { step: 50 });
  assert.equal(fixture.context.hasPixels, false);
  assert.equal(fixture.scheduler.pendingCount, 0);

  fixture.setSize(160, 90);
  const writesBefore = fixture.backingWrites.length;
  field.resize();
  assert.equal(fixture.backingWrites.length, writesBefore + 2);
  assert.equal(fixture.context.hasPixels, false);
  assert.equal(fixture.scheduler.pendingCount, 0);
  assert.equal(field.getState().particleCount, 0);
  field.destroy();
});

test('reduce, clear, render failure, profile replacement, and destroy erase and settle work', async () => {
  const cases = [
    ['clear', (field) => field.clear()],
    ['reduce', (field) => field.setProfile('reduce')],
    ['replacement', (field) => field.setProfile('full')],
    ['destroy', (field) => field.destroy()]
  ];

  for (const [label, cancel] of cases) {
    for (const phase of ['gather', 'scatter']) {
      const fixture = createFixture();
      const field = createField(fixture, 'compact');
      const pending = field[phase]({ left: 60, top: 50, width: 100, height: 80 });
      fixture.scheduler.step(0);
      cancel(field);
      await pending;
      assert.equal(fixture.scheduler.pendingCount, 0);
      assert.equal(fixture.canvas.dataset.phase, 'idle');
      assert.equal(field.getState().animating, false);
      assert.equal(field.getState().particleCount, 0);
      assertTerminalClear(fixture.context.calls, `${label} pending ${phase}`);
      if (!field.getState().destroyed) field.destroy();
    }
  }

  for (const phase of ['gather', 'scatter']) {
    const failureFixture = createFixture();
    const originalDrawImage = failureFixture.context.drawImage;
    failureFixture.context.drawImage = (...args) => {
      originalDrawImage(...args);
      throw new Error('render failed');
    };
    const failureField = createField(failureFixture, 'compact');
    const failed = failureField[phase]({ left: 60, top: 50, width: 100, height: 80 });
    assert.doesNotThrow(() => failureFixture.scheduler.step(0));
    await failed;
    assert.equal(failureFixture.scheduler.pendingCount, 0);
    assert.equal(failureFixture.canvas.dataset.phase, 'idle');
    assert.equal(failureField.getState().animating, false);
    assertTerminalClear(failureFixture.context.calls, `render failure pending ${phase}`);
    failureField.destroy();
  }
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

test('each animated command refreshes CSS size and DPR before seeding particles', async () => {
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
  assert.equal(fixture.canvas.width, 123);
  assert.equal(fixture.canvas.height, 68);
  assert.equal(field.getState().dpr, 1);
  assert.equal(field.getState().particleCount, 260);

  field.destroy();
  await gathering;
});

test('visibility loss settles immediately and visibility restoration does not restart RAF', async () => {
  const fixture = createFixture();
  const field = createField(fixture, 'compact');
  const gathering = field.gather({ left: 60, top: 50, width: 100, height: 80 });

  fixture.scheduler.step(0);
  fixture.scheduler.step(40);
  const frameCountAtHide = Number(fixture.canvas.dataset.frameCount);
  fixture.setHidden(true);
  await gathering;
  assert.equal(fixture.scheduler.pendingCount, 0);
  assert.equal(fixture.canvas.dataset.phase, 'idle');
  assert.equal(field.getState().particleCount, 0);
  assert.equal(fixture.context.hasPixels, false);

  fixture.setHidden(false);
  fixture.setHidden(false);
  assert.equal(fixture.scheduler.pendingCount, 0);
  assert.equal(Number(fixture.canvas.dataset.frameCount), frameCountAtHide);

  fixture.setHidden(true);
  await field.scatter({ left: 60, top: 50, width: 100, height: 80 });
  assert.equal(fixture.scheduler.pendingCount, 0);
  assert.equal(fixture.canvas.dataset.phase, 'idle');
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

test('finish, clear, and destroy settle promises and release Canvas backing stores', async () => {
  const fixture = createFixture({ width: 200, height: 100, dpr: 3 });
  const field = createField(fixture, 'full');
  field.setProfile('compact');
  assert.equal(fixture.canvas.width, 200);
  assert.equal(fixture.canvas.height, 100);

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
  assert.ok(fixture.spriteCanvases.every((sprite) => sprite.width === 0 && sprite.height === 0));
  assert.deepEqual(field.getState(), {
    profile: 'compact', particleCount: 0, dpr: 1, animating: false, destroyed: true
  });
});

test('rejects unknown profiles and missing 2D contexts', () => {
  const fixture = createFixture();
  assert.throws(() => createField(fixture, 'unknown'), /Unknown particle profile/);
  fixture.canvas.getContext = () => null;
  assert.throws(() => createField(fixture), /2D canvas context/);
  assert.throws(() => createLightParticleField({ canvas: null }), /canvas/);
});
