import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

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
