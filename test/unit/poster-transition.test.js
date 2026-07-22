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

  return {
    sleep(ms, signal) {
      return new Promise((resolve) => {
        let settled = false;
        const entry = {
          ms,
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
    get pending() {
      return pending.length;
    },
    get durations() {
      return pending.map(({ ms }) => ms);
    }
  };
};

const makeDeferredParticleField = () => {
  const pending = [];
  const calls = [];
  const start = (phase, bounds) => new Promise((resolve, reject) => {
    calls.push([phase, bounds]);
    pending.push({ phase, resolve, reject });
  });

  return {
    calls,
    pending,
    gather: (bounds) => start('gather', bounds),
    scatter: (bounds) => start('scatter', bounds),
    finish() {
      calls.push(['finish']);
    },
    setProfile(profile) {
      calls.push(['profile', profile]);
    }
  };
};

const makeFixture = ({ scheduler, particleField, profile = 'full', onError } = {}) => {
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
    gather(bounds) {
      particleCalls.push(['gather', bounds]);
    },
    scatter(bounds) {
      particleCalls.push(['scatter', bounds]);
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
    onError: onError || ((error) => errors.push(error))
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

test('timing tables are deeply frozen and preserve exact phase totals', () => {
  assert.deepEqual(POSTER_TIMING, {
    normal: { gather: 160, scatter: 160, reveal: 180, hold: 300 },
    fast: { gather: 80, scatter: 100, reveal: 100, hold: 160 },
    finalHold: 520,
    finalExposure: 360,
    reduceFade: 120
  });
  assert.equal(Object.values(POSTER_TIMING.normal).reduce((sum, value) => sum + value, 0), 800);
  assert.equal(Object.values(POSTER_TIMING.fast).reduce((sum, value) => sum + value, 0), 440);
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

test('rapid backlog uses fast intermediate phases and preserves final hold and exposure', async () => {
  const { controller, sleeps, slots } = makeFixture();
  slots.forEach((slot) => controller.enqueue(slot));
  await controller.finish();

  assert.ok(sleeps.includes(POSTER_TIMING.fast.gather));
  assert.ok(sleeps.includes(POSTER_TIMING.fast.scatter));
  assert.ok(sleeps.includes(POSTER_TIMING.fast.reveal));
  assert.ok(sleeps.includes(POSTER_TIMING.finalHold));
  assert.equal(sleeps.at(-1), POSTER_TIMING.finalExposure);
  assert.equal(slots[1].style.getPropertyValue('--poster-reveal-ms'), `${POSTER_TIMING.fast.reveal}ms`);
});

test('waitForIdle settles before finish completes its final exposure', async () => {
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
  assert.deepEqual(scheduler.durations, [POSTER_TIMING.finalExposure]);
  scheduler.releaseNext();
  await flush();
  assert.equal(finished, true);
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
  while (controller.getState().processing) {
    scheduler.releaseNext();
    await flush();
  }
  assert.equal(root.classList.contains('is-final-exposure'), true);

  controller.reset();
  controller.enqueue(slots[1]);
  await oldFinish;
  await flush();

  assert.equal(root.classList.contains('is-final-exposure'), false);
  assert.equal(root.dataset.transitionSettled, undefined);
  assert.equal(controller.getState().activeId, null);
  while (scheduler.pending) {
    scheduler.releaseNext();
    await flush();
  }
  await controller.waitForIdle();
  assert.equal(controller.getState().activeId, 'archive-02');
});

test('freeze aborts queued work but keeps the current poster active and stable', async () => {
  const scheduler = makeManualScheduler();
  const { controller, slit, slots } = makeFixture({ scheduler });
  controller.enqueue(slots[0]);
  controller.enqueue(slots[1]);
  await flush();
  scheduler.releaseNext();
  await flush();
  assert.equal(slots[0].classList.contains('is-active'), true);

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
  assert.equal(slots[1].classList.contains('is-active'), false);
  assert.equal(slit.classList.contains('is-lit'), false);
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

  await assert.rejects(controller.finish(), expected);
  assert.deepEqual(errors, [expected]);
  assert.equal(controller.getState().queued, 0);
  assert.equal(slots[0].classList.contains('is-active'), true);
  assert.equal(slots[0].classList.contains('is-stable'), true);
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

  controller.destroy();
  controller.destroy();
  assert.equal(controller.enqueue(slots[1]), false);
  assert.equal(root.querySelectorAll('.is-active, .is-revealing, .is-scattering, .is-stable').length, 0);
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
