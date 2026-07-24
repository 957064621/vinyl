import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  animateWithCleanup,
  createMotionController,
  detectMotionProfile,
  tweenWithCleanup
} from '../../src/motion/motion-controller.js';
import { createAppTransitions } from '../../src/app/transitions.js';

const media = (reduce, coarse) => (query) => ({
  matches: query.includes('reduced-motion') ? reduce : coarse
});

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

test('selects reduce first, compact for coarse/mobile, and full for desktop', () => {
  assert.equal(detectMotionProfile({ matchMedia: media(true, false), userAgent: '' }), 'reduce');
  assert.equal(detectMotionProfile({ matchMedia: media(false, true), userAgent: '' }), 'compact');
  assert.equal(detectMotionProfile({ matchMedia: media(false, false), userAgent: 'MicroMessenger iPhone' }), 'compact');
  assert.equal(detectMotionProfile({ matchMedia: media(false, false), userAgent: 'Desktop Chrome' }), 'full');
});

test('rejects an unknown motion profile', () => {
  assert.throws(
    () => createMotionController({ profile: 'cinematic', transitions: {} }),
    /Unknown motion profile: cinematic/
  );
});

test('runs one transition at a time and settles the interrupted promise', async () => {
  const events = [];
  const transitions = {
    draw: ({ signal }) => new Promise((resolve) => {
      events.push('draw:start');
      signal.addEventListener('abort', () => {
        events.push('draw:abort');
        setImmediate(() => {
          events.push('draw:cleanup');
          resolve();
        });
      }, { once: true });
    }),
    openOverlay: async ({ kind }) => { events.push(`open:${kind}`); }
  };
  const motion = createMotionController({ profile: 'compact', transitions });
  const draw = motion.draw(3);
  const open = motion.openOverlay('playlist');
  assert.deepEqual(await draw, { status: 'cancelled', name: 'draw' });
  assert.deepEqual(await open, { status: 'completed', name: 'open:playlist' });
  assert.deepEqual(events, ['draw:start', 'draw:abort', 'draw:cleanup', 'open:playlist']);
});

test('only the latest request starts in a triple-request race', async () => {
  const firstCleanup = createDeferred();
  const events = [];
  const transitions = {
    draw: ({ signal }) => new Promise((resolve) => {
      events.push('draw:start');
      signal.addEventListener('abort', async () => {
        events.push('draw:abort');
        await firstCleanup.promise;
        events.push('draw:cleanup');
        resolve();
      }, { once: true });
    }),
    openOverlay: async ({ kind }) => { events.push(`open:${kind}`); },
    closeOverlay: async ({ kind }) => { events.push(`close:${kind}`); }
  };
  const motion = createMotionController({ profile: 'full', transitions });
  const first = motion.draw(1);
  const second = motion.openOverlay('lyrics');
  const third = motion.closeOverlay('playlist');
  firstCleanup.resolve();

  assert.deepEqual(await first, { status: 'cancelled', name: 'draw' });
  assert.deepEqual(await second, { status: 'cancelled', name: 'open:lyrics' });
  assert.deepEqual(await third, { status: 'completed', name: 'close:playlist' });
  assert.deepEqual(events, ['draw:start', 'draw:abort', 'draw:cleanup', 'close:playlist']);
});

test('propagates a current transition error and clears activity', async () => {
  const expected = new Error('transition failed');
  const activity = [];
  const motion = createMotionController({
    profile: 'full',
    transitions: { draw: async () => { throw expected; } },
    onActivityChange: (state) => activity.push(state)
  });

  await assert.rejects(motion.draw(2), (error) => error === expected);
  assert.equal(motion.isActive(), false);
  assert.deepEqual(activity.map(({ active }) => active), [true, false]);
});

test('cancel and dispose both settle active work', async () => {
  const events = [];
  const transition = ({ signal }) => new Promise((resolve) => {
    signal.addEventListener('abort', () => {
      events.push(signal.reason);
      resolve();
    }, { once: true });
  });
  const motion = createMotionController({
    profile: 'compact',
    transitions: { draw: transition, openOverlay: transition, dispose: () => events.push('disposed') }
  });

  const draw = motion.draw(0);
  await motion.cancel('manual');
  assert.deepEqual(await draw, { status: 'cancelled', name: 'draw' });

  const open = motion.openOverlay('lyrics');
  await motion.dispose();
  assert.deepEqual(await open, { status: 'cancelled', name: 'open:lyrics' });
  assert.deepEqual(events, ['manual', 'disposed', 'disposed']);
});

test('delegates visibility and cancels active decorative motion when hidden', async () => {
  const visibility = [];
  const motion = createMotionController({
    profile: 'full',
    transitions: {
      draw: ({ signal }) => new Promise((resolve) => {
        signal.addEventListener('abort', resolve, { once: true });
      }),
      setDocumentVisible: (visible) => visibility.push(visible)
    }
  });
  const draw = motion.draw(0);
  motion.setDocumentVisible(false);
  motion.setDocumentVisible(true);

  assert.deepEqual(await draw, { status: 'cancelled', name: 'draw' });
  assert.deepEqual(visibility, [false, true]);
});

test('does not start requests queued while the document is hidden', async () => {
  const events = [];
  const motion = createMotionController({
    profile: 'full',
    transitions: { draw: async () => events.push('draw') }
  });

  motion.setDocumentVisible(false);
  assert.deepEqual(await motion.draw(0), { status: 'cancelled', name: 'draw' });
  motion.setDocumentVisible(true);
  assert.deepEqual(await motion.draw(1), { status: 'completed', name: 'draw' });
  assert.deepEqual(events, ['draw']);
});

test('allows semantic headless track changes while the document is hidden', async () => {
  const events = [];
  const motion = createMotionController({
    profile: 'compact',
    transitions: {
      switchTrack: async ({ targetIndex, headless }) => events.push([targetIndex, headless])
    }
  });

  motion.setDocumentVisible(false);
  assert.deepEqual(
    await motion.switchTrack(4, { headless: true }),
    { status: 'completed', name: 'switch-track' }
  );
  assert.deepEqual(events, [[4, true]]);
});

test('does not allow caller options to replace controller-owned switch context', async () => {
  let received;
  const motion = createMotionController({
    profile: 'compact',
    transitions: { switchTrack: async (context) => { received = context; } }
  });
  const suppliedSignal = new AbortController().signal;

  await motion.switchTrack(4, {
    headless: true,
    targetIndex: 99,
    profile: 'reduce',
    tokens: { enter: 999 },
    signal: suppliedSignal
  });

  assert.equal(received.targetIndex, 4);
  assert.equal(received.headless, true);
  assert.equal(received.profile, 'compact');
  assert.notEqual(received.signal, suppliedSignal);
  assert.equal(received.tokens.enter, 280);
});

test('activity callback failures cannot strand motion ownership', async () => {
  const motion = createMotionController({
    profile: 'compact',
    transitions: { draw: async () => {} },
    onActivityChange: () => { throw new Error('observer failed'); }
  });

  assert.deepEqual(await motion.draw(0), { status: 'completed', name: 'draw' });
  assert.equal(motion.isActive(), false);
});

test('settles an aborted numeric tween', async () => {
  const controller = new AbortController();
  const frames = [];
  const tween = tweenWithCleanup({
    from: 0,
    to: 1,
    duration: 100,
    easing: (value) => value,
    render: () => {},
    signal: controller.signal,
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: () => {}
  });
  controller.abort();
  assert.deepEqual(await tween, { status: 'cancelled' });
});

test('does not schedule a replacement frame when render aborts a tween', async () => {
  const controller = new AbortController();
  let frame;
  let scheduled = 0;
  const tween = tweenWithCleanup({
    from: 0,
    to: 1,
    duration: 100,
    easing: (value) => value,
    render: () => controller.abort('render interrupted'),
    signal: controller.signal,
    requestFrame: (callback) => {
      scheduled += 1;
      frame = callback;
      return scheduled;
    },
    cancelFrame: () => {}
  });

  frame(0);
  assert.deepEqual(await tween, { status: 'cancelled' });
  assert.equal(scheduled, 1);
});

test('settles a zero-duration tween at its target', async () => {
  const values = [];
  const result = await tweenWithCleanup({
    from: 4,
    to: 9,
    duration: 0,
    easing: (value) => value,
    render: (value) => values.push(value),
    signal: new AbortController().signal,
    requestFrame: () => { throw new Error('zero-duration tween scheduled a frame'); },
    cancelFrame: () => {}
  });
  assert.deepEqual(result, { status: 'completed' });
  assert.deepEqual(values, [9]);
});

test('propagates a render error from a tween frame', async () => {
  let frame;
  const tween = tweenWithCleanup({
    from: 0,
    to: 1,
    duration: 100,
    easing: (value) => value,
    render: () => { throw new Error('render failed'); },
    signal: new AbortController().signal,
    requestFrame: (callback) => { frame = callback; return 1; },
    cancelFrame: () => {}
  });
  frame(0);
  await assert.rejects(tween, /render failed/);
});

test('animation cleanup uses a compatibility adapter and settles without finished support', async () => {
  const calls = [];
  const element = { dataset: {}, style: {} };
  const animation = { cancel: () => calls.push('cancel') };
  const result = await animateWithCleanup(
    element,
    [{ opacity: 0 }, { opacity: 1 }],
    { duration: 100 },
    new AbortController().signal,
    (target, keyframes) => {
      calls.push(target, keyframes);
      return animation;
    }
  );

  assert.deepEqual(result, { status: 'completed' });
  assert.equal(element.style.opacity, '1');
  assert.equal('motionActive' in element.dataset, false);
  assert.equal(calls.at(-1), 'cancel');
});

const makeTransitionFakes = ({
  playError = null,
  loadError = null,
  blockMove = null,
  pendingPlay = null
} = {}) => {
  const events = [];
  const normalizedTrack = {
    title: 'Normalized title',
    artist: 'Artist',
    album: 'Album',
    musicOssUrl: 'https://example.test/audio.mp3',
    artwork: [{ src: 'https://example.test/cover.jpg' }]
  };
  const turntable = {
    readState: () => ({ arm: -72, rate: 0.42 }),
    setSpinning: (active) => events.push(['spin', active]),
    moveArmTo: async (target, options) => {
      events.push(['arm', target, options]);
      if (blockMove && target === 'rest') await blockMove(options.signal);
    },
    rampRateTo: async (rate, options) => events.push(['rate', rate, options]),
    resetAfterPlaybackError: async (options) => events.push(['reset', options]),
    setDocumentVisible: () => {},
    dispose: () => {}
  };
  const overlays = {
    closeAll: async (options) => { events.push(['closeAll', options]); return { anyVisible: true }; },
    open: async (kind, options) => events.push(['open', kind, options]),
    close: async (kind, options) => events.push(['close', kind, options]),
    restoreAfterTrackSwitch: async (state, options) => events.push(['restore', state, options]),
    refresh: async (options) => events.push(['refresh', options]),
    setDocumentVisible: () => {},
    dispose: () => {}
  };
  const controls = {
    setLabel: async (label, options) => events.push(['label', label, options])
  };
  const audio = {
    pause: () => events.push(['pause']),
    load: async (track) => {
      events.push(['load', track]);
      if (loadError) throw loadError;
    },
    play: async (options) => {
      events.push(['play', options]);
      if (playError) throw playError;
      if (pendingPlay) return pendingPlay.promise;
    }
  };
  const selectTrack = async (index, options) => {
    events.push(['select', index, options]);
    return normalizedTrack;
  };
  return { events, normalizedTrack, turntable, overlays, controls, audio, selectTrack };
};

test('draw stops old audio, loads the normalized track, and forwards motion context', async () => {
  const fakes = makeTransitionFakes();
  const transitions = createAppTransitions(fakes);
  const signal = new AbortController().signal;
  const tokens = { enter: 23, move: 45, settle: 67, itemStagger: 0 };

  await transitions.draw({ signal, targetIndex: 7, profile: 'compact', tokens });

  assert.equal(fakes.events[0][0], 'closeAll');
  assert.equal(fakes.events[1][0], 'pause');
  assert.deepEqual(fakes.events.find(([name]) => name === 'load')[1], fakes.normalizedTrack);
  assert.equal(fakes.events.find(([name]) => name === 'select')[2].signal, signal);
  assert.equal(fakes.events.find(([name, target]) => name === 'arm' && target === 'rest')[2].duration, tokens.move);
  assert.equal(fakes.events.find(([name]) => name === 'play')[1].signal, signal);
});

test('an aborted draw does not select, open, play, or set its final label', async () => {
  const started = createDeferred();
  const fakes = makeTransitionFakes({
    blockMove: (signal) => new Promise((resolve) => {
      started.resolve();
      signal.addEventListener('abort', resolve, { once: true });
    })
  });
  const transitions = createAppTransitions(fakes);
  const controller = new AbortController();
  const draw = transitions.draw({
    signal: controller.signal,
    targetIndex: 1,
    profile: 'full',
    tokens: { enter: 20, move: 40, settle: 60, itemStagger: 16 }
  });
  await started.promise;
  controller.abort('superseded');

  await assert.rejects(draw, (error) => error === 'superseded');
  assert.equal(fakes.events.some(([name]) => name === 'select'), false);
  assert.equal(fakes.events.some(([name]) => name === 'open'), false);
  assert.equal(fakes.events.some(([name]) => name === 'play'), false);
  assert.equal(fakes.events.some(([name, label]) => name === 'label' && label === '再次抽取'), false);
});

test('a play rejection resets the turntable and remains recoverable by the caller', async () => {
  const playError = new Error('autoplay denied');
  const fakes = makeTransitionFakes({ playError });
  const transitions = createAppTransitions(fakes);

  await assert.rejects(transitions.switchTrack({
    signal: new AbortController().signal,
    targetIndex: 3,
    profile: 'compact',
    tokens: { enter: 20, move: 40, settle: 60, itemStagger: 0 }
  }), (error) => error === playError);

  assert.equal(fakes.events[0][0], 'closeAll');
  assert.equal(fakes.events[1][0], 'pause');
  assert.equal(fakes.events.some(([name]) => name === 'reset'), true);
  assert.equal(fakes.events.at(-1)[0], 'reset');
});

test('a load rejection resets the turntable and remains recoverable by the caller', async () => {
  const loadError = new Error('source failed');
  const fakes = makeTransitionFakes({ loadError });
  const transitions = createAppTransitions(fakes);

  await assert.rejects(transitions.draw({
    signal: new AbortController().signal,
    targetIndex: 3,
    profile: 'compact',
    tokens: { enter: 20, move: 40, settle: 60, itemStagger: 0 }
  }), (error) => error === loadError);

  assert.equal(fakes.events.at(-1)[0], 'reset');
});

test('an interrupted pending play resets the turntable before its transition settles', async () => {
  const pendingPlay = createDeferred();
  const fakes = makeTransitionFakes({ pendingPlay });
  const transitions = createAppTransitions(fakes);
  const controller = new AbortController();
  const draw = transitions.draw({
    signal: controller.signal,
    targetIndex: 3,
    profile: 'compact',
    tokens: { enter: 20, move: 40, settle: 60, itemStagger: 0 }
  });

  while (!fakes.events.some(([name]) => name === 'play')) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  controller.abort('superseded');
  pendingPlay.resolve(false);

  await assert.rejects(draw, (error) => error === 'superseded');
  assert.equal(fakes.events.at(-1)[0], 'reset');
});

test('a track switch snapshots its overlay before pausing and restores it after playback', async () => {
  const fakes = makeTransitionFakes();
  const transitions = createAppTransitions(fakes);

  await transitions.switchTrack({
    signal: new AbortController().signal,
    targetIndex: 4,
    profile: 'full',
    tokens: { enter: 20, move: 40, settle: 60, itemStagger: 16 }
  });

  assert.deepEqual(
    fakes.events.map(([name]) => name),
    ['closeAll', 'pause', 'select', 'load', 'refresh', 'play', 'restore']
  );
});

test('the composition root routes player commands through exclusive motion ownership', () => {
  const mainSource = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');

  assert.match(mainSource, /createMotionController/);
  assert.match(mainSource, /createAppTransitions/);
  assert.match(mainSource, /const motion = createMotionController\(/);
  assert.match(mainSource, /motion\.draw\(/);
  assert.match(mainSource, /motion\.switchTrack\(/);
  assert.match(mainSource, /motion\.openOverlay\(/);
  assert.match(mainSource, /motion\.closeOverlay\(/);
  assert.match(mainSource, /motion\.setDocumentVisible\(!document\.hidden\)/);
  assert.doesNotMatch(mainSource, /if \(isDrawing\) return;/);
  assert.doesNotMatch(mainSource, /if \(isOverlayClosing \|\|/);
  assert.doesNotMatch(mainSource, /if \(isTrackSwitching\) return;/);
});
