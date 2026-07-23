import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import {
  POSTER_TIMING,
  createPosterTransition
} from '../../src/ui/poster-transition.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

const makeImmediateScheduler = (sleeps) => ({
  async sleep(ms, signal) {
    sleeps.push(ms);
    return !signal.aborted;
  }
});

const makeManualScheduler = () => {
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
          release(value = true) {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', abort);
            const index = pending.indexOf(entry);
            if (index >= 0) pending.splice(index, 1);
            resolve(value);
          }
        };
        const abort = () => entry.release(false);

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
  const start = (phase, bounds, duration) => new Promise((resolve, reject) => {
    calls.push([phase, bounds, duration]);
    pending.push({ phase, duration, resolve, reject });
  });

  return {
    calls,
    pending,
    gather: (bounds, duration) => start('gather', bounds, duration),
    scatter: (bounds, duration) => start('scatter', bounds, duration),
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
  const defaultParticleField = {
    gather(bounds, duration) {
      particleCalls.push(['gather', bounds, duration]);
    },
    scatter(bounds, duration) {
      particleCalls.push(['scatter', bounds, duration]);
    },
    finish() {
      particleCalls.push(['finish']);
    },
    setProfile(nextProfile) {
      particleCalls.push(['profile', nextProfile]);
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
    scheduleMicrotask
  });

  return {
    controller,
    document,
    errors,
    images,
    particleCalls: particleField?.calls || particleCalls,
    particleField: particleField || defaultParticleField,
    root,
    sleeps,
    slit,
    slots
  };
};

test('timing tables are deeply frozen and preserve exact Visual 7 wall times', () => {
  assert.deepEqual(POSTER_TIMING, {
    normal: { gather: 140, scatter: 360, reveal: 440, hold: 220 },
    fast: { gather: 80, scatter: 240, reveal: 300, hold: 120 },
    finalHold: 420,
    finalExposure: 560,
    exitLead: 180,
    reduceFade: 120
  });
  const wallTime = ({ gather, scatter, reveal, hold }) => (
    gather + Math.max(scatter, reveal) + hold
  );
  assert.equal(wallTime(POSTER_TIMING.normal), 800);
  assert.equal(wallTime(POSTER_TIMING.fast), 500);
  assert.equal(POSTER_TIMING.exitLead, 180);
  assert.equal(POSTER_TIMING.finalExposure - POSTER_TIMING.exitLead, 380);
  assert.equal(Object.isFrozen(POSTER_TIMING), true);
  assert.equal(Object.isFrozen(POSTER_TIMING.normal), true);
  assert.equal(Object.isFrozen(POSTER_TIMING.fast), true);
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

test('rapid enqueue is synchronous, FIFO, alternates direction, and preserves exact image nodes', async () => {
  const { controller, images, root, slots } = makeFixture();
  const returns = slots.map((slot) => controller.enqueue(slot));

  assert.deepEqual(returns, [true, true, true, true, true]);
  assert.equal(controller.enqueue(slots[0]), false, 'a decoded slot is accepted once per run');
  assert.deepEqual(slots.map((slot) => slot.dataset.transitionOrder), ['1', '2', '3', '4', '5']);
  assert.deepEqual(slots.map((slot) => slot.dataset.slitDirection), ['ltr', 'rtl', 'ltr', 'rtl', 'ltr']);

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
  assert.deepEqual(compressedRounds, [
    [POSTER_TIMING.fast.gather],
    [POSTER_TIMING.fast.reveal],
    [POSTER_TIMING.fast.hold],
    [POSTER_TIMING.fast.gather],
    [POSTER_TIMING.fast.scatter, POSTER_TIMING.fast.reveal],
    [POSTER_TIMING.fast.hold],
    [POSTER_TIMING.fast.gather],
    [POSTER_TIMING.fast.scatter, POSTER_TIMING.fast.reveal],
    [POSTER_TIMING.fast.hold],
    [POSTER_TIMING.fast.gather],
    [POSTER_TIMING.fast.scatter, POSTER_TIMING.fast.reveal],
    [POSTER_TIMING.fast.hold],
    [POSTER_TIMING.fast.gather],
    [POSTER_TIMING.fast.scatter, POSTER_TIMING.fast.reveal],
    [POSTER_TIMING.finalHold]
  ]);
  const compressedWallClock = compressedRounds.reduce(
    (total, durations) => total + Math.max(...durations),
    0
  );
  assert.equal(
    compressedWallClock,
    (5 * POSTER_TIMING.fast.gather)
      + POSTER_TIMING.fast.reveal
      + (4 * Math.max(POSTER_TIMING.fast.scatter, POSTER_TIMING.fast.reveal))
      + (4 * POSTER_TIMING.fast.hold)
      + POSTER_TIMING.finalHold
  );
  assert.ok(slots.every(
    (slot) => slot.style.getPropertyValue('--poster-reveal-ms')
      === String(POSTER_TIMING.fast.reveal) + 'ms'
  ));
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
    [POSTER_TIMING.normal.reveal],
    [POSTER_TIMING.normal.hold]
  ]);
  assert.equal(
    slots[0].style.getPropertyValue('--poster-reveal-ms'),
    String(POSTER_TIMING.normal.reveal) + 'ms'
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
    POSTER_TIMING.normal.reveal,
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

test('finish during a pre-classified normal hold waits its remainder before exposure', async () => {
  const scheduler = makeManualScheduler();
  const { controller, slots } = makeFixture({ scheduler });
  controller.enqueue(slots[0]);
  await flush();
  scheduler.releaseNext();
  await flush();
  scheduler.releaseNext();
  await flush();
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

test('animated transitions overlap outgoing scatter with incoming reveal', async () => {
  const scheduler = makeManualScheduler();
  const { controller, particleCalls, root, slit, slots } = makeFixture({ scheduler });
  controller.enqueue(slots[0]);
  controller.enqueue(slots[1]);
  await flush();

  scheduler.releaseNext();
  await flush();
  scheduler.releaseNext();
  await flush();
  scheduler.releaseNext();
  await flush();
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.normal.gather]);

  scheduler.releaseNext();
  await flush();

  const outgoing = slots[0];
  const incoming = slots[1];
  assert.equal(outgoing.classList.contains('is-outgoing'), true);
  assert.equal(outgoing.classList.contains('is-active'), false);
  assert.equal(outgoing.querySelector('img').getAttribute('aria-hidden'), 'true');
  assert.equal(incoming.classList.contains('is-active'), true);
  assert.equal(incoming.classList.contains('is-revealing'), true);
  assert.equal(root.querySelectorAll('.is-active').length, 1);
  assert.equal(root.querySelectorAll('.is-active, .is-outgoing').length, 2);
  assert.equal(root.style.getPropertyValue('--slit-duration'), `${POSTER_TIMING.normal.reveal}ms`);
  assert.ok(particleCalls.some(([name]) => name === 'scatter'));
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.normal.scatter, POSTER_TIMING.normal.reveal]);
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

  scheduler.releaseNext();
  await flush();
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
      gather(bounds, duration = 2_000) {
        calls.push(['gather', duration, bounds]);
      },
      scatter(bounds, duration = 2_000) {
        calls.push(['scatter', duration, bounds]);
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
    [POSTER_TIMING.normal.gather, POSTER_TIMING.normal.gather]
  );
  assert.deepEqual(
    normalField.calls.filter(([phase]) => phase === 'scatter').map(([, duration]) => duration),
    [POSTER_TIMING.normal.scatter]
  );

  const fastField = makeSlowField();
  const fast = makeFixture({ particleField: fastField });
  fast.slots.forEach((slot) => fast.controller.enqueue(slot));
  await fast.controller.waitForIdle();
  assert.deepEqual(
    fastField.calls.filter(([phase]) => phase === 'gather').map(([, duration]) => duration),
    Array(5).fill(POSTER_TIMING.fast.gather)
  );
  assert.deepEqual(
    fastField.calls.filter(([phase]) => phase === 'scatter').map(([, duration]) => duration),
    Array(4).fill(POSTER_TIMING.fast.scatter)
  );
});

test('full to compact settles particles without cancelling the poster handoff', async () => {
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

  settleParticle();
  scheduler.releaseNext();
  await flush();
  scheduler.releaseNext();
  await flush();
  scheduler.releaseNext();
  await flush();
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.normal.gather]);

  settleParticle();
  scheduler.releaseNext();
  await flush();
  assert.equal(slots[0].classList.contains('is-outgoing'), true);
  assert.equal(slots[1].classList.contains('is-revealing'), true);
  assert.deepEqual(scheduler.durations, [
    POSTER_TIMING.normal.scatter,
    POSTER_TIMING.normal.reveal
  ]);
  const signalsBeforeChange = scheduler.signals;
  assert.equal(signalsBeforeChange.every((signal) => !signal.aborted), true);

  controller.setProfile('compact');
  await flush();

  assert.equal(controller.getState().profile, 'compact');
  assert.equal(controller.getState().processing, true);
  assert.equal(root.dataset.motionProfile, 'compact');
  assert.deepEqual(particleCalls.slice(-2), [
    ['profile', 'compact'],
    ['settle', 'scatter']
  ]);
  assert.deepEqual(scheduler.signals, signalsBeforeChange);
  assert.equal(scheduler.signals.every((signal) => !signal.aborted), true);
  assert.deepEqual(scheduler.durations, [
    POSTER_TIMING.normal.scatter,
    POSTER_TIMING.normal.reveal
  ]);
  assert.equal(slots[0].classList.contains('is-outgoing'), true);
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
  assert.equal(
    particleCalls.some(([phase, profile]) => phase === 'gather' && profile === 'compact'),
    true
  );

  settleParticle();
  scheduler.releaseNext();
  await flush();
  assert.equal(
    slots[2].style.getPropertyValue('--poster-reveal-ms'),
    `${POSTER_TIMING.normal.reveal}ms`
  );

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
  assert.equal(controller.getState().activeId, 'archive-03');
});

test('scatter rejection during overlap stabilizes the incoming poster and cleans transient state', async () => {
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
    scheduler.releaseNext();
    await flush();
    scheduler.releaseNext();
    await flush();
    scheduler.releaseNext();
    await flush();
    scheduler.releaseNext();
    await flush();

    await finishing;
    await flush();

    assert.equal(errors.length, 1);
    assert.strictEqual(errors[0], expected);
    assert.equal(scatterCalls, 1);
    assert.equal(root.querySelectorAll('.is-outgoing, .is-scattering, .is-revealing').length, 0);
    assert.equal(root.querySelectorAll('.is-active').length, 1);
    assert.strictEqual(root.querySelector('.is-active'), slots[1]);
    assert.equal(slots[1].classList.contains('is-stable'), true);
    assert.equal(slots[1].querySelector('img').hasAttribute('aria-hidden'), false);
    assert.equal(slots[0].classList.contains('is-active'), false);
    assert.equal(slots[0].querySelector('img').getAttribute('aria-hidden'), 'true');
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

  assert.equal(root.classList.contains('is-final-exposure'), true);
  assert.equal(root.dataset.transitionSettled, 'true');
  assert.strictEqual(activeSlot, slots[0]);

  controller.setProfile('reduce');

  assert.equal(controller.getState().profile, 'reduce');
  assert.equal(root.dataset.motionProfile, 'reduce');
  assert.deepEqual(particleCalls.slice(callsBeforeProfileChange), [['profile', 'reduce']]);
  assert.equal(root.classList.contains('is-final-exposure'), true);
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

test('finish resolves at the 180ms exit gate and stale exposure completion cannot mutate reset', async () => {
  const scheduler = makeManualScheduler();
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
  assert.equal(root.classList.contains('is-final-exposure'), true);
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.exitLead, POSTER_TIMING.finalExposure]);
  scheduler.releaseNext();
  await flush();
  assert.equal(finished, true);
  assert.equal(root.dataset.transitionSettled, 'true');
  assert.equal(root.dataset.exposureSettled, undefined);
  assert.equal(root.classList.contains('is-final-exposure'), true);
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.finalExposure]);
  const staleExposure = scheduler.entries.find(({ ms }) => ms === POSTER_TIMING.finalExposure);
  assert.ok(staleExposure);

  controller.reset();
  controller.enqueue(slots[1]);
  await flush();
  assert.equal(root.dataset.exposureSettled, undefined);
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.normal.gather]);
  scheduler.releaseDuration(POSTER_TIMING.normal.gather);
  await flush();
  assert.equal(controller.getState().activeId, 'archive-02');

  staleExposure.release(true);
  await flush();
  assert.equal(root.classList.contains('is-final-exposure'), false);
  assert.equal(root.dataset.transitionSettled, undefined);
  assert.equal(root.dataset.exposureSettled, undefined);
  assert.equal(controller.getState().activeId, 'archive-02');
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
  assert.equal(root.classList.contains('is-final-exposure'), true);

  slots[0].classList.add('is-outgoing');
  slots[0].style.setProperty('--poster-scatter-ms', '260ms');
  root.style.setProperty('--slit-duration', '180ms');
  assert.equal(slots[0].style.getPropertyValue('--poster-scatter-ms'), '260ms');

  controller.reset();
  controller.enqueue(slots[1]);
  await oldFinish;
  await flush();

  assert.equal(root.classList.contains('is-final-exposure'), false);
  assert.equal(root.dataset.transitionSettled, undefined);
  assert.equal(root.querySelectorAll('.is-outgoing').length, 0);
  assert.equal(slots[0].style.getPropertyValue('--poster-scatter-ms'), '');
  assert.equal(root.style.getPropertyValue('--slit-duration'), '');
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
  scheduler.releaseNext();
  await flush();
  assert.equal(slots[0].classList.contains('is-active'), true);

  slots[1].classList.add('is-outgoing');
  slots[1].style.setProperty('--poster-scatter-ms', '260ms');
  root.style.setProperty('--slit-duration', '180ms');
  assert.equal(slots[1].style.getPropertyValue('--poster-scatter-ms'), '260ms');

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
  assert.equal(slots[1].style.getPropertyValue('--poster-scatter-ms'), '');
  assert.equal(slots[1].classList.contains('is-active'), false);
  assert.equal(slit.classList.contains('is-lit'), false);
  assert.equal(root.style.getPropertyValue('--slit-duration'), '');
  assert.equal(controller.enqueue(slots[2]), false);
});

test('reduce profile uses direct fades without gather, scatter, or a lit slit', async () => {
  const { controller, particleCalls, root, sleeps, slit, slots } = makeFixture({ profile: 'reduce' });
  slots.slice(0, 2).forEach((slot) => controller.enqueue(slot));
  await controller.finish();

  assert.equal(root.dataset.motionProfile, 'reduce');
  assert.equal(particleCalls.some(([name]) => name === 'gather' || name === 'scatter'), false);
  assert.ok(particleCalls.some(([name]) => name === 'finish'));
  assert.equal(slit.classList.contains('is-lit'), false);
  assert.ok(sleeps.includes(POSTER_TIMING.reduceFade));
  assert.equal(sleeps.includes(POSTER_TIMING.finalExposure), false);
});

test('switching to reduce mid-gather cancels animation and resumes every item as a fade', async () => {
  const scheduler = makeManualScheduler();
  const { controller, particleCalls, slit, slots } = makeFixture({ scheduler });
  controller.enqueue(slots[0]);
  controller.enqueue(slots[1]);
  await flush();
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.normal.gather]);

  slots[0].style.setProperty('--poster-scatter-ms', '260ms');
  assert.equal(slots[0].style.getPropertyValue('--poster-scatter-ms'), '260ms');

  controller.setProfile('reduce');
  assert.equal(slots[0].style.getPropertyValue('--poster-scatter-ms'), '');
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

  assert.equal(scheduler.sleepCalls.includes(POSTER_TIMING.normal.reveal), false);
  assert.deepEqual(
    scheduler.sleepCalls,
    [POSTER_TIMING.normal.gather, POSTER_TIMING.reduceFade, POSTER_TIMING.reduceFade]
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
  const staleGather = particleField.pending.shift();

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

  slots[0].style.setProperty('--poster-scatter-ms', '260ms');
  assert.equal(slots[0].style.getPropertyValue('--poster-scatter-ms'), '260ms');
  await assert.rejects(controller.finish(), expected);
  assert.deepEqual(errors, [expected]);
  assert.equal(controller.getState().queued, 0);
  assert.equal(slots[0].classList.contains('is-active'), true);
  assert.equal(slots[0].classList.contains('is-stable'), true);
  assert.equal(slots[0].style.getPropertyValue('--poster-scatter-ms'), '');
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
  slots[1].style.setProperty('--poster-scatter-ms', '260ms');
  root.style.setProperty('--slit-duration', '180ms');
  assert.equal(slots[1].style.getPropertyValue('--poster-scatter-ms'), '260ms');

  controller.destroy();
  controller.destroy();
  assert.equal(controller.enqueue(slots[1]), false);
  assert.equal(root.querySelectorAll('.is-active, .is-outgoing, .is-revealing, .is-scattering, .is-stable').length, 0);
  assert.equal(slots[1].style.getPropertyValue('--poster-scatter-ms'), '');
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
