import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  animateWithCleanup,
  createMotionController,
  detectMotionProfile,
  MOTION_TOKENS,
  tweenWithCleanup
} from '../../src/motion/motion-controller.js';
import {
  createAppTransitions,
  DRAW_LYRIC_HOLD_MS
} from '../../src/app/transitions.js';

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

test('selects compact for a short desktop viewport without overriding reduced motion', () => {
  assert.equal(detectMotionProfile({
    matchMedia: media(false, false),
    userAgent: 'Desktop Chrome',
    viewportHeight: 720
  }), 'compact');
  assert.equal(detectMotionProfile({
    matchMedia: media(false, false),
    userAgent: 'Desktop Chrome',
    viewportHeight: 721
  }), 'full');
  assert.equal(detectMotionProfile({
    matchMedia: media(true, false),
    userAgent: 'Desktop Chrome',
    viewportHeight: 640
  }), 'reduce');
});

test('rejects an unknown motion profile', () => {
  assert.throws(
    () => createMotionController({ profile: 'cinematic', transitions: {} }),
    /Unknown motion profile: cinematic/
  );
});

test('setProfile validates, settles active work, and updates future command tokens', async () => {
  const cleanup = createDeferred();
  const events = [];
  const contexts = [];
  const motion = createMotionController({
    profile: 'full',
    transitions: {
      draw: ({ signal, profile, tokens }) => new Promise((resolve) => {
        contexts.push({ profile, tokens });
        signal.addEventListener('abort', async () => {
          events.push(signal.reason);
          await cleanup.promise;
          resolve();
        }, { once: true });
      }),
      openOverlay: async (context) => contexts.push(context)
    }
  });

  const draw = motion.draw(2);
  await Promise.resolve();
  assert.equal(contexts[0].profile, 'full');
  assert.equal(contexts[0].tokens, MOTION_TOKENS.full);

  const profileChange = motion.setProfile('reduce');
  let profileChangeSettled = false;
  void profileChange.then(() => { profileChangeSettled = true; });
  assert.equal(motion.profile, 'reduce');
  assert.throws(() => motion.setProfile('cinematic'), /Unknown motion profile: cinematic/);
  assert.equal(motion.profile, 'reduce');
  await Promise.resolve();
  assert.equal(profileChangeSettled, false);
  assert.equal(motion.isActive(), true);

  const open = motion.openOverlay('lyrics');
  cleanup.resolve();

  assert.deepEqual(await draw, { status: 'cancelled', name: 'draw' });
  await profileChange;
  assert.deepEqual(await open, { status: 'completed', name: 'open:lyrics' });
  assert.deepEqual(events, ['motion profile changed']);
  assert.equal(contexts[1].profile, 'reduce');
  assert.equal(contexts[1].tokens, MOTION_TOKENS.reduce);
  assert.equal(motion.isActive(), false);
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
  await Promise.resolve();
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
  await Promise.resolve();
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
  await Promise.resolve();
  await motion.cancel('manual');
  assert.deepEqual(await draw, { status: 'cancelled', name: 'draw' });

  const open = motion.openOverlay('lyrics');
  await Promise.resolve();
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
      switchTrack: async ({ targetIndex, headless, showLyrics }) => {
        events.push([targetIndex, headless, showLyrics]);
      }
    }
  });

  motion.setDocumentVisible(false);
  assert.deepEqual(
    await motion.switchTrack(4, { headless: true, showLyrics: true }),
    { status: 'completed', name: 'switch-track' }
  );
  assert.deepEqual(events, [[4, true, false]]);
});

test('starts a queued headless switch after decorative cleanup during backgrounding', async () => {
  const cleanup = createDeferred();
  const events = [];
  const motion = createMotionController({
    profile: 'compact',
    transitions: {
      draw: ({ signal }) => new Promise((resolve) => {
        events.push('draw:start');
        signal.addEventListener('abort', async () => {
          events.push('draw:abort');
          await cleanup.promise;
          events.push('draw:cleanup');
          resolve();
        }, { once: true });
      }),
      switchTrack: async ({ targetIndex, headless }) => {
        events.push(`switch:${targetIndex}:${headless}`);
      }
    }
  });

  const draw = motion.draw(0);
  await Promise.resolve();
  const headlessSwitch = motion.switchTrack(4, { headless: true });
  motion.setDocumentVisible(false);
  cleanup.resolve();

  assert.deepEqual(await draw, { status: 'cancelled', name: 'draw' });
  assert.deepEqual(
    await headlessSwitch,
    { status: 'completed', name: 'switch-track' }
  );
  assert.deepEqual(events, [
    'draw:start',
    'draw:abort',
    'draw:cleanup',
    'switch:4:true'
  ]);
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
    showLyrics: true,
    targetIndex: 99,
    profile: 'reduce',
    tokens: { enter: 999 },
    signal: suppliedSignal
  });

  assert.equal(received.targetIndex, 4);
  assert.equal(received.headless, true);
  assert.equal(received.showLyrics, false);
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

test('settles a synchronously superseded record before starting the reentrant command', async () => {
  const events = [];
  let reentrant;
  let startedReentrant = false;
  let motion;
  motion = createMotionController({
    profile: 'full',
    transitions: {
      draw: async () => { events.push('draw:task'); },
      openOverlay: async ({ kind }) => { events.push(`open:${kind}`); }
    },
    onActivityChange: ({ active, name }) => {
      events.push(`activity:${active ? 'start' : 'end'}:${name}`);
      if (active && name === 'draw' && !startedReentrant) {
        startedReentrant = true;
        reentrant = motion.openOverlay('lyrics');
      }
    }
  });

  const draw = motion.draw(0);

  assert.deepEqual(await draw, { status: 'cancelled', name: 'draw' });
  assert.deepEqual(await reentrant, { status: 'completed', name: 'open:lyrics' });
  assert.deepEqual(events, [
    'activity:start:draw',
    'activity:end:null',
    'activity:start:open:lyrics',
    'open:lyrics',
    'activity:end:null'
  ]);
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
  prepareError = null,
  commitError = null,
  moveError = null,
  refreshError = null,
  blockMove = null,
  pendingPlayArm = null,
  pendingPlay = null,
  pendingReset = null,
  pendingRestore = null,
  pendingOpen = null,
  pendingCoverReveal = null,
  pendingLyricHold = null,
  pendingLoad = null,
  pendingTrackReady = null,
  loadResult = undefined,
  playResult = undefined,
  previousIndex = 0,
  playbackRestored = false
} = {}) => {
  const events = [];
  const mechanics = {
    arm: 'rest',
    rate: 0,
    spinning: false
  };
  const normalizedTrack = {
    title: 'Normalized title',
    artist: 'Artist',
    album: 'Album',
    musicOssUrl: 'https://example.test/audio.mp3',
    artwork: [{ src: 'https://example.test/cover.jpg' }]
  };
  const turntable = {
    readState: () => ({ arm: -72, rate: 0.42, spinning: true }),
    setSpinning: (active) => {
      mechanics.spinning = active;
      events.push(['spin', active]);
    },
    moveArmTo: async (target, options) => {
      events.push(['arm', target, options]);
      if (moveError && target === 'rest') throw moveError;
      if (blockMove && target === 'rest') await blockMove(options.signal);
      if (pendingPlayArm && target === 'play') await pendingPlayArm.promise;
      if (!options.signal?.aborted) mechanics.arm = target;
    },
    rampRateTo: async (rate, options) => {
      events.push(['rate', rate, options]);
      if (!options.signal?.aborted) mechanics.rate = rate;
    },
    resetAfterPlaybackError: async (options) => {
      events.push(['reset', options]);
      if (pendingReset) await pendingReset.promise;
      mechanics.arm = 'rest';
      mechanics.rate = 0;
      mechanics.spinning = false;
    },
    restoreState: async (state, options) => {
      events.push(['restoreMechanics', state, options]);
      mechanics.arm = state.arm;
      mechanics.rate = state.rate;
      mechanics.spinning = state.spinning;
    },
    setDocumentVisible: () => {},
    dispose: () => {}
  };
  const overlays = {
    readState: () => ({ lyrics: true, playlist: false, split: true }),
    closeAll: async (options) => { events.push(['closeAll', options]); return { anyVisible: true }; },
    open: async (kind, options) => {
      events.push(['open', kind, options]);
      if (pendingOpen) await pendingOpen.promise;
    },
    close: async (kind, options) => events.push(['close', kind, options]),
    restoreAfterTrackSwitch: async (state, options) => {
      events.push(['restore', state, options]);
      if (pendingRestore) await pendingRestore.promise;
    },
    refresh: async (options) => {
      events.push(['refresh', options]);
      if (refreshError) throw refreshError;
    },
    setDocumentVisible: () => {},
    dispose: () => {}
  };
  const controls = {
    setLabel: async (label, options) => events.push(['label', label, options])
  };
  const audio = {
    getState: () => ({ status: 'playing' }),
    pause: () => events.push(['pause']),
    load: async (track) => {
      events.push(['load', track]);
      if (loadError) throw loadError;
      if (pendingLoad) await pendingLoad.promise;
      return loadResult;
    },
    play: async (options) => {
      events.push(['play', options]);
      if (playError) throw playError;
      if (pendingPlay) return pendingPlay.promise;
      return playResult;
    }
  };
  const preparedTransaction = {
    previousIndex,
    track: normalizedTrack,
    ready: pendingTrackReady?.promise || Promise.resolve()
  };
  const prepareTrack = (index, options) => {
    events.push(['prepare', index, options]);
    if (prepareError) throw prepareError;
    return preparedTransaction;
  };
  const commitTrack = async (transaction, options) => {
    events.push(['commit', transaction, options]);
    if (commitError) throw commitError;
  };
  const rollbackTrack = async (transaction, options) => {
    events.push(['rollback', transaction, options]);
    return { playbackRestored };
  };
  const waitForCoverReveal = async ({ signal }) => {
    events.push(['coverReveal', signal]);
    if (pendingCoverReveal) await pendingCoverReveal.promise;
  };
  const waitForDelay = async (duration, signal) => {
    events.push(['wait', duration, signal]);
    if (pendingLyricHold) await pendingLyricHold.promise;
  };
  return {
    events,
    mechanics,
    normalizedTrack,
    turntable,
    overlays,
    controls,
    audio,
    prepareTrack,
    commitTrack,
    rollbackTrack,
    waitForCoverReveal,
    waitForDelay
  };
};

test('draw prepares, loads, and commits the normalized track with motion context', async () => {
  const fakes = makeTransitionFakes();
  const transitions = createAppTransitions(fakes);
  const signal = new AbortController().signal;
  const tokens = { enter: 23, move: 45, settle: 67, itemStagger: 0 };

  await transitions.draw({ signal, targetIndex: 7, profile: 'compact', tokens });

  assert.equal(fakes.events[0][0], 'prepare');
  assert.ok(
    fakes.events.findIndex(([name]) => name === 'closeAll')
      < fakes.events.findIndex(([name]) => name === 'pause')
  );
  assert.deepEqual(fakes.events.find(([name]) => name === 'load')[1], fakes.normalizedTrack);
  assert.equal(fakes.events.find(([name]) => name === 'prepare')[2].signal.aborted, false);
  assert.ok(
    fakes.events.findIndex(([name]) => name === 'load')
      < fakes.events.findIndex(([name]) => name === 'commit')
  );
  assert.equal(fakes.events.find(([name, target]) => name === 'arm' && target === 'rest')[2].duration, tokens.move);
  assert.equal(fakes.events.find(([name]) => name === 'play')[1].signal.aborted, false);
});

test('draw does not commit visible track state until audio and cover preparation both finish', async () => {
  const pendingLoad = createDeferred();
  const pendingTrackReady = createDeferred();
  const fakes = makeTransitionFakes({ pendingLoad, pendingTrackReady });
  const transitions = createAppTransitions(fakes);

  const drawing = transitions.draw({
    signal: new AbortController().signal,
    targetIndex: 6,
    profile: 'compact',
    tokens: { enter: 20, move: 40, settle: 60, itemStagger: 0 }
  });

  while (!fakes.events.some(([name]) => name === 'load')) await Promise.resolve();
  assert.equal(fakes.events.some(([name]) => name === 'commit'), false);
  assert.equal(
    fakes.events.some(([name, label]) => name === 'label' && label === '抽取中'),
    true
  );

  pendingLoad.resolve(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fakes.events.some(([name]) => name === 'commit'), false);

  pendingTrackReady.resolve();
  await drawing;
  assert.equal(fakes.events.filter(([name]) => name === 'commit').length, 1);
});

test('a failed parallel branch cancels late preparation before rollback can be overwritten', async () => {
  const pendingTrackReady = createDeferred();
  const moveError = new Error('bridge failed');
  const fakes = makeTransitionFakes({ moveError, pendingTrackReady });
  const transitions = createAppTransitions(fakes);

  const switching = transitions.switchTrack({
    signal: new AbortController().signal,
    targetIndex: 2,
    profile: 'full',
    tokens: { enter: 20, move: 40, settle: 60, itemStagger: 16 }
  });

  while (!fakes.events.some(([name]) => name === 'load')) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fakes.events.some(([name]) => name === 'commit'), false);
  assert.equal(fakes.events.some(([name]) => name === 'rollback'), false);

  pendingTrackReady.resolve();
  await assert.rejects(switching, (error) => error === moveError);
  assert.equal(fakes.events.some(([name]) => name === 'commit'), false);
  assert.equal(fakes.events.filter(([name]) => name === 'rollback').length, 1);
});

test('draw anchors the 500ms lyric hold to the settled cover without waiting on slower mechanics', async () => {
  const pendingCoverReveal = createDeferred();
  const pendingLyricHold = createDeferred();
  const pendingPlayArm = createDeferred();
  const fakes = makeTransitionFakes({ pendingCoverReveal, pendingLyricHold, pendingPlayArm });
  const transitions = createAppTransitions(fakes);
  const signal = new AbortController().signal;

  const draw = transitions.draw({
    signal,
    targetIndex: 4,
    profile: 'compact',
    tokens: { enter: 20, move: 40, settle: 60, itemStagger: 0 }
  });

  while (
    !fakes.events.some(([name]) => name === 'coverReveal')
  ) {
    await Promise.resolve();
  }

  let eventNames = fakes.events.map(([name]) => name);
  assert.ok(eventNames.indexOf('prepare') < eventNames.indexOf('load'));
  assert.ok(eventNames.indexOf('load') < eventNames.indexOf('commit'));
  assert.ok(eventNames.indexOf('commit') < eventNames.indexOf('coverReveal'));
  assert.equal(fakes.events.some(([name]) => name === 'wait'), false);
  assert.equal(
    fakes.events.some(([name, target]) => name === 'arm' && target === 'play'),
    false
  );
  assert.equal(fakes.events.some(([name]) => name === 'open'), false);

  pendingCoverReveal.resolve();
  while (
    !fakes.events.some(([name]) => name === 'wait')
    || !fakes.events.some(([name, target]) => name === 'arm' && target === 'play')
  ) {
    await Promise.resolve();
  }
  eventNames = fakes.events.map(([name]) => name);
  assert.equal(fakes.events.find(([name]) => name === 'wait')[1], DRAW_LYRIC_HOLD_MS);
  assert.ok(eventNames.indexOf('coverReveal') < eventNames.indexOf('wait'));

  pendingLyricHold.resolve();
  while (!fakes.events.some(([name]) => name === 'open')) await Promise.resolve();

  const revealEventNames = fakes.events.map(([name]) => name);
  assert.ok(revealEventNames.indexOf('play') < revealEventNames.indexOf('open'));
  assert.deepEqual(fakes.events.find(([name]) => name === 'open').slice(0, 2), [
    'open',
    'lyrics'
  ]);

  let drawSettled = false;
  void draw.then(() => { drawSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drawSettled, false);

  pendingPlayArm.resolve();
  await draw;
});

test('an aborted draw rolls back its prepared track before any overlay or playback starts', async () => {
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
  assert.equal(fakes.events.some(([name]) => name === 'prepare'), true);
  assert.equal(fakes.events.some(([name]) => name === 'rollback'), true);
  assert.equal(fakes.events.some(([name]) => name === 'open'), false);
  assert.equal(fakes.events.some(([name]) => name === 'play'), false);
  assert.deepEqual(fakes.events.at(-1).slice(0, 2), ['label', '再次抽取']);
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

  assert.equal(fakes.events[0][0], 'prepare');
  assert.ok(
    fakes.events.findIndex(([name]) => name === 'closeAll')
      < fakes.events.findIndex(([name]) => name === 'pause')
  );
  assert.equal(fakes.events.some(([name]) => name === 'reset'), true);
  assert.equal(
    fakes.events.find(([name]) => name === 'rollback')[2].retryable,
    true
  );
  assert.deepEqual(fakes.events.at(-1).slice(0, 2), ['label', '再次抽取']);
  assert.equal(
    fakes.events.findIndex(([name]) => name === 'reset')
      < fakes.events.findIndex(([name, label]) => name === 'label' && label === '再次抽取'),
    true
  );
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

  assert.equal(
    fakes.events.find(([name]) => name === 'rollback')[2].retryable,
    true
  );
  assert.deepEqual(fakes.events.at(-1).slice(0, 2), ['label', '再次抽取']);
  assert.equal(
    fakes.events.findIndex(([name]) => name === 'reset')
      < fakes.events.findIndex(([name, label]) => name === 'label' && label === '再次抽取'),
    true
  );
});

test('a live false load resets and settles the recovery draw label', async () => {
  const fakes = makeTransitionFakes({ loadResult: false });
  const transitions = createAppTransitions(fakes);
  const signal = new AbortController().signal;

  await assert.rejects(transitions.draw({
    signal,
    targetIndex: 3,
    profile: 'compact',
    tokens: { enter: 20, move: 40, settle: 60, itemStagger: 0 }
  }), /Audio load did not complete/);

  assert.equal(signal.aborted, false);
  assert.deepEqual(fakes.events.at(-1).slice(0, 2), ['label', '再次抽取']);
  assert.equal(
    fakes.events.findIndex(([name]) => name === 'reset')
      < fakes.events.findIndex(([name, label]) => name === 'label' && label === '再次抽取'),
    true
  );
});

test('a live false play resets and settles the recovery draw label', async () => {
  const fakes = makeTransitionFakes({ playResult: false });
  const transitions = createAppTransitions(fakes);
  const signal = new AbortController().signal;

  await assert.rejects(transitions.draw({
    signal,
    targetIndex: 3,
    profile: 'compact',
    tokens: { enter: 20, move: 40, settle: 60, itemStagger: 0 }
  }), /Audio playback did not start/);

  assert.equal(signal.aborted, false);
  assert.deepEqual(fakes.events.at(-1).slice(0, 2), ['label', '再次抽取']);
  assert.equal(
    fakes.events.findIndex(([name]) => name === 'reset')
      < fakes.events.findIndex(([name, label]) => name === 'label' && label === '再次抽取'),
    true
  );
});

for (const [operation, options, expectedError] of [
  ['load', { loadResult: false }, /Audio load did not complete/],
  ['play', { playResult: false }, /Audio playback did not start/]
]) {
  test(`a live false ${operation} restores the previous overlay before recovering the switch label`, async () => {
    const fakes = makeTransitionFakes(options);
    const transitions = createAppTransitions(fakes);

    await assert.rejects(transitions.switchTrack({
      signal: new AbortController().signal,
      targetIndex: 3,
      profile: 'compact',
      tokens: { enter: 20, move: 40, settle: 60, itemStagger: 0 }
    }), expectedError);

    assert.deepEqual(fakes.events.at(-1).slice(0, 2), ['label', '再次抽取']);
    assert.equal(
      fakes.events.findIndex(([name]) => name === 'reset')
        < fakes.events.findIndex(([name, label]) => name === 'label' && label === '再次抽取'),
      true
    );
    assert.equal(fakes.events.filter(([name]) => name === 'restore').length, 1);
    assert.ok(
      fakes.events.findIndex(([name]) => name === 'restore')
        < fakes.events.findIndex(([name, label]) => name === 'label' && label === '再次抽取')
    );
  });
}

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
  assert.equal(fakes.events.filter(([name]) => name === 'reset').length, 1);
  assert.equal(fakes.events.filter(([name]) => name === 'rollback').length, 1);
  assert.deepEqual(fakes.events.at(-1).slice(0, 2), ['label', '再次抽取']);
});

test('an interrupted pending playlist play resets once with an immediate unsignaled rollback', async () => {
  const pendingPlay = createDeferred();
  const fakes = makeTransitionFakes({ pendingPlay });
  const transitions = createAppTransitions(fakes);
  const controller = new AbortController();
  const switching = transitions.switchTrack({
    signal: controller.signal,
    targetIndex: 3,
    profile: 'compact',
    tokens: { enter: 20, move: 40, settle: 60, itemStagger: 0 },
    showLyrics: true
  });

  while (!fakes.events.some(([name]) => name === 'play')) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  controller.abort('superseded');
  pendingPlay.resolve(false);

  await assert.rejects(switching, (error) => error === 'superseded');
  const resets = fakes.events.filter(([name]) => name === 'reset');
  assert.equal(resets.length, 1);
  assert.deepEqual(resets[0][1], { duration: 0 });
  assert.deepEqual(fakes.mechanics, {
    arm: 'rest',
    rate: 0,
    spinning: false
  });
});

test('hiding the document during a playlist switch restores the paused mechanics', async () => {
  const switchStarted = createDeferred();
  const fakes = makeTransitionFakes({
    blockMove: (signal) => new Promise((resolve) => {
      switchStarted.resolve();
      signal.addEventListener('abort', resolve, { once: true });
    })
  });
  const motion = createMotionController({
    profile: 'full',
    transitions: createAppTransitions(fakes)
  });

  const switching = motion.switchTrack(2, { showLyrics: true });
  await switchStarted.promise;
  motion.setDocumentVisible(false);

  assert.deepEqual(await switching, { status: 'cancelled', name: 'switch-track' });
  assert.equal(fakes.events.some(([name]) => name === 'prepare'), true);
  assert.equal(fakes.events.some(([name]) => name === 'rollback'), true);
  assert.equal(fakes.events.some(([name]) => name === 'play'), false);
  assert.deepEqual(fakes.events.filter(([name]) => name === 'reset')[0][1], { duration: 0 });
  assert.deepEqual(fakes.events.at(-1).slice(0, 2), ['label', '再次抽取']);
  assert.deepEqual(fakes.mechanics, {
    arm: 'rest',
    rate: 0,
    spinning: false
  });
});

test('changing motion profile waits for an interrupted playlist switch rollback', async () => {
  const switchStarted = createDeferred();
  const pendingReset = createDeferred();
  const fakes = makeTransitionFakes({
    pendingReset,
    blockMove: (signal) => new Promise((resolve) => {
      switchStarted.resolve();
      signal.addEventListener('abort', resolve, { once: true });
    })
  });
  const motion = createMotionController({
    profile: 'full',
    transitions: createAppTransitions(fakes)
  });

  const switching = motion.switchTrack(2, { showLyrics: true });
  await switchStarted.promise;
  const profileChange = motion.setProfile('reduce');
  let profileChangeSettled = false;
  void profileChange.then(() => { profileChangeSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(profileChangeSettled, false);
  assert.equal(fakes.events.some(([name]) => name === 'rollback'), true);
  assert.equal(fakes.events.some(([name]) => name === 'play'), false);
  assert.deepEqual(fakes.events.filter(([name]) => name === 'reset')[0][1], { duration: 0 });

  pendingReset.resolve();
  assert.deepEqual(await switching, { status: 'cancelled', name: 'switch-track' });
  await profileChange;
  assert.equal(profileChangeSettled, true);
  assert.deepEqual(fakes.mechanics, {
    arm: 'rest',
    rate: 0,
    spinning: false
  });
});

for (const [phase, options, expectedError] of [
  ['bridge motion', { moveError: new Error('bridge failed') }, /bridge failed/],
  ['overlay refresh', { refreshError: new Error('refresh failed') }, /refresh failed/]
]) {
  test(`a ${phase} failure restores mechanics before rejecting a track switch`, async () => {
    const fakes = makeTransitionFakes(options);
    const transitions = createAppTransitions(fakes);

    await assert.rejects(transitions.switchTrack({
      signal: new AbortController().signal,
      targetIndex: 2,
      profile: 'full',
      tokens: { enter: 20, move: 40, settle: 60, itemStagger: 16 }
    }), expectedError);

    assert.equal(fakes.events.some(([name]) => name === 'pause'), true);
    assert.equal(fakes.events.filter(([name]) => name === 'reset').length, 1);
    assert.ok(
      fakes.events.findIndex(([name]) => name === 'pause')
        < fakes.events.findIndex(([name]) => name === 'reset')
    );
    assert.deepEqual(fakes.events.at(-1).slice(0, 2), ['label', '再次抽取']);
  });
}

test('a superseding command waits for an interrupted track switch rollback', async () => {
  const switchStarted = createDeferred();
  const pendingReset = createDeferred();
  const fakes = makeTransitionFakes({
    pendingReset,
    blockMove: (signal) => new Promise((resolve) => {
      switchStarted.resolve();
      signal.addEventListener('abort', resolve, { once: true });
    })
  });
  const motion = createMotionController({
    profile: 'full',
    transitions: createAppTransitions(fakes)
  });

  const switching = motion.switchTrack(2);
  await switchStarted.promise;
  const opening = motion.openOverlay('lyrics');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fakes.events.some(([name]) => name === 'reset'), true);
  assert.equal(fakes.events.some(([name]) => name === 'open'), false);

  pendingReset.resolve();
  assert.deepEqual(await switching, { status: 'cancelled', name: 'switch-track' });
  assert.deepEqual(await opening, { status: 'completed', name: 'open:lyrics' });
  assert.ok(
    fakes.events.findIndex(([name]) => name === 'reset')
      < fakes.events.findIndex(([name]) => name === 'open')
  );
});

test('a failed first draw restores the initial 抽取 label', async () => {
  const fakes = makeTransitionFakes({ loadResult: false, previousIndex: -1 });
  const transitions = createAppTransitions(fakes);

  await assert.rejects(transitions.draw({
    signal: new AbortController().signal,
    targetIndex: 3,
    profile: 'compact',
    tokens: { enter: 20, move: 40, settle: 60, itemStagger: 0 }
  }), /Audio load did not complete/);

  assert.equal(fakes.events.filter(([name]) => name === 'rollback').length, 1);
  assert.deepEqual(fakes.events.at(-1).slice(0, 2), ['label', '抽取']);
});

test('rollback restores the previous playing mechanics when old playback resumes', async () => {
  const fakes = makeTransitionFakes({ loadResult: false, playbackRestored: true });
  const transitions = createAppTransitions(fakes);

  await assert.rejects(transitions.switchTrack({
    signal: new AbortController().signal,
    targetIndex: 3,
    profile: 'compact',
    tokens: { enter: 20, move: 40, settle: 60, itemStagger: 0 }
  }), /Audio load did not complete/);

  assert.equal(fakes.events.some(([name]) => name === 'reset'), false);
  assert.equal(fakes.events.filter(([name]) => name === 'restoreMechanics').length, 1);
  assert.deepEqual(fakes.mechanics, {
    arm: -72,
    rate: 0.42,
    spinning: true
  });
});

test('an interruption after playback starts does not roll the turntable back to rest', async () => {
  const pendingRestore = createDeferred();
  const fakes = makeTransitionFakes({ pendingRestore });
  const motion = createMotionController({
    profile: 'full',
    transitions: createAppTransitions(fakes)
  });

  const switching = motion.switchTrack(2);
  while (!fakes.events.some(([name]) => name === 'restore')) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  motion.setDocumentVisible(false);
  pendingRestore.resolve();

  assert.deepEqual(await switching, { status: 'cancelled', name: 'switch-track' });
  assert.equal(fakes.events.some(([name]) => name === 'play'), true);
  assert.equal(fakes.events.some(([name]) => name === 'reset'), false);
});

test('hiding while lyrics open after playback keeps the new track mechanics running', async () => {
  const pendingOpen = createDeferred();
  const fakes = makeTransitionFakes({ pendingOpen });
  const motion = createMotionController({
    profile: 'full',
    transitions: createAppTransitions(fakes)
  });

  const switching = motion.switchTrack(2, { showLyrics: true });
  while (!fakes.events.some(([name]) => name === 'open')) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  motion.setDocumentVisible(false);
  pendingOpen.resolve();

  assert.deepEqual(await switching, { status: 'cancelled', name: 'switch-track' });
  assert.equal(fakes.events.filter(([name]) => name === 'play').length, 1);
  assert.equal(fakes.events.some(([name]) => name === 'reset'), false);
  assert.deepEqual(fakes.mechanics, {
    arm: 'play',
    rate: 0.68,
    spinning: true
  });
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
    [
      'prepare', 'closeAll', 'label', 'pause', 'spin', 'arm', 'rate', 'load',
      'commit', 'coverReveal', 'refresh', 'arm', 'rate', 'play', 'restore', 'label'
    ]
  );
  assert.deepEqual(
    fakes.events.filter(([name]) => name === 'arm').map(([, target]) => target),
    ['rest', 'play']
  );
  assert.deepEqual(
    fakes.events.filter(([name]) => name === 'rate').map(([, rate]) => rate),
    [1.85, 0.68]
  );
  assert.equal(fakes.events.find(([name]) => name === 'spin')[1], true);
});

test('a playlist-directed track switch replaces the playlist with lyrics after playback', async () => {
  const fakes = makeTransitionFakes();
  const transitions = createAppTransitions(fakes);

  await transitions.switchTrack({
    signal: new AbortController().signal,
    targetIndex: 5,
    profile: 'full',
    tokens: { enter: 20, move: 40, settle: 60, itemStagger: 16 },
    showLyrics: true
  });

  assert.deepEqual(
    fakes.events.map(([name]) => name),
    [
      'prepare', 'closeAll', 'label', 'pause', 'spin', 'arm', 'rate', 'load',
      'commit', 'coverReveal', 'arm', 'rate', 'play', 'open', 'label'
    ]
  );
  assert.deepEqual(
    fakes.events.find(([name]) => name === 'open').slice(0, 2),
    ['open', 'lyrics']
  );
  assert.equal(fakes.events.some(([name]) => name === 'refresh'), false);
  assert.equal(fakes.events.some(([name]) => name === 'restore'), false);
});

test('a headless track switch synchronizes the playing mechanics without transition delays', async () => {
  const fakes = makeTransitionFakes();
  const transitions = createAppTransitions(fakes);

  await transitions.switchTrack({
    signal: new AbortController().signal,
    targetIndex: 2,
    profile: 'full',
    tokens: { enter: 20, move: 40, settle: 60, itemStagger: 16 },
    headless: true
  });

  assert.deepEqual(
    fakes.events.map(([name]) => name),
    ['prepare', 'pause', 'load', 'commit', 'spin', 'arm', 'rate', 'play']
  );
  const arm = fakes.events.find(([name]) => name === 'arm');
  const rate = fakes.events.find(([name]) => name === 'rate');
  const commit = fakes.events.find(([name]) => name === 'commit');
  assert.deepEqual(arm.slice(0, 2), ['arm', 'play']);
  assert.equal(arm[2].duration, 0);
  assert.equal(rate[1], 0.68);
  assert.equal(rate[2].duration, 0);
  assert.equal(commit[2].profile, 'reduce');
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
