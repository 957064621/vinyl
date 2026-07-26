import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { releases, lyricsPool } from '../../src/data.js';
import {
  createPlaylist,
  createPlaylistSelectionGuard,
  getPlaylistViewportItems
} from '../../src/ui/playlist.js';
import { ossImageDerivative } from '../../src/config/assets.js';

const makePlaylist = ({
  releaseFixtures = releases,
  trackFixtures = lyricsPool,
  getCoverCandidates = () => null,
  onSelect = () => {}
} = {}) => {
  const dom = new JSDOM('<div id="list"></div>');
  const listEl = dom.window.document.querySelector('#list');
  const playlist = createPlaylist({
    listEl,
    releases: releaseFixtures,
    tracks: trackFixtures,
    getCoverCandidates,
    onSelect
  });

  return { dom, listEl, playlist };
};

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
  assert.equal(cover, cover.closest('.playlist-group-head').lastElementChild);
  assert.equal(listEl.querySelector('.playlist-album-meta').textContent, '2006');
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

test('skips invalid or unmatched release tracks and falls back to the release ordinal', () => {
  const releaseFixtures = [{
    title: 'Fixture Release',
    releaseDate: '',
    tracks: [
      null,
      { title: 'Matched', trackNumber: 2 },
      { title: 'No Number' },
      { title: 'Unmatched', trackNumber: 4 },
      { title: 'Invalid Number', trackNumber: '5' },
      {}
    ]
  }];
  const trackFixtures = [
    { album: 'Fixture Release', title: 'Matched', trackNumber: 2 },
    { album: 'Fixture Release', title: 'No Number' },
    { album: 'Fixture Release', title: 'Invalid Number', trackNumber: '5' }
  ];
  const { listEl, playlist } = makePlaylist({ releaseFixtures, trackFixtures });

  playlist.ensureRendered();

  const items = Array.from(listEl.querySelectorAll('.playlist-item'));
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.dataset.index), ['0', '1']);
  assert.deepEqual(items.map((item) => item.querySelector('.playlist-track-no').textContent), ['02', '03']);
  assert.equal(listEl.querySelector('[data-index="undefined"]'), null);
  assert.equal(listEl.textContent.includes('undefined'), false);
  assert.equal(listEl.querySelector('.playlist-album-meta').textContent, '待核对');
});

test('recovers from a pre-render active update and maintains accessible group state', () => {
  const { listEl, playlist } = makePlaylist();
  const secondReleaseIndex = releases[0].tracks.length;

  playlist.setActive(0);
  playlist.ensureRendered();
  assert.equal(listEl.querySelector('.playlist-item.is-current'), null);

  playlist.setActive(0);
  const firstItem = listEl.querySelector('.playlist-item[data-index="0"]');
  const firstGroup = firstItem.closest('.playlist-group');
  assert.equal(firstItem.getAttribute('aria-current'), 'true');
  assert.equal(firstGroup.classList.contains('is-current-group'), true);

  playlist.setActive(secondReleaseIndex);
  const secondItem = listEl.querySelector(`.playlist-item[data-index="${secondReleaseIndex}"]`);
  const secondGroup = secondItem.closest('.playlist-group');
  assert.equal(firstItem.classList.contains('is-current'), false);
  assert.equal(firstItem.hasAttribute('aria-current'), false);
  assert.equal(firstGroup.classList.contains('is-current-group'), false);
  assert.equal(secondItem.getAttribute('aria-current'), 'true');
  assert.equal(secondGroup.classList.contains('is-current-group'), true);
  assert.equal(listEl.querySelectorAll('[aria-current="true"]').length, 1);
  assert.equal(listEl.querySelectorAll('.playlist-group.is-current-group').length, 1);
});

test('delegates row selection and stops dispatching after destroy', () => {
  const selectedIndexes = [];
  const { dom, listEl, playlist } = makePlaylist({
    onSelect: (index) => selectedIndexes.push(index)
  });
  playlist.ensureRendered();

  listEl.querySelector('.playlist-item[data-index="4"] .playlist-track-name')
    .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(selectedIndexes, [4]);

  playlist.destroy();
  listEl.querySelector('.playlist-item[data-index="5"] .playlist-track-name')
    .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(selectedIndexes, [4]);
});

test('clears responsive candidates and falls back once when a cover fails', () => {
  const releaseFixtures = [{
    title: 'Fixture Release',
    tracks: [{ title: 'Matched', trackNumber: 1 }]
  }];
  const trackFixtures = [{ album: 'Fixture Release', title: 'Matched', trackNumber: 1 }];
  const fallback = 'https://example.com/cover.jpg';
  const { dom, listEl, playlist } = makePlaylist({
    releaseFixtures,
    trackFixtures,
    getCoverCandidates: () => ({
      src: 'https://example.com/cover-480.webp',
      srcset: 'https://example.com/cover-480.webp 480w, https://example.com/cover-960.webp 960w',
      fallback
    })
  });
  playlist.ensureRendered();

  const cover = listEl.querySelector('.playlist-cover');
  cover.dispatchEvent(new dom.window.Event('error'));
  assert.equal(cover.srcset, '');
  assert.equal(cover.src, fallback);

  cover.src = 'https://example.com/after-fallback.webp';
  cover.dispatchEvent(new dom.window.Event('error'));
  assert.equal(cover.src, 'https://example.com/after-fallback.webp');
});

test('selection guard ignores drawing and track-switching interactions', () => {
  const selectedIndexes = [];
  const interaction = { isDrawing: false, isTrackSwitching: false };
  const handleSelect = createPlaylistSelectionGuard({
    isLocked: () => interaction.isDrawing || interaction.isTrackSwitching,
    onSelect: (index) => selectedIndexes.push(index)
  });

  handleSelect(1);
  interaction.isDrawing = true;
  handleSelect(2);
  interaction.isDrawing = false;
  interaction.isTrackSwitching = true;
  handleSelect(3);

  assert.deepEqual(selectedIndexes, [1]);
});

test('collects only viewport rows around the current item and stops at both bounds', () => {
  let geometryReads = 0;
  const rows = [
    [-80, -60],
    [-30, -10],
    [10, 30],
    [40, 60],
    [70, 90],
    [110, 130],
    [140, 160]
  ].map(([top, bottom], index) => ({
    index,
    getBoundingClientRect() {
      geometryReads += 1;
      return { top, bottom };
    }
  }));

  const visibleRows = getPlaylistViewportItems(rows, { top: 0, bottom: 100 }, 3);

  assert.deepEqual(visibleRows.map(({ index }) => index), [2, 3, 4]);
  assert.equal(geometryReads, 5);
});
