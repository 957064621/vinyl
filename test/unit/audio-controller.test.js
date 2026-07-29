import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';

import { createAudioController } from '../../src/player/audio-controller.js';

class FakeAudio extends EventEmitter {
  constructor() {
    super();
    this.paused = true;
    this.currentTime = 0;
    this.duration = 100;
    this.readyState = 1;
    this.playbackRate = 1;
    this.src = '';
    this.pauseCalls = 0;
    this.loadCalls = 0;
  }

  addEventListener(name, fn) { this.on(name, fn); }
  removeEventListener(name, fn) { this.off(name, fn); }
  setAttribute() {}
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  load() { this.loadCalls += 1; }
  pause() { this.pauseCalls += 1; this.paused = true; this.emit('pause'); }
  async play() { this.paused = false; this.emit('play'); }
}

class DelayedMetadataAudio extends FakeAudio {
  constructor() {
    super();
    this.readyState = 0;
    this.duration = Number.NaN;
  }

  load() {
    this.loadCalls += 1;
    this.readyState = 0;
    this.duration = Number.NaN;
    this.currentTime = 0;
  }

  resolveMetadata(duration = 900) {
    this.readyState = 1;
    this.duration = duration;
    this.currentTime = 0;
    this.emit('loadedmetadata');
  }
}

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

test('does not report playing until play resolves', async () => {
  const audio = new FakeAudio();
  let resolvePlay;
  audio.play = () => {
    audio.emit('play');
    return new Promise((resolve) => { resolvePlay = resolve; });
  };
  const states = [];
  const controller = createAudioController({ audio, onStateChange: (state) => states.push(state.status) });
  await controller.load({ title: '媚人', musicOssUrl: 'https://example.test/meiren.mp3' });
  const pending = controller.play();
  assert.equal(states.at(-1), 'loading');
  resolvePlay();
  await pending;
  assert.equal(states.at(-1), 'playing');
});

test('surfaces play rejection and retries the selected source', async () => {
  const audio = new FakeAudio();
  let attempts = 0;
  audio.play = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('autoplay denied');
  };
  const states = [];
  const controller = createAudioController({ audio, onStateChange: (state) => states.push(state) });
  await controller.load({ title: '媚人', musicOssUrl: 'https://example.test/meiren.mp3' });
  await assert.rejects(controller.play(), /autoplay denied/);
  assert.equal(states.at(-1).status, 'error');
  assert.equal(audio.pauseCalls, 1);
  await controller.retry();
  assert.equal(attempts, 2);
  assert.equal(states.at(-1).status, 'playing');
  assert.equal(audio.loadCalls, 2);
});

test('restore waits for metadata before seeking and resuming the previous track', async () => {
  const audio = new DelayedMetadataAudio();
  const positionStates = [];
  const oldMetadata = { title: 'Old track' };
  const mediaSession = {
    metadata: { title: 'Replacement track' },
    playbackState: 'paused',
    setPositionState(state) { positionStates.push(state); }
  };
  const controller = createAudioController({ audio, mediaSession, MediaMetadataCtor: null });
  const oldTrack = { title: 'Old track', musicOssUrl: 'https://example.test/old.mp3' };

  await controller.load({ title: 'Replacement track', musicOssUrl: 'https://example.test/new.mp3' });
  audio.readyState = 1;
  audio.duration = 900;
  const restoring = controller.restore({
    track: oldTrack,
    status: 'playing',
    error: null,
    currentTime: 137,
    volume: 0.7,
    mediaMetadata: oldMetadata
  });
  let restoreSettled = false;
  restoring.finally(() => { restoreSettled = true; });

  while (audio.loadCalls < 2) await Promise.resolve();
  await Promise.resolve();
  assert.equal(restoreSettled, false);
  assert.equal(audio.currentTime, 0);
  assert.equal(mediaSession.metadata, oldMetadata);
  assert.equal(positionStates.at(-1), undefined);
  audio.resolveMetadata();

  assert.deepEqual(await restoring, { playbackRestored: true });
  assert.equal(audio.currentTime, 137);
  assert.equal(audio.volume, 0.7);
  assert.equal(audio.src, oldTrack.musicOssUrl);
  assert.equal(controller.getState().track, oldTrack);
  assert.equal(controller.getState().status, 'playing');
  assert.equal(mediaSession.metadata, oldMetadata);
  assert.equal(mediaSession.playbackState, 'playing');
  assert.equal(positionStates.at(-1).position, 137);
});

test('retry preserves a recovered playback position across the media reload', async () => {
  const audio = new DelayedMetadataAudio();
  const controller = createAudioController({ audio });
  const track = { title: 'Old track', musicOssUrl: 'https://example.test/old.mp3' };

  await controller.load(track);
  audio.readyState = 1;
  audio.duration = 900;
  audio.currentTime = 137;
  audio.emit('error');

  const retrying = controller.retry();
  let retrySettled = false;
  retrying.finally(() => { retrySettled = true; });
  while (audio.loadCalls < 2) await Promise.resolve();
  await Promise.resolve();
  assert.equal(retrySettled, false);
  assert.equal(audio.currentTime, 0);
  audio.resolveMetadata();

  assert.equal(await retrying, true);
  assert.equal(audio.currentTime, 137);
  assert.equal(controller.getState().status, 'playing');
});

test('clear removes the private track and resets media element and Media Session state', async () => {
  const audio = new FakeAudio();
  const positionCalls = [];
  const mediaSession = {
    metadata: { title: 'Cancelled track' },
    playbackState: 'playing',
    setPositionState(...args) { positionCalls.push(args); }
  };
  const states = [];
  const controller = createAudioController({
    audio,
    mediaSession,
    MediaMetadataCtor: null,
    onStateChange: (state) => states.push(state)
  });

  await controller.load({ title: 'Cancelled track', musicOssUrl: 'https://example.test/cancelled.mp3' });
  controller.clear();

  assert.deepEqual(controller.getState(), { status: 'idle', error: null, track: null });
  assert.equal(audio.src, '');
  assert.equal(mediaSession.metadata, null);
  assert.equal(mediaSession.playbackState, 'none');
  assert.deepEqual(positionCalls.at(-1), []);
  assert.deepEqual(states.at(-1), { status: 'idle', error: null, track: null });
});

test('stale pending play cannot pause or overwrite a successful retry', async () => {
  const audio = new FakeAudio();
  const firstAttempt = createDeferred();
  const retryAttempt = createDeferred();
  audio.play = () => audio.loadCalls === 1 ? firstAttempt.promise : retryAttempt.promise;
  const states = [];
  const controller = createAudioController({ audio, onStateChange: (state) => states.push(state.status) });
  await controller.load({ title: '媚人', musicOssUrl: 'https://example.test/meiren.mp3' });

  const pendingPlay = controller.play();
  const pendingRetry = controller.retry();
  retryAttempt.resolve();
  assert.equal(await pendingRetry, true);
  assert.equal(states.at(-1), 'playing');

  firstAttempt.reject(new Error('stale autoplay denial'));
  assert.equal(await pendingPlay, false);
  assert.equal(audio.pauseCalls, 0);
  assert.equal(states.at(-1), 'playing');
});

test('stale play from a previous source cannot pause or overwrite the new source', async () => {
  const audio = new FakeAudio();
  const oldAttempt = createDeferred();
  const newAttempt = createDeferred();
  let playCalls = 0;
  audio.play = () => {
    playCalls += 1;
    return playCalls === 1 ? oldAttempt.promise : newAttempt.promise;
  };
  const states = [];
  const controller = createAudioController({ audio, onStateChange: (state) => states.push(state) });
  await controller.load({ title: '旧歌', musicOssUrl: 'https://example.test/old.mp3' });

  const pendingOldPlay = controller.play();
  await controller.load({ title: '新歌', musicOssUrl: 'https://example.test/new.mp3' });
  const pendingNewPlay = controller.play();
  newAttempt.resolve();
  assert.equal(await pendingNewPlay, true);

  oldAttempt.reject(new Error('stale source rejection'));
  assert.equal(await pendingOldPlay, false);
  assert.equal(audio.pauseCalls, 0);
  assert.equal(states.at(-1).status, 'playing');
  assert.equal(states.at(-1).track.title, '新歌');
});

test('late play event after explicit pause cannot leave a pending attempt loading or publish playing', async () => {
  const audio = new FakeAudio();
  const pendingAttempt = createDeferred();
  audio.play = () => pendingAttempt.promise;
  audio.pause = () => {
    audio.pauseCalls += 1;
    if (audio.paused) return;
    audio.paused = true;
    audio.emit('pause');
  };
  const states = [];
  const controller = createAudioController({ audio, onStateChange: (state) => states.push(state.status) });
  await controller.load({ title: '媚人', musicOssUrl: 'https://example.test/meiren.mp3' });

  const pendingPlay = controller.play();
  controller.pause();
  assert.equal(states.at(-1), 'paused');

  const statesBeforeLatePlay = states.length;
  const pauseCallsBeforeLatePlay = audio.pauseCalls;
  audio.paused = false;
  audio.emit('play');
  assert.equal(audio.paused, true);
  assert.equal(audio.pauseCalls, pauseCallsBeforeLatePlay + 1);
  assert.equal(states.length, statesBeforeLatePlay);
  assert.equal(states.at(-1), 'paused');
  pendingAttempt.resolve();
  assert.equal(await pendingPlay, false);
  assert.equal(states.at(-1), 'paused');
});

test('late play event after source replacement cannot publish playing', async () => {
  const audio = new FakeAudio();
  const oldAttempt = createDeferred();
  audio.play = () => oldAttempt.promise;
  const states = [];
  const controller = createAudioController({ audio, onStateChange: (state) => states.push(state) });
  await controller.load({ title: '旧歌', musicOssUrl: 'https://example.test/old.mp3' });

  const pendingOldPlay = controller.play();
  const loadingNewSource = controller.load({ title: '新歌', musicOssUrl: 'https://example.test/new.mp3' });
  const pauseCallsBeforeLoadingEvent = audio.pauseCalls;
  audio.paused = false;
  audio.emit('play');
  assert.equal(audio.paused, true);
  assert.equal(audio.pauseCalls, pauseCallsBeforeLoadingEvent + 1);
  assert.equal(states.at(-1).status, 'loading');

  await loadingNewSource;
  const statesBeforeReadyEvent = states.length;
  const pauseCallsBeforeReadyEvent = audio.pauseCalls;
  audio.paused = false;
  audio.emit('play');

  assert.equal(audio.paused, true);
  assert.equal(audio.pauseCalls, pauseCallsBeforeReadyEvent + 1);
  assert.equal(states.length, statesBeforeReadyEvent);
  assert.equal(states.at(-1).status, 'ready');
  assert.equal(states.at(-1).track.title, '新歌');
  oldAttempt.resolve();
  assert.equal(await pendingOldPlay, false);
  assert.equal(states.at(-1).status, 'ready');
});

test('late play event and explicit pause cannot hide a recoverable media error', async () => {
  const audio = new FakeAudio();
  const pendingAttempt = createDeferred();
  audio.play = () => pendingAttempt.promise;
  const states = [];
  const controller = createAudioController({ audio, onStateChange: (state) => states.push(state) });
  await controller.load({ title: '媚人', musicOssUrl: 'https://example.test/meiren.mp3' });

  const pendingPlay = controller.play();
  audio.emit('error');
  assert.equal(states.at(-1).status, 'error');

  const errorState = controller.getState();
  const statesBeforeLatePlay = states.length;
  const pauseCallsBeforeLatePlay = audio.pauseCalls;
  audio.paused = false;
  audio.emit('play');
  assert.equal(audio.paused, true);
  assert.equal(audio.pauseCalls, pauseCallsBeforeLatePlay + 1);
  assert.equal(states.length, statesBeforeLatePlay);
  assert.equal(states.at(-1).status, 'error');
  assert.equal(controller.getState().error, errorState.error);
  pendingAttempt.resolve();
  assert.equal(await pendingPlay, false);
  assert.equal(states.at(-1).status, 'error');
});

test('seeks by a clamped fraction', async () => {
  const audio = new FakeAudio();
  const controller = createAudioController({ audio });
  await controller.load({ title: '媚人', musicOssUrl: 'https://example.test/meiren.mp3' });
  controller.seekToFraction(1.4);
  assert.equal(audio.currentTime, 100);
});

test('pauses and publishes error when the media element fails', async () => {
  const audio = new FakeAudio();
  const states = [];
  const controller = createAudioController({ audio, onStateChange: (state) => states.push(state) });
  await controller.load({ title: '媚人', musicOssUrl: 'https://example.test/meiren.mp3' });
  audio.emit('error');
  assert.equal(audio.pauseCalls, 1);
  assert.equal(states.at(-1).status, 'error');
});

test('loads without MediaMetadata support', async () => {
  const audio = new FakeAudio();
  const mediaSession = {};
  const controller = createAudioController({ audio, mediaSession });

  await controller.load({ title: '媚人', musicOssUrl: 'https://example.test/meiren.mp3' });

  assert.equal(controller.getState().status, 'ready');
  assert.equal(mediaSession.metadata, undefined);
});

test('continues binding supported media actions when one handler throws', () => {
  const audio = new FakeAudio();
  const registered = [];
  const mediaSession = {
    setActionHandler(name) {
      if (name === 'seekto') throw new Error('unsupported');
      registered.push(name);
    }
  };
  const controller = createAudioController({ audio, mediaSession });

  assert.doesNotThrow(() => controller.bindMediaActions({
    nextTrack: () => {},
    previousTrack: () => {}
  }));
  assert.ok(registered.includes('play'));
  assert.ok(registered.includes('seekforward'));
});

test('publishes a non-playing state before invoking the ended callback', async () => {
  const audio = new FakeAudio();
  const mediaSession = { playbackState: 'none' };
  const observations = [];
  let controller;
  controller = createAudioController({
    audio,
    mediaSession,
    onEnded: () => {
      observations.push({
        status: controller.getState().status,
        playbackState: mediaSession.playbackState
      });
    }
  });
  await controller.load({ title: '媚人', musicOssUrl: 'https://example.test/meiren.mp3' });
  await controller.play();

  audio.emit('ended');

  assert.deepEqual(observations, [{ status: 'paused', playbackState: 'paused' }]);
});

test('cancels the turntable motion owner before resetting rejected playback visuals', () => {
  const mainSource = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  const resetStart = mainSource.indexOf('const resetRejectedPlaybackVisual = () => {');
  const resetEnd = mainSource.indexOf('\n        };', resetStart);
  const resetSource = mainSource.slice(resetStart, resetEnd);

  assert.notEqual(resetStart, -1);
  assert.ok(resetSource.indexOf('cancelTurntableMotion();') > 0);
  assert.ok(resetSource.indexOf('cancelTurntableMotion();') < resetSource.indexOf("turntable.classList.remove('is-playing');"));
  assert.ok(resetSource.indexOf('cancelTurntableMotion();') < resetSource.indexOf('spinAnimation.playbackRate = 0;'));
});

test('direct playback inputs yield the central motion owner with current-command ownership', () => {
  const mainSource = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  const directStart = mainSource.indexOf('const runDirectPlaybackCommand = async');
  const directEnd = mainSource.indexOf('\n\n        const closeLyricOverlay', directStart);
  const directSource = mainSource.slice(directStart, directEnd);
  const playerStart = mainSource.indexOf("playerToggleBtn.addEventListener('click'");
  const playerEnd = mainSource.indexOf('\n        });', playerStart) + '\n        });'.length;
  const playerSource = mainSource.slice(playerStart, playerEnd);
  const retryStart = mainSource.indexOf("audioRetry.addEventListener('click'");
  const retryEnd = mainSource.indexOf('\n        });', retryStart) + '\n        });'.length;
  const retrySource = mainSource.slice(retryStart, retryEnd);
  const mediaStart = mainSource.indexOf('audioController.bindMediaActions({');
  const fadeStart = mainSource.indexOf('const stopAndFadeOutAudio = async');
  const fadeEnd = mainSource.indexOf('\n\n        const getCurrentArmAngle', fadeStart);
  const fadeSource = mainSource.slice(fadeStart, fadeEnd);

  assert.notEqual(directStart, -1);
  const motionCommandSource = mainSource.slice(
    mainSource.indexOf('const runMotionCommand = async'),
    directStart
  );
  assert.match(motionCommandSource, /if \(invalidatePlaybackCommand\) \{\s*directPlaybackCommandEpoch \+= 1/);
  assert.match(
    motionCommandSource,
    /const runOverlayMotionCommand = \(command\) => runMotionCommand\(command, \{\s*invalidatePlaybackCommand: false/
  );
  for (const overlayCommand of [
    "motion.closeOverlay('lyrics')",
    "motion.closeOverlay('playlist')",
    "motion.openOverlay('lyrics')",
    "motion.openOverlay('playlist')"
  ]) {
    assert.ok(mainSource.includes(`runOverlayMotionCommand(() => ${overlayCommand})`));
  }
  assert.match(directSource, /const commandEpoch = \+\+directPlaybackCommandEpoch/);
  assert.match(directSource, /const isCurrent = \(\) => commandEpoch === directPlaybackCommandEpoch/);
  assert.match(directSource, /await motion\.cancel\(reason\)/);
  assert.match(directSource, /cancelTurntableMotion\(\)/);
  assert.match(directSource, /return await command\(isCurrent\)/);
  assert.match(directSource, /if \(!isCurrent\(\)\) return;/);
  assert.match(fadeSource, /const frame = \(now\) => \{\s*if \(!isCurrent\(\)\) \{\s*cancel\(\);\s*return;/);
  assert.match(playerSource, /runDirectPlaybackCommand/);
  assert.match(playerSource, /isCurrent\) => toggleAudioState\(shouldPlay, \{ isCurrent \}\)/);
  assert.match(retrySource, /runMotionCommand\(\(\) => motion\.draw\(retryIndex\)\)/);
  assert.match(retrySource, /runDirectPlaybackCommand/);
  assert.match(retrySource, /isCurrent\) => toggleAudioState\(true, \{ retry: true, isCurrent \}\)/);
  const mediaSource = mainSource.slice(mediaStart, mediaStart + 1_400);
  assert.match(mediaSource, /runDirectPlaybackCommand/);
  assert.match(mediaSource, /isCurrent\) => toggleAudioState\(true, \{/);
  assert.match(mediaSource, /isCurrent\) => toggleAudioState\(false, \{/);
  assert.match(mediaSource, /stopTrack:[\s\S]*?isCurrent\) => toggleAudioState\(false, \{[\s\S]*?stopDuration: 0,[\s\S]*?isCurrent/);
});

test('transaction rollback delegates the complete audio snapshot to the controller', () => {
  const mainSource = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  const rollbackStart = mainSource.indexOf('const rollbackTrack = async');
  const rollbackEnd = mainSource.indexOf('\n\n        const PLAYLIST_CONTENT_REST_TRANSFORM', rollbackStart);
  const rollbackSource = mainSource.slice(rollbackStart, rollbackEnd);

  assert.notEqual(rollbackStart, -1);
  assert.match(rollbackSource, /audioController\.restore\(snapshot\.audio/);
  assert.doesNotMatch(rollbackSource, /audioEl\.currentTime\s*=/);
  assert.doesNotMatch(rollbackSource, /audioEl\.removeAttribute\('src'\)/);
});

test('stale direct playback results cannot reset newer playback visuals', () => {
  const mainSource = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  const toggleStart = mainSource.indexOf('const toggleAudioState = async (play, options = {}) => {');
  const toggleEnd = mainSource.indexOf("\n        playerToggleBtn.addEventListener('click'", toggleStart);
  const toggleSource = mainSource.slice(toggleStart, toggleEnd);

  assert.notEqual(toggleStart, -1);
  assert.match(toggleSource, /isCurrent = \(\) => true/);
  assert.match(toggleSource, /const played = await \(retry \? audioController\.retry\(\) : audioController\.play\(\)\)/);
  assert.match(toggleSource, /const played[\s\S]*?if \(!isCurrent\(\)\) return false;[\s\S]*?resetRejectedPlaybackVisual\(\)/);
  assert.match(toggleSource, /catch \(error\) \{[\s\S]*?if \(!isCurrent\(\)\) return false;[\s\S]*?audioController\.pause\(\)/);
  assert.match(toggleSource, /if \(isCurrent\(\)\) suppressPlaybackMotion = false/);
});

test('player and Media Session pause commands invalidate a loading controller attempt', () => {
  const mainSource = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  const toggleStart = mainSource.indexOf('const toggleAudioState = async (play, options = {}) => {');
  const toggleEnd = mainSource.indexOf("\n        playerToggleBtn.addEventListener('click'", toggleStart);
  const toggleSource = mainSource.slice(toggleStart, toggleEnd);
  const clickEnd = mainSource.indexOf('\n        });', toggleEnd) + '\n        });'.length;
  const clickSource = mainSource.slice(toggleEnd, clickEnd);

  assert.notEqual(toggleStart, -1);
  assert.match(toggleSource, /controllerStatus === 'loading'/);
  assert.match(toggleSource, /audioController\.pause\(\)/);
  assert.match(clickSource, /status === 'playing'/);
  assert.match(clickSource, /!playerToggleBtn\.classList\.contains\('is-playing'\)/);
  assert.match(clickSource, /status !== 'loading'/);
});

test('a visible replay intent cancels an in-flight pause fade and restores media', () => {
  const mainSource = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  const toggleStart = mainSource.indexOf('const toggleAudioState = async (play, options = {}) => {');
  const toggleEnd = mainSource.indexOf("\n        playerToggleBtn.addEventListener('click'", toggleStart);
  const toggleSource = mainSource.slice(toggleStart, toggleEnd);

  assert.match(toggleSource, /if \(play && controllerStatus === 'playing'\)/);
  assert.match(toggleSource, /cancelVolumeFade\(\)/);
  assert.match(toggleSource, /audioEl\.playbackRate = 1/);
  assert.match(toggleSource, /if \(canSetMediaVolume\) audioEl\.volume = 1/);
  assert.match(toggleSource, /setPlayerToggleState\(true\)/);
});

test('the vinyl sheen has a true zero-rate resting state', () => {
  const mainSource = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  assert.match(mainSource, /const sheenRate = clamped === 0 \? 0 : 0\.08 \+ normalized \* 1\.1/);
});

test('destroy removes every media element listener', async () => {
  const audio = new FakeAudio();
  const states = [];
  const controller = createAudioController({ audio, onStateChange: (state) => states.push(state.status) });
  await controller.load({ title: '媚人', musicOssUrl: 'https://example.test/meiren.mp3' });

  controller.destroy();
  const publishedBeforeEvents = states.length;
  assert.equal(audio.listenerCount('play'), 0);
  assert.equal(audio.listenerCount('pause'), 0);
  assert.equal(audio.listenerCount('error'), 0);
  assert.equal(audio.listenerCount('ended'), 0);
  assert.equal(audio.listenerCount('timeupdate'), 0);
  audio.emit('play');
  audio.emit('pause');
  audio.emit('ended');
  audio.emit('timeupdate');

  assert.equal(states.length, publishedBeforeEvents);
});
