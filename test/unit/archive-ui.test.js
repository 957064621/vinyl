import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import {
  createArchiveMetadata,
  getArchiveMetadata
} from '../../src/ui/archive-metadata.js';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(
  new URL('../../public/manifest.webmanifest', import.meta.url),
  'utf8'
));
const mainSource = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
const songAttributionAssignments = [...mainSource.matchAll(
  /songEl\.textContent\s*=\s*(`[^`]*`);/g
)].map((match) => match[1]);

test('uses archive void for shell metadata and ASCII song attribution', () => {
  const document = new JSDOM(html).window.document;
  const firstPaintStyle = document.querySelector('head > style').textContent;

  assert.equal(document.querySelector('meta[name="theme-color"]').content, '#070808');
  assert.match(firstPaintStyle, /html,\s*body\s*\{[\s\S]*background:\s*#070808;/);
  assert.match(firstPaintStyle, /\.loading-screen\s*\{[\s\S]*background:\s*#070808;/);

  assert.deepEqual(
    {
      name: manifest.name,
      short_name: manifest.short_name,
      start_url: manifest.start_url,
      display: manifest.display,
      orientation: manifest.orientation,
      background_color: manifest.background_color,
      theme_color: manifest.theme_color
    },
    {
      name: '歌词抽取机',
      short_name: '歌词抽取机',
      start_url: './',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#070808',
      theme_color: '#070808'
    }
  );

  assert.deepEqual(songAttributionAssignments, ['`- ${result.song}`']);
});

test('uses the lyric draw identity without decorative header copy', () => {
  const document = new JSDOM(html).window.document;
  const header = document.querySelector('.header');

  assert.equal(document.title, '歌词抽取机');
  assert.equal(
    document.querySelector('meta[name="apple-mobile-web-app-title"]').content,
    '歌词抽取机'
  );
  assert.equal(header.querySelector('h1').textContent.trim(), '歌词抽取机');
  assert.equal(
    header.querySelector('p').textContent.trim(),
    '按下按钮，为你抽取一段专属歌词'
  );
  assert.equal(header.children.length, 2);
  assert.equal(document.querySelector('.archive-kicker'), null);
  assert.equal(document.querySelector('.archive-accession'), null);
  assert.equal(manifest.name, '歌词抽取机');
  assert.equal(manifest.short_name, '歌词抽取机');
});

test('defines one factual four-field metadata rail', () => {
  const document = new JSDOM(html).window.document;
  const rail = document.querySelector('#archiveTrackMeta');

  assert.ok(rail);
  assert.deepEqual(
    Array.from(rail.querySelectorAll(':scope > div')).map((row) => ({
      label: row.querySelector('dt')?.textContent.trim(),
      value: row.querySelector('dd')?.textContent.trim()
    })),
    [
      { label: '歌曲', value: '未抽取' },
      { label: '发行', value: '未抽取' },
      { label: '年份', value: '----' },
      { label: '状态', value: '待机' }
    ]
  );
});

test('maps selected tracks and controller states to stable archive metadata', () => {
  const tracks = [
    { title: '方圆几里', album: '正式专辑', releaseType: 'album', releaseDate: '2013-11-11' },
    {
      title: '粉钻',
      album: '现场档案',
      releaseType: 'live-recording',
      releaseDate: '2026',
      recordingSource: '万兽之王演唱会录音'
    }
  ];

  assert.deepEqual(getArchiveMetadata(tracks, -1, 'idle'), {
    song: '未抽取',
    release: '未抽取',
    year: '----',
    state: '待机'
  });
  assert.deepEqual(getArchiveMetadata(tracks, -1, 'drawing'), {
    song: '未抽取',
    release: '未抽取',
    year: '----',
    state: '抽取中'
  });
  assert.deepEqual(getArchiveMetadata(tracks, 0, 'loading'), {
    song: '方圆几里',
    release: '正式专辑',
    year: '2013',
    state: '读取'
  });
  assert.deepEqual(getArchiveMetadata(tracks, 1, 'playing'), {
    song: '粉钻',
    release: '现场档案',
    year: '2026',
    state: '播放'
  });
  assert.equal(getArchiveMetadata([{
    title: '媚人',
    album: '媚人 - Single',
    releaseDate: '2026-07-17'
  }], 0, 'ready').year, '2026');
  assert.equal(getArchiveMetadata(tracks, 1, 'ready').state, '暂停');
  assert.equal(getArchiveMetadata(tracks, 1, 'paused').state, '暂停');
  assert.equal(getArchiveMetadata(tracks, 1, 'error').state, '故障');
  assert.equal(getArchiveMetadata(tracks, 1, 'drawing').state, '抽取中');
});

test('updates the four metadata values without rebuilding the rail', () => {
  const document = new JSDOM(html).window.document;
  const rail = document.querySelector('#archiveTrackMeta');
  const updateArchiveMetadata = createArchiveMetadata({
    documentRef: document,
    tracks: [{ title: '动物世界', album: '渡 The Crossing', releaseType: 'album', releaseDate: '2017-11-28' }]
  });

  updateArchiveMetadata(0, 'playing');

  assert.equal(document.querySelector('#archiveTrackSong').textContent, '动物世界');
  assert.equal(document.querySelector('#archiveRelease').textContent, '渡 The Crossing');
  assert.equal(document.querySelector('#archiveYear').textContent, '2017');
  assert.equal(document.querySelector('#archivePlaybackState').textContent, '播放');
  assert.equal(document.querySelector('#archiveTrackMeta'), rail);
});

test('applies the track fallback palette before remote cover preparation can settle', () => {
  const applyStart = mainSource.indexOf('const applyCoverVisual = async (index) => {');
  const applyEnd = mainSource.indexOf('\n        };', applyStart);
  const applySource = mainSource.slice(applyStart, applyEnd);
  const requestIndex = applySource.indexOf('const requestId = ++coverSwapRequestId;');
  const fallbackIndex = applySource.indexOf('setCoverPalette(getTrackPaletteByIndex(index));');
  const prepareIndex = applySource.indexOf('await primeCoverVisual(index)');
  const staleGuardIndex = applySource.indexOf('if (requestId !== coverSwapRequestId)');
  const refinedIndex = applySource.indexOf('setCoverPalette(palette);');

  assert.notEqual(applyStart, -1);
  for (const stepIndex of [requestIndex, fallbackIndex, prepareIndex, staleGuardIndex, refinedIndex]) {
    assert.notEqual(stepIndex, -1);
  }
  assert.ok(requestIndex < fallbackIndex);
  assert.ok(fallbackIndex < prepareIndex);
  assert.ok(prepareIndex < staleGuardIndex);
  assert.ok(staleGuardIndex < refinedIndex);
});

test('eases the portfolio-style pointer light with a finite animation-frame loop', () => {
  const pointerStart = mainSource.indexOf('const renderPointerLight = () => {');
  const pointerEnd = mainSource.indexOf('\n        const DRAW_BUTTON_SPOT_DEFAULT_X', pointerStart);
  const pointerSource = mainSource.slice(pointerStart, pointerEnd);

  assert.notEqual(pointerStart, -1);
  assert.notEqual(pointerEnd, -1);
  assert.match(pointerSource, /pointerLightCurrent\.x \+= \(x - pointerLightCurrent\.x\) \* 0\.2/);
  assert.match(pointerSource, /setProperty\('--pointer-x'/);
  assert.match(pointerSource, /setProperty\('--pointer-y'/);
  assert.match(pointerSource, /> 0\.08/);
  assert.doesNotMatch(pointerSource, /pointerLight\.style\.transform/);
});
