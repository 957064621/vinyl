import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

import {
  CRITICAL_IMAGE_MANIFEST,
  selectCriticalImageCandidates
} from '../../src/config/assets.js';

const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

test('contains the nine numbered posters followed by the final responsive cover', () => {
  assert.equal(CRITICAL_IMAGE_MANIFEST.length, 10);
  assert.equal(new Set(CRITICAL_IMAGE_MANIFEST.map(({ id }) => id)).size, 10);
  assert.deepEqual(
    CRITICAL_IMAGE_MANIFEST.map(({ source }) => new URL(source).pathname),
    [...Array.from({ length: 9 }, (_, index) => `/covers/${index + 1}.jpg`), '/covers/end.jpg']
  );
  for (const asset of CRITICAL_IMAGE_MANIFEST) {
    const urls = ['source', 'mobile', 'desktop', 'fallback'].map((key) => new URL(asset[key]));
    assert.ok(urls.every((url) => url.origin === 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com'));
    assert.equal(new Set(urls.map(({ pathname }) => pathname)).size, 1);
    assert.match(asset.mobile, /resize,w_480/);
    assert.match(asset.desktop, /resize,w_960/);
    assert.match(asset.fallback, /resize,w_320/);
  }
  assert.equal(selectCriticalImageCandidates(CRITICAL_IMAGE_MANIFEST[0], 390)[0], CRITICAL_IMAGE_MANIFEST[0].mobile);
  assert.equal(selectCriticalImageCandidates(CRITICAL_IMAGE_MANIFEST[0], 1440)[0], CRITICAL_IMAGE_MANIFEST[0].desktop);
});

test('self-hosts the Chinese display font used by mobile titles and lyrics', () => {
  const fontUrl = new URL('../../src/assets/fonts/vinyl-serif-sc.woff2', import.meta.url);
  assert.ok(statSync(fontUrl).size > 100_000);
  assert.match(css, /@font-face\s*\{[^}]*font-family:\s*"Vinyl Serif SC"[^}]*font-display:\s*swap/s);
  assert.match(css, /--font-body:\s*var\(--font-ui\)/);
  assert.match(css, /--font-title:\s*"Vinyl Serif SC"/);
  assert.match(html, /rel="preload"[^>]*vinyl-serif-sc\.woff2[^>]*as="font"[^>]*type="font\/woff2"[^>]*crossorigin/);
});
