import test from 'node:test';
import assert from 'node:assert/strict';

import { lyricsPool, releases } from '../../src/data.js';
import { MAX_LYRIC_LINES, parseLyricLines } from '../../src/lyrics/format.js';

const liveRelease = () => releases.find((release) => release.title === '万兽之王演唱会录音');

test('uses the approved 粉钻 wording', () => {
  const track = liveRelease().tracks.find(({ title }) => title === '粉钻');
  assert.equal(track.text, '满地粉钻 无人看管\n' + '你若不甘 用挚爱交换\n' + '漫天红伞 无人生还\n' + '我的遗憾 是不能洁白的带你离开');
  assert.doesNotMatch(track.text, /用爱交换/);
});

test('adds 媚人 as the third live recording', () => {
  const release = liveRelease();
  const track = release.tracks[2];
  assert.deepEqual(release.tracks.map(({ title, trackNumber }) => ({ title, trackNumber })), [
    { title: '粉钻', trackNumber: 1 },
    { title: '造物', trackNumber: 2 },
    { title: '媚人', trackNumber: 3 }
  ]);
  assert.equal(track.artist, '薛之谦');
  assert.equal(track.recordingSource, release.title);
  assert.equal(track.musicOssUrl, 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com/musics/%E5%AA%9A%E4%BA%BA.mp3');
  assert.deepEqual(parseLyricLines(track.text), [
    '我们都疮痍满身',
    '再捏造缘分',
    '然后扮成 无辜的路人',
    '要粉饰半生',
    '残存体温',
    '献祭给假圣人'
  ]);
});

test('keeps every track identity unique and every excerpt valid', () => {
  const keys = lyricsPool.map(({ album, trackNumber, title }) => [album, trackNumber, title].join('\0'));
  assert.equal(lyricsPool.length, 142);
  assert.equal(new Set(keys).size, keys.length);
  for (const track of lyricsPool) {
    const lines = parseLyricLines(track.text);
    assert.ok(lines.length > 0 && lines.length <= MAX_LYRIC_LINES);
  }
});
