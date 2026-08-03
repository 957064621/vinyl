import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import {
  PORTAL_DURATION,
  POSTER_TIMING as VISUAL8_TIMING,
  createPosterTransition
} from '../../src/ui/poster-transition.js';

const POSTER_TIMING = {
  normal: {
    ...VISUAL8_TIMING.full.normal,
    reveal: VISUAL8_TIMING.full.normal.handoff,
    scatter: VISUAL8_TIMING.full.normal.exit
  },
  fast: {
    ...VISUAL8_TIMING.full.compressed,
    reveal: VISUAL8_TIMING.full.compressed.handoff,
    scatter: VISUAL8_TIMING.full.compressed.exit
  },
  finalHold: VISUAL8_TIMING.full.finalHold,
  finalExposure: VISUAL8_TIMING.full.finalResolve,
  exitLead: VISUAL8_TIMING.full.exitLead,
  reduceFade: VISUAL8_TIMING.reduce.fade
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

const makeImmediateScheduler = (sleeps) => ({
  async sleep(ms, signal) {
    sleeps.push(ms);
    return !signal.aborted;
  }
});

const makeManualScheduler = ({ retainAfterAbort = () => false } = {}) => {
  const pending = [];
  const sleepCalls = [];

  return {
    sleep(ms, signal) {
      sleepCalls.push(ms);
      return new Promise((resolve) => {
        let settled = false;
        const entry = {
          ms,
          signal,
          abortObserved: false,
          release(value = true) {
            if (settled) return false;
            settled = true;
            signal.removeEventListener('abort', abort);
            const index = pending.indexOf(entry);
            if (index >= 0) pending.splice(index, 1);
            resolve(value);
            return true;
          }
        };
        const abort = () => {
          entry.abortObserved = true;
          if (!retainAfterAbort(entry)) entry.release(false);
        };

        if (signal.aborted) {
          entry.release(false);
          return;
        }
        signal.addEventListener('abort', abort, { once: true });
        pending.push(entry);
      });
    },
    releaseNext() {
      pending[0]?.release(true);
    },
    releaseDuration(ms) {
      pending.find((entry) => entry.ms === ms)?.release(true);
    },
    pendingDuration(ms) {
      return pending.filter((entry) => entry.ms === ms).length;
    },
    get pending() {
      return pending.length;
    },
    get durations() {
      return pending.map(({ ms }) => ms);
    },
    get signals() {
      return pending.map(({ signal }) => signal);
    },
    get sleepCalls() {
      return [...sleepCalls];
    },
    get entries() {
      return [...pending];
    }
  };
};

const makeDeferredParticleField = () => {
  const pending = [];
  const calls = [];
  const start = (phase, bounds, duration, options) => new Promise((resolve, reject) => {
    calls.push([phase, bounds, duration, options]);
    pending.push({ phase, duration, options, resolve, reject });
  });

  return {
    calls,
    pending,
    gather: (bounds, duration, options) => start('gather', bounds, duration, options),
    scatter: (bounds, duration, options) => start('scatter', bounds, duration, options),
    finish() {
      calls.push(['finish']);
    },
    setProfile(profile) {
      calls.push(['profile', profile]);
    }
  };
};

const makeFixture = ({
  scheduler,
  particleField,
  profile = 'full',
  onError,
  onFinalScene,
  scheduleMicrotask
} = {}) => {
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
  const particleSideCalls = [];
  const defaultParticleField = {
    gather(bounds, duration, options) {
      particleCalls.push(['gather', bounds, duration, options]);
    },
    scatter(bounds, duration, options) {
      particleCalls.push(['scatter', bounds, duration, options]);
    },
    finish() {
      particleCalls.push(['finish']);
    },
    setProfile(nextProfile) {
      particleCalls.push(['profile', nextProfile]);
    },
    setPortalSide(side) {
      particleSideCalls.push([side, root.classList.contains('is-portal-active')]);
    }
  };
  const sleeps = [];
  const root = document.getElementById('root');
  const slit = document.getElementById('slit');
  const slots = [...root.querySelectorAll('[data-loading-slot]')];
  const images = slots.map((slot) => slot.querySelector('img'));
  for (const [index, slot] of slots.entries()) {
    slot.getBoundingClientRect = () => ({
      left: 20 + index,
      top: 30,
      right: 200 + index,
      bottom: 270,
      width: 180,
      height: 240
    });
  }
  const errors = [];
  const controller = createPosterTransition({
    root,
    slit,
    particleField: particleField || defaultParticleField,
    profile,
    scheduler: scheduler || makeImmediateScheduler(sleeps),
    onError: onError || ((error) => errors.push(error)),
    onFinalScene,
    scheduleMicrotask
  });

  return {
    controller,
    document,
    errors,
    images,
    particleCalls: particleField?.calls || particleCalls,
    particleField: particleField || defaultParticleField,
    particleSideCalls,
    root,
    sleeps,
    slit,
    slots
  };
};

test('timing tables are deeply frozen and preserve fast portal travel with a readable center hold', () => {
  assert.equal(PORTAL_DURATION, 760, 'the established stretch/luminance portal envelope must not change');
  assert.deepEqual(VISUAL8_TIMING, {
    full: {
      normal: { gather: 220, handoff: 520, exit: 520, hold: 700 },
      compressed: { gather: 220, handoff: 520, exit: 520, hold: 480 },
      finalHold: 840,
      finalResolve: 1280,
      exitLead: 1280,
      rootFade: 680
    },
    compact: {
      normal: { gather: 220, handoff: 520, exit: 520, hold: 760 },
      compressed: { gather: 220, handoff: 520, exit: 520, hold: 520 },
      finalHold: 900,
      finalResolve: 1280,
      exitLead: 1280,
      rootFade: 760
    },
    reduce: { fade: 120 }
  });
  const firstPosterTime = ({ hold }) => PORTAL_DURATION + hold;
  const exchangeTime = ({ hold }) => (PORTAL_DURATION * 2) + hold;
  assert.equal(firstPosterTime(VISUAL8_TIMING.full.normal), 1460);
  assert.equal(exchangeTime(VISUAL8_TIMING.full.normal), 2220);
  assert.equal(firstPosterTime(VISUAL8_TIMING.full.compressed), 1240);
  assert.equal(exchangeTime(VISUAL8_TIMING.full.compressed), 2000);
  assert.equal(firstPosterTime(VISUAL8_TIMING.compact.normal), 1520);
  assert.equal(firstPosterTime(VISUAL8_TIMING.compact.compressed), 1280);
  assert.equal(Object.isFrozen(VISUAL8_TIMING), true);
  for (const profile of ['full', 'compact', 'reduce']) {
    assert.equal(Object.isFrozen(VISUAL8_TIMING[profile]), true);
  }
  for (const profile of ['full', 'compact']) {
    assert.equal(Object.isFrozen(VISUAL8_TIMING[profile].normal), true);
    assert.equal(Object.isFrozen(VISUAL8_TIMING[profile].compressed), true);
  }
});

test('poster transition removes legacy edge feathers and fixes horizontal portal geometry per run', () => {
  const source = readFileSync(new URL('../../src/ui/poster-transition.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /poster-fade|sideFade|leftSoft|rightSoft/);
  assert.match(source, /const portalOrientation = 'horizontal'/);
  assert.match(source, /let fixedPortalGeometry = null/);
  assert.match(source, /if \(!fixedPortalGeometry\)/);
  assert.match(source, /const width = Math\.max\(1, Math\.min\(artWidth \* 1\.08, availableWidth\)\)/);
  assert.match(source, /const height = Math\.max\(112, Math\.min\(168, width \/ 4\.4\)\)/);
  assert.match(source, /const desiredGap = Math\.max\(20, Math\.min\(38, artHeight \* 0\.055\)\)/);
});

test('top and bottom portals keep one geometry across differently proportioned posters', async () => {
  const scheduler = makeManualScheduler();
  const { controller, images, root, slots } = makeFixture({ scheduler });
  root.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 600,
    bottom: 400,
    width: 600,
    height: 400
  });
  const dimensions = [
    [600, 300],
    [300, 400],
    [240, 520]
  ];
  dimensions.forEach(([width, height], index) => {
    Object.defineProperties(images[index], {
      naturalWidth: { configurable: true, value: width },
      naturalHeight: { configurable: true, value: height }
    });
    controller.enqueue(slots[index]);
  });
  await flush();

  const signatures = { top: new Set(), bottom: new Set() };
  const portalGaps = { top: [], bottom: [] };
  let guard = 0;
  while (controller.getState().processing) {
    assert.ok(guard < 64, 'portal sequence exceeded its scheduler bound');
    const side = root.dataset.portalSide;
    if (side === 'top' || side === 'bottom') {
      const signature = [
        '--gate-x', '--gate-y', '--gate-width', '--gate-height'
      ].map((property) => root.style.getPropertyValue(property)).join('|');
      if (signature.replaceAll('|', '')) signatures[side].add(signature);
      const portalGap = Number.parseFloat(root.style.getPropertyValue('--portal-gap'));
      if (Number.isFinite(portalGap)) portalGaps[side].push(portalGap);
    }
    assert.ok(scheduler.pending > 0);
    scheduler.releaseNext();
    await flush();
    guard += 1;
  }

  assert.equal(signatures.top.size, 1);
  assert.equal(signatures.bottom.size, 1);
  assert.ok(portalGaps.top.length > 0 && portalGaps.bottom.length > 0);
  assert.ok(portalGaps.top[0] >= 18 && portalGaps.bottom[0] >= 18, 'the lead poster keeps a visible gate gap');
  assert.ok(
    [...portalGaps.top, ...portalGaps.bottom].every((gap) => gap >= 0),
    'per-artwork portal gaps are clamped when a later contained image reaches the fixed gate'
  );
});

test('top portal leaves measured space above the artwork and forwards its actual travel distance', async () => {
  const scheduler = makeManualScheduler();
  const { controller, images, particleCalls, root, slots } = makeFixture({ scheduler });
  root.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 600,
    bottom: 400,
    width: 600,
    height: 400
  });
  Object.defineProperties(images[0], {
    naturalWidth: { configurable: true, value: 300 },
    naturalHeight: { configurable: true, value: 400 }
  });

  controller.enqueue(slots[0]);
  await flush();

  const gateWidth = Number.parseFloat(root.style.getPropertyValue('--gate-width'));
  const gateHeight = Number.parseFloat(root.style.getPropertyValue('--gate-height'));
  const gateY = Number.parseFloat(root.style.getPropertyValue('--gate-y'));
  const portalGap = Number.parseFloat(root.style.getPropertyValue('--portal-gap'));
  const seamInset = Number.parseFloat(slots[0].style.getPropertyValue('--seam-inset'));
  const portalOffset = Number.parseFloat(slots[0].style.getPropertyValue('--poster-portal-offset'));
  assert.equal(gateWidth, 194.4);
  assert.equal(gateHeight, 112);
  assert.equal(gateY, 12);
  assert.equal(portalGap, 18);
  assert.equal(seamInset, -7.5);
  assert.ok(portalOffset < -110, 'the poster begins fully beyond the separated gate');
  assert.equal(slots[0].style.cssText.includes('poster-fade'), false);

  scheduler.releaseDuration(POSTER_TIMING.normal.gather);
  await flush();
  const gatherCall = particleCalls.find(([phase]) => phase === 'gather');
  const gatherBounds = gatherCall?.[1];
  const gatherOptions = gatherCall?.[3];
  assert.ok(Math.abs(gatherBounds.left - 12.8) < 0.001);
  assert.ok(Math.abs(gatherBounds.right - 207.2) < 0.001);
  assert.equal(gatherBounds.top, 12);
  assert.equal(gatherBounds.bottom, 12);
  assert.equal(gatherBounds.height, 0, 'particles are born on the measured light core');
  assert.equal(gatherOptions?.portalSide, 'top');
  assert.ok(Math.abs(gatherOptions?.motionDistance - 268) < 0.001);
  assert.deepEqual(gatherOptions?.trajectory, {
    distance: gatherOptions.motionDistance,
    trailDistance: portalGap,
    duration: POSTER_TIMING.normal.handoff,
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    directionY: 1
  });

  controller.freeze();
  assert.equal(slots[0].style.getPropertyValue('--seam-inset'), '');
  assert.equal(slots[0].style.getPropertyValue('--poster-portal-offset'), '');
  assert.equal(root.style.getPropertyValue('--portal-gap'), '');
});

test('top portal ignites for the lead before a single poster begins entering', async () => {
  const scheduler = makeManualScheduler();
  const { controller, particleSideCalls, root, scheduler: unused, slit, slots } = {
    ...makeFixture({ scheduler }),
    scheduler
  };
  void unused;
  controller.enqueue(slots[0]);
  await flush();

  assert.deepEqual(scheduler.durations, [POSTER_TIMING.normal.gather]);
  assert.equal(slit.classList.contains('is-lit'), true);
  assert.equal(root.dataset.portalSide, 'top');
  assert.equal(root.dataset.portalPhase, 'enter');
  assert.equal(slit.dataset.portalSide, 'top');
  assert.equal(slit.dataset.portalPhase, 'enter');
  assert.equal(root.querySelectorAll('.is-active').length, 0);
  assert.deepEqual(
    particleSideCalls,
    [['top', false]],
    'the old particle side is cleared before the top portal becomes visible'
  );

  scheduler.releaseDuration(POSTER_TIMING.normal.gather);
  await flush();
  assert.equal(slit.classList.contains('is-lit'), true);
  assert.equal(root.classList.contains('is-scanning'), true);
  assert.equal(root.querySelectorAll('.is-active').length, 1);
  assert.equal(slots[0].classList.contains('is-entering'), true);
  assert.equal(slots[0].classList.contains('is-entering-from-portal'), true);
  assert.equal(slots[0].dataset.portalSide, 'top');
  assert.equal(slots[0].dataset.portalPhase, 'enter');
  assert.equal(root.style.getPropertyValue('--slit-duration'), `${PORTAL_DURATION}ms`);
  assert.equal(root.style.getPropertyValue('--portal-phase-ms'), `${PORTAL_DURATION}ms`);

  controller.freeze();
});

test('validates required collaborators and motion profiles', () => {
  const dom = new JSDOM('<div id="root"><div id="slit"></div></div>');
  const root = dom.window.document.getElementById('root');
  const slit = dom.window.document.getElementById('slit');
  const particleField = { gather() {}, scatter() {}, finish() {}, setProfile() {} };

  assert.throws(() => createPosterTransition(), /required/i);
  assert.throws(() => createPosterTransition({ root, slit, particleField: null }), /required/i);
  assert.throws(() => createPosterTransition({ root, slit, particleField, profile: 'cinema' }), /profile/i);

  const { controller } = makeFixture();
  assert.throws(() => controller.setProfile('cinema'), /profile/i);
  assert.equal(controller.getState().profile, 'full');
});

test('rapid enqueue is synchronous, FIFO, uses one horizontal gate axis, and preserves exact image nodes', async () => {
  const { controller, images, root, slots } = makeFixture();
  const returns = slots.map((slot) => controller.enqueue(slot));

  assert.deepEqual(returns, [true, true, true, true, true]);
  assert.equal(controller.enqueue(slots[0]), false, 'a decoded slot is accepted once per run');
  assert.deepEqual(slots.map((slot) => slot.dataset.transitionOrder), ['1', '2', '3', '4', '5']);
  assert.deepEqual(slots.map((slot) => slot.dataset.slitDirection), [
    'horizontal',
    'horizontal',
    'horizontal',
    'horizontal',
    'horizontal'
  ]);

  const finishing = controller.finish();
  assert.strictEqual(controller.finish(), finishing, 'finish is idempotent per run');
  await finishing;

  assert.equal(root.querySelectorAll('.is-active').length, 1);
  assert.strictEqual(root.querySelector('.is-active'), slots[4]);
  assert.strictEqual(slots[4].querySelector('img'), images[4]);
  assert.equal(images[4].hasAttribute('aria-hidden'), false);
  for (const [index, slot] of slots.slice(0, 4).entries()) {
    assert.strictEqual(slot.querySelector('img'), images[index]);
    assert.equal(images[index].getAttribute('aria-hidden'), 'true');
  }
  assert.equal(root.dataset.transitionSettled, 'true');
  assert.equal(root.classList.contains('is-scanning'), false);
});

test('skipTo lets an in-flight poster finish without aborting or rewinding before final starts', async () => {
  const scheduler = makeManualScheduler();
  const { controller, particleCalls, root, slots } = makeFixture({ scheduler });
  const current = slots[0];
  const skipped = slots[1];
  const final = slots[4];

  controller.enqueue(current);
  controller.enqueue(skipped);
  controller.enqueue(final);
  await flush();

  scheduler.releaseDuration(POSTER_TIMING.normal.gather);
  await flush();
  assert.equal(current.classList.contains('is-entering-from-portal'), true);
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.normal.handoff]);

  const enteringSignal = scheduler.entries[0].signal;
  const enteringClasses = current.className;
  const handoffDuration = current.style.getPropertyValue('--poster-handoff-ms');

  assert.equal(controller.skipTo(final), true);
  assert.deepEqual(controller.getState(), {
    profile: 'full',
    queued: 1,
    activeId: 'archive-01',
    processing: true,
    sealed: false,
    destroyed: false
  });
  assert.equal(enteringSignal.aborted, false, 'skip must not cancel the current poster animation');
  assert.equal(current.className, enteringClasses, 'skip must not rewind the current poster classes');
  assert.equal(current.style.getPropertyValue('--poster-handoff-ms'), handoffDuration);
  assert.equal(root.dataset.portalSide, 'top');
  assert.equal(final.classList.contains('is-active'), false);
  assert.equal(particleCalls.some(([phase]) => phase === 'finish'), false);

  scheduler.releaseDuration(POSTER_TIMING.normal.handoff);
  await flush();
  assert.equal(final.classList.contains('is-active'), false);

  const enterTail = PORTAL_DURATION - POSTER_TIMING.normal.gather - POSTER_TIMING.normal.handoff;
  scheduler.releaseDuration(enterTail);
  await flush();
  assert.equal(current.classList.contains('is-active'), true);
  assert.equal(current.classList.contains('is-stable'), true);
  assert.equal(final.classList.contains('is-active'), false);
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.normal.hold]);

  scheduler.releaseDuration(POSTER_TIMING.normal.hold);
  await flush();
  assert.equal(root.dataset.portalSide, 'bottom', 'final starts only after the current hold completes');
  assert.equal(current.classList.contains('is-active'), true);
  assert.equal(final.classList.contains('is-active'), false);

  let guard = 0;
  while (controller.getState().processing) {
    assert.ok(guard < 24, 'skip drain exceeded its scheduler bound');
    assert.ok(scheduler.pending > 0);
    scheduler.releaseNext();
    await flush();
    guard += 1;
  }
  await controller.waitForIdle();

  assert.equal(controller.getState().activeId, 'archive-05');
  assert.equal(final.classList.contains('is-active'), true);
  assert.equal(skipped.classList.contains('is-active'), false);
  assert.equal(
    particleCalls.filter(([phase]) => phase === 'gather').length,
    2,
    'only the current and final posters enter'
  );
});

test('skipTo reuses a queued final poster and repeated skips keep exactly one final item', async () => {
  const scheduler = makeManualScheduler();
  const { controller, particleCalls, slots } = makeFixture({ profile: 'reduce', scheduler });
  const current = slots[0];
  const skipped = slots[1];
  const final = slots[4];

  controller.enqueue(current);
  controller.enqueue(skipped);
  controller.enqueue(final);
  await flush();
  assert.equal(controller.getState().queued, 2);

  const finalOrder = final.dataset.transitionOrder;
  assert.equal(controller.skipTo(final), true);
  assert.equal(controller.skipTo(final), true);
  assert.equal(controller.getState().queued, 1);
  assert.equal(final.dataset.transitionOrder, finalOrder, 'the existing final queue item is retained');

  scheduler.releaseDuration(POSTER_TIMING.reduceFade);
  await flush();
  assert.equal(controller.getState().activeId, 'archive-05');
  assert.equal(controller.getState().queued, 0);
  assert.deepEqual(scheduler.sleepCalls, [POSTER_TIMING.reduceFade, POSTER_TIMING.reduceFade]);

  scheduler.releaseDuration(POSTER_TIMING.reduceFade);
  await controller.waitForIdle();

  assert.equal(skipped.classList.contains('is-active'), false);
  assert.equal(final.classList.contains('is-active'), true);
  assert.equal(
    particleCalls.filter(([phase]) => phase === 'finish').length,
    2,
    'only the current and one final item are processed'
  );
});

test('skipTo stays idempotent after finish seals the queue and after final is active', async () => {
  const finalScenes = [];
  const { controller, particleCalls, sleeps, slots } = makeFixture({
    onFinalScene: (scene) => finalScenes.push(scene)
  });
  const final = slots[4];

  controller.enqueue(slots[0]);
  controller.enqueue(slots[1]);
  controller.enqueue(final);
  const finishing = controller.finish();
  assert.equal(controller.getState().sealed, true);

  assert.equal(controller.skipTo(final), true);
  assert.equal(controller.skipTo(final), true);
  assert.equal(controller.getState().queued, 1);
  await finishing;

  assert.equal(controller.getState().activeId, 'archive-05');
  assert.equal(controller.getState().processing, false);
  assert.equal(finalScenes.length, 1);
  assert.strictEqual(finalScenes[0].slot, final);
  assert.equal(particleCalls.filter(([phase]) => phase === 'gather').length, 1);

  const sleepCount = sleeps.length;
  const particleCallCount = particleCalls.length;
  assert.equal(controller.skipTo(final), true);
  assert.equal(controller.skipTo(final), true);
  await flush();

  assert.deepEqual(controller.getState(), {
    profile: 'full',
    queued: 0,
    activeId: 'archive-05',
    processing: false,
    sealed: true,
    destroyed: false
  });
  assert.equal(sleeps.length, sleepCount, 'active final is not scheduled again');
  assert.equal(particleCalls.length, particleCallCount, 'active final does not restart particles');
});

test('final resolve reports the true final active poster before the tunnel starts', async () => {
  const finalScenes = [];
  const { controller, images, root, slots } = makeFixture({
    onFinalScene: (scene) => finalScenes.push(scene)
  });

  for (const slot of slots) controller.enqueue(slot);
  await controller.finish();

  assert.equal(finalScenes.length, 1);
  assert.strictEqual(finalScenes[0].slot, slots[4]);
  assert.strictEqual(finalScenes[0].image, images[4]);
  assert.equal(finalScenes[0].profile, 'full');
  assert.equal(root.classList.contains('is-final-resolving'), true);
  assert.equal(root.dataset.portalSide, 'center');
  assert.equal(root.dataset.portalPhase, 'final-handoff');
});

test('enqueue accepts only mounted image slots inside its root', () => {
  const { controller, document, slots } = makeFixture();
  const empty = document.createElement('figure');
  empty.dataset.loadingSlot = 'empty';
  const detached = slots[0].cloneNode(true);

  assert.equal(controller.enqueue(null), false);
  assert.equal(controller.enqueue(empty), false);
  assert.equal(controller.enqueue(detached), false);
  assert.equal(controller.enqueue(slots[0]), true);
});

test('enqueue returns false for arbitrary non-Element values', () => {
  const { controller, document } = makeFixture();
  const values = [
    0,
    1,
    'archive-01',
    Symbol('slot'),
    {},
    [],
    () => {},
    document.createTextNode('not an element')
  ];

  for (const value of values) {
    assert.doesNotThrow(() => controller.enqueue(value));
    assert.equal(controller.enqueue(value), false);
  }
});

test('enqueue rejects an undeclared mounted descendant and reset cannot leave it exposed', async () => {
  const { controller, document, root } = makeFixture();
  const undeclared = document.createElement('div');
  const image = document.createElement('img');
  image.alt = 'undeclared';
  image.setAttribute('aria-hidden', 'true');
  undeclared.append(image);
  root.append(undeclared);

  const accepted = controller.enqueue(undeclared);
  await controller.waitForIdle();
  controller.reset();

  assert.equal(accepted, false);
  assert.equal(undeclared.classList.contains('is-active'), false);
  assert.equal(image.getAttribute('aria-hidden'), 'true');
  assert.equal(controller.getState().activeId, null);
});

test('rapid backlog stays compressed through one drain and a later isolated run returns to normal', async () => {
  const scheduler = makeManualScheduler();
  const { controller, slots } = makeFixture({ scheduler });
  const releaseProcessingRounds = async () => {
    const rounds = [];
    let iterations = 0;
    while (controller.getState().processing) {
      assert.ok(iterations < 32, 'scheduler processing drain exceeded its bound');
      assert.ok(scheduler.pending > 0);
      rounds.push(scheduler.durations);
      let pendingIterations = 0;
      while (scheduler.pending > 0) {
        assert.ok(pendingIterations < 32, 'scheduler pending drain exceeded its bound');
        scheduler.releaseNext();
        pendingIterations += 1;
      }
      await flush();
      iterations += 1;
    }
    return rounds;
  };

  slots.forEach((slot) => controller.enqueue(slot));
  const finishing = controller.finish();
  await flush();

  const compressedRounds = await releaseProcessingRounds();
  const fastEnterTail = PORTAL_DURATION - POSTER_TIMING.fast.gather - POSTER_TIMING.fast.handoff;
  const fastExitTail = PORTAL_DURATION - POSTER_TIMING.fast.gather - POSTER_TIMING.fast.exit;
  assert.deepEqual(compressedRounds, [
    [POSTER_TIMING.fast.gather],
    [POSTER_TIMING.fast.handoff],
    [fastEnterTail],
    [POSTER_TIMING.fast.hold],
    [POSTER_TIMING.fast.gather],
    [POSTER_TIMING.fast.exit],
    [fastExitTail],
    [POSTER_TIMING.fast.gather],
    [POSTER_TIMING.fast.handoff],
    [fastEnterTail],
    [POSTER_TIMING.fast.hold],
    [POSTER_TIMING.fast.gather],
    [POSTER_TIMING.fast.exit],
    [fastExitTail],
    [POSTER_TIMING.fast.gather],
    [POSTER_TIMING.fast.handoff],
    [fastEnterTail],
    [POSTER_TIMING.fast.hold],
    [POSTER_TIMING.fast.gather],
    [POSTER_TIMING.fast.exit],
    [fastExitTail],
    [POSTER_TIMING.fast.gather],
    [POSTER_TIMING.fast.handoff],
    [fastEnterTail],
    [POSTER_TIMING.fast.hold],
    [POSTER_TIMING.fast.gather],
    [POSTER_TIMING.fast.exit],
    [fastExitTail],
    [POSTER_TIMING.fast.gather],
    [POSTER_TIMING.fast.handoff],
    [fastEnterTail],
    [POSTER_TIMING.finalHold]
  ]);
  assert.equal(
    (POSTER_TIMING.fast.gather * 2)
      + POSTER_TIMING.fast.exit
      + POSTER_TIMING.fast.handoff
      + POSTER_TIMING.fast.hold,
    1960
  );
  assert.equal(
    slots.at(-1).style.getPropertyValue('--poster-handoff-ms'),
    ''
  );
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.exitLead, POSTER_TIMING.finalExposure]);
  scheduler.releaseNext();
  await finishing;

  controller.reset();
  controller.enqueue(slots[0]);
  await flush();
  const isolatedRounds = await releaseProcessingRounds();
  await controller.waitForIdle();

  assert.deepEqual(isolatedRounds, [
    [POSTER_TIMING.normal.gather],
    [POSTER_TIMING.normal.handoff],
    [PORTAL_DURATION - POSTER_TIMING.normal.gather - POSTER_TIMING.normal.handoff],
    [POSTER_TIMING.normal.hold]
  ]);
  assert.equal(
    slots[0].style.getPropertyValue('--poster-handoff-ms'),
    ''
  );
});

test('finish after an idle normal scene adds only the unread final hold remainder', async () => {
  const scheduler = makeManualScheduler();
  const { controller, slots } = makeFixture({ scheduler });
  controller.enqueue(slots[0]);
  await flush();

  let iterations = 0;
  while (controller.getState().processing) {
    assert.ok(iterations < 32, 'scheduler processing drain exceeded its bound');
    assert.ok(scheduler.pending > 0);
    scheduler.releaseNext();
    await flush();
    iterations += 1;
  }
  await controller.waitForIdle();
  assert.deepEqual(scheduler.sleepCalls, [
    POSTER_TIMING.normal.gather,
    POSTER_TIMING.normal.handoff,
    PORTAL_DURATION - POSTER_TIMING.normal.gather - POSTER_TIMING.normal.handoff,
    POSTER_TIMING.normal.hold
  ]);

  const finishing = controller.finish();
  await flush();
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.finalHold - POSTER_TIMING.normal.hold]);
  scheduler.releaseNext();
  await flush();
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.exitLead, POSTER_TIMING.finalExposure]);
  scheduler.releaseNext();
  await finishing;
});

test('the unread final pause extends time without reseeding the settled particle field', async () => {
  const scheduler = makeManualScheduler();
  const particleCalls = [];
  const particleField = {
    gather() {},
    scatter() {},
    hold(bounds, duration) {
      particleCalls.push(['hold', bounds, duration]);
    },
    finish() {
      particleCalls.push(['finish']);
    },
    setProfile() {}
  };
  const { controller, slots } = makeFixture({ scheduler, particleField });
  controller.enqueue(slots[0]);
  await flush();

  let iterations = 0;
  while (controller.getState().processing) {
    assert.ok(iterations < 32, 'scheduler processing drain exceeded its bound');
    scheduler.releaseNext();
    await flush();
    iterations += 1;
  }
  await controller.waitForIdle();
  assert.deepEqual(
    particleCalls.filter(([phase]) => phase === 'hold').map(([, , duration]) => duration),
    [POSTER_TIMING.normal.hold]
  );

  const finishing = controller.finish();
  await flush();
  scheduler.releaseNext();
  await flush();
  assert.deepEqual(
    particleCalls.filter(([phase]) => phase === 'hold').map(([, , duration]) => duration),
    [POSTER_TIMING.normal.hold]
  );
  scheduler.releaseNext();
  await finishing;
});

test('finish during a pre-classified normal hold waits its remainder before exposure', async () => {
  const scheduler = makeManualScheduler();
  const { controller, slots } = makeFixture({ scheduler });
  controller.enqueue(slots[0]);
  await flush();
  let guard = 0;
  while (!scheduler.durations.includes(POSTER_TIMING.normal.hold)) {
    assert.ok(guard < 8);
    scheduler.releaseNext();
    await flush();
    guard += 1;
  }
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.normal.hold]);

  const finishing = controller.finish();
  scheduler.releaseNext();
  await flush();
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.finalHold - POSTER_TIMING.normal.hold]);
  scheduler.releaseNext();
  await flush();
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.exitLead, POSTER_TIMING.finalExposure]);
  scheduler.releaseNext();
  await finishing;
});

for (const [initialProfile, nextProfile] of [
  ['compact', 'full'],
  ['full', 'compact']
]) {
  test(`final hold and resolve stay bound to ${initialProfile} when switching to ${nextProfile}`, async () => {
    const scheduler = makeManualScheduler();
    const { controller, root, slots } = makeFixture({ scheduler, profile: initialProfile });
    const initialTiming = VISUAL8_TIMING[initialProfile];
    controller.enqueue(slots[0]);
    await flush();

    let guard = 0;
    while (controller.getState().processing) {
      assert.ok(guard < 16, 'initial profile scene exceeded its scheduler bound');
      assert.ok(scheduler.pending > 0);
      scheduler.releaseNext();
      await flush();
      guard += 1;
    }
    await controller.waitForIdle();

    const finishing = controller.finish();
    await flush();
    assert.deepEqual(scheduler.durations, [
      initialTiming.finalHold - initialTiming.normal.hold
    ]);

    controller.setProfile(nextProfile);
    scheduler.releaseNext();
    await flush();

    assert.equal(controller.getState().profile, nextProfile);
    assert.deepEqual(scheduler.durations, [initialTiming.exitLead, initialTiming.finalResolve]);
    assert.equal(root.style.getPropertyValue('--final-resolve-ms'), `${initialTiming.finalResolve}ms`);
    assert.equal(root.dataset.motionProfile, nextProfile);

    scheduler.releaseDuration(initialTiming.exitLead);
    await finishing;
  });
}

test('poster exchange descends into the bottom portal before the next poster emerges from the top', async () => {
  const scheduler = makeManualScheduler();
  const {
    controller,
    particleCalls,
    particleSideCalls,
    root,
    slit,
    slots
  } = makeFixture({ scheduler });
  controller.enqueue(slots[0]);
  controller.enqueue(slots[1]);
  await flush();

  let guard = 0;
  while (root.dataset.portalSide !== 'bottom' || root.dataset.portalPhase !== 'exit') {
    assert.ok(guard < 16);
    assert.ok(scheduler.pending > 0);
    scheduler.releaseNext();
    await flush();
    guard += 1;
  }

  assert.equal(slots[0].classList.contains('is-active'), true);
  assert.equal(slots[0].classList.contains('is-stable'), true);
  assert.equal(slots[1].classList.contains('is-active'), false);
  assert.equal(root.querySelectorAll('.is-active, .is-outgoing').length, 1);
  assert.equal(slit.dataset.portalSide, 'bottom');
  assert.equal(slit.dataset.portalPhase, 'exit');
  assert.deepEqual(particleSideCalls.at(-1), ['bottom', false]);

  scheduler.releaseDuration(POSTER_TIMING.normal.gather);
  await flush();

  const outgoing = slots[0];
  const incoming = slots[1];
  assert.equal(outgoing.classList.contains('is-outgoing'), true);
  assert.equal(outgoing.classList.contains('is-exiting'), true);
  assert.equal(outgoing.classList.contains('is-exiting-to-portal'), true);
  assert.equal(outgoing.classList.contains('is-active'), false);
  assert.equal(outgoing.querySelector('img').getAttribute('aria-hidden'), 'true');
  assert.equal(outgoing.dataset.portalSide, 'bottom');
  assert.equal(outgoing.dataset.portalPhase, 'exit');
  assert.equal(incoming.classList.contains('is-active'), false);
  assert.equal(incoming.classList.contains('is-revealing'), false);
  assert.equal(root.querySelectorAll('.is-active').length, 0);
  assert.equal(root.querySelectorAll('.is-active, .is-outgoing').length, 1);
  assert.equal(root.style.getPropertyValue('--slit-duration'), `${PORTAL_DURATION}ms`);
  const scatterCall = particleCalls.find(([name]) => name === 'scatter');
  assert.ok(scatterCall);
  assert.equal(scatterCall[3]?.portalSide, 'bottom');
  assert.deepEqual(scatterCall[3]?.trajectory, {
    distance: scatterCall[3].motionDistance,
    duration: POSTER_TIMING.normal.exit,
    easing: 'cubic-bezier(0.64, 0, 0.78, 0)',
    directionY: 1
  });
  assert.ok(scheduler.durations.includes(POSTER_TIMING.normal.exit));
  assert.equal(
    outgoing.style.getPropertyValue('--poster-exit-ms'),
    `${POSTER_TIMING.normal.exit}ms`
  );
  assert.equal(slit.classList.contains('is-lit'), true);

  scheduler.releaseDuration(POSTER_TIMING.normal.exit);
  await flush();
  const exitTail = PORTAL_DURATION - POSTER_TIMING.normal.gather - POSTER_TIMING.normal.exit;
  assert.equal(root.dataset.portalSide, 'bottom');
  assert.equal(root.dataset.portalPhase, 'exit');
  assert.deepEqual(scheduler.durations, [exitTail]);

  scheduler.releaseDuration(exitTail);
  await flush();
  assert.equal(outgoing.classList.contains('is-outgoing'), false);
  assert.equal(outgoing.classList.contains('is-exiting'), false);
  assert.equal(outgoing.classList.contains('is-exiting-to-portal'), false);
  assert.equal(root.dataset.portalSide, 'top');
  assert.equal(root.dataset.portalPhase, 'enter');
  assert.equal(incoming.classList.contains('is-active'), false);
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.normal.gather]);
  assert.deepEqual(particleSideCalls.at(-1), ['top', false]);

  scheduler.releaseDuration(POSTER_TIMING.normal.gather);
  await flush();
  assert.equal(incoming.classList.contains('is-active'), true);
  assert.equal(incoming.classList.contains('is-revealing'), true);
  assert.equal(incoming.classList.contains('is-entering-from-portal'), true);
  assert.equal(incoming.dataset.portalSide, 'top');
  assert.equal(incoming.dataset.portalPhase, 'enter');
  assert.equal(root.querySelectorAll('.is-active').length, 1);
  assert.equal(root.querySelectorAll('.is-outgoing').length, 0);
  assert.ok(scheduler.durations.includes(POSTER_TIMING.normal.handoff));

  while (controller.getState().processing) {
    assert.ok(guard < 32);
    assert.ok(scheduler.pending > 0);
    scheduler.releaseNext();
    await flush();
    guard += 1;
  }
  assert.equal(slit.classList.contains('is-lit'), false);
  assert.equal(outgoing.classList.contains('is-outgoing'), false);
  assert.equal(outgoing.style.getPropertyValue('--poster-handoff-ms'), '');
  assert.equal(incoming.classList.contains('is-entering-from-portal'), false);
  assert.equal(root.dataset.portalSide, undefined, 'the lamp goes fully dark once the poster rests');
  assert.equal(root.dataset.portalPhase, undefined);
  await controller.waitForIdle();
  assert.equal(root.querySelectorAll('.is-outgoing').length, 0);
  assert.equal(root.querySelectorAll('.is-active').length, 1);
  assert.strictEqual(root.querySelector('.is-active'), incoming);
});

test('normal and compressed scene durations override deliberately slow particle defaults', async () => {
  const makeSlowField = () => {
    const calls = [];
    return {
      calls,
      gather(bounds, duration = 2_000, options) {
        calls.push(['gather', duration, bounds, options]);
      },
      scatter(bounds, duration = 2_000, options) {
        calls.push(['scatter', duration, bounds, options]);
      },
      finish() {},
      setProfile() {}
    };
  };

  const normalField = makeSlowField();
  const normal = makeFixture({ particleField: normalField });
  normal.controller.enqueue(normal.slots[0]);
  normal.controller.enqueue(normal.slots[1]);
  await normal.controller.waitForIdle();
  assert.deepEqual(
    normalField.calls.filter(([phase]) => phase === 'gather').map(([, duration]) => duration),
    [POSTER_TIMING.normal.handoff, POSTER_TIMING.normal.handoff]
  );
  assert.deepEqual(
    normalField.calls.filter(([phase]) => phase === 'scatter').map(([, duration]) => duration),
    [POSTER_TIMING.normal.scatter]
  );
  assert.deepEqual(
    normalField.calls.map(([phase, , , options]) => [phase, options.portalSide]),
    [['gather', 'top'], ['scatter', 'bottom'], ['gather', 'top']]
  );

  const fastField = makeSlowField();
  const fast = makeFixture({ particleField: fastField });
  fast.slots.forEach((slot) => fast.controller.enqueue(slot));
  await fast.controller.waitForIdle();
  assert.deepEqual(
    fastField.calls.filter(([phase]) => phase === 'gather').map(([, duration]) => duration),
    Array(5).fill(POSTER_TIMING.fast.handoff)
  );
  assert.deepEqual(
    fastField.calls.filter(([phase]) => phase === 'scatter').map(([, duration]) => duration),
    Array(4).fill(POSTER_TIMING.fast.scatter)
  );
});

test('full to compact settles particles without cancelling the active portal phase', async () => {
  const scheduler = makeManualScheduler();
  const particleCalls = [];
  let particleProfile = 'full';
  let activeParticle = null;
  const startParticle = (phase, bounds) => new Promise((resolve) => {
    particleCalls.push([phase, particleProfile, bounds]);
    activeParticle = { phase, resolve };
  });
  const settleParticle = () => {
    if (!activeParticle) return;
    const { phase, resolve } = activeParticle;
    activeParticle = null;
    particleCalls.push(['settle', phase]);
    resolve();
  };
  const particleField = {
    gather: (bounds) => startParticle('gather', bounds),
    scatter: (bounds) => startParticle('scatter', bounds),
    finish: settleParticle,
    setProfile(profile) {
      particleProfile = profile;
      particleCalls.push(['profile', profile]);
      settleParticle();
    }
  };
  const { controller, root, slots } = makeFixture({ scheduler, particleField });
  controller.enqueue(slots[0]);
  controller.enqueue(slots[1]);
  await flush();

  let guard = 0;
  while (!slots[1].classList.contains('is-revealing')) {
    assert.ok(guard < 24);
    settleParticle();
    assert.ok(scheduler.pending > 0);
    scheduler.releaseNext();
    await flush();
    guard += 1;
  }
  assert.equal(slots[0].classList.contains('is-outgoing'), false);
  assert.equal(slots[1].classList.contains('is-revealing'), true);
  assert.ok(scheduler.durations.includes(POSTER_TIMING.normal.handoff));
  const signalsBeforeChange = scheduler.signals;
  assert.equal(signalsBeforeChange.every((signal) => !signal.aborted), true);

  controller.setProfile('compact');
  await flush();

  assert.equal(controller.getState().profile, 'compact');
  assert.equal(controller.getState().processing, true);
  assert.equal(root.dataset.motionProfile, 'compact');
  assert.deepEqual(particleCalls.slice(-2), [
    ['profile', 'compact'],
    ['settle', 'gather']
  ]);
  assert.deepEqual(scheduler.signals, signalsBeforeChange);
  assert.equal(scheduler.signals.every((signal) => !signal.aborted), true);
  assert.ok(scheduler.durations.includes(POSTER_TIMING.normal.handoff));
  assert.equal(slots[0].classList.contains('is-outgoing'), false);
  assert.equal(slots[1].classList.contains('is-revealing'), true);

  let iterations = 0;
  while (controller.getState().processing) {
    assert.ok(iterations < 32, 'profile-change drain exceeded its bound');
    settleParticle();
    assert.ok(scheduler.pending > 0);
    scheduler.releaseNext();
    await flush();
    iterations += 1;
  }
  await controller.waitForIdle();

  assert.equal(controller.getState().activeId, 'archive-02');
  assert.equal(root.dataset.motionProfile, 'compact');

  controller.enqueue(slots[2]);
  await flush();

  iterations = 0;
  while (controller.getState().processing) {
    assert.ok(iterations < 32, 'next-profile scene drain exceeded its bound');
    settleParticle();
    assert.ok(scheduler.pending > 0);
    scheduler.releaseNext();
    await flush();
    iterations += 1;
  }
  await controller.waitForIdle();
  assert.equal(
    particleCalls.some(([phase, profile]) => phase === 'scatter' && profile === 'compact'),
    true
  );
  assert.equal(
    particleCalls.some(([phase, profile]) => phase === 'gather' && profile === 'compact'),
    true
  );
  assert.equal(slots[2].style.getPropertyValue('--poster-handoff-ms'), '');
  assert.equal(controller.getState().activeId, 'archive-03');
});

test('bottom-exit rejection restores the current poster and cleans transient portal state', async () => {
  const scheduler = makeManualScheduler();
  const expected = new Error('overlapped scatter failed');
  let scatterCalls = 0;
  const particleField = {
    gather() {},
    scatter() {
      scatterCalls += 1;
      return Promise.reject(expected);
    },
    finish() {},
    setProfile() {}
  };
  const { controller, errors, root, slots } = makeFixture({ particleField, scheduler });
  const unhandled = [];
  const handleUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', handleUnhandled);

  try {
    controller.enqueue(slots[0]);
    controller.enqueue(slots[1]);
    const finishing = assert.rejects(controller.finish(), expected);
    await flush();
    let guard = 0;
    while (errors.length === 0) {
      assert.ok(guard < 24);
      assert.ok(scheduler.pending > 0);
      scheduler.releaseNext();
      await flush();
      guard += 1;
    }

    await finishing;
    await flush();

    assert.equal(errors.length, 1);
    assert.strictEqual(errors[0], expected);
    assert.equal(scatterCalls, 1);
    assert.equal(root.querySelectorAll(
      '.is-outgoing, .is-scattering, .is-revealing, .is-exiting-to-portal'
    ).length, 0);
    assert.equal(root.querySelectorAll('.is-active').length, 1);
    assert.strictEqual(root.querySelector('.is-active'), slots[0]);
    assert.equal(slots[0].classList.contains('is-stable'), true);
    assert.equal(slots[0].querySelector('img').hasAttribute('aria-hidden'), false);
    assert.equal(slots[1].classList.contains('is-active'), false);
    assert.equal(slots[1].querySelector('img').getAttribute('aria-hidden'), 'true');
    assert.equal(root.dataset.portalSide, undefined);
    assert.equal(root.dataset.portalPhase, undefined);
    assert.deepEqual(unhandled, []);
  } finally {
    process.removeListener('unhandledRejection', handleUnhandled);
  }
});

test('switching to reduce during the final hold remainder settles finish immediately', async () => {
  const scheduler = makeManualScheduler();
  const { controller, root, slots } = makeFixture({ scheduler });
  controller.enqueue(slots[0]);
  await flush();
  let iterations = 0;
  while (controller.getState().processing) {
    assert.ok(iterations < 32, 'scheduler processing drain exceeded its bound');
    assert.ok(scheduler.pending > 0);
    scheduler.releaseNext();
    await flush();
    iterations += 1;
  }

  const finishing = controller.finish();
  await flush();
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.finalHold - POSTER_TIMING.normal.hold]);
  controller.setProfile('reduce');
  await finishing;

  assert.equal(scheduler.pending, 0);
  assert.equal(root.dataset.transitionSettled, 'true');
});

test('switching to reduce after finish preserves the settled presentation and promise', async () => {
  const { controller, particleCalls, root, slots } = makeFixture();
  controller.enqueue(slots[0]);
  const finishing = controller.finish();
  await finishing;
  const activeSlot = root.querySelector('.is-active');
  const callsBeforeProfileChange = particleCalls.length;

  assert.equal(root.classList.contains('is-final-resolving'), true);
  assert.equal(root.dataset.transitionSettled, 'true');
  assert.strictEqual(activeSlot, slots[0]);

  controller.setProfile('reduce');

  assert.equal(controller.getState().profile, 'reduce');
  assert.equal(root.dataset.motionProfile, 'reduce');
  assert.deepEqual(particleCalls.slice(callsBeforeProfileChange), [['profile', 'reduce']]);
  assert.equal(root.classList.contains('is-final-resolving'), true);
  assert.equal(root.dataset.transitionSettled, 'true');
  assert.strictEqual(root.querySelector('.is-active'), activeSlot);
  assert.strictEqual(controller.finish(), finishing);
});

test('enqueue defers collaborators to one microtask and stale reservations cannot start work', async () => {
  const microtasks = [];
  const scheduleMicrotask = (callback) => microtasks.push(callback);
  const fixture = makeFixture({ scheduleMicrotask });
  let boundsCalls = 0;
  fixture.slots[0].getBoundingClientRect = () => {
    boundsCalls += 1;
    return { left: 20, top: 30, right: 200, bottom: 270, width: 180, height: 240 };
  };
  const initialParticleCalls = fixture.particleCalls.length;

  assert.equal(fixture.controller.enqueue(fixture.slots[0]), true);
  assert.equal(fixture.controller.enqueue(fixture.slots[1]), true);
  assert.equal(microtasks.length, 1);
  assert.equal(boundsCalls, 0);
  assert.equal(fixture.particleCalls.length, initialParticleCalls);
  assert.deepEqual(fixture.sleeps, []);

  fixture.controller.reset();
  assert.equal(fixture.controller.enqueue(fixture.slots[2]), true);
  assert.equal(microtasks.length, 2);
  const callsAfterReset = fixture.particleCalls.length;
  microtasks.shift()();
  await flush();
  assert.equal(fixture.particleCalls.length, callsAfterReset);
  assert.deepEqual(fixture.sleeps, []);

  microtasks.shift()();
  await fixture.controller.waitForIdle();
  assert.equal(fixture.controller.getState().activeId, 'archive-03');

  const destroyed = makeFixture({ scheduleMicrotask });
  assert.equal(destroyed.controller.enqueue(destroyed.slots[0]), true);
  const staleDestroyTask = microtasks.shift();
  destroyed.controller.destroy();
  const callsAfterDestroy = destroyed.particleCalls.length;
  staleDestroyTask();
  await flush();
  assert.equal(destroyed.particleCalls.length, callsAfterDestroy);
});

test('finish resolves at the profile exit gate and stale final completion cannot mutate reset', async () => {
  const scheduler = makeManualScheduler({
    retainAfterAbort: ({ ms }) => ms === POSTER_TIMING.finalExposure
  });
  const { controller, root, slots } = makeFixture({ scheduler });
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
  assert.equal(root.classList.contains('is-final-resolving'), true);
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.exitLead, POSTER_TIMING.finalExposure]);
  scheduler.releaseNext();
  await flush();
  assert.equal(finished, true);
  assert.equal(root.dataset.transitionSettled, 'true');
  assert.equal(root.dataset.finalSettled, undefined);
  assert.equal(root.classList.contains('is-final-resolving'), true);
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.finalExposure]);
  const staleExposure = scheduler.entries.find(({ ms }) => ms === POSTER_TIMING.finalExposure);
  assert.ok(staleExposure);
  assert.equal(staleExposure.abortObserved, false);
  assert.equal(scheduler.pendingDuration(POSTER_TIMING.finalExposure), 1);

  controller.reset();
  assert.equal(staleExposure.abortObserved, true);
  assert.equal(scheduler.pendingDuration(POSTER_TIMING.finalExposure), 1);
  controller.enqueue(slots[1]);
  await flush();
  assert.equal(root.dataset.finalSettled, undefined);
  assert.deepEqual(scheduler.durations, [
    POSTER_TIMING.finalExposure,
    POSTER_TIMING.normal.gather
  ]);
  scheduler.releaseDuration(POSTER_TIMING.normal.gather);
  await flush();
  assert.equal(controller.getState().activeId, 'archive-02');
  const replacementState = {
    controller: controller.getState(),
    rootClass: root.className,
    activeClass: slots[1].className,
    transitionSettled: root.dataset.transitionSettled,
    finalSettled: root.dataset.finalSettled
  };

  assert.equal(staleExposure.release(true), true);
  assert.equal(scheduler.pendingDuration(POSTER_TIMING.finalExposure), 0);
  await flush();
  assert.equal(root.classList.contains('is-final-resolving'), false);
  assert.equal(root.dataset.transitionSettled, undefined);
  assert.equal(root.dataset.finalSettled, undefined);
  assert.equal(controller.getState().activeId, 'archive-02');
  assert.deepEqual({
    controller: controller.getState(),
    rootClass: root.className,
    activeClass: slots[1].className,
    transitionSettled: root.dataset.transitionSettled,
    finalSettled: root.dataset.finalSettled
  }, replacementState);
});

test('reset starts a new run immediately and stale particle completion cannot reactivate the old poster', async () => {
  const particleField = makeDeferredParticleField();
  const { controller, slots } = makeFixture({ particleField });
  controller.enqueue(slots[0]);
  await flush();
  const staleGather = particleField.pending.shift();
  assert.equal(staleGather.phase, 'gather');

  controller.reset();
  assert.equal(controller.enqueue(slots[1]), true);
  await flush();
  const currentGather = particleField.pending.shift();
  assert.equal(currentGather.phase, 'gather');
  currentGather.resolve();
  await flush();
  await controller.waitForIdle();

  staleGather.resolve();
  await flush();
  assert.equal(slots[0].classList.contains('is-active'), false);
  assert.equal(slots[1].classList.contains('is-active'), true);
  assert.equal(slots[0].dataset.transitionOrder, undefined);
  assert.equal(slots[1].dataset.transitionOrder, '1');
});

test('reset aborts an old finish exposure without settling the new run', async () => {
  const scheduler = makeManualScheduler();
  const { controller, root, slots } = makeFixture({ scheduler });
  controller.enqueue(slots[0]);
  const oldFinish = controller.finish();
  await flush();
  let iterations = 0;
  while (controller.getState().processing) {
    assert.ok(iterations < 32, 'scheduler processing drain exceeded its bound');
    assert.ok(scheduler.pending > 0);
    scheduler.releaseNext();
    await flush();
    iterations += 1;
  }
  assert.equal(root.classList.contains('is-final-resolving'), true);

  slots[0].classList.add('is-outgoing');
  slots[0].style.setProperty('--poster-handoff-ms', '260ms');
  root.style.setProperty('--slit-duration', '180ms');
  assert.equal(slots[0].style.getPropertyValue('--poster-handoff-ms'), '260ms');

  controller.reset();
  controller.enqueue(slots[1]);
  await oldFinish;
  await flush();

  assert.equal(root.classList.contains('is-final-resolving'), false);
  assert.equal(root.dataset.transitionSettled, undefined);
  assert.equal(root.querySelectorAll('.is-outgoing').length, 0);
  assert.equal(slots[0].style.getPropertyValue('--poster-handoff-ms'), '');
  assert.equal(
    root.style.getPropertyValue('--slit-duration'),
    `${PORTAL_DURATION}ms`
  );
  assert.equal(root.dataset.portalSide, 'top');
  assert.equal(root.dataset.portalPhase, 'enter');
  assert.equal(controller.getState().activeId, null);
  iterations = 0;
  while (scheduler.pending) {
    assert.ok(iterations < 32, 'scheduler pending drain exceeded its bound');
    assert.ok(scheduler.pending > 0);
    scheduler.releaseNext();
    await flush();
    iterations += 1;
  }
  await controller.waitForIdle();
  assert.equal(controller.getState().activeId, 'archive-02');
});

test('freeze aborts queued work but keeps the current poster active and stable', async () => {
  const scheduler = makeManualScheduler();
  const { controller, root, slit, slots } = makeFixture({ scheduler });
  controller.enqueue(slots[0]);
  controller.enqueue(slots[1]);
  await flush();
  let guard = 0;
  while (!slots[0].classList.contains('is-active')) {
    assert.ok(guard < 8);
    scheduler.releaseNext();
    await flush();
    guard += 1;
  }
  assert.equal(slots[0].classList.contains('is-active'), true);

  slots[1].classList.add('is-outgoing');
  slots[1].style.setProperty('--poster-handoff-ms', '260ms');
  root.style.setProperty('--slit-duration', '180ms');
  assert.equal(slots[1].style.getPropertyValue('--poster-handoff-ms'), '260ms');

  controller.freeze();

  assert.deepEqual(controller.getState(), {
    profile: 'full',
    queued: 0,
    activeId: 'archive-01',
    processing: false,
    sealed: true,
    destroyed: false
  });
  assert.equal(slots[0].classList.contains('is-active'), true);
  assert.equal(slots[0].classList.contains('is-stable'), true);
  assert.equal(slots[0].classList.contains('is-scattering'), false);
  assert.equal(slots[1].classList.contains('is-outgoing'), false);
  assert.equal(slots[1].style.getPropertyValue('--poster-handoff-ms'), '');
  assert.equal(slots[1].classList.contains('is-active'), false);
  assert.equal(slit.classList.contains('is-lit'), false);
  assert.equal(root.style.getPropertyValue('--slit-duration'), '');
  assert.equal(controller.enqueue(slots[2]), false);
});

test('assigns activation to the fixed portal for the requested side', async () => {
  const scheduler = makeManualScheduler();
  const dom = new JSDOM(`
    <div id="root">
      <div id="top"></div><div id="bottom"></div>
      <figure data-loading-slot="archive-01"><img alt="one"></figure>
    </div>
  `);
  const root = dom.window.document.getElementById('root');
  const top = dom.window.document.getElementById('top');
  const bottom = dom.window.document.getElementById('bottom');
  const slot = root.querySelector('[data-loading-slot]');
  Object.defineProperties(slot.querySelector('img'), {
    naturalWidth: { configurable: true, value: 300 },
    naturalHeight: { configurable: true, value: 400 }
  });
  slot.getBoundingClientRect = () => ({ left: 0, top: 0, right: 180, bottom: 240, width: 180, height: 240 });
  root.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400 });
  top.parentElement.getBoundingClientRect = root.getBoundingClientRect;
  const particleField = { gather() {}, scatter() {}, finish() {}, setProfile() {} };
  const controller = createPosterTransition({
    root,
    portals: { top, bottom },
    particleField,
    scheduler
  });

  controller.enqueue(slot);
  await flush();
  assert.equal(top.classList.contains('is-lit'), true);
  assert.equal(bottom.classList.contains('is-lit'), false);
  assert.equal(top.dataset.portalPhase, 'enter');
  assert.equal(top.style.getPropertyValue('--portal-y'), '12.00px');
  assert.equal(bottom.style.getPropertyValue('--portal-y'), '260.00px');
  controller.freeze();
});

test('writes fixed portal geometry in loading-stage coordinates', async () => {
  const scheduler = makeManualScheduler();
  const dom = new JSDOM(`
    <div id="root">
      <div id="stage">
        <div id="top"></div><div id="bottom"></div>
        <figure data-loading-slot="archive-01"><img alt="one"></figure>
      </div>
    </div>
  `);
  const root = dom.window.document.getElementById('root');
  const stage = dom.window.document.getElementById('stage');
  const top = dom.window.document.getElementById('top');
  const bottom = dom.window.document.getElementById('bottom');
  const slot = root.querySelector('[data-loading-slot]');
  root.getBoundingClientRect = () => ({
    left: 100, top: 40, right: 900, bottom: 640, width: 800, height: 600
  });
  stage.getBoundingClientRect = () => ({
    left: 160, top: 88, right: 840, bottom: 528, width: 680, height: 440
  });
  slot.getBoundingClientRect = () => ({
    left: 320, top: 128, right: 680, bottom: 488, width: 360, height: 360
  });
  const image = slot.querySelector('img');
  Object.defineProperties(image, {
    naturalWidth: { value: 1000 },
    naturalHeight: { value: 1000 }
  });
  const particleField = { gather() {}, scatter() {}, finish() {}, setProfile() {} };
  const controller = createPosterTransition({
    root,
    portals: { top, bottom },
    particleField,
    scheduler
  });

  controller.enqueue(slot);
  await flush();

  assert.equal(top.style.getPropertyValue('--portal-x'), '340.00px');
  assert.equal(bottom.style.getPropertyValue('--portal-x'), '340.00px');
  assert.equal(top.style.getPropertyValue('--portal-y'), '20.00px');
  assert.equal(bottom.style.getPropertyValue('--portal-y'), '420.00px');
  controller.freeze();
});

test('reset can discard queued work while preserving the active poster for a new finish run', async () => {
  const scheduler = makeManualScheduler();
  const { controller, root, slots } = makeFixture({ scheduler });
  controller.enqueue(slots[0]);
  controller.enqueue(slots[1]);
  controller.enqueue(slots[2]);
  await flush();

  let guard = 0;
  while (!slots[0].classList.contains('is-active')) {
    assert.ok(guard < 8);
    assert.ok(scheduler.pending > 0);
    scheduler.releaseNext();
    await flush();
    guard += 1;
  }
  const interruptedSignals = scheduler.signals;

  controller.reset({ preserveActive: true });
  await flush();

  assert.equal(interruptedSignals.every((signal) => signal.aborted), true);
  assert.deepEqual(controller.getState(), {
    profile: 'full',
    queued: 0,
    activeId: 'archive-01',
    processing: false,
    sealed: false,
    destroyed: false
  });
  assert.equal(root.querySelectorAll('.is-active').length, 1);
  assert.equal(slots[0].classList.contains('is-active'), true);
  assert.equal(slots[0].classList.contains('is-stable'), true);
  assert.equal(slots[1].classList.contains('is-active'), false);
  assert.equal(slots[2].classList.contains('is-active'), false);
  assert.equal(controller.enqueue(slots[0]), false);
});

test('reduce profile uses direct fades without gather, scatter, or a lit slit', async () => {
  const { controller, particleCalls, root, sleeps, slit, slots } = makeFixture({ profile: 'reduce' });
  slots.slice(0, 2).forEach((slot) => controller.enqueue(slot));
  await controller.finish();

  assert.equal(root.dataset.motionProfile, 'reduce');
  assert.equal(particleCalls.some(([name]) => name === 'gather' || name === 'scatter'), false);
  assert.ok(particleCalls.some(([name]) => name === 'finish'));
  assert.equal(slit.classList.contains('is-lit'), false);
  assert.equal(root.classList.contains('is-scanning'), false);
  assert.ok(sleeps.includes(POSTER_TIMING.reduceFade));
  assert.equal(sleeps.includes(POSTER_TIMING.finalExposure), false);
});

test('switching to reduce mid-entry cancels portal animation and resumes every item as a fade', async () => {
  const scheduler = makeManualScheduler();
  const { controller, particleCalls, slit, slots } = makeFixture({ scheduler });
  controller.enqueue(slots[0]);
  controller.enqueue(slots[1]);
  await flush();
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.normal.gather]);
  scheduler.releaseDuration(POSTER_TIMING.normal.gather);
  await flush();
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.normal.handoff]);
  assert.equal(slots[0].classList.contains('is-entering-from-portal'), true);

  slots[0].style.setProperty('--poster-handoff-ms', '260ms');
  assert.equal(slots[0].style.getPropertyValue('--poster-handoff-ms'), '260ms');

  controller.setProfile('reduce');
  assert.equal(slots[0].style.getPropertyValue('--poster-handoff-ms'), '');
  await flush();
  let iterations = 0;
  while (controller.getState().processing) {
    assert.ok(iterations < 32, 'scheduler processing drain exceeded its bound');
    assert.ok(scheduler.pending > 0);
    scheduler.releaseNext();
    await flush();
    iterations += 1;
  }
  await controller.waitForIdle();

  assert.equal(scheduler.sleepCalls.includes(POSTER_TIMING.normal.reveal), true);
  assert.deepEqual(
    scheduler.sleepCalls,
    [
      POSTER_TIMING.normal.gather,
      POSTER_TIMING.normal.handoff,
      POSTER_TIMING.reduceFade,
      POSTER_TIMING.reduceFade
    ]
  );
  assert.ok(particleCalls.some(([name]) => name === 'finish'));
  assert.equal(slit.classList.contains('is-lit'), false);
  assert.equal(slots[0].classList.contains('is-active'), false);
  assert.equal(slots[1].classList.contains('is-active'), true);
  assert.equal(slots[1].classList.contains('is-stable'), true);
  assert.equal(controller.getState().activeId, 'archive-02');
});

test('a late gather completion cannot clear tracking for the same resumed reduce item', async () => {
  const scheduler = makeManualScheduler();
  const particleField = makeDeferredParticleField();
  const { controller, slots } = makeFixture({ particleField, scheduler });
  controller.enqueue(slots[0]);
  await flush();
  scheduler.releaseDuration(POSTER_TIMING.normal.gather);
  await flush();
  const staleGather = particleField.pending.shift();
  assert.equal(staleGather.phase, 'gather');

  controller.setProfile('reduce');
  await flush();
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.reduceFade]);
  staleGather.resolve();
  await flush();

  controller.setProfile('compact');
  controller.setProfile('reduce');
  await flush();
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.reduceFade]);
  assert.equal(controller.getState().processing, true);

  scheduler.releaseNext();
  await flush();
  await controller.waitForIdle();
  assert.deepEqual(scheduler.sleepCalls, [
    POSTER_TIMING.normal.gather,
    POSTER_TIMING.normal.handoff,
    POSTER_TIMING.reduceFade,
    POSTER_TIMING.reduceFade
  ]);
  assert.equal(slots[0].classList.contains('is-active'), true);
  assert.equal(slots[0].classList.contains('is-stable'), true);
});

test('animation errors stabilize the current poster, reject finish once, and reset recovers', async () => {
  const expected = new Error('particle render failed');
  let gatherCalls = 0;
  const particleCalls = [];
  const particleField = {
    gather() {
      gatherCalls += 1;
      particleCalls.push(['gather']);
      if (gatherCalls === 2) throw expected;
    },
    scatter() {
      particleCalls.push(['scatter']);
    },
    finish() {
      particleCalls.push(['finish']);
    },
    setProfile(profile) {
      particleCalls.push(['profile', profile]);
    }
  };
  const errors = [];
  const { controller, slots } = makeFixture({
    particleField,
    onError: (error) => errors.push(error)
  });
  controller.enqueue(slots[0]);
  controller.enqueue(slots[1]);

  slots[0].style.setProperty('--poster-handoff-ms', '260ms');
  assert.equal(slots[0].style.getPropertyValue('--poster-handoff-ms'), '260ms');
  await assert.rejects(controller.finish(), expected);
  assert.deepEqual(errors, [expected]);
  assert.equal(controller.getState().queued, 0);
  assert.equal(slots[0].classList.contains('is-active'), false);
  assert.equal(slots[1].classList.contains('is-active'), true);
  assert.equal(slots[1].classList.contains('is-stable'), true);
  assert.equal(slots[0].style.getPropertyValue('--poster-handoff-ms'), '');
  assert.equal(slots[0].dataset.status, undefined, 'visual failures must not become image failures');

  controller.reset();
  assert.equal(controller.enqueue(slots[2]), true);
  await controller.finish();
  assert.equal(controller.getState().activeId, 'archive-03');
  assert.equal(errors.length, 1);
});

test('an asynchronous animation error aborts pending timing and seals the run until reset', async () => {
  const scheduler = makeManualScheduler();
  const expected = new Error('async gather failed');
  const particleField = {
    gather: () => Promise.reject(expected),
    scatter() {},
    finish() {},
    setProfile() {}
  };
  const { controller, errors, slots } = makeFixture({ particleField, scheduler });
  controller.enqueue(slots[0]);
  await flush();
  scheduler.releaseDuration(POSTER_TIMING.normal.gather);
  await flush();
  await controller.waitForIdle();

  assert.equal(scheduler.pending, 0);
  assert.equal(controller.getState().sealed, true);
  assert.equal(controller.enqueue(slots[1]), false);
  assert.deepEqual(errors, [expected]);
  await assert.rejects(controller.finish(), expected);

  controller.reset();
  assert.equal(controller.getState().sealed, false);
});

test('cleanup adopts rejected particle finish promises without replacing outcomes', async () => {
  const cleanupError = new Error('particle cleanup failed');
  const originalError = new Error('original visual failure');
  const unhandled = [];
  const handleUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', handleUnhandled);

  try {
    let cleanupCalls = 0;
    const cleanupField = {
      gather() {},
      scatter() {},
      finish() {
        cleanupCalls += 1;
        return Promise.reject(cleanupError);
      },
      setProfile() {}
    };
    const cleanupFixture = makeFixture({ particleField: cleanupField });
    cleanupFixture.controller.reset();
    cleanupFixture.controller.freeze();
    cleanupFixture.controller.reset();
    cleanupFixture.controller.destroy();

    const failureField = {
      gather: () => Promise.reject(originalError),
      scatter() {},
      finish: () => Promise.reject(cleanupError),
      setProfile() {}
    };
    const failureFixture = makeFixture({ particleField: failureField });
    failureFixture.controller.enqueue(failureFixture.slots[0]);
    await assert.rejects(failureFixture.controller.finish(), originalError);
    await flush();

    assert.equal(cleanupCalls, 4);
    assert.deepEqual(failureFixture.errors, [originalError]);
    assert.deepEqual(unhandled, []);
  } finally {
    process.removeListener('unhandledRejection', handleUnhandled);
  }
});

test('setProfile forwards valid changes and destroy is idempotent and terminal', async () => {
  const { controller, images, particleCalls, root, slots } = makeFixture();
  controller.setProfile('compact');
  assert.equal(root.dataset.motionProfile, 'compact');
  assert.deepEqual(particleCalls.at(-1), ['profile', 'compact']);
  controller.setProfile('compact');
  assert.deepEqual(
    particleCalls.filter(([name]) => name === 'profile').map(([, value]) => value),
    ['full', 'compact', 'compact']
  );
  controller.enqueue(slots[0]);
  const waitForIdle = controller.waitForIdle;
  await waitForIdle();

  slots[1].classList.add('is-outgoing');
  slots[1].style.setProperty('--poster-handoff-ms', '260ms');
  root.style.setProperty('--slit-duration', '180ms');
  assert.equal(slots[1].style.getPropertyValue('--poster-handoff-ms'), '260ms');

  controller.destroy();
  controller.destroy();
  assert.equal(controller.enqueue(slots[1]), false);
  assert.equal(root.querySelectorAll('.is-active, .is-outgoing, .is-revealing, .is-scattering, .is-stable').length, 0);
  assert.equal(slots[1].style.getPropertyValue('--poster-handoff-ms'), '');
  assert.equal(root.style.getPropertyValue('--slit-duration'), '');
  assert.equal(images.every((image) => image.getAttribute('aria-hidden') === 'true'), true);
  assert.deepEqual(controller.getState(), {
    profile: 'compact', queued: 0, activeId: null, processing: false, sealed: false, destroyed: true
  });
});

test('queue source has no network, clone, src assignment, or decode ownership', () => {
  const source = readFileSync(new URL('../../src/ui/poster-transition.js', import.meta.url), 'utf8');
  for (const forbidden of ['fetch(', 'cloneNode(', '.decode(', '.src =', "setAttribute('src'"]) {
    assert.equal(source.includes(forbidden), false, `poster queue must not contain ${forbidden}`);
  }
});
