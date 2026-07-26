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
    this.src = '';
    this.pauseCalls = 0;
    this.loadCalls = 0;
  }

  addEventListener(name, fn) { this.on(name, fn); }
  removeEventListener(name, fn) { this.off(name, fn); }
  setAttribute() {}
  load() { this.loadCalls += 1; }
  pause() { this.pauseCalls += 1; this.paused = true; this.emit('pause'); }
  async play() { this.paused = false; this.emit('play'); }
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

test('direct playback inputs yield the central motion owner before acting', () => {
  const mainSource = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  const directStart = mainSource.indexOf('const runDirectPlaybackCommand = async');
  const directEnd = mainSource.indexOf('\n\n        const closeLyricOverlay', directStart);
  const directSource = mainSource.slice(directStart, directEnd);
  const playerStart = mainSource.indexOf("playerToggleBtn.addEventListener('click'");
  const retryStart = mainSource.indexOf("audioRetry.addEventListener('click'");
  const mediaStart = mainSource.indexOf('audioController.bindMediaActions({');

  assert.notEqual(directStart, -1);
  assert.match(directSource, /await motion\.cancel\(reason\)/);
  assert.match(directSource, /cancelTurntableMotion\(\)/);
  assert.match(mainSource.slice(playerStart, playerStart + 320), /runDirectPlaybackCommand/);
  assert.match(mainSource.slice(retryStart, retryStart + 320), /runDirectPlaybackCommand/);
  assert.match(mainSource.slice(mediaStart, mediaStart + 900), /runDirectPlaybackCommand/);
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
