import test from 'node:test';
import assert from 'node:assert/strict';

import { lyricsPool, releases } from '../../src/data.js';

test('current library imports in Node without a browser global', () => {
  assert.equal(releases.length, 24);
  assert.ok(lyricsPool.length >= 141);
});
