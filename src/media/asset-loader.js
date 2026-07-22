const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class CriticalAssetError extends Error {
  constructor(failures) {
    super(`Critical images failed: ${failures.map(({ id }) => id).join(', ')}`);
    this.name = 'CriticalAssetError';
    this.failures = failures;
  }
}

export function loadAndDecodeImage(src, {
  createImage = () => new Image(),
  timeoutMs = 12000,
  signal
} = {}) {
  return new Promise((resolve, reject) => {
    const image = createImage();
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      image.onload = null;
      image.onerror = null;
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const abort = () => settle(reject, new Error(`Image load aborted: ${src}`));
    const timer = setTimeout(
      () => settle(reject, new Error(`Image load timed out: ${src}`)),
      timeoutMs
    );

    image.onload = async () => {
      try {
        if (typeof image.decode === 'function') await image.decode();
        if ('naturalWidth' in image && image.naturalWidth === 0) {
          throw new Error(`Image has no decoded bitmap: ${src}`);
        }
        settle(resolve, { src, image });
      } catch (error) {
        settle(reject, error);
      }
    };
    image.onerror = () => settle(reject, new Error(`Image load failed: ${src}`));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    image.decoding = 'async';
    image.src = src;
  });
}

async function loadSlot(asset, options) {
  const candidates = options.selectCandidates(asset);
  const attempts = [];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const src = candidates[candidateIndex];
    const limit = candidateIndex === 0 ? options.retries + 1 : 1;
    for (let attempt = 1; attempt <= limit; attempt += 1) {
      try {
        return { ...await options.loadImage(src), id: asset.id, alt: asset.alt };
      } catch (error) {
        attempts.push({ src, attempt, error });
        if (attempt < limit) await wait(options.retryDelayMs);
      }
    }
  }
  const error = new Error(`No usable image for ${asset.id}`);
  error.attempts = attempts;
  throw error;
}

export async function loadCriticalImages(manifest, {
  selectCandidates,
  loadImage = loadAndDecodeImage,
  retries = 2,
  concurrency = 2,
  retryDelayMs = 250,
  onProgress = () => {}
}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new TypeError('concurrency must be a positive integer');
  }
  const results = new Array(manifest.length);
  const failures = [];
  let nextIndex = 0;
  let completed = 0;

  const worker = async () => {
    while (nextIndex < manifest.length) {
      const index = nextIndex;
      nextIndex += 1;
      const entry = manifest[index];
      onProgress({ id: entry.id, status: 'loading', completed, total: manifest.length });
      try {
        results[index] = await loadSlot(entry, {
          selectCandidates,
          loadImage,
          retries,
          retryDelayMs
        });
        completed += 1;
        onProgress({
          id: entry.id,
          status: 'ready',
          completed,
          total: manifest.length,
          src: results[index].src,
          result: results[index]
        });
      } catch (error) {
        failures.push({ id: entry.id, error, attempts: error.attempts });
        onProgress({ id: entry.id, status: 'failed', completed, total: manifest.length });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, manifest.length) }, () => worker())
  );
  if (failures.length > 0) throw new CriticalAssetError(failures);
  return results;
}
