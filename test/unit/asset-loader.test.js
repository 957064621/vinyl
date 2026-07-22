import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CriticalAssetError,
  loadAndDecodeImage,
  loadCriticalImages
} from '../../src/media/asset-loader.js';

const asset = {
  id: 'archive-01',
  alt: '封面',
  desktop: 'desktop.webp',
  fallback: 'small.webp',
  source: 'source.jpg'
};

test('requires decode success and rejects timeout', async () => {
  const decodeFailure = {
    naturalWidth: 100,
    decode: async () => { throw new Error('decode failed'); },
    set src(value) { this.currentSrc = value; queueMicrotask(() => this.onload()); }
  };
  await assert.rejects(
    loadAndDecodeImage('bad.webp', { createImage: () => decodeFailure, timeoutMs: 50 }),
    /decode failed/
  );
  await assert.rejects(
    loadAndDecodeImage('slow.webp', { createImage: () => ({}), timeoutMs: 1 }),
    /timed out/
  );
});

test('retries the selected derivative twice before a smaller fallback', async () => {
  const calls = [];
  const result = await loadCriticalImages([asset], {
    selectCandidates: (entry) => [entry.desktop, entry.fallback, entry.source],
    loadImage: async (src) => {
      calls.push(src);
      if (src === asset.desktop) throw new Error('network');
      return { src, image: { src } };
    },
    retries: 2,
    retryDelayMs: 0
  });
  assert.deepEqual(calls, ['desktop.webp', 'desktop.webp', 'desktop.webp', 'small.webp']);
  assert.equal(result[0].src, 'small.webp');
});

test('limits concurrency and reports completed decoded slots', async () => {
  let active = 0;
  let maxActive = 0;
  const progress = [];
  const manifest = Array.from({ length: 5 }, (_, index) => ({ id: `a${index}`, source: `${index}.jpg` }));
  await loadCriticalImages(manifest, {
    selectCandidates: (entry) => [entry.source],
    concurrency: 2,
    loadImage: async (src) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return { src, image: { src } };
    },
    onProgress: (event) => progress.push(event)
  });
  assert.equal(maxActive, 2);
  assert.deepEqual(
    progress.filter(({ status }) => status === 'ready').map(({ completed }) => completed).sort(),
    [1, 2, 3, 4, 5]
  );
});

test('names failed slots instead of resolving an incomplete player', async () => {
  await assert.rejects(
    loadCriticalImages([asset], {
      selectCandidates: (entry) => [entry.desktop, entry.fallback, entry.source],
      loadImage: async () => { throw new Error('decode'); },
      retries: 0,
      retryDelayMs: 0
    }),
    (error) => error instanceof CriticalAssetError && error.failures[0].id === 'archive-01'
  );
});
