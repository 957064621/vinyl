import { pathToFileURL } from 'node:url';

import { lyricsPool, releases } from '../../src/data.js';
import { CRITICAL_IMAGE_MANIFEST } from '../../src/config/assets.js';

export function validateMediaResponse({ kind, status, headers, immutable = false }) {
  const disposition = headers.get('content-disposition') || '';
  const type = headers.get('content-type') || '';
  if (/attachment/i.test(disposition) || !/inline/i.test(disposition)) {
    throw new Error(`${kind} Content-Disposition must be inline`);
  }

  if (kind === 'image') {
    if (status !== 200 || !/^image\//i.test(type)) {
      throw new Error('Image must return 200 with an image Content-Type');
    }
    const cacheControl = headers.get('cache-control') || '';
    if (immutable && (!/max-age=31536000/i.test(cacheControl) || !/immutable/i.test(cacheControl))) {
      throw new Error('Versioned image cache policy must be immutable for one year');
    }
  }

  if (kind === 'audio') {
    if (status !== 206) throw new Error('Audio Range request must return 206');
    if (!/^audio\/mpeg/i.test(type)) {
      throw new Error('Audio Content-Type must be audio/mpeg');
    }
    if (!/^bytes 0-0\/\d+$/i.test(headers.get('content-range') || '')) {
      throw new Error('Audio response must include Content-Range');
    }
  }
}

export function readRequiredContentLength(headers) {
  const bytes = Number(headers.get('content-length'));
  if (!Number.isInteger(bytes) || bytes <= 0) {
    throw new Error('Critical derivative requires a positive Content-Length');
  }
  return bytes;
}

export async function verifyAllMedia({ fetchImpl = fetch } = {}) {
  const images = [
    ...releases.map(({ title, coverOssUrl }) => ({
      title,
      url: coverOssUrl,
      immutable: true
    })),
    ...CRITICAL_IMAGE_MANIFEST.map(({ id, source }) => ({
      title: id,
      url: source,
      immutable: false
    }))
  ];
  const audio = [...new Map(
    lyricsPool.map((track) => [track.musicOssUrl, track])
  ).values()];
  const failures = [];
  let criticalMobileBytes = 0;

  for (const image of images) {
    try {
      const response = await fetchImpl(image.url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(12000)
      });
      validateMediaResponse({
        kind: 'image',
        status: response.status,
        headers: response.headers,
        immutable: image.immutable
      });
    } catch (error) {
      failures.push({ kind: 'image', id: image.title, message: error.message });
    }
  }

  for (const asset of CRITICAL_IMAGE_MANIFEST) {
    try {
      let response = await fetchImpl(asset.mobile, {
        method: 'HEAD',
        signal: AbortSignal.timeout(12000)
      });
      let headBytes = 0;
      if (response.status === 200) {
        validateMediaResponse({
          kind: 'image',
          status: response.status,
          headers: response.headers
        });
        try {
          headBytes = readRequiredContentLength(response.headers);
        } catch {}
      }

      if (headBytes > 0) {
        criticalMobileBytes += headBytes;
      } else {
        response = await fetchImpl(asset.mobile, {
          signal: AbortSignal.timeout(12000)
        });
        validateMediaResponse({
          kind: 'image',
          status: response.status,
          headers: response.headers
        });
        const bytes = (await response.arrayBuffer()).byteLength;
        if (bytes <= 0) throw new Error('Critical derivative returned an empty body');
        criticalMobileBytes += bytes;
      }
    } catch (error) {
      failures.push({ kind: 'critical-size', id: asset.id, message: error.message });
    }
  }

  if (criticalMobileBytes > 1.2 * 1024 * 1024) {
    failures.push({
      kind: 'critical-size',
      id: 'total',
      message: `${criticalMobileBytes} bytes exceeds 1.2 MiB`
    });
  }

  for (const track of audio) {
    try {
      const response = await fetchImpl(track.musicOssUrl, {
        headers: { Range: 'bytes=0-0' },
        signal: AbortSignal.timeout(12000)
      });
      validateMediaResponse({
        kind: 'audio',
        status: response.status,
        headers: response.headers
      });
    } catch (error) {
      failures.push({ kind: 'audio', id: track.title, message: error.message });
    }
  }

  if (failures.length > 0) {
    throw new Error(JSON.stringify(failures, null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyAllMedia();
  console.log(
    `verified ${releases.length + CRITICAL_IMAGE_MANIFEST.length} images and ${new Set(lyricsPool.map(({ musicOssUrl }) => musicOssUrl)).size} audio objects`
  );
}
