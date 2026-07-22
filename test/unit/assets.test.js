import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CRITICAL_IMAGE_MANIFEST,
  selectCriticalImageCandidates
} from '../../src/config/assets.js';

test('contains exactly five responsive variants of existing OSS covers', () => {
  assert.equal(CRITICAL_IMAGE_MANIFEST.length, 5);
  assert.equal(new Set(CRITICAL_IMAGE_MANIFEST.map(({ id }) => id)).size, 5);
  for (const asset of CRITICAL_IMAGE_MANIFEST) {
    const urls = ['source', 'mobile', 'desktop', 'fallback'].map((key) => new URL(asset[key]));
    assert.ok(urls.every((url) => url.origin === 'https://yuko-portfolio.oss-cn-hangzhou.aliyuncs.com'));
    assert.equal(new Set(urls.map(({ pathname }) => pathname)).size, 1);
    assert.match(asset.mobile, /resize,w_480/);
    assert.match(asset.desktop, /resize,w_960/);
    assert.match(asset.fallback, /resize,w_320/);
  }
  assert.equal(selectCriticalImageCandidates(CRITICAL_IMAGE_MANIFEST[0], 390)[0], CRITICAL_IMAGE_MANIFEST[0].mobile);
  assert.equal(selectCriticalImageCandidates(CRITICAL_IMAGE_MANIFEST[0], 1440)[0], CRITICAL_IMAGE_MANIFEST[0].desktop);
});
