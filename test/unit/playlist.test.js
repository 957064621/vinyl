import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { releases, lyricsPool } from '../../src/data.js';
import { createPlaylist } from '../../src/ui/playlist.js';
import { ossImageDerivative } from '../../src/config/assets.js';

test('renders only on first open and updates active rows without rebuilding', () => {
  const dom = new JSDOM('<div id="list"></div>');
  const listEl = dom.window.document.querySelector('#list');
  const playlist = createPlaylist({
    listEl,
    releases,
    tracks: lyricsPool,
    getCoverCandidates: (release) => ({
      src: ossImageDerivative(release.coverOssUrl, 480),
      srcset: `${ossImageDerivative(release.coverOssUrl, 480)} 480w, ${ossImageDerivative(release.coverOssUrl, 960)} 960w`,
      fallback: release.coverOssUrl
    }),
    onSelect: () => {}
  });

  assert.equal(listEl.querySelectorAll('.playlist-item').length, 0);
  playlist.ensureRendered();
  assert.equal(listEl.querySelectorAll('.playlist-item').length, 142);
  const cover = listEl.querySelector('.playlist-cover');
  assert.match(cover.srcset, /480w.*960w/);
  assert.equal(cover.loading, 'lazy');
  const firstNode = listEl.querySelector('.playlist-item');
  playlist.ensureRendered();
  assert.equal(listEl.querySelector('.playlist-item'), firstNode);

  playlist.setActive(4);
  assert.equal(listEl.querySelectorAll('.playlist-item.is-current').length, 1);
  assert.equal(listEl.querySelector('.playlist-item.is-current').dataset.index, '4');
  playlist.setActive(5);
  assert.equal(listEl.querySelector('.playlist-item[data-index="4"]').classList.contains('is-current'), false);
  assert.equal(listEl.querySelector('.playlist-item[data-index="5"]').classList.contains('is-current'), true);
});
