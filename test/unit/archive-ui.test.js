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
const rootManifest = JSON.parse(readFileSync(
  new URL('../../manifest.webmanifest', import.meta.url),
  'utf8'
));
const mainSource = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');

test('uses archive void for shell metadata and ASCII song attribution', () => {
  const document = new JSDOM(html).window.document;
  const firstPaintStyle = document.querySelector('head > style').textContent;

  assert.equal(document.querySelector('meta[name="theme-color"]').content, '#070808');
  assert.match(firstPaintStyle, /html,\s*body\s*\{[\s\S]*background:\s*#070808;/);
  assert.match(firstPaintStyle, /\.loading-screen\s*\{[\s\S]*background:\s*#070808;/);

  for (const currentManifest of [manifest, rootManifest]) {
    assert.equal(currentManifest.background_color, '#070808');
    assert.equal(currentManifest.theme_color, '#070808');
  }

  assert.match(mainSource, /songEl\.textContent\s*=\s*`- \$\{result\.song\}`;/);
  assert.doesNotMatch(mainSource, /[—–]/);
});

test('uses the archive identity without decorative header copy', () => {
  const document = new JSDOM(html).window.document;
  const header = document.querySelector('.header');

  assert.equal(document.title, '光影档案馆');
  assert.equal(
    document.querySelector('meta[name="apple-mobile-web-app-title"]').content,
    '光影档案馆'
  );
  assert.equal(header.querySelector('h1').textContent.trim(), '光影档案馆');
  assert.equal(
    header.querySelector('p').textContent.trim(),
    '按下按钮，为你抽取一段专属歌词'
  );
  assert.equal(header.children.length, 2);
  assert.equal(document.querySelector('.archive-kicker'), null);
  assert.equal(document.querySelector('.archive-accession'), null);
  assert.equal(manifest.name, '光影档案馆');
  assert.equal(manifest.short_name, '光影档案馆');
  assert.equal(rootManifest.name, '光影档案馆');
  assert.equal(rootManifest.short_name, '光影档案馆');
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
      { label: '编号', value: '--' },
      { label: '发行', value: '未抽取' },
      { label: '来源', value: '档案库' },
      { label: '状态', value: '待机' }
    ]
  );
});

test('maps selected tracks and controller states to stable archive metadata', () => {
  const tracks = [
    { album: '正式专辑', releaseType: 'album' },
    {
      album: '现场档案',
      releaseType: 'live-recording',
      recordingSource: '万兽之王演唱会录音'
    }
  ];

  assert.deepEqual(getArchiveMetadata(tracks, -1, 'idle'), {
    number: '--',
    release: '未抽取',
    source: '档案库',
    state: '待机'
  });
  assert.deepEqual(getArchiveMetadata(tracks, 0, 'loading'), {
    number: '01',
    release: '正式专辑',
    source: '正式发行',
    state: '读取'
  });
  assert.deepEqual(getArchiveMetadata(tracks, 1, 'playing'), {
    number: '02',
    release: '现场档案',
    source: '万兽之王演唱会录音',
    state: '播放'
  });
  assert.equal(getArchiveMetadata(tracks, 1, 'ready').state, '暂停');
  assert.equal(getArchiveMetadata(tracks, 1, 'paused').state, '暂停');
  assert.equal(getArchiveMetadata(tracks, 1, 'error').state, '故障');
});

test('updates the four metadata values without rebuilding the rail', () => {
  const document = new JSDOM(html).window.document;
  const rail = document.querySelector('#archiveTrackMeta');
  const updateArchiveMetadata = createArchiveMetadata({
    documentRef: document,
    tracks: [{ album: '渡 The Crossing', releaseType: 'album' }]
  });

  updateArchiveMetadata(0, 'playing');

  assert.equal(document.querySelector('#archiveTrackNumber').textContent, '01');
  assert.equal(document.querySelector('#archiveRelease').textContent, '渡 The Crossing');
  assert.equal(document.querySelector('#archiveSource').textContent, '正式发行');
  assert.equal(document.querySelector('#archivePlaybackState').textContent, '播放');
  assert.equal(document.querySelector('#archiveTrackMeta'), rail);
});
