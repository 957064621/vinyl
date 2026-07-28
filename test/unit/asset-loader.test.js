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

test('abort stops queued image work and reaches the active request signal', async () => {
  const controller = new AbortController();
  const started = [];
  let notifyStarted;
  const firstStarted = new Promise((resolve) => { notifyStarted = resolve; });
  const manifest = Array.from({ length: 3 }, (_, index) => ({
    id: `a${index}`,
    source: `${index}.jpg`
  }));

  const loading = loadCriticalImages(manifest, {
    selectCandidates: (entry) => [entry.source],
    concurrency: 1,
    signal: controller.signal,
    loadImage: (src, { signal }) => new Promise((resolve, reject) => {
      started.push(src);
      notifyStarted();
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })
  });

  await firstStarted;
  controller.abort(new Error('skip requested'));
  await assert.rejects(loading, /skip requested/);
  assert.deepEqual(started, ['0.jpg']);
});

test('drains workers and aggregates async progress observer errors', async () => {
  const loaded = [];
  const unhandled = [];
  const listener = (error) => unhandled.push(error);
  const manifest = Array.from({ length: 3 }, (_, index) => ({ id: `a${index}`, source: `${index}.jpg` }));
  process.on('unhandledRejection', listener);

  try {
    await assert.rejects(
      loadCriticalImages(manifest, {
        selectCandidates: (entry) => [entry.source],
        concurrency: 2,
        loadImage: async (src) => {
          loaded.push(src);
          await new Promise((resolve) => setImmediate(resolve));
          return { src, image: { src } };
        },
        onProgress: async ({ id, status }) => {
          if (id === 'a0' && status === 'ready') throw new Error('progress failed');
        }
      }),
      (error) => error instanceof AggregateError
        && error.message === 'Progress observer failed'
        && error.errors[0].message === 'progress failed'
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(loaded.sort(), ['0.jpg', '1.jpg', '2.jpg']);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', listener);
  }
});

test('does not classify a synchronous progress observer error as an asset failure', async () => {
  const manifest = [
    { id: 'archive-01', source: 'good.jpg' },
    { id: 'archive-02', source: 'bad.jpg' }
  ];
  await assert.rejects(
    loadCriticalImages(manifest, {
      selectCandidates: (entry) => [entry.source],
      concurrency: 1,
      retries: 0,
      loadImage: async (src) => {
        if (src === 'bad.jpg') throw new Error('decode failed');
        return { src, image: { src } };
      },
      onProgress: ({ id, status }) => {
        if (id === 'archive-01' && status === 'ready') throw new Error('progress failed');
      }
    }),
    (error) => error instanceof CriticalAssetError
      && error.failures.length === 1
      && error.failures[0].id === 'archive-02'
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

test('reports concurrent failures in manifest order', async () => {
  const manifest = [
    { id: 'archive-01', source: 'slow.jpg' },
    { id: 'archive-02', source: 'fast.jpg' }
  ];
  await assert.rejects(
    loadCriticalImages(manifest, {
      selectCandidates: (entry) => [entry.source],
      concurrency: 2,
      retries: 0,
      loadImage: async (src) => {
        if (src === 'slow.jpg') await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error(`failed ${src}`);
      }
    }),
    (error) => error instanceof CriticalAssetError
      && error.message === 'Critical images failed: archive-01, archive-02'
      && error.failures.map(({ id }) => id).join(',') === 'archive-01,archive-02'
  );
});
