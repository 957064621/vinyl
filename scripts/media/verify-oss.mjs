import { pathToFileURL } from 'node:url';

import { lyricsPool, releases } from '../../src/data.js';
import { CRITICAL_IMAGE_MANIFEST } from '../../src/config/assets.js';
import {
  MAX_IMAGE_BYTES,
  normalizeImageMediaType,
  validateImageSignature
} from './mirror-covers.mjs';

const ROLE_ORIGINS = Object.freeze({
  'release-cover': 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com',
  critical: 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com',
  audio: 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com'
});
const CRITICAL_BUDGET_BYTES = 1.2 * 1024 * 1024;
const VERSIONED_RELEASE_COVER = /^\/covers\/releases\/v2026-07\/\d{3}\.jpg$/;
const SHARED_RELEASE_COVER = '/covers/end.jpg';

const normalizedType = (value) => String(value || '').split(';', 1)[0].trim().toLowerCase();

const validateInlineDisposition = (value, kind) => {
  const token = String(value || '').split(';', 1)[0].trim().toLowerCase();
  if (token !== 'inline') throw new Error(`${kind} Content-Disposition must be inline`);
};

const parseCacheControl = (value) => {
  const directives = new Map();
  for (const rawToken of String(value || '').split(',')) {
    const token = rawToken.trim();
    if (!token) continue;
    const separator = token.indexOf('=');
    const name = (separator === -1 ? token : token.slice(0, separator)).trim().toLowerCase();
    const directiveValue = separator === -1 ? null : token.slice(separator + 1).trim();
    if (!/^[a-z][a-z0-9-]*$/.test(name) || directives.has(name)) {
      throw new Error('Cache-Control contains an invalid or duplicate directive');
    }
    directives.set(name, directiveValue);
  }
  return directives;
};

export function readRequiredContentLength(headers) {
  const raw = headers.get('content-length');
  if (raw === null || !/^[1-9]\d*$/.test(raw.trim())) {
    throw new Error('Critical derivative requires a positive Content-Length');
  }
  const bytes = Number(raw);
  if (!Number.isSafeInteger(bytes)) {
    throw new Error('Critical derivative Content-Length exceeds the safe integer range');
  }
  return bytes;
}

export function validateMediaResponse({ kind, status, headers, immutable = false }) {
  validateInlineDisposition(headers.get('content-disposition'), kind);
  if (kind === 'image') {
    if (status !== 200) throw new Error('Image must return 200');
    normalizeImageMediaType(headers.get('content-type'));
    if (immutable) {
      const directives = parseCacheControl(headers.get('cache-control'));
      if (directives.get('max-age') !== '31536000' || directives.get('immutable') !== null) {
        throw new Error('Versioned image cache policy must be immutable for one year');
      }
    }
    return;
  }
  if (kind === 'audio') {
    if (status !== 206) throw new Error('Audio Range request must return 206');
    if (normalizedType(headers.get('content-type')) !== 'audio/mpeg') {
      throw new Error('Audio Content-Type must be audio/mpeg');
    }
    const range = /^bytes 0-0\/([1-9]\d*)$/.exec(headers.get('content-range') || '');
    if (!range || !Number.isSafeInteger(Number(range[1]))) {
      throw new Error('Audio response must include Content-Range bytes 0-0/positive-total');
    }
    if (headers.get('content-length') !== null && readRequiredContentLength(headers) !== 1) {
      throw new Error('Audio Range response Content-Length must be one byte');
    }
    return;
  }
  throw new Error(`Unknown media kind: ${kind}`);
}

export function validateMediaUrl(value, role) {
  const expectedOrigin = ROLE_ORIGINS[role];
  if (!expectedOrigin) throw new Error(`Unknown media role: ${role}`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${role} media URL is invalid`);
  }
  if (url.protocol !== 'https:' || url.origin !== expectedOrigin) {
    throw new Error(`${role} media origin must be ${expectedOrigin}`);
  }
  if (
    role === 'release-cover'
    && !VERSIONED_RELEASE_COVER.test(url.pathname)
    && url.pathname !== SHARED_RELEASE_COVER
  ) {
    throw new Error('Release cover URL must use the v2026-07 ordinal path or covers/end.jpg');
  }
  if (role === 'critical' && !url.pathname.startsWith('/covers/')) {
    throw new Error('Critical image URL must use the covers/ prefix');
  }
  if (role === 'audio' && !url.pathname.startsWith('/musics/')) {
    throw new Error('Audio URL must use the musics/ prefix');
  }
  return url;
}

const validateFinalUrl = (response, role) => {
  try {
    validateMediaUrl(response.url, role);
  } catch (error) {
    throw new Error(`Final response ${error.message}`);
  }
};

const cancelResponseBody = async (response) => {
  if (!response?.body || response.body.locked) return;
  try { await response.body.cancel(); } catch {}
};

const readBoundedBody = async (response, maxBytes, label) => {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const length = readRequiredContentLength(response.headers);
    if (length > maxBytes) throw new Error(`${label} body exceeds ${maxBytes} byte limit`);
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error(`${label} response requires a readable body`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`${label} body exceeds ${maxBytes} byte limit`);
      chunks.push(Buffer.from(value));
    }
  } finally {
    if (!complete) {
      try { await reader.cancel(); } catch {}
    }
    reader.releaseLock?.();
  }
  if (total === 0) throw new Error(`${label} response returned an empty body`);
  return Buffer.concat(chunks, total);
};

const requestSignal = (globalSignal, requestTimeoutMs) => AbortSignal.any([
  globalSignal,
  AbortSignal.timeout(requestTimeoutMs)
]);

const fetchChecked = async ({
  fetchImpl,
  url,
  role,
  options,
  globalSignal,
  requestTimeoutMs
}) => {
  validateMediaUrl(url, role);
  const response = await fetchImpl(url, {
    ...options,
    signal: requestSignal(globalSignal, requestTimeoutMs)
  });
  try {
    validateFinalUrl(response, role);
    return response;
  } catch (error) {
    await cancelResponseBody(response);
    throw error;
  }
};

const validateImageGet = async ({ response, role, immutable, maxBytes }) => {
  try {
    if (![200, 206].includes(response.status)) {
      throw new Error(`Image signature request must return 200 or 206, received ${response.status}`);
    }
    validateInlineDisposition(response.headers.get('content-disposition'), 'image');
    const type = normalizeImageMediaType(response.headers.get('content-type'));
    if (immutable) {
      const directives = parseCacheControl(response.headers.get('cache-control'));
      if (directives.get('max-age') !== '31536000' || directives.get('immutable') !== null) {
        throw new Error('Versioned image cache policy must be immutable for one year');
      }
    }
    validateFinalUrl(response, role);
    const body = await readBoundedBody(response, maxBytes, 'Image');
    validateImageSignature(body, type);
    return { bytes: body.byteLength, status: response.status };
  } catch (error) {
    await cancelResponseBody(response);
    throw error;
  }
};

const runBounded = async (tasks, concurrency, globalSignal) => {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new TypeError('Verification concurrency must be a positive integer');
  }
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      const task = tasks[index];
      try {
        if (globalSignal.aborted) throw new Error('Media verification global deadline exceeded');
        results[index] = { status: 'fulfilled', value: await task.run() };
      } catch (error) {
        results[index] = { status: 'rejected', error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return results;
};

const aggregateFailures = (failures) => {
  const error = new AggregateError(
    failures.map(({ kind, id, message }) => new Error(`${kind}:${id}: ${message}`)),
    `OSS verification failed for ${failures.length} checks`
  );
  error.failures = failures;
  return error;
};

export async function verifyAllMedia({
  fetchImpl = fetch,
  releasesInput = releases,
  criticalManifest = CRITICAL_IMAGE_MANIFEST,
  tracks = lyricsPool,
  concurrency = 6,
  deadlineMs = 120000,
  requestTimeoutMs = 12000,
  maxImageBytes = MAX_IMAGE_BYTES
} = {}) {
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => {
    deadlineController.abort(new Error('Media verification global deadline exceeded'));
  }, deadlineMs);
  const globalSignal = deadlineController.signal;
  const uniqueAudio = [...new Map(tracks.map((track) => [track.musicOssUrl, track])).values()];
  const tasks = [];
  let order = 0;
  const addTask = (kind, id, run) => tasks.push({ order: order++, kind, id, run });

  for (const release of releasesInput) {
    addTask('image', release.title, async () => {
      const releaseUrl = validateMediaUrl(release.coverOssUrl, 'release-cover');
      const immutable = VERSIONED_RELEASE_COVER.test(releaseUrl.pathname);
      const head = await fetchChecked({
        fetchImpl,
        url: release.coverOssUrl,
        role: 'release-cover',
        options: { method: 'HEAD' },
        globalSignal,
        requestTimeoutMs
      });
      let length;
      try {
        validateMediaResponse({ kind: 'image', status: head.status, headers: head.headers, immutable });
        length = readRequiredContentLength(head.headers);
      } finally {
        await cancelResponseBody(head);
      }
      if (length > maxImageBytes) throw new Error(`Versioned cover exceeds ${maxImageBytes} byte limit`);
      const signature = await fetchChecked({
        fetchImpl,
        url: release.coverOssUrl,
        role: 'release-cover',
        options: { headers: { Range: 'bytes=0-15' } },
        globalSignal,
        requestTimeoutMs
      });
      await validateImageGet({ response: signature, role: 'release-cover', immutable, maxBytes: length });
      return length;
    });
  }

  for (const asset of criticalManifest) {
    addTask('image', asset.id, async () => {
      const response = await fetchChecked({
        fetchImpl,
        url: asset.source,
        role: 'critical',
        options: { method: 'HEAD' },
        globalSignal,
        requestTimeoutMs
      });
      try {
        validateMediaResponse({ kind: 'image', status: response.status, headers: response.headers });
        return readRequiredContentLength(response.headers);
      } finally {
        await cancelResponseBody(response);
      }
    });
  }

  for (const asset of criticalManifest) {
    addTask('critical-size', asset.id, async () => {
      const head = await fetchChecked({
        fetchImpl,
        url: asset.mobile,
        role: 'critical',
        options: { method: 'HEAD' },
        globalSignal,
        requestTimeoutMs
      });
      let headBytes = 0;
      try {
        validateMediaResponse({ kind: 'image', status: head.status, headers: head.headers });
        try { headBytes = readRequiredContentLength(head.headers); } catch {}
      } finally {
        await cancelResponseBody(head);
      }
      if (headBytes > maxImageBytes) throw new Error(`Critical derivative exceeds ${maxImageBytes} byte limit`);

      const signature = await fetchChecked({
        fetchImpl,
        url: asset.mobile,
        role: 'critical',
        options: { headers: { Range: 'bytes=0-15' } },
        globalSignal,
        requestTimeoutMs
      });
      const signatureResult = await validateImageGet({
        response: signature,
        role: 'critical',
        immutable: false,
        maxBytes: headBytes || maxImageBytes
      });
      if (headBytes > 0) return headBytes;
      if (signatureResult.status === 200) return signatureResult.bytes;

      const full = await fetchChecked({
        fetchImpl,
        url: asset.mobile,
        role: 'critical',
        options: {},
        globalSignal,
        requestTimeoutMs
      });
      const fullResult = await validateImageGet({
        response: full,
        role: 'critical',
        immutable: false,
        maxBytes: maxImageBytes
      });
      return fullResult.bytes;
    });
  }

  for (const track of uniqueAudio) {
    addTask('audio', track.title, async () => {
      const response = await fetchChecked({
        fetchImpl,
        url: track.musicOssUrl,
        role: 'audio',
        options: { headers: { Range: 'bytes=0-0' } },
        globalSignal,
        requestTimeoutMs
      });
      try {
        validateMediaResponse({ kind: 'audio', status: response.status, headers: response.headers });
        const body = await readBoundedBody(response, 1, 'Audio Range');
        if (body.byteLength !== 1) throw new Error('Audio Range body must contain exactly one byte');
      } catch (error) {
        await cancelResponseBody(response);
        throw error;
      }
      return 1;
    });
  }

  let results;
  try {
    results = await runBounded(tasks, concurrency, globalSignal);
  } finally {
    clearTimeout(deadlineTimer);
  }
  const failures = [];
  let criticalMobileBytes = 0;
  results.forEach((result, index) => {
    const task = tasks[index];
    if (result.status === 'rejected') {
      failures.push({ order: task.order, kind: task.kind, id: task.id, message: result.error.message });
    } else if (task.kind === 'critical-size') {
      criticalMobileBytes += result.value;
    }
  });
  if (criticalMobileBytes > CRITICAL_BUDGET_BYTES) {
    failures.push({
      order: tasks.length,
      kind: 'critical-size',
      id: 'total',
      message: `${criticalMobileBytes} bytes exceeds 1.2 MiB`
    });
  }
  if (failures.length > 0) throw aggregateFailures(failures);
  return {
    imageCount: releasesInput.length + criticalManifest.length,
    derivativeCount: criticalManifest.length,
    audioCount: uniqueAudio.length,
    criticalMobileBytes
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await verifyAllMedia();
    console.log(`verified ${result.imageCount} images and ${result.audioCount} audio objects`);
  } catch (error) {
    console.error(JSON.stringify({
      error: error.message,
      failures: error.failures || []
    }, null, 2));
    process.exitCode = 1;
  }
}
